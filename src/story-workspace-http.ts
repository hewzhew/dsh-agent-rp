/** Same-origin HTTP surface for editable story workspaces. */

import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  jsonResponse as json,
  readJsonRequest,
  trustedBrowserRequest,
  type AgentRpHttpServer,
} from './host-http.ts'
import {
  STORY_WORKSPACES_PATH,
  type StoryResearchAcceptRequest,
  type StorySourceRefreshRequest,
  type StorySourceUrlImportRequest,
  type StoryWorkspaceCreateRequest,
  type StoryCharacterActorBindRequest,
  type StoryWorkspaceSaveRequest,
  type StoryWorkspaceSnapshot,
} from './story-workspace-protocol.ts'
import type { RoleplayResourceCatalog } from './roleplay-resource-catalog.ts'
import {
  PLAY_WORLD_RESOURCES_PATH,
  type PlayWorldActionRequest,
  type PlayWorldCastSelection,
  type PlayWorldCastUpdateRequest,
  type PlayWorldConfigurationUpdateRequest,
  type PlayWorldInstallRequest,
  type PlayWorldRestartRequest,
  type PlayWorldSurfaceProjection,
  type PlayWorldTurnProjection,
} from './play-world-protocol.ts'
import { createStorySourceId, StoryWorkspaceStore } from './story-workspace.ts'
import { fetchStoryWebPage, storyWebFetchAvailable, storyWebSearchAvailable } from './story-web.ts'

const MAX_STORY_WORKSPACE_REQUEST_BYTES = 17 * 1024 * 1024

async function readJson(request: IncomingMessage): Promise<unknown> {
  return readJsonRequest(request, {
    limit: MAX_STORY_WORKSPACE_REQUEST_BYTES,
    emptyMessage: '故事工作区请求为空',
    tooLargeMessage: '故事工作区请求过大',
    invalidMessage: '故事工作区请求不是有效 JSON',
  })
}

function requestRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('故事工作区请求不是对象')
  return value as Record<string, unknown>
}

function parseCreateRequest(value: unknown): StoryWorkspaceCreateRequest {
  const record = requestRecord(value)
  if (record.format !== 2 || typeof record.name !== 'string'
    || Object.keys(record).some(key => key !== 'format' && key !== 'name')) {
    throw new Error('故事工作区创建请求字段无效')
  }
  return record as unknown as StoryWorkspaceCreateRequest
}

function parseSaveRequest(value: unknown, id: string): StoryWorkspaceSaveRequest {
  const record = requestRecord(value)
  const keys = new Set(['format', 'id', 'revision', 'name', 'pipeline', 'graph', 'characters', 'facts', 'events', 'outputs', 'sources', 'citations', 'researchInbox'])
  if (record.format !== 2 || record.id !== id || typeof record.revision !== 'number'
    || typeof record.name !== 'string' || typeof record.pipeline !== 'object' || record.pipeline === null
    || Array.isArray(record.pipeline) || typeof record.graph !== 'object' || record.graph === null
    || Array.isArray(record.graph) || !Array.isArray(record.characters) || !Array.isArray(record.facts)
    || !Array.isArray(record.events) || !Array.isArray(record.outputs) || !Array.isArray(record.sources)
    || !Array.isArray(record.citations) || !Array.isArray(record.researchInbox)
    || Object.keys(record).some(key => !keys.has(key))) {
    throw new Error('故事工作区保存请求字段无效')
  }
  return record as unknown as StoryWorkspaceSaveRequest
}

function parseWorldInstallRequest(value: unknown): PlayWorldInstallRequest {
  const record = requestRecord(value)
  const resource = record.resource
  if (record.format !== 0 || typeof record.revision !== 'number'
    || typeof resource !== 'object' || resource === null || Array.isArray(resource)
    || (resource as { readonly kind?: unknown }).kind !== 'world'
    || typeof (resource as { readonly id?: unknown }).id !== 'string'
    || Object.keys(resource).some(key => key !== 'kind' && key !== 'id' && key !== 'variant')
    || parseWorldCastSelections(record.cast) === undefined
    || Object.keys(record).some(key => key !== 'format' && key !== 'revision' && key !== 'resource' && key !== 'cast')) {
    throw new Error('游玩世界安装请求字段无效')
  }
  return record as unknown as PlayWorldInstallRequest
}

