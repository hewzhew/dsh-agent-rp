/** Same-origin download route for the active Roleplay transcript. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { cardFromImportMeta, readActiveSessionCharacter } from './import/session-character.ts'
import { readSillyTavernChatIdentity } from './import/sillytavern-chat-seed.ts'
import {
  jsonResponse as json,
  trustedBrowserRequest,
  type AgentRpHttpServer,
} from './host-http.ts'
import { resolveSessionPersonaIdentity } from './session-persona.ts'
import { exportSillyTavernSessionChat } from './sillytavern-chat-export.ts'
import { SILLYTAVERN_CHAT_EXPORT_PATH } from './sillytavern-chat-export-protocol.ts'
import { agentHasAgentRpRuntime, type AgentPresetGateway } from './agent-capability-preset.ts'
import { sessionEvents } from './session-events.ts'

interface AgentRegistryGateway {
  get(sessionId: SessionId): Agent | undefined
}

interface SessionTitleGateway {
  get(session: Agent['session']): { readonly title: string } | undefined
}

/** Register a Host-owned SillyTavern JSONL export for active Agent RP Sessions. */
export function installSillyTavernChatExportHttp(
  routeCtx: Context,
  hostCtx: Context,
  server: AgentRpHttpServer,
): void {
  routeCtx.effect(() => server.register({
    kind: 'exact',
    path: SILLYTAVERN_CHAT_EXPORT_PATH,
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
        const agents = hostCtx.get('agents') as AgentRegistryGateway | undefined
        const agent = agents?.get(SessionId(sourceSessionId))
        const presets = hostCtx.get('agentPresets') as AgentPresetGateway | undefined
        if (presets === undefined || !agentHasAgentRpRuntime(presets, agent)) throw new Error('角色会话当前不可用')
        if (agent.status !== 'idle' || agent.inbox.hasPending) throw new Error('请等待当前回复完成后再导出')
        const events = sessionEvents(agent.session)
        const activeCharacter = readActiveSessionCharacter(events)
        const card = activeCharacter === undefined ? undefined : cardFromImportMeta(activeCharacter.meta)
        const importedIdentity = readSillyTavernChatIdentity(events)
        const persona = resolveSessionPersonaIdentity(events, activeCharacter?.result.userName, importedIdentity?.userName)
        const title = (hostCtx.get('sessionTitle') as SessionTitleGateway | undefined)?.get(agent.session)?.title.trim()
        const characterName = card?.nickname?.trim() || card?.name.trim() || importedIdentity?.characterName.trim()
          || title || '角色'
        const exported = exportSillyTavernSessionChat(agent.session, {
          sessionId: sourceSessionId,
          characterName,
          userName: persona.userName?.trim() || 'User',
        })
        const body = Buffer.from(exported.source, 'utf8')
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(exported.filename)}`,
          'content-length': String(body.byteLength),
          'content-type': 'application/x-ndjson; charset=utf-8',
          'x-agent-rp-filename': encodeURIComponent(exported.filename),
          'x-agent-rp-message-count': String(exported.messageCount),
        })
        response.end(body)
      } catch (error: unknown) {
        json(response, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'agent-rp: SillyTavern chat export HTTP')
}
