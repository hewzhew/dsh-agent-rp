import assert from 'node:assert/strict'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { Session, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import { installAgentRpCommandHttp } from '../src/agent-rp-command-http.ts'
import {
  AGENT_RP_COMMAND_PATH,
  parseAgentRpCommandRequest,
} from '../src/agent-rp-command-protocol.ts'
import type { AgentRpHttpServer } from '../src/host-http.ts'
import { agentRpPresetGateway } from './agent-preset-fixture.ts'
import { sessionEvents } from '../src/session-events.ts'

type RegisteredRoute = Parameters<AgentRpHttpServer['register']>[0]

function roleplayAgent(id: string): Agent {
  const sessionId = SessionId(id)
  const header: SessionHeader = {
    version: 0,
    id: sessionId,
    createdAt: 1_800_000_000_000,
    isSeeded: false,
    agentPreset: 'agent-rp',
  }
  return { session: Session.create(sessionId, [], header) } as Agent
}

function routeFor(services: Readonly<Record<string, unknown>>): RegisteredRoute {
  let route: RegisteredRoute | undefined
  const routeCtx = { effect(register: () => unknown) { register() } } as unknown as Context
  const hostCtx = { get(name: string) { return services[name] } } as unknown as Context
  const server: AgentRpHttpServer = {
    register(next) {
      route = next
      return () => {}
    },
  }
  installAgentRpCommandHttp(routeCtx, hostCtx, server)
  assert.ok(route)
  assert.equal(route.kind, 'exact')
  assert.equal(route.path, AGENT_RP_COMMAND_PATH)
  return route
}

async function invoke(route: RegisteredRoute, options: {
  readonly method?: string
  readonly headers?: IncomingHttpHeaders
  readonly body?: string
} = {}): Promise<{ readonly status: number; readonly json: unknown; readonly headers: Readonly<Record<string, string>> }> {
  const request = Object.assign(Readable.from(options.body === undefined ? [] : [options.body]), {
    method: options.method ?? 'POST',
    headers: {
      host: '127.0.0.1:3091',
      origin: 'http://127.0.0.1:3091',
      'sec-fetch-site': 'same-origin',
      ...options.headers,
    } satisfies IncomingHttpHeaders,
  }) as unknown as IncomingMessage
  let status: number | undefined
  let body = Buffer.alloc(0)
  const headers = new Map<string, string>()
  const response = {
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value))
      return response
    },
    writeHead(value: number, values?: Readonly<Record<string, string | number | readonly string[]>>) {
      status = value
      for (const [name, header] of Object.entries(values ?? {})) {
        headers.set(name.toLowerCase(), Array.isArray(header) ? header.join(', ') : String(header))
      }
      return response
    },
    end(value?: string | Uint8Array) {
      if (value !== undefined) body = Buffer.from(value)
      return response
    },
  } as unknown as ServerResponse
  await route.handler(request, response)
  assert.notEqual(status, undefined)
  return { status: status!, json: JSON.parse(body.toString('utf8')) as unknown, headers: Object.fromEntries(headers) }
}

function request(sessionId: string, line: string): string {
  return JSON.stringify({ format: 0, sessionId, line })
}

test('accepts only the explicit Agent RP command vocabulary', () => {
  assert.equal(parseAgentRpCommandRequest({
    format: 0,
    sessionId: ' session-roleplay ',
    line: '/rp-state {"format":0}',
  }).sessionId, 'session-roleplay')
  assert.throws(() => parseAgentRpCommandRequest({
    format: 0,
    sessionId: 'session-roleplay',
    line: '/goal replace the user goal',
  }), /不属于 Agent RP/u)
  assert.throws(() => parseAgentRpCommandRequest({
    format: 0,
    sessionId: 'session-roleplay',
    line: 'rp-state',
  }), /不属于 Agent RP/u)
})