function parseWorldCastSelections(value: unknown): readonly PlayWorldCastSelection[] | undefined {
  if (!Array.isArray(value) || value.length > 64 || value.some(selection => {
    if (typeof selection !== 'object' || selection === null || Array.isArray(selection)) return true
    const item = selection as Record<string, unknown>
    const actor = item.actor
    return typeof item.slotId !== 'string'
      || typeof actor !== 'object' || actor === null || Array.isArray(actor)
      || (actor as { readonly kind?: unknown }).kind !== 'actor'
      || typeof (actor as { readonly id?: unknown }).id !== 'string'
      || Object.keys(actor).some(key => key !== 'kind' && key !== 'id' && key !== 'variant')
      || item.characterId !== undefined && typeof item.characterId !== 'string'
      || Object.keys(item).some(key => key !== 'slotId' && key !== 'actor' && key !== 'characterId')
  })) return undefined
  return value as unknown as readonly PlayWorldCastSelection[]
}

function parseWorldCastUpdateRequest(value: unknown): PlayWorldCastUpdateRequest {
  const record = requestRecord(value)
  const cast = parseWorldCastSelections(record.cast)
  if (record.format !== 0 || typeof record.revision !== 'number' || cast === undefined
    || Object.keys(record).some(key => key !== 'format' && key !== 'revision' && key !== 'cast')) {
    throw new Error('游玩世界阵容更新请求字段无效')
  }
  return { format: 0, revision: record.revision, cast }
}

function parseWorldRestartRequest(value: unknown): PlayWorldRestartRequest {
  const record = requestRecord(value)
  if (record.format !== 0 || typeof record.revision !== 'number'
    || Object.keys(record).some(key => key !== 'format' && key !== 'revision')) {
    throw new Error('游玩世界重新开局请求字段无效')
  }
  return record as unknown as PlayWorldRestartRequest
}

function parseWorldConfigurationUpdateRequest(value: unknown): PlayWorldConfigurationUpdateRequest {
  const record = requestRecord(value)
  const configuration = snapshotJsonValue(record.configuration) as JsonValue | undefined
  if (record.format !== 0 || typeof record.revision !== 'number' || configuration === undefined
    || Buffer.byteLength(JSON.stringify(configuration), 'utf8') > 1024 * 1024
    || Object.keys(record).some(key => key !== 'format' && key !== 'revision' && key !== 'configuration')) {
    throw new Error('游玩世界配置更新请求字段无效')
  }
  return { format: 0, revision: record.revision, configuration }
}

function parseWorldActionRequest(value: unknown): PlayWorldActionRequest {
  const record = requestRecord(value)
  if (record.format !== 0 || typeof record.revision !== 'number'
    || typeof record.cycleId !== 'string' || typeof record.actionId !== 'string'
    || Object.keys(record).some(key => !['format', 'revision', 'cycleId', 'actionId'].includes(key))) {
    throw new Error('游玩世界动作请求字段无效')
  }
  return record as unknown as PlayWorldActionRequest
}

function workspaceResponse(ctx: Context, store: StoryWorkspaceStore, workspace: StoryWorkspaceSnapshot): {
  readonly format: 1
  readonly workspace: StoryWorkspaceSnapshot
  readonly worldTurn: PlayWorldTurnProjection | null
  readonly worldSurface: PlayWorldSurfaceProjection | null
  readonly worldModuleAvailable: boolean | null
  readonly webFetchAvailable: boolean
  readonly webSearchAvailable: boolean
} {
  return {
    format: 1,
    workspace,
    worldTurn: store.worldTurn(workspace.id) ?? null,
    worldSurface: store.worldSurface(workspace.id) ?? null,
    worldModuleAvailable: workspace.world === undefined ? null : store.worlds.has(workspace.world.moduleId),
    webFetchAvailable: storyWebFetchAvailable(ctx),
    webSearchAvailable: storyWebSearchAvailable(ctx),
  }
}

