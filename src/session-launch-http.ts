/** Same-origin creation of complete seeded Agent RP Sessions on public DSH. */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { normalize as normalizePath, win32 as win32Path } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { CharacterLibrary } from './character-library.ts'
import {
  jsonResponse as json,
  readJsonRequest,
  trustedBrowserRequest,
  type AgentRpHttpServer,
} from './host-http.ts'
import {
  prepareAgentRpRewriteSession,
  prepareAgentRpSession,
  parseAgentRpSessionLaunchRequest,
} from './session-launch.ts'
import { AGENT_RP_SESSION_PATH } from './session-launch-protocol.ts'
import type { PresetLibrary } from './preset-library.ts'
import { SillyTavernChatLibrary } from './sillytavern-chat-library.ts'
import { WorldInfoLibrary } from './world-info-library.ts'
import { appendAgentRpMemorySeed, readAgentRpMemoryHistory } from './memory.ts'
import { readActiveSessionCharacter } from './import/session-character.ts'
import type { RoleplayResourceCatalog } from './roleplay-resource-catalog.ts'
import {
  agentHasAgentRpRuntime,
  resolveAgentRpCapabilityPreset,
  type AgentPresetGateway,
} from './agent-capability-preset.ts'
import { AGENT_RP_PRESET_ID } from './preset.ts'
import { createStoryWorkspaceSessionSeed } from './session-story-workspace.ts'
import type { StoryWorkspaceStore } from './story-workspace.ts'

const MAX_REQUEST_BYTES = 32 * 1024

interface LaunchWorkspace {
  readonly id: string
  readonly path?: string
  readonly sessionIds: readonly SessionId[]
  attachSession(sessionId: SessionId): Promise<void>
}

interface WorkspaceGateway {
  list(): readonly LaunchWorkspace[]
  resolveByPath?(path: string): Promise<LaunchWorkspace | undefined>
}

interface SessionTitleGateway {
  get(session: Agent['session']): { readonly title: string } | undefined
  rename(session: Agent['session'], title: string): unknown
}

/** Normalize a workspace path for conservative same-directory fallback matching. */
export function normalizeWorkspacePath(value: string): string {
  const trimmed = trimTrailingPathSeparators(value)
  const windowsStyle = /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\')
  const normalized = windowsStyle ? win32Path.normalize(trimmed) : normalizePath(trimmed)
  const caseInsensitive = windowsStyle || process.platform === 'win32'
  return caseInsensitive ? normalized.toLowerCase() : normalized
}

/** Compare workspace paths without guessing filesystem aliases or volume case rules. */
export function sameWorkspacePath(left: string, right: string): boolean {
  if (left === '' || right === '') return false
  return normalizeWorkspacePath(left) === normalizeWorkspacePath(right)
}

function trimTrailingPathSeparators(value: string): string {
  if (/^[A-Za-z]:[\\/]$/.test(value)) return value
  if (/^[\\/]+$/u.test(value)) return value
  return value.replace(/[\\/]+$/u, '')
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  return readJsonRequest(request, {
    limit: MAX_REQUEST_BYTES,
    emptyMessage: '角色会话启动请求为空',
    tooLargeMessage: '角色会话启动请求过大',
    invalidMessage: '角色会话启动请求不是有效 JSON',
  })
}