test('enforces same-origin POST requests before resolving a Session', async () => {
  const route = routeFor({})
  const crossSite = await invoke(route, {
    body: request('session-roleplay', '/rp-state {}'),
    headers: { origin: 'https://example.test', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(crossSite.status, 403)
  const method = await invoke(route, { method: 'GET' })
  assert.equal(method.status, 405)
  assert.equal(method.headers.allow, 'POST')
})

test('routes published rc.2 commands through the four-argument executor and preserves its lifecycle', async () => {
  const agent = roleplayAgent('session-published-command')
  const commandId = CommandId('agent-rp-http-published')
  let receivedImages: readonly unknown[] | undefined
  let receivedSignal: AbortSignal | undefined
  const commands = {
    async execute(target: Agent, line: string, images: readonly unknown[], signal: AbortSignal) {
      assert.equal(target, agent)
      assert.match(line, /^\/rp-state /u)
      receivedImages = images
      receivedSignal = signal
      target.session.append('command/run', { commandId, name: 'rp-state', source: { kind: 'user' } })
      target.session.append('command/done', { commandId, kind: 'success', text: 'agent-rp-state-v0:{}' })
      return { commandId }
    },
  }
  const route = routeFor({
    agents: { get: (id: SessionId) => id === agent.session.id ? agent : undefined },
    agentPresets: agentRpPresetGateway({ active: agent }),
    commands,
  })
  const result = await invoke(route, { body: request(String(agent.session.id), '/rp-state {"format":0}') })
  assert.deepEqual(result.json, { format: 0, matched: true, commandId })
  assert.deepEqual(receivedImages, [])
  assert.equal(receivedSignal?.aborted, false)
  assert.deepEqual(sessionEvents(agent.session)
    .filter(event => event.type === 'command/run' || event.type === 'command/done')
    .map(event => event.type), ['command/run', 'command/done'])
})

test('resumes a cold Agent RP Session and supports the newer three-argument executor', async () => {
  const agent = roleplayAgent('session-cold-command')
  let live: Agent | undefined
  let mounted = 0
  let resumed = 0
  let receivedSignal: AbortSignal | undefined
  const agents = {
    get: () => live,
    async resume(options: {
      readonly resumeSessionId: SessionId
      readonly setup?: (ctx: Context) => unknown | Promise<unknown>
    }) {
      assert.equal(options.resumeSessionId, agent.session.id)
      await options.setup?.({} as Context)
      resumed += 1
      live = agent
      return { agent }
    },
  }
  const commands = {
    async execute(_target: Agent, line: string, signal: AbortSignal) {
      assert.equal(line, '/rp-tavern-trigger')
      receivedSignal = signal
      return { commandId: CommandId('agent-rp-http-current') }
    },
  }
  const route = routeFor({
    agents,
    commands,
    sessionPersistence: {
      async inspect(id: SessionId) {
        assert.equal(id, agent.session.id)
        return { meta: agent.session.header }
      },
    },
    agentPresets: agentRpPresetGateway({ active: agent, onMount: () => { mounted += 1 } }),
  })
  const result = await invoke(route, { body: request(String(agent.session.id), '/rp-tavern-trigger') })
  assert.deepEqual(result.json, { format: 0, matched: true, commandId: 'agent-rp-http-current' })
  assert.equal(resumed, 1)
  assert.equal(mounted, 1)
  assert.equal(receivedSignal?.aborted, false)
})

test('rejects non-roleplay Sessions and non-Agent-RP commands without invoking the executor', async () => {
  const sessionId = SessionId('session-not-roleplay')
  const agent = { session: Session.create(sessionId) } as Agent
  let executions = 0
  const route = routeFor({
    agents: { get: () => agent },
    agentPresets: agentRpPresetGateway(),
    commands: { async execute() { executions += 1; return undefined } },
  })
  const wrongSession = await invoke(route, { body: request(String(sessionId), '/rp-state {}') })
  assert.equal(wrongSession.status, 400)
  assert.match(JSON.stringify(wrongSession.json), /角色会话当前不可用/u)
  const wrongCommand = await invoke(route, { body: request(String(sessionId), '/goal escape') })
  assert.equal(wrongCommand.status, 400)
  assert.match(JSON.stringify(wrongCommand.json), /不属于 Agent RP/u)
  assert.equal(executions, 0)
})