function parseActorBindRequest(value: unknown, characterId: string): StoryCharacterActorBindRequest {
  const record = requestRecord(value)
  const actor = record.actor
  if (record.format !== 0 || typeof record.revision !== 'number' || record.characterId !== characterId
    || (actor !== undefined && (typeof actor !== 'object' || actor === null || Array.isArray(actor)
      || (actor as { readonly kind?: unknown }).kind !== 'actor'
      || typeof (actor as { readonly id?: unknown }).id !== 'string'
      || Object.keys(actor).some(key => key !== 'kind' && key !== 'id' && key !== 'variant')))
    || Object.keys(record).some(key => key !== 'format' && key !== 'revision' && key !== 'characterId' && key !== 'actor')) {
    throw new Error('人物角色卡绑定请求字段无效')
  }
  return record as unknown as StoryCharacterActorBindRequest
}

function parseSourceUrlImportRequest(value: unknown): StorySourceUrlImportRequest {
  const record = requestRecord(value)
  if (record.format !== 0 || typeof record.revision !== 'number' || typeof record.url !== 'string'
    || record.name !== undefined && typeof record.name !== 'string'
    || record.kind !== 'original' && record.kind !== 'reference'
    || Object.keys(record).some(key => !['format', 'revision', 'url', 'name', 'kind'].includes(key))) {
    throw new Error('网址资料导入请求字段无效')
  }
  return record as unknown as StorySourceUrlImportRequest
}

function parseSourceRefreshRequest(value: unknown, sourceId: string): StorySourceRefreshRequest {
  const record = requestRecord(value)
  if (record.format !== 0 || typeof record.revision !== 'number' || record.sourceId !== sourceId
    || Object.keys(record).some(key => !['format', 'revision', 'sourceId'].includes(key))) {
    throw new Error('网页资料刷新请求字段无效')
  }
  return record as unknown as StorySourceRefreshRequest
}

function parseResearchAcceptRequest(value: unknown): StoryResearchAcceptRequest {
  const record = requestRecord(value)
  if (record.format !== 0 || typeof record.revision !== 'number' || typeof record.itemId !== 'string'
    || Object.keys(record).some(key => !['format', 'revision', 'itemId'].includes(key))) {
    throw new Error('网络研究收取请求字段无效')
  }
  return record as unknown as StoryResearchAcceptRequest
}

function sourceNameFromUrl(value: string): string {
  const url = new URL(value)
  const lastSegment = url.pathname.split('/').filter(Boolean).at(-1)
  if (lastSegment === undefined) return url.hostname
  try {
    return decodeURIComponent(lastSegment).slice(0, 120) || url.hostname
  } catch {
    return lastSegment.slice(0, 120) || url.hostname
  }
}

async function fetchSourcePage(ctx: Context, url: string): ReturnType<typeof fetchStoryWebPage> {
  let fetched
  try {
    fetched = await fetchStoryWebPage(ctx, url)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (/资料 URL 必须|没有可用的网页正文读取能力|最终 URL/u.test(message)) throw error
    throw new Error(`网页读取失败：${message}`, { cause: error })
  }
  if (fetched.statusCode < 200 || fetched.statusCode >= 300) {
    throw new Error(`网页读取失败：HTTP ${String(fetched.statusCode)}`)
  }
  if (fetched.content.trim() === '') throw new Error('网页读取失败：页面没有可导入的正文')
  return fetched
}

function responseStatus(message: string): number {
  if (/请求过大|不能超过/u.test(message)) return 413
  if (/当前 revision|回合已经变化|动作不再合法/u.test(message)) return 409
  if (/无法读取故事工作区/u.test(message)) return 404
  if (/没有可用的网页正文读取能力/u.test(message)) return 503
  if (/网页读取失败/u.test(message)) return 502
  return 400
}