/** Create an Agent whose constructor sees the complete imported history. */
export async function launchAgentRpSession(
  ctx: Context,
  characters: CharacterLibrary,
  chats: SillyTavernChatLibrary,
  presetLibrary: PresetLibrary,
  worldInfos: WorldInfoLibrary,
  input: unknown,
  resources?: RoleplayResourceCatalog,
  storyWorkspaces?: StoryWorkspaceStore,
): Promise<{
  readonly sessionId: SessionId
  readonly title: string
  readonly seed: readonly SessionEvent[]
  readonly workspaceWarning?: string
}> {
  const request = parseAgentRpSessionLaunchRequest(input)
  const sourceId = SessionId(request.sourceSessionId)
  const agents = ctx.get('agents') as Context['agents'] | undefined
  if (agents === undefined) throw new Error('当前 Host 无法创建角色会话')
  const sessionController = ctx.get('sessionController')
  if (sessionController === undefined) throw new Error('当前 Host 无法读取来源会话')
  const sourceResult = await sessionController.resolveAgent(sourceId)
  if ('error' in sourceResult) throw new Error(sourceResult.error.message)
  const source = sourceResult.agent
  const sessionProjections = ctx.get('sessionProjections')
  if (sessionProjections === undefined) throw new Error('当前 Host 无法读取来源会话模型')
  const sourceModelProjection = sessionProjections.snapshot(source.session).values.modelSelection
  if (sourceModelProjection === undefined) throw new Error('来源会话缺少模型选择投影')
  const sourceModel: ModelSelection = sourceModelProjection.next
    ?? (await sessionController.modelCatalog()).default

  const agentPresets = ctx.get('agentPresets') as AgentPresetGateway | undefined
  if (agentPresets === undefined) throw new Error('当前 Host 无法挂载角色会话预设')
  const requestedAgentPreset = request.kind === 'rewrite'
    ? source.session.header.agentPreset
    : request.agentPresetId ?? AGENT_RP_PRESET_ID
  if (requestedAgentPreset === undefined) throw new Error('来源角色会话没有记录 Agent 能力预设')
  const preset = await resolveAgentRpCapabilityPreset(agentPresets, requestedAgentPreset)
  const titles = ctx.get('sessionTitle') as SessionTitleGateway | undefined
  if (request.kind === 'rewrite') {
    if (!agentHasAgentRpRuntime(agentPresets, source)) throw new Error('只能改写 Agent RP 角色会话')
    if (source.status !== 'idle' || source.inbox.hasPending) throw new Error('请等待当前回复完成后再改写')
  }
  let prepared
  if (request.kind === 'rewrite') {
    prepared = prepareAgentRpRewriteSession(source.session, request.turn, titles?.get(source.session)?.title)
  } else if (request.kind === 'story-workspace') {
    if (storyWorkspaces === undefined) throw new Error('当前 Host 没有可用的游玩场地目录')
    prepared = createStoryWorkspaceSessionSeed(storyWorkspaces, request.workspaceId)
  } else {
    prepared = prepareAgentRpSession(characters, chats, presetLibrary, worldInfos, request, resources)
  }
  if (request.kind === 'character' && request.memory === 'copy-active') {
    if (!agentHasAgentRpRuntime(agentPresets, source)) throw new Error('只能从角色会话继承记忆')
    if (source.status !== 'idle' || source.inbox.hasPending) throw new Error('请等待当前回复完成后再继承记忆')
    const sourceCharacter = readActiveSessionCharacter(source.session.events)
    if (sourceCharacter?.result.libraryId !== request.characterId) throw new Error('只能把记忆带给同一个角色')
    const memory = readAgentRpMemoryHistory(source.session.events).active
    prepared = {
      ...prepared,
      seed: appendAgentRpMemorySeed(prepared.seed, memory, String(source.id)),
    }
  }
  const sessionId = SessionId(`session-${randomUUID()}`)
  const agentOptions: AgentOptions = {
    provider: sourceModel.provider,
    model: sourceModel.model,
  }
  const handle = await agents.create({
    sessionId,
    seed: prepared.seed,
    agentOptions,
    meta: {
      ...(source.session.header.cwd === undefined ? {} : { cwd: source.session.header.cwd }),
      ...(request.kind === 'rewrite' ? { parentSession: source.id, seedLength: prepared.seed.length } : {}),
      agentPreset: preset.id,
    },
    setup: async agentCtx => { await agentPresets.mount(agentCtx, preset.id) },
  })
  if (!agentHasAgentRpRuntime(agentPresets, handle.agent)) {
    await handle.dispose()
    throw new Error('所选 Agent 能力预设没有成功挂载 Agent RP 角色运行时')
  }
  try {
    await sessionController.selectModel({
      sessionId,
      provider: sourceModel.provider,
      model: sourceModel.model,
      ...(sourceModel.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: sourceModel.reasoningEffort }),
    })
  } catch (error: unknown) {
    await handle.dispose()
    throw error
  }

  if (titles !== undefined) {
    try {
      titles.rename(handle.agent.session, prepared.title)
    } catch (error: unknown) {
      ctx.logger.warn(`agent-rp: Session ${JSON.stringify(sessionId)} title was not applied: ${String(error)}`)
    }
  }
  let workspaceWarning: string | undefined
  try {
    const workspaces = (ctx.get('workspace') ?? ctx.get('workspaceRegistry')) as WorkspaceGateway | undefined
    if (workspaces === undefined) {
      workspaceWarning = '当前 DSH 没有可用的工作区服务，新角色会话保留在“未分组”'
    } else {
      const listed = workspaces.list()
      const sourceCwd = source.session.header.cwd
      const byMembership = listed.find(item => item.sessionIds.includes(sourceId))
      let workspace = byMembership
      if (workspace === undefined && sourceCwd !== undefined) {
        workspace = await workspaces.resolveByPath?.(sourceCwd)
        if (workspace === undefined) {
          const byCwd = listed.filter(item => item.path !== undefined && sameWorkspacePath(item.path, sourceCwd))
          if (byCwd.length === 1) {
            workspace = byCwd[0]
          } else if (byCwd.length > 1) {
            workspaceWarning = '多个工作区与来源工作目录匹配，拒绝猜测，新角色会话保留在“未分组”'
          }
        }
      }
      if (workspace === undefined) {
        workspaceWarning ??= sourceCwd === undefined
          ? '来源会话没有工作目录，新角色会话保留在“未分组”'
          : '没有找到来源工作目录对应的工作区，新角色会话保留在“未分组”'
      } else {
        await workspace.attachSession(sessionId)
      }
    }
  } catch (error: unknown) {
    workspaceWarning = `工作区挂靠失败：${error instanceof Error ? error.message : String(error)}`
  }
  if (workspaceWarning !== undefined) {
    ctx.logger.warn(`agent-rp: Session ${JSON.stringify(sessionId)} remains ungrouped: ${workspaceWarning}`)
  }
  if (request.kind === 'rewrite') {
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: request.text }],
      source: { kind: 'user' },
    }))
  }
  return {
    sessionId,
    title: prepared.title,
    seed: prepared.seed,
    ...(workspaceWarning === undefined ? {} : { workspaceWarning }),
  }
}

