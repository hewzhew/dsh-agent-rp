/** Same-origin read route for content-free Roleplay turn lifecycle health. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  jsonResponse as json,
  trustedBrowserRequest,
  type AgentRpHttpServer,
} from './host-http.ts'
import {
  AGENT_RP_TURN_HEALTH_PATH,
  type AgentRpTurnHealthDiagnostic,
} from './roleplay-turn-health-protocol.ts'
import { summarizeRoleplayTurnHealth } from './roleplay-turn-health.ts'
import { readRoleplayTurnRecords } from './roleplay-turn-record.ts'
import { agentHasAgentRpRuntime, type AgentPresetGateway } from './agent-capability-preset.ts'
import { sessionEvents } from './session-events.ts'

interface AgentRegistryGateway {
  get(sessionId: SessionId): Agent | undefined
}

/** Register a local-only inspector that never serializes Session content or identity. */
export function installRoleplayTurnHealthHttp(routeCtx: Context, hostCtx: Context, server: AgentRpHttpServer): void {
  const cache = new WeakMap<Agent['session'], {
    readonly eventCount: number
    readonly value: AgentRpTurnHealthDiagnostic
  }>()
  routeCtx.effect(() => server.register({
    kind: 'exact',
    path: AGENT_RP_TURN_HEALTH_PATH,
    handler(request, response) {
      if (!trustedBrowserRequest(request)) {
        json(response, 403, { error: 'forbidden' })
        return
      }
      if (request.method !== 'GET') {
        response.setHeader('allow', 'GET')
        json(response, 405, { error: 'method not allowed' })
        return
      }
      try {
        const url = new URL(request.url ?? '/', 'http://agent-rp.local')
        const sourceSessionId = url.searchParams.get('sessionId')?.trim()
        if (sourceSessionId === undefined || sourceSessionId === '' || sourceSessionId.length > 512) {
          throw new Error('角色会话编号无效')
        }
        const agent = (hostCtx.get('agents') as AgentRegistryGateway | undefined)?.get(SessionId(sourceSessionId))
        const presets = hostCtx.get('agentPresets') as AgentPresetGateway | undefined
        if (presets === undefined || !agentHasAgentRpRuntime(presets, agent)) {
          throw new Error('角色会话当前不可用')
        }
        const cached = cache.get(agent.session)
        let value = cached?.eventCount === sessionEvents(agent.session).length ? cached.value : undefined
        if (value === undefined) {
          try {
            value = {
              format: 0,
              status: 'ready',
              health: summarizeRoleplayTurnHealth(readRoleplayTurnRecords(agent.session)),
            }
          } catch {
            value = { format: 0, status: 'invalid' }
          }
          cache.set(agent.session, { eventCount: sessionEvents(agent.session).length, value })
        }
        json(response, 200, value)
      } catch (error: unknown) {
        json(response, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'agent-rp: turn health HTTP')
}