/** Register story workspace list, read, create, save, and delete operations. */
export function installStoryWorkspaceHttp(
  ctx: Context,
  store: StoryWorkspaceStore,
  server: AgentRpHttpServer,
  resources?: RoleplayResourceCatalog,
): void {
  ctx.effect(() => server.register({
    kind: 'exact',
    path: PLAY_WORLD_RESOURCES_PATH,
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
      json(response, 200, { format: 0, worlds: store.worldResources() })
    },
  }), 'agent-rp: play world module HTTP')
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: STORY_WORKSPACES_PATH,
    async handler(request, response) {
      if (!trustedBrowserRequest(request)) {
        json(response, 403, { error: 'forbidden' })
        return
      }
      const pathname = new URL(request.url ?? '/', 'http://agent-rp.local').pathname
      const suffix = pathname === STORY_WORKSPACES_PATH ? '' : pathname.slice(STORY_WORKSPACES_PATH.length + 1)
      const segments = suffix === '' ? [] : suffix.split('/').map(segment => decodeURIComponent(segment))
      const id = segments.length === 1 ? segments[0] : undefined
      try {
        if (request.method === 'GET' && suffix === '') {
          json(response, 200, { format: 1, workspaces: store.list() })
          return
        }
        if (request.method === 'POST' && suffix === '') {
          const workspace = store.create(parseCreateRequest(await readJson(request)))
          json(response, 201, workspaceResponse(ctx, store, workspace))
          return
        }
        if (request.method === 'POST' && segments.length === 2 && segments[1] === 'world') {
          const workspace = store.installWorld(segments[0]!, parseWorldInstallRequest(await readJson(request)))
          json(response, 200, workspaceResponse(ctx, store, workspace))
          return
        }
        if (request.method === 'POST' && segments.length === 3 && segments[1] === 'world' && segments[2] === 'restart') {
          const workspace = store.restartWorld(segments[0]!, parseWorldRestartRequest(await readJson(request)))
          json(response, 200, workspaceResponse(ctx, store, workspace))
          return
        }
        if (request.method === 'POST' && segments.length === 3 && segments[1] === 'world' && segments[2] === 'cast') {
          const workspace = store.updateWorldCast(segments[0]!, parseWorldCastUpdateRequest(await readJson(request)))
          json(response, 200, workspaceResponse(ctx, store, workspace))
          return
        }
        if (request.method === 'POST' && segments.length === 3 && segments[1] === 'world' && segments[2] === 'configuration') {
          const workspace = store.updateWorldConfiguration(
            segments[0]!, parseWorldConfigurationUpdateRequest(await readJson(request)),
          )
          json(response, 200, workspaceResponse(ctx, store, workspace))
          return
        }
        if (request.method === 'POST' && segments.length === 3 && segments[1] === 'world' && segments[2] === 'actions') {
          const workspace = store.dispatchWorldAction(segments[0]!, parseWorldActionRequest(await readJson(request)))
          json(response, 200, workspaceResponse(ctx, store, workspace))
          return
        }
        if (request.method === 'POST' && segments.length === 4 && segments[1] === 'characters' && segments[3] === 'actor') {
          const binding = parseActorBindRequest(await readJson(request), segments[2]!)
          if (binding.actor !== undefined && resources === undefined) throw new Error('当前 Host 没有可用的角色资源目录')
          const result = store.bindCharacterActor(
            segments[0]!, binding, binding.actor === undefined ? undefined : resources!.projectActor(binding.actor),
          )
          json(response, 200, {
            ...workspaceResponse(ctx, store, result.workspace),
            actorSync: result.sync,
          })
          return
        }
        if (request.method === 'POST' && segments.length === 4 && segments[1] === 'sources' && segments[3] === 'refresh') {
          const input = parseSourceRefreshRequest(await readJson(request), segments[2]!)
          const current = store.get(segments[0]!)
          if (!Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision !== current.revision) {
            throw new Error(`故事工作室已更新；当前 revision 为 ${String(current.revision)}`)
          }
          const source = current.sources.find(candidate => candidate.id === input.sourceId)
          if (source === undefined) throw new Error('要刷新的网页资料不存在')
          if (source.origin?.kind !== 'url') throw new Error('只有直接从网址导入的资料可以刷新')
          const fetched = await fetchSourcePage(ctx, source.origin.requestedUrl ?? source.origin.url)
          const result = store.refreshUrlSource(segments[0]!, input.revision, input.sourceId, fetched.content, {
            kind: 'url',
            url: fetched.url,
            ...(fetched.requestedUrl === fetched.url ? {} : { requestedUrl: fetched.requestedUrl }),
            truncated: fetched.truncated,
          })
          json(response, 200, {
            ...workspaceResponse(ctx, store, result.workspace),
            sourceRefresh: result.report,
          })
          return
        }
        if (request.method === 'POST' && segments.length === 3 && segments[1] === 'sources' && segments[2] === 'url') {
          const input = parseSourceUrlImportRequest(await readJson(request))
          const current = store.get(segments[0]!)
          if (!Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision !== current.revision) {
            throw new Error(`故事工作室已更新；当前 revision 为 ${String(current.revision)}`)
          }
          const fetched = await fetchSourcePage(ctx, input.url)
          const sourceId = createStorySourceId()
          const workspace = store.appendSource(segments[0]!, input.revision, {
            id: sourceId,
            name: input.name?.trim() || sourceNameFromUrl(fetched.url),
            kind: input.kind,
            enabled: true,
            content: fetched.content,
            origin: {
              kind: 'url',
              url: fetched.url,
              ...(fetched.requestedUrl === fetched.url ? {} : { requestedUrl: fetched.requestedUrl }),
              truncated: fetched.truncated,
            },
          })
          json(response, 201, {
            ...workspaceResponse(ctx, store, workspace),
            sourceImport: { sourceId, truncated: fetched.truncated },
          })
          return
        }
        if (request.method === 'POST' && segments.length === 3 && segments[1] === 'sources' && segments[2] === 'research') {
          const input = parseResearchAcceptRequest(await readJson(request))
          const current = store.get(segments[0]!)
          if (!Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision !== current.revision) {
            throw new Error(`故事工作室已更新；当前 revision 为 ${String(current.revision)}`)
          }
          const item = current.researchInbox.find(candidate => candidate.id === input.itemId)
          if (item === undefined) throw new Error('要收取的网络研究结果不存在')
          const fetched = await fetchSourcePage(ctx, item.url)
          const sourceId = createStorySourceId()
          const workspace = store.appendSource(segments[0]!, input.revision, {
            id: sourceId,
            name: item.title,
            kind: 'research',
            enabled: true,
            content: fetched.content,
            origin: {
              kind: 'web',
              url: item.url,
              query: item.query,
              sessionId: item.sessionId,
              turn: item.turn,
              resultEventSeq: item.resultEventSeq,
            },
          })
          json(response, 201, {
            ...workspaceResponse(ctx, store, workspace),
            sourceImport: { sourceId, truncated: fetched.truncated },
          })
          return
        }
        if (request.method === 'GET' && id !== undefined) {
          const workspace = store.get(id)
          json(response, 200, workspaceResponse(ctx, store, workspace))
          return
        }
        if (request.method === 'PUT' && id !== undefined) {
          const workspace = store.save(parseSaveRequest(await readJson(request), id))
          json(response, 200, workspaceResponse(ctx, store, workspace))
          return
        }
        if (request.method === 'DELETE' && id !== undefined) {
          json(response, 200, { format: 1, workspace: store.remove(id) })
          return
        }
        response.setHeader('allow', 'GET, POST, PUT, DELETE')
        json(response, request.method === 'GET' || request.method === 'POST'
          || request.method === 'PUT' || request.method === 'DELETE' ? 404 : 405, { error: 'not found' })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        json(response, responseStatus(message), { error: message })
      }
    },
  }), 'agent-rp: story workspace HTTP')
}
