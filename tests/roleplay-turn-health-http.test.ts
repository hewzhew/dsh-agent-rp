import assert from 'node:assert/strict'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { AgentRpHttpServer } from '../src/host-http.ts'
import {
  AGENT_RP_TURN_HEALTH_PATH,
  parseAgentRpTurnHealthDiagnostic,
} from '../src/roleplay-turn-health-protocol.ts'
import { installRoleplayTurnHealthHttp } from '../src/roleplay-turn-health-http.ts'
import { agentRpPresetGateway } from './agent-preset-fixture.ts'

type RegisteredRoute = Parameters<AgentRpHttpServer['register']>[0]

function roleplayAgent(id: string): Agent {
  const sessionId = SessionId(id)
  const header: SessionHeader = {
    version: 0, id: sessionId, createdAt: 1_800_000_000_000, isSeeded: false, agentPreset: 'agent-rp',
  }
  return { session: Session.create(sessionId, [], header) } as Agent
}

function routeFor(agent?: Agent): RegisteredRoute {
  let route: RegisteredRoute | undefined
  const routeCtx = { effect(register: () => unknown) { register() } } as unknown as Context
  const hostCtx = {
    get(name: string) {
      if (name === 'agents') return { get: (id: SessionId) => id === agent?.session.id ? agent : undefined }
      if (name === 'agentPresets') return agentRpPresetGateway(agent === undefined ? {} : { active: agent })
      return undefined
    },
  } as unknown as Context
  const server: AgentRpHttpServer = { register(next) { route = next; return () => {} } }
  installRoleplayTurnHealthHttp(routeCtx, hostCtx, server)
  assert.ok(route)
  assert.equal(route.path, AGENT_RP_TURN_HEALTH_PATH)
  return route
}

async function invoke(route: RegisteredRoute, options: {
  readonly method?: string
  readonly headers?: IncomingHttpHeaders
  readonly sessionId?: string
} = {}): Promise<{ readonly status: number; readonly json: unknown; readonly headers: Readonly<Record<string, string>> }> {
  const query = options.sessionId === undefined ? '' : `?sessionId=${encodeURIComponent(options.sessionId)}`
  const request = Object.assign(Readable.from([]), {
    method: options.method ?? 'GET',
    url: `${AGENT_RP_TURN_HEALTH_PATH}${query}`,
    headers: {
      host: '127.0.0.1:3091', origin: 'http://127.0.0.1:3091', 'sec-fetch-site': 'same-origin',
      ...options.headers,
    } satisfies IncomingHttpHeaders,
  }) as unknown as IncomingMessage
  let status = 0
  let body = Buffer.alloc(0)
  const headers = new Map<string, string>()
  const response = {
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value)); return response
    },
    writeHead(value: number, values?: Readonly<Record<string, string | number | readonly string[]>>) {
      status = value
      for (const [name, header] of Object.entries(values ?? {})) {
        headers.set(name.toLowerCase(), Array.isArray(header) ? header.join(', ') : String(header))
      }
      return response
    },
    end(value?: string | Uint8Array) { if (value !== undefined) body = Buffer.from(value); return response },
  } as unknown as ServerResponse
  await route.handler(request, response)
  return { status, json: JSON.parse(body.toString('utf8')) as unknown, headers: Object.fromEntries(headers) }
}

test('returns prepare-phase health without Session identity or message content', async () => {
  const agent = roleplayAgent('private-session-health')
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: 'private roleplay text' }],
  }), { surfaceOp: 'append' })
  const route = routeFor(agent)
  const response = await invoke(route, { sessionId: String(agent.session.id) })
  assert.equal(response.status, 200)
  const value = parseAgentRpTurnHealthDiagnostic(response.json)
  assert.equal(value.status, 'ready')
  assert.equal(value.status === 'ready' ? value.health.latest?.nextPhase : undefined, 'prepare')
  assert.doesNotMatch(JSON.stringify(response.json), /private|roleplay text|session-health/u)
  assert.equal(response.headers['cache-control'], 'no-store')

  agent.session.append('turn/start', { turn: 2 })
  const refreshed = parseAgentRpTurnHealthDiagnostic((await invoke(
    route, { sessionId: String(agent.session.id) },
  )).json)
  assert.equal(refreshed.status === 'ready' ? refreshed.health.turns : undefined, 2)
  assert.equal(refreshed.status === 'ready' ? refreshed.health.latest?.turn : undefined, 2)
})

test('collapses invalid causal records to one fixed content-free status', async () => {
  const agent = roleplayAgent('private-invalid-health')
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('turn/start', { turn: 1 })
  const response = await invoke(routeFor(agent), { sessionId: String(agent.session.id) })
  assert.equal(response.status, 200)
  assert.deepEqual(response.json, { format: 0, status: 'invalid' })
})

test('enforces same-origin GET and active Agent RP ownership', async () => {
  const route = routeFor()
  const forbidden = await invoke(route, {
    sessionId: 'missing', headers: { origin: 'https://example.test', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(forbidden.status, 403)
  const method = await invoke(route, { method: 'POST', sessionId: 'missing' })
  assert.equal(method.status, 405)
  assert.equal(method.headers.allow, 'GET')
  const missing = await invoke(route, { sessionId: 'missing' })
  assert.equal(missing.status, 400)
})