/** Register the current-public-DSH bridge for seeded Session creation. */
export function installSessionLaunchHttp(
  routeCtx: Context,
  hostCtx: Context,
  characters: CharacterLibrary,
  chats: SillyTavernChatLibrary,
  presets: PresetLibrary,
  worldInfos: WorldInfoLibrary,
  resources: RoleplayResourceCatalog,
  server: AgentRpHttpServer,
  storyWorkspaces?: StoryWorkspaceStore,
): void {
  routeCtx.effect(() => server.register({
    kind: 'exact',
    path: AGENT_RP_SESSION_PATH,
    async handler(request, response) {
      if (!trustedBrowserRequest(request)) {
        json(response, 403, { error: 'forbidden' })
        return
      }
      if (request.method !== 'POST') {
        response.setHeader('allow', 'POST')
        json(response, 405, { error: 'method not allowed' })
        return
      }
      try {
        const result = await launchAgentRpSession(
          hostCtx,
          characters,
          chats,
          presets,
          worldInfos,
          await readJson(request),
          resources,
          storyWorkspaces,
        )
        json(response, 200, {
          format: 0,
          sessionId: result.sessionId,
          title: result.title,
          ...(result.workspaceWarning === undefined ? {} : { workspaceWarning: result.workspaceWarning }),
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        json(response, /过大/u.test(message) ? 413 : 400, { error: message })
      }
    },
  }), 'agent-rp: seeded Session launch HTTP')
}
