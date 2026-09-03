/** Typed, multi-view browser workspace for long-form story authoring. */

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import {
  type CSSProperties,
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import xyFlowCss from '@xyflow/react/dist/style.css?raw'
import type { CharacterLibraryImportResult } from '../character-library-protocol.ts'
import type { AgentRpPlayWorldViewOwnerProps } from '../client-extension-v0.ts'
import type { AgentRpStoryTurnProgress } from '../projection-types.ts'
import {
  FLYING_CHESS_WORLD_MODULE_ID,
  isFlyingChessWorldState,
  type FlyingChessNarrativeCard,
  type FlyingChessPiece,
  type FlyingChessWorldConfiguration,
  type FlyingChessWorldState,
} from '../flying-chess-protocol.ts'
import {
  PLAY_WORLD_RESOURCES_PATH,
  type PlayWorldCastSelection,
  type PlayWorldModuleDescriptor,
  type PlayWorldResourceDescriptor,
  type PlayWorldEvent,
  type PlayWorldTurnProjection,
} from '../play-world-protocol.ts'
import {
  ROLEPLAY_RESOURCE_CATALOG_PATH,
  type RoleplayResourceDescriptor,
  type RoleplayResourceSelection,
} from '../roleplay-resource-catalog-protocol.ts'
import {
  STORY_WORKSPACES_PATH,
  type StoryCitation,
  type StoryCharacter,
  type StoryCharacterActorField,
  type StoryCharacterActorSyncReport,
  type StoryEdge,
  type StoryEdgeKind,
  type StoryEvent,
  type StoryFact,
  type StoryNode,
  type StoryNodeKind,
  type StoryOutput,
  type StoryOutputKind,
  type StoryResearchItem,
  type StorySource,
  type StorySourceKind,
  type StorySourceRefreshReport,
  type StoryWorkspaceSnapshot,
  type StoryWorkspaceSummary,
} from '../story-workspace-protocol.ts'
import {
  acceptStorySuggestionBatch,
  rejectStorySuggestionBatch,
  storySuggestionBatch,
} from '../story-suggestion-batch.ts'
import { createEventObservationFact, removeStoryFact } from '../story-fact.ts'
import {
  findStorySourceQuoteMatches,
  normalizeStorySourceContent,
  splitLocatedStorySourcePassages,
  splitStorySourcePassages,
  storySourcePassageSections,
  type LocatedStorySourcePassage,
  type StorySourcePassage,
} from '../story-source.ts'
import {
  attributeStoryVoiceDocument,
  parseStoryVoiceDocument,
  storyVoiceEvidenceUnits,
  storyVoiceSpeakerMatches,
  storyVoiceSpeakerAttributions,
} from '../story-voice-evidence.ts'
import { groupStoryTimeline, type StoryTimelineGroup } from '../story-timeline.ts'
import { executeAgentRpCommand } from './agent-rp-command.ts'
import { importCharacterFile } from './character-library-client.ts'
import { createClientOpaqueUuid } from './client-opaque-id.ts'
import {
  inspectStoryPlayWorldReadiness,
  storyPlayWorldParticipants,
} from './story-play-world-readiness.ts'
import { assignImportedStoryWorldActor } from './story-world-actor-assignment.ts'
import {
  storyTurnDuration,
  storyTurnProgressText,
  storyTurnStageLabels,
  storyTurnSubjectName,
} from './story-turn-progress.ts'
import {
  decodeStorySourceFile,
  STORY_SOURCE_FILE_ACCEPT,
  storySourceNameFromFile,
} from './story-source-file.ts'
import storyStudioCss from './story-workspace-editor.css?raw'

interface StoryWorkspaceEditorProps {
  readonly accent: string
  readonly initialWorkspaceId?: string
  readonly sessionId?: string
  readonly sessionWorkspaceId?: string
  readonly storyTurn?: AgentRpStoryTurnProgress | undefined
  readonly launchTargets?: readonly { readonly id: string; readonly title: string }[]
  readonly defaultLaunchTargetId?: string
  readonly launchUnavailableReason?: string
  readonly onOpenSession?: (hostWorkspaceId: string, workspaceId: string) => Promise<void>
  readonly renderPlayWorldView?: (
    moduleId: string,
    props: AgentRpPlayWorldViewOwnerProps,
    fallback: React.ReactNode,
  ) => React.ReactNode
  readonly onClose: () => void
}

interface StoryWorkspaceResponse {
  readonly format?: number
  readonly workspace?: StoryWorkspaceSnapshot
  readonly worldTurn?: PlayWorldTurnProjection | null
  readonly worldModuleAvailable?: boolean | null
  readonly webFetchAvailable?: boolean
  readonly webSearchAvailable?: boolean
  readonly sourceImport?: { readonly sourceId?: string; readonly truncated?: boolean }
  readonly sourceRefresh?: StorySourceRefreshReport
  readonly actorSync?: StoryCharacterActorSyncReport
  readonly workspaces?: readonly StoryWorkspaceSummary[]
  readonly error?: string
}

interface StorySourceImportResult extends StoryWorkspaceResult {
  readonly sourceId: string
  readonly truncated: boolean
}

interface StorySourceRefreshResult extends StoryWorkspaceResult {
  readonly report: StorySourceRefreshReport
}

interface StoryWorkspaceResult {
  readonly workspace: StoryWorkspaceSnapshot
  readonly worldTurn: PlayWorldTurnProjection | null
  readonly worldModuleAvailable: boolean | null
  readonly webFetchAvailable: boolean
  readonly webSearchAvailable: boolean
}

interface StoryCharacterActorBindResult extends StoryWorkspaceResult {
  readonly sync: StoryCharacterActorSyncReport
}

interface PlayWorldResourcesResponse {
  readonly format?: number
  readonly worlds?: readonly PlayWorldResourceDescriptor[]
  readonly error?: string
}

interface RoleplayResourcesResponse {
  readonly format?: number
  readonly entries?: readonly RoleplayResourceDescriptor[]
  readonly error?: string
}

interface ImportedWorldActor {
  readonly actor: RoleplayResourceDescriptor
  readonly outcome: CharacterLibraryImportResult['outcome']
}

type StudioView = 'world' | 'map' | 'timeline' | 'characters' | 'sources' | 'outputs'

type StudioSelection =
  | { readonly kind: 'node'; readonly id: string }
  | { readonly kind: 'edge'; readonly id: string }
  | { readonly kind: 'character'; readonly id: string }
  | { readonly kind: 'event'; readonly id: string }
  | { readonly kind: 'world-event'; readonly id: string }
  | { readonly kind: 'source'; readonly id: string }
  | { readonly kind: 'citation'; readonly id: string }
  | { readonly kind: 'output'; readonly id: string }

interface StoryCanvasNodeData extends Record<string, unknown> {
  readonly kind: StoryNodeKind
  readonly lifecycle: StoryNode['lifecycle']
  readonly status: StoryNode['status']
  readonly title: string
  readonly summary: string
  readonly people: string
  readonly knowledge: string
  readonly expanded: boolean
  readonly children: readonly {
    readonly id: string
    readonly kind: StoryNodeKind
    readonly title: string
    readonly summary: string
    readonly depth: number
    readonly detailCount: number
  }[]
  readonly details: readonly {
    readonly id: string
    readonly text: string
    readonly knownBy: string
    readonly location: string
  }[]
  readonly onToggle: () => void
  readonly onSelectNode: (id: string) => void
}

type StoryCanvasNode = Node<StoryCanvasNodeData, 'story'>
type StoryCanvasEdge = Edge<{ readonly kind: StoryEdgeKind }>
type UpdateWorkspace = (transform: (current: StoryWorkspaceSnapshot) => StoryWorkspaceSnapshot) => void

const nodeKindLabels: Readonly<Record<StoryNodeKind, string>> = {
  arc: '篇章',
  beat: '场景',
  secret: '秘密',
}

const nodeStatusLabels: Readonly<Record<StoryNode['status'], string>> = {
  planned: '计划',
  active: '进行中',
  completed: '已完成',
  dropped: '已放弃',
}

const edgeKindLabels: Readonly<Record<StoryEdgeKind, string>> = {
  precedes: '先于',
  causes: '导致',
  foreshadows: '埋设 → 回收',
}

const outputKindLabels: Readonly<Record<StoryOutputKind, string>> = {
  prose: '正文',
  character: '人物',
  history: '历史',
}

const sourceKindLabels: Readonly<Record<StorySourceKind, string>> = {
  original: '原著',
  reference: '参考',
  research: '研究',
  web: '网络',
}

const characterActorFields = [
  'name',
  'voiceAliases',
  'description',
  'personality',
  'scenario',
  'exampleDialogue',
  'systemPrompt',
  'postHistoryInstructions',
] as const satisfies readonly StoryCharacterActorField[]

const characterActorFieldLabels: Readonly<Record<StoryCharacterActorField, string>> = {
  name: '姓名',
  voiceAliases: '原作署名',
  description: '人物描述',
  personality: '性格与行为',
  scenario: '入场情境',
  exampleDialogue: '说话样本',
  systemPrompt: '系统指令',
  postHistoryInstructions: '历史后指令',
}

function StoryTurnTimingDetails({
  workspace,
  progress,
}: {
  readonly workspace: StoryWorkspaceSnapshot | undefined
  readonly progress: AgentRpStoryTurnProgress | undefined
}): React.JSX.Element | undefined {
  if (workspace === undefined || progress === undefined || progress.workspaceId !== workspace.id
    || progress.requests.length === 0) return undefined
  const finished = progress.requests.filter(request => request.durationMs !== undefined)
  const firstStart = Math.min(...progress.requests.map(request => request.startedAt))
  const lastFinish = Math.max(...progress.requests.map(request => request.finishedAt ?? request.startedAt))
  const wallMs = Math.max(0, lastFinish - firstStart)
  const workerMs = finished.reduce((total, request) => total + (request.durationMs ?? 0), 0)
  return <details className="story-studio-turn-timing">
    <summary>用时 {storyTurnDuration(wallMs)} · Worker 累计 {storyTurnDuration(workerMs)}</summary>
    <div className="story-studio-turn-timing-panel">
      <header><strong>本轮模型阶段</strong><span>并行阶段的累计用时会大于总用时</span></header>
      {progress.requests.map(request => {
        const subject = storyTurnSubjectName(workspace, request.subjectId)
        const status = request.status === 'running'
          ? '进行中'
          : request.status === 'failed' ? '已降级' : '完成'
        return <div className="story-studio-turn-timing-row" key={request.requestId}>
          <span>{storyTurnStageLabels[request.stage]}{subject === undefined ? '' : ` · ${subject}`}</span>
          <span>{request.durationMs === undefined ? status : `${storyTurnDuration(request.durationMs)} · ${status}`}</span>
        </div>
      })}
    </div>
  </details>
}

function canBecomeActiveNode(node: StoryNode): boolean {
  return node.kind === 'beat' && node.lifecycle === 'canonical' && node.status !== 'dropped'
}

function nodeKnownBy(workspace: StoryWorkspaceSnapshot, nodeId: string): readonly string[] {
  const nodeById = new Map(workspace.graph.nodes.map(node => [node.id, node]))
  const resolveNode = (id: string): readonly string[] => {
    const node = nodeById.get(id)
    if (node === undefined) return []
    if (node.knowledge.mode === 'none') return []
    if (node.knowledge.mode === 'participants') return node.participantIds
    if (node.knowledge.mode === 'characters') return node.knowledge.characterIds
    return node.parentId === undefined ? [] : resolveNode(node.parentId)
  }
  return [...new Set(resolveNode(nodeId))]
}

function factKnownBy(workspace: StoryWorkspaceSnapshot, fact: StoryFact): readonly string[] {
  return fact.knowledgeMode === 'override'
    ? fact.knownBy
    : fact.nodeId === undefined ? [] : nodeKnownBy(workspace, fact.nodeId)
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function actorSyncReport(value: unknown): StoryCharacterActorSyncReport {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('人物角色卡同步响应无效')
  const record = value as Partial<Record<keyof StoryCharacterActorSyncReport, unknown>>
  const validFields = (fields: unknown): fields is readonly StoryCharacterActorField[] => Array.isArray(fields)
    && fields.every(field => typeof field === 'string' && characterActorFields.includes(field as StoryCharacterActorField))
    && new Set(fields).size === fields.length
  if (record.mode !== 'detached' && record.mode !== 'replaced' && record.mode !== 'refreshed'
    || typeof record.baselineCreated !== 'boolean'
    || !validFields(record.updatedFields) || !validFields(record.preservedFields)) {
    throw new Error('人物角色卡同步响应无效')
  }
  return record as unknown as StoryCharacterActorSyncReport
}

function actorSyncNotice(report: StoryCharacterActorSyncReport): string {
  if (report.mode === 'detached') return '人物已经改为手写档案；当前设定和本局内容均已保留'
  if (report.mode === 'replaced') {
    return '角色卡来源已经更换；人物身份采用新卡，本局动态、认知、事件和世界进度保持不变'
  }
  const updated = report.updatedFields.map(field => characterActorFieldLabels[field]).join('、')
  const preserved = report.preservedFields.map(field => characterActorFieldLabels[field]).join('、')
  if (report.baselineCreated && preserved !== '') {
    return `已建立角色卡同步基线；为避免覆盖旧绑定中的本地编辑，保留了${preserved}`
  }
  if (updated !== '' && preserved !== '') return `角色卡已更新${updated}；保留本地编辑${preserved}`
  if (updated !== '') return `角色卡已更新${updated}；本局动态、认知和世界进度保持不变`
  if (preserved !== '') return `角色卡来源没有可自动更新的字段；保留本地编辑${preserved}`
  return '角色卡设定已经是最新版本'
}

function sourceRefreshReport(value: unknown): StorySourceRefreshReport {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('网页资料刷新响应无效')
  const record = value as Partial<Record<keyof StorySourceRefreshReport, unknown>>
  const citationIds = (ids: unknown): ids is readonly string[] => Array.isArray(ids)
    && ids.every(id => typeof id === 'string') && new Set(ids).size === ids.length
  if (typeof record.sourceId !== 'string' || typeof record.truncated !== 'boolean'
    || typeof record.citationCount !== 'number' || !Number.isSafeInteger(record.citationCount) || record.citationCount < 0
    || !citationIds(record.relocatedCitationIds) || !citationIds(record.ambiguousCitationIds)
    || !citationIds(record.missingCitationIds)) throw new Error('网页资料刷新响应无效')
  return record as unknown as StorySourceRefreshReport
}

function sourceRefreshNotice(report: StorySourceRefreshReport): string {
  const details = [
    report.relocatedCitationIds.length === 0 ? '' : `${String(report.relocatedCitationIds.length)} 条引用位置已重新定位`,
    report.ambiguousCitationIds.length === 0 ? '' : `${String(report.ambiguousCitationIds.length)} 条引用在新正文中有多个位置，保留原定位待检查`,
    report.missingCitationIds.length === 0 ? '' : `${String(report.missingCitationIds.length)} 条引用未在新正文中找到，引用快照仍保留`,
  ].filter(detail => detail !== '')
  const citationSummary = report.citationCount === 0 ? '当前没有关联引用' : `${String(report.citationCount)} 条引用均保留`
  return `网页资料已经原地刷新；${citationSummary}${details.length === 0 ? '' : `；${details.join('；')}`}${report.truncated ? '；新正文达到安全截断上限' : ''}`
}

async function storyRequest(path = '', init?: RequestInit): Promise<StoryWorkspaceResponse> {
  const response = await fetch(`${STORY_WORKSPACES_PATH}${path}`, init ?? { headers: { accept: 'application/json' } })
  const text = await response.text()
  let value: StoryWorkspaceResponse
  try {
    value = JSON.parse(text) as StoryWorkspaceResponse
  } catch {
    throw new Error(`游玩场地响应无法识别（${response.status}）`)
  }
  if (!response.ok) throw new Error(value.error ?? `游玩场地请求失败（${response.status}）`)
  if (value.format !== 1) throw new Error('游玩场地响应版本无效')
  return value
}

async function listWorkspaces(): Promise<readonly StoryWorkspaceSummary[]> {
  const value = await storyRequest()
  if (!Array.isArray(value.workspaces)) throw new Error('游玩场地列表响应无效')
  return value.workspaces
}

function workspaceResult(value: StoryWorkspaceResponse, label: string): StoryWorkspaceResult {
  if (value.workspace === undefined || !Object.prototype.hasOwnProperty.call(value, 'worldTurn')
    || !Object.prototype.hasOwnProperty.call(value, 'worldModuleAvailable')
    || typeof value.webFetchAvailable !== 'boolean'
    || typeof value.webSearchAvailable !== 'boolean') {
    throw new Error(`${label}响应无效`)
  }
  return {
    workspace: value.workspace,
    worldTurn: value.worldTurn ?? null,
    worldModuleAvailable: value.worldModuleAvailable ?? null,
    webFetchAvailable: value.webFetchAvailable,
    webSearchAvailable: value.webSearchAvailable,
  }
}

async function readWorkspace(id: string): Promise<StoryWorkspaceResult> {
  const value = await storyRequest(`/${encodeURIComponent(id)}`)
  return workspaceResult(value, '游玩场地读取')
}

async function createWorkspace(name: string): Promise<StoryWorkspaceResult> {
  const value = await storyRequest('', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ format: 2, name }),
  })
  return workspaceResult(value, '游玩场地创建')
}

async function saveWorkspace(workspace: StoryWorkspaceSnapshot): Promise<StoryWorkspaceResult> {
  const value = await storyRequest(`/${encodeURIComponent(workspace.id)}`, {
    method: 'PUT',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      format: 2,
      id: workspace.id,
      revision: workspace.revision,
      name: workspace.name,
      pipeline: workspace.pipeline,
      graph: workspace.graph,
      characters: workspace.characters,
      facts: workspace.facts,
      events: workspace.events,
      outputs: workspace.outputs,
      sources: workspace.sources,
      citations: workspace.citations,
      researchInbox: workspace.researchInbox,
    }),
  })
  return workspaceResult(value, '游玩场地保存')
}

async function importStorySourceUrl(
  workspace: StoryWorkspaceSnapshot,
  url: string,
  name: string,
  kind: 'original' | 'reference',
): Promise<StorySourceImportResult> {
  const value = await storyRequest(`/${encodeURIComponent(workspace.id)}/sources/url`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      format: 0,
      revision: workspace.revision,
      url,
      ...(name.trim() === '' ? {} : { name: name.trim() }),
      kind,
    }),
  })
  const result = workspaceResult(value, '网址资料导入')
  if (typeof value.sourceImport?.sourceId !== 'string' || typeof value.sourceImport.truncated !== 'boolean') {
    throw new Error('网址资料导入响应无效')
  }
  return { ...result, sourceId: value.sourceImport.sourceId, truncated: value.sourceImport.truncated }
}

async function refreshStorySourceUrl(
  workspace: StoryWorkspaceSnapshot,
  sourceId: string,
): Promise<StorySourceRefreshResult> {
  const value = await storyRequest(`/${encodeURIComponent(workspace.id)}/sources/${encodeURIComponent(sourceId)}/refresh`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ format: 0, revision: workspace.revision, sourceId }),
  })
  const report = sourceRefreshReport(value.sourceRefresh)
  if (report.sourceId !== sourceId) throw new Error('网页资料刷新响应指向了其他资料')
  return { ...workspaceResult(value, '网页资料刷新'), report }
}

async function acceptStoryResearchItem(
  workspace: StoryWorkspaceSnapshot,
  itemId: string,
): Promise<StorySourceImportResult> {
  const value = await storyRequest(`/${encodeURIComponent(workspace.id)}/sources/research`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ format: 0, revision: workspace.revision, itemId }),
  })
  const result = workspaceResult(value, '网络研究收取')
  if (typeof value.sourceImport?.sourceId !== 'string' || typeof value.sourceImport.truncated !== 'boolean') {
    throw new Error('网络研究收取响应无效')
  }
  return { ...result, sourceId: value.sourceImport.sourceId, truncated: value.sourceImport.truncated }
}

async function listPlayWorldResources(): Promise<readonly PlayWorldResourceDescriptor[]> {
  const response = await fetch(PLAY_WORLD_RESOURCES_PATH, { headers: { accept: 'application/json' } })
  const value = await response.json() as PlayWorldResourcesResponse
  if (!response.ok) throw new Error(value.error ?? `世界资源请求失败（${response.status}）`)
  if (value.format !== 0 || !Array.isArray(value.worlds)) throw new Error('世界资源列表响应无效')
  return value.worlds
}

async function listActorResources(): Promise<readonly RoleplayResourceDescriptor[]> {
  const response = await fetch(ROLEPLAY_RESOURCE_CATALOG_PATH, { headers: { accept: 'application/json' } })
  const value = await response.json() as RoleplayResourcesResponse
  if (!response.ok) throw new Error(value.error ?? `角色资源请求失败（${response.status}）`)
  if (value.format !== 0 || !Array.isArray(value.entries)) throw new Error('角色资源列表响应无效')
  return value.entries.filter(entry => entry.kind === 'actor' && entry.availability === 'available')
}

async function installPlayWorld(
  workspace: StoryWorkspaceSnapshot,
  resource: PlayWorldResourceDescriptor['resource'],
  cast: readonly PlayWorldCastSelection[],
): Promise<StoryWorkspaceResult> {
  const value = await storyRequest(`/${encodeURIComponent(workspace.id)}/world`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ format: 0, revision: workspace.revision, resource, cast }),
  })
  return workspaceResult(value, '世界模块安装')
}

async function updatePlayWorldCast(
  workspace: StoryWorkspaceSnapshot,
  cast: readonly PlayWorldCastSelection[],
): Promise<StoryWorkspaceResult> {
  const value = await storyRequest(`/${encodeURIComponent(workspace.id)}/world/cast`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ format: 0, revision: workspace.revision, cast }),
  })
  return workspaceResult(value, '世界人物来源更新')
}

async function updatePlayWorldConfiguration(
  workspace: StoryWorkspaceSnapshot,
  configuration: FlyingChessWorldConfiguration,
): Promise<StoryWorkspaceResult> {
  const value = await storyRequest(`/${encodeURIComponent(workspace.id)}/world/configuration`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ format: 0, revision: workspace.revision, configuration }),
  })
  return workspaceResult(value, '世界事件牌更新')
}

async function restartPlayWorld(workspace: StoryWorkspaceSnapshot): Promise<StoryWorkspaceResult> {
  const value = await storyRequest(`/${encodeURIComponent(workspace.id)}/world/restart`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ format: 0, revision: workspace.revision }),
  })
  return workspaceResult(value, '世界重新开局')
}

async function dispatchPlayWorldAction(
  workspace: StoryWorkspaceSnapshot,
  turn: PlayWorldTurnProjection,
  actionId: string,
): Promise<StoryWorkspaceResult> {
  const value = await storyRequest(`/${encodeURIComponent(workspace.id)}/world/actions`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ format: 0, revision: workspace.revision, cycleId: turn.cycleId, actionId }),
  })
  return workspaceResult(value, '世界动作')
}

async function bindStoryCharacterActor(
  workspace: StoryWorkspaceSnapshot,
  characterId: string,
  actor?: RoleplayResourceSelection,
): Promise<StoryCharacterActorBindResult> {
  const value = await storyRequest(`/${encodeURIComponent(workspace.id)}/characters/${encodeURIComponent(characterId)}/actor`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      format: 0,
      revision: workspace.revision,
      characterId,
      ...(actor === undefined ? {} : { actor }),
    }),
  })
  return {
    ...workspaceResult(value, '人物角色卡绑定'),
    sync: actorSyncReport(value.actorSync),
  }
}

async function deleteWorkspace(id: string): Promise<void> {
  await storyRequest(`/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { accept: 'application/json' } })
}

function StoryCanvasNodeCard({ data, selected }: NodeProps<StoryCanvasNode>) {
  return <div className="story-canvas-node" data-kind={data.kind} data-lifecycle={data.lifecycle} data-selected={selected}>
    <Handle className="story-canvas-handle" type="target" position={Position.Left} />
    <div className="story-canvas-node-meta">
      <span className="story-canvas-node-badge">{nodeKindLabels[data.kind]}</span>
      <span>{data.lifecycle === 'suggested' ? 'AI 建议' : nodeStatusLabels[data.status]}</span>
    </div>
    <div className="story-canvas-node-title">{data.title}</div>
    <div className="story-canvas-node-summary">{data.summary || '尚未填写折叠摘要'}</div>
    {data.people !== '' && <div className="story-canvas-node-people">{data.people}</div>}
    <div className="story-canvas-node-foot">
      <span>{data.children.length} 个子项 · {data.details.length} 条信息</span>
      <button className="nodrag story-canvas-node-toggle" type="button" onClick={event => { event.stopPropagation(); data.onToggle() }}>
        {data.expanded ? '收起' : '展开'}
      </button>
    </div>
    {data.expanded && <div className="nodrag story-canvas-node-contents">
      {data.children.map(child => <button className="story-canvas-child" type="button" key={child.id}
        style={{ '--story-child-depth': child.depth } as CSSProperties}
        onClick={event => { event.stopPropagation(); data.onSelectNode(child.id) }}>
        <span><b>{nodeKindLabels[child.kind]}</b>{child.title}</span>
        <small>{child.summary || '尚未填写摘要'}{child.detailCount === 0 ? '' : ` · ${String(child.detailCount)} 条信息`}</small>
      </button>)}
      {data.details.map(detail => <div className="story-canvas-detail" key={detail.id}>
        <span>{detail.text}</span><small>{detail.location}{detail.location === '' ? '' : ' · '}{detail.knownBy}</small>
      </div>)}
      {data.children.length + data.details.length === 0 && <small className="story-canvas-empty">故事簇内部还没有细节。</small>}
    </div>}
    <div className="story-canvas-node-knowledge">{data.knowledge}</div>
    <Handle className="story-canvas-handle" type="source" position={Position.Right} />
  </div>
}

const nodeTypes = { story: StoryCanvasNodeCard }

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return <label className="story-studio-field"><span>{label}</span>{children}</label>
}

function TextField({ label, value, rows, onChange }: {
  readonly label: string
  readonly value: string
  readonly rows?: number
  readonly onChange: (value: string) => void
}) {
  return <Field label={label}><textarea className="story-studio-input" value={value} rows={rows ?? 3}
    onChange={event => { onChange(event.target.value) }} /></Field>
}

function selectWithoutCharacter(output: StoryOutput): StoryOutput {
  const { characterId: _characterId, ...rest } = output
  return rest
}

function eventWithoutNode(event: StoryEvent): StoryEvent {
  const { nodeId: _nodeId, ...rest } = event
  return rest
}

function nodeWithoutSourceEvent(node: StoryNode): StoryNode {
  const { sourceEventId: _sourceEventId, ...rest } = node
  return rest
}

function nodeWithoutParent(node: StoryNode): StoryNode {
  const { parentId: _parentId, ...rest } = node
  return rest
}

function edgeWithoutSourceEvent(edge: StoryEdge): StoryEdge {
  const { sourceEventId: _sourceEventId, ...rest } = edge
  return rest
}

function citationWithoutTarget(citation: StoryCitation): StoryCitation {
  const { target: _target, ...rest } = citation
  return rest
}

function citationWithoutRefreshReview(citation: StoryCitation): StoryCitation {
  const { refreshReview: _refreshReview, ...rest } = citation
  return rest
}

function citationSourceLabel(workspace: StoryWorkspaceSnapshot, citation: StoryCitation): string {
  const source = workspace.sources.find(candidate => candidate.id === citation.sourceId)
  return [source?.name ?? '未知资料', citation.locator].filter(Boolean).join(' · ')
}

function compileCharacterPreview(workspace: StoryWorkspaceSnapshot, character: StoryCharacter): string {
  const facts = workspace.facts.filter(fact => fact.status !== 'refuted' && factKnownBy(workspace, fact).includes(character.id))
    .map(fact => {
      const citations = workspace.citations.filter(citation => citation.target?.kind === 'fact' && citation.target.factId === fact.id)
      return [`- ${fact.status === 'uncertain' ? '[不确定] ' : ''}${fact.text}`,
        ...citations.map(citation => `  - 依据：${citationSourceLabel(workspace, citation)} — ${citation.quote}`)].join('\n')
    }).join('\n')
  return [
    `# 人物：${character.name}`,
    ...(character.profile.systemPrompt.trim() === '' ? [] : ['## 扮演指令', character.profile.systemPrompt]),
    ...(character.profile.description.trim() === '' ? [] : ['## 人物描述', character.profile.description]),
    ...(character.profile.personality.trim() === '' ? [] : ['## 性格与行为', character.profile.personality]),
    ...(character.profile.scenario.trim() === '' ? [] : ['## 入场情境', character.profile.scenario]),
    ...(character.profile.exampleDialogue.trim() === '' ? [] : ['## 对话示例', character.profile.exampleDialogue]),
    ...(Object.values(character.state).every(value => value.trim() === '') ? [] : [
      '## 当前场地状态',
      [
        character.state.location.trim() === '' ? '' : `- 位置：${character.state.location}`,
        character.state.condition.trim() === '' ? '' : `- 状态：${character.state.condition}`,
        character.state.objective.trim() === '' ? '' : `- 当前目标：${character.state.objective}`,
        character.state.notes.trim() === '' ? '' : `- 备注：${character.state.notes}`,
      ].filter(Boolean).join('\n'),
    ]),
    '## 此人物已经知道的事实',
    facts,
    '## 本轮玩家输入',
    '（将在生成时填入）',
    ...(character.profile.postHistoryInstructions.trim() === '' ? [] : ['## 历史后指令', character.profile.postHistoryInstructions]),
  ].join('\n\n')
}

function NodeInspector({ workspace, node, update, onSelect, onOpenEvent, onDelete }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly node: StoryNode
  readonly update: UpdateWorkspace
  readonly onSelect: (selection: StudioSelection | undefined) => void
  readonly onOpenEvent: (eventId: string) => void
  readonly onDelete: () => void
}) {
  const patch = (transform: (value: StoryNode) => StoryNode): void => {
    update(current => {
      let transformed: StoryNode | undefined
      const nodes = current.graph.nodes.map(item => {
        if (item.id !== node.id) return item
        transformed = transform(item)
        return transformed
      })
      const activeNodeId = current.graph.activeNodeId === node.id && transformed !== undefined && !canBecomeActiveNode(transformed)
        ? undefined
        : current.graph.activeNodeId
      const { activeNodeId: _activeNodeId, ...graph } = current.graph
      return { ...current, graph: { ...graph, ...(activeNodeId === undefined ? {} : { activeNodeId }), nodes } }
    })
  }
  const toggleParticipant = (id: string, checked: boolean): void => {
    patch(value => ({ ...value, participantIds: checked
      ? [...new Set([...value.participantIds, id])]
      : value.participantIds.filter(candidate => candidate !== id) }))
  }
  const toggleKnowledgeCharacter = (id: string, checked: boolean): void => {
    patch(value => ({ ...value, knowledge: {
      mode: 'characters',
      characterIds: checked
        ? [...new Set([...value.knowledge.characterIds, id])]
        : value.knowledge.characterIds.filter(candidate => candidate !== id),
    } }))
  }
  const descendants = new Set<string>([node.id])
  let changed = true
  while (changed) {
    changed = false
    for (const candidate of workspace.graph.nodes) {
      if (candidate.parentId !== undefined && descendants.has(candidate.parentId) && !descendants.has(candidate.id)) {
        descendants.add(candidate.id)
        changed = true
      }
    }
  }
  const parentCandidates = workspace.graph.nodes.filter(candidate => !descendants.has(candidate.id)
    && candidate.lifecycle === 'canonical' && candidate.status !== 'dropped'
    && (candidate.kind === 'arc' || candidate.kind === 'beat'))
  const parent = node.parentId === undefined ? undefined : workspace.graph.nodes.find(candidate => candidate.id === node.parentId)
  const sourceEvent = node.sourceEventId === undefined ? undefined : workspace.events.find(event => event.id === node.sourceEventId)
  const canAccept = parent === undefined || parent.lifecycle === 'canonical'
  return <>
    <h2>{node.title}</h2>
    <div className="story-studio-inspector-subtitle">{nodeKindLabels[node.kind]} · {node.lifecycle === 'suggested' ? '候选变更' : '正式故事数据'}</div>
    {sourceEvent !== undefined && <button className="story-citation-link" type="button"
      onClick={() => { onOpenEvent(sourceEvent.id) }}>来源：第 {sourceEvent.turn} 回合 · {sourceEvent.title} ↗</button>}
    {node.lifecycle === 'suggested' && <div className="story-studio-actions" style={{ marginBottom: 14 }}>
      <button className="story-studio-button story-studio-button-primary" type="button"
        disabled={!canAccept} onClick={() => { patch(value => ({ ...value, lifecycle: 'canonical' })) }}>
        {canAccept ? '接受建议' : '先接受上级故事簇'}</button>
      <button className="story-studio-button" type="button" onClick={onDelete}>拒绝</button>
    </div>}
    <TextField label="标题" rows={1} value={node.title} onChange={value => { patch(current => ({ ...current, title: value })) }} />
    <TextField label="折叠摘要" rows={3} value={node.summary} onChange={value => { patch(current => ({ ...current, summary: value })) }} />
    <div className="story-studio-field-row">
      <Field label="类型"><select className="story-studio-input" value={node.kind}
        onChange={event => { patch(current => ({ ...current, kind: event.target.value as StoryNodeKind })) }}>
        <option value="arc">篇章</option><option value="beat">剧情</option><option value="secret">秘密</option>
      </select></Field>
      <Field label="进度"><select className="story-studio-input" value={node.status}
        onChange={event => { patch(current => ({ ...current, status: event.target.value as StoryNode['status'] })) }}>
        <option value="planned">计划</option><option value="active">进行中</option><option value="completed">已完成</option><option value="dropped">已放弃</option>
      </select></Field>
    </div>
    <Field label="归属故事簇"><select className="story-studio-input" value={node.parentId ?? ''}
      onChange={event => { patch(current => event.target.value === ''
        ? nodeWithoutParent(current)
        : { ...current, parentId: event.target.value }) }}>
      <option value="">顶层</option>{parentCandidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
    </select></Field>
    <Field label="可见范围"><select className="story-studio-input" value={node.audience}
      onChange={event => { patch(current => ({ ...current, audience: event.target.value as StoryNode['audience'] })) }}>
      <option value="director">导演</option><option value="public">公开</option>
    </select></Field>
    <Field label="内部信息默认由谁知道"><select className="story-studio-input" value={node.knowledge.mode}
      onChange={event => { patch(current => ({ ...current, knowledge: {
        mode: event.target.value as StoryNode['knowledge']['mode'],
        characterIds: [],
      } })) }}>
      <option value="inherit">继承上级故事簇</option><option value="none">默认无人知道</option>
      <option value="participants">场景参与人物</option><option value="characters">指定人物</option>
    </select></Field>
    {node.knowledge.mode === 'characters' && <div className="story-studio-field"><span>默认知情人物</span><div className="story-studio-checks">
      {workspace.characters.map(character => <label className="story-studio-check" key={character.id}>
        <input type="checkbox" checked={node.knowledge.characterIds.includes(character.id)}
          onChange={event => { toggleKnowledgeCharacter(character.id, event.target.checked) }} />{character.name}
      </label>)}
    </div></div>}
    <TextField label="详细内容" rows={8} value={node.content} onChange={value => { patch(current => ({ ...current, content: value })) }} />
    <div className="story-studio-field"><span>场景参与人物</span><div className="story-studio-checks">
      {workspace.characters.length === 0 && <small>尚未创建人物</small>}
      {workspace.characters.map(character => <label className="story-studio-check" key={character.id}>
        <input type="checkbox" checked={node.participantIds.includes(character.id)}
          onChange={event => { toggleParticipant(character.id, event.target.checked) }} />{character.name}
      </label>)}
    </div></div>
    <div className="story-studio-actions">
      {node.kind === 'beat' && <button className="story-studio-button" type="button"
        disabled={!canBecomeActiveNode(node) || workspace.graph.activeNodeId === node.id}
        onClick={() => { update(current => ({ ...current, graph: { ...current.graph, activeNodeId: node.id } })) }}>
        {workspace.graph.activeNodeId === node.id
          ? '当前剧情节点'
          : node.lifecycle === 'suggested'
            ? '接受后可设为当前剧情'
            : node.status === 'dropped' ? '已放弃节点' : '设为当前剧情'}
      </button>}
      {node.lifecycle === 'canonical' && <button className="story-studio-button story-studio-danger" type="button"
        onClick={() => { onSelect(undefined); onDelete() }}>删除节点</button>}
    </div>
  </>
}

function EdgeInspector({ workspace, edge, update, onDelete }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly edge: StoryEdge
  readonly update: UpdateWorkspace
  readonly onDelete: () => void
}) {
  const patch = (transform: (value: StoryEdge) => StoryEdge): void => {
    update(current => ({ ...current, graph: {
      ...current.graph,
      edges: current.graph.edges.map(item => item.id === edge.id ? transform(item) : item),
    } }))
  }
  const changeKind = (kind: StoryEdgeKind): void => {
    patch(current => {
      if (kind === 'foreshadows') return { ...current, kind, foreshadowStatus: 'unplanted' }
      const { foreshadowStatus: _foreshadowStatus, ...rest } = current
      return { ...rest, kind }
    })
  }
  const source = workspace.graph.nodes.find(node => node.id === edge.source)?.title ?? edge.source
  const target = workspace.graph.nodes.find(node => node.id === edge.target)?.title ?? edge.target
  const endpointsCanonical = workspace.graph.nodes
    .filter(node => node.id === edge.source || node.id === edge.target)
    .every(node => node.lifecycle === 'canonical')
  return <>
    <h2>{edgeKindLabels[edge.kind]}</h2>
    <div className="story-studio-inspector-subtitle">{source} → {target}</div>
    {edge.lifecycle === 'suggested' && <div className="story-studio-actions" style={{ marginBottom: 14 }}>
      <button className="story-studio-button story-studio-button-primary" type="button"
        disabled={!endpointsCanonical} onClick={() => { patch(value => ({ ...value, lifecycle: 'canonical' })) }}>
        {endpointsCanonical ? '接受关系' : '先接受两端节点'}
      </button>
      <button className="story-studio-button" type="button" onClick={onDelete}>拒绝</button>
    </div>}
    <Field label="关系类型"><select className="story-studio-input" value={edge.kind}
      onChange={event => { changeKind(event.target.value as StoryEdgeKind) }}>
      {Object.entries(edgeKindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
    </select></Field>
    <TextField label="关系说明" rows={3} value={edge.label} onChange={value => { patch(current => ({ ...current, label: value })) }} />
    {edge.kind === 'foreshadows' && <Field label="伏笔状态"><select className="story-studio-input" value={edge.foreshadowStatus}
      onChange={event => { patch(current => ({ ...current, foreshadowStatus: event.target.value as NonNullable<StoryEdge['foreshadowStatus']> })) }}>
      <option value="unplanted">未埋设</option><option value="planted">已埋设</option><option value="triggered">已触发</option><option value="resolved">已回收</option><option value="dropped">已放弃</option>
    </select></Field>}
    <Field label="可见范围"><select className="story-studio-input" value={edge.audience}
      onChange={event => { patch(current => ({ ...current, audience: event.target.value as StoryEdge['audience'] })) }}>
      <option value="director">导演</option><option value="public">公开</option>
    </select></Field>
    {edge.lifecycle === 'canonical' && <button className="story-studio-button story-studio-danger" type="button" onClick={onDelete}>删除关系</button>}
  </>
}

function KnowledgeAudit({ workspace, selectedCharacterId, update, selectEvent }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly selectedCharacterId: string
  readonly update: UpdateWorkspace
  readonly selectEvent: (id: string) => void
}) {
  const patchFact = (factId: string, transform: (value: StoryFact) => StoryFact): void => {
    update(current => ({ ...current, facts: current.facts.map(item => item.id === factId ? transform(item) : item) }))
  }
  const knowledgeColumns = `minmax(220px, 1fr) repeat(${String(workspace.characters.length)}, minmax(70px, 86px)) 94px`
  return <section className="story-knowledge-ledger story-knowledge-audit">
    <div className="story-knowledge-ledger-heading"><div><strong>全局认知审计</strong><span>用于排查或批量修正知情范围；日常编辑请使用上方人物认知。</span></div>
      <span>{workspace.facts.length} 条事实</span></div>
    <div className="story-knowledge-scroll">
      <div className="story-knowledge-row story-knowledge-row-head" style={{ gridTemplateColumns: knowledgeColumns }}>
        <span>事实与来源</span>{workspace.characters.map(character => <span data-selected={selectedCharacterId === character.id} key={character.id}>{character.name}</span>)}<span>状态</span>
      </div>
      {workspace.facts.map(fact => {
        const sourceEventId = fact.source.kind === 'event' ? fact.source.eventId : undefined
        const sourceEvent = sourceEventId === undefined ? undefined : workspace.events.find(event => event.id === sourceEventId)
        const effectiveKnownBy = factKnownBy(workspace, fact)
        const parentNode = fact.nodeId === undefined ? undefined : workspace.graph.nodes.find(node => node.id === fact.nodeId)
        return <article className="story-knowledge-row" data-highlighted={effectiveKnownBy.includes(selectedCharacterId)}
          key={fact.id} style={{ gridTemplateColumns: knowledgeColumns }}>
          <div className="story-knowledge-fact-copy"><span>{fact.text}</span>
            {sourceEvent === undefined
              ? <small>{parentNode === undefined ? '未归入故事簇' : `归入：${parentNode.title}`}</small>
              : <button className="story-citation-link" type="button" onClick={() => { selectEvent(sourceEvent.id) }}>
                第 {sourceEvent.turn} 回合 · {sourceEvent.title} ↗
              </button>}
          </div>
          {workspace.characters.map(character => <label className="story-knowledge-person" data-selected={selectedCharacterId === character.id} key={character.id}>
            <span className="story-knowledge-person-name">{character.name}</span>
            <input aria-label={`${character.name}知道：${fact.text.slice(0, 48)}`} type="checkbox" checked={effectiveKnownBy.includes(character.id)}
              onChange={event => { patchFact(fact.id, current => {
                const base = current.knowledgeMode === 'inherit' ? effectiveKnownBy : current.knownBy
                return {
                  ...current,
                  knowledgeMode: 'override',
                  knownBy: event.target.checked ? [...new Set([...base, character.id])] : base.filter(id => id !== character.id),
                }
              }) }} />
          </label>)}
          <div className="story-knowledge-state"><span>{fact.status === 'asserted' ? '确认' : fact.status === 'uncertain' ? '不确定' : '已否定'}</span></div>
        </article>
      })}
    </div>
  </section>
}

function CharacterWorkspaceView({ workspace, character, actorResources, busy, dirty, update, perspectiveId, previewId, setPerspectiveId, setPreviewId, openStoryMap, onBindActor, onImportActor, onDelete, selectEvent, addCharacter }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly character: StoryCharacter | undefined
  readonly actorResources: readonly RoleplayResourceDescriptor[]
  readonly busy: boolean
  readonly dirty: boolean
  readonly update: UpdateWorkspace
  readonly perspectiveId: string | undefined
  readonly previewId: string | undefined
  readonly setPerspectiveId: (id: string | undefined) => void
  readonly setPreviewId: (id: string | undefined) => void
  readonly openStoryMap: () => void
  readonly onBindActor: (
    characterId: string,
    actor?: RoleplayResourceSelection,
  ) => void
  readonly onImportActor: (characterId: string, file: File) => Promise<void>
  readonly onDelete: (id: string) => void
  readonly selectEvent: (id: string) => void
  readonly addCharacter: () => void
}) {
  const [tab, setTab] = useState<'profile' | 'state' | 'knowledge' | 'agent'>('profile')
  const [importingActor, setImportingActor] = useState(false)
  const actorFileInputRef = useRef<HTMLInputElement>(null)
  if (character === undefined) return <div className="story-studio-empty"><span style={{ fontSize: 32 }}>◉</span><strong>先建立一位人物</strong>
    <span>人物档案、当前状态和独立认知会在这里汇合。</span><button className="story-studio-button story-studio-button-primary" type="button" onClick={addCharacter}>添加人物</button></div>
  const patchCharacter = (transform: (value: StoryCharacter) => StoryCharacter): void => {
    update(current => ({ ...current, characters: current.characters.map(item => item.id === character.id ? transform(item) : item) }))
  }
  const patchFact = (factId: string, transform: (value: StoryFact) => StoryFact): void => {
    update(current => ({ ...current, facts: current.facts.map(item => item.id === factId ? transform(item) : item) }))
  }
  const addFact = (): void => {
    update(current => ({ ...current, facts: [...current.facts, {
      id: `fact-${createClientOpaqueUuid()}`,
      ...(current.graph.activeNodeId === undefined ? {} : { nodeId: current.graph.activeNodeId }),
      text: '新事实',
      status: 'asserted',
      audience: 'director',
      knowledgeMode: 'override',
      knownBy: [character.id],
      source: { kind: 'manual' },
    }] }))
  }
  const deleteFact = (factId: string): void => {
    update(current => removeStoryFact(current, factId))
  }
  const knownFacts = workspace.facts.filter(fact => fact.status !== 'refuted' && factKnownBy(workspace, fact).includes(character.id))
  const relatedEvents = workspace.events.filter(event => event.participantIds.includes(character.id)
    || workspace.facts.some(fact => fact.source.kind === 'event' && fact.source.eventId === event.id && factKnownBy(workspace, fact).includes(character.id)))
  return <div className="story-studio-view story-character-workspace">
    <header className="story-character-hero">
      <div className="story-character-avatar" aria-hidden="true">{character.name.slice(0, 1)}</div>
      <div className="story-character-hero-copy"><span>{character.actor === undefined ? '本场地手写人物' : '已绑定资源中心角色卡'}</span><h1>{character.name}</h1>
        <p>{character.profile.description.trim().split('\n').find(Boolean)?.slice(0, 120) || '还没有人物描述。'}</p>
        <div className="story-character-now">
          {character.state.location.trim() !== '' && <span>位置 · {character.state.location}</span>}
          {character.state.condition.trim() !== '' && <span>状态 · {character.state.condition}</span>}
          {character.state.objective.trim() !== '' && <span>目标 · {character.state.objective}</span>}
        </div></div>
      <div className="story-character-hero-actions"><button className="story-studio-button" type="button" onClick={() => {
        if (perspectiveId === character.id) setPerspectiveId(undefined)
        else {
          setPerspectiveId(character.id)
          openStoryMap()
        }
      }}>
        {perspectiveId === character.id ? '退出人物视角' : '以此人物查看故事图'}</button>
        <button className="story-studio-button" type="button" onClick={addCharacter}>＋ 添加人物</button></div>
    </header>
    <nav className="story-character-tabs" aria-label="人物编辑区">
      {([['profile', '人物设定'], ['state', '当前动态'], ['knowledge', `认知与经历 · ${String(knownFacts.length)}`], ['agent', 'Agent 输入']] as const)
        .map(([id, label]) => <button aria-current={tab === id ? 'page' : undefined} key={id} type="button" onClick={() => { setTab(id) }}>{label}</button>)}
    </nav>
    {tab === 'profile' && <div className="story-character-editor-grid">
      <section className="story-character-panel story-character-panel-wide"><div className="story-character-panel-heading"><div><strong>人物设定</strong><span>角色卡中持续影响人物身份与行动方式的内容。</span></div></div>
        <div className="story-character-fields">
          <Field label="角色卡来源"><select className="story-studio-input" value={character.actor?.id ?? ''} disabled={busy || dirty}
            onChange={event => { onBindActor(character.id, event.target.value === ''
              ? undefined
              : { kind: 'actor', id: event.target.value }) }}>
            <option value="">手写人物</option>{actorResources.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
          </select></Field>
          <div className="story-character-source-sync">
            <input ref={actorFileInputRef} hidden type="file" accept=".png,.json,.charx,image/png,application/json,application/zip"
              onChange={event => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file === undefined) return
                setImportingActor(true)
                void onImportActor(character.id, file).finally(() => { setImportingActor(false) })
              }} />
            <button className="story-studio-button" type="button" disabled={busy || dirty || importingActor}
              onClick={() => { actorFileInputRef.current?.click() }}>{importingActor ? '正在导入角色卡…' : '＋ 导入并绑定角色卡'}</button>
            {character.actor !== undefined && <button className="story-studio-button" type="button" disabled={busy || dirty || importingActor}
              onClick={() => { onBindActor(character.id, character.actor) }}>重新同步角色卡设定</button>
            }<span>导入会保存为可复用角色卡；同步只更新仍由来源卡管理的设定字段，本地改写与本局动态、认知、事件和世界进度都会保留。</span>
          </div>
          {dirty && <p className="story-studio-inline-note">保存当前修改后即可更换角色卡来源。</p>}
          <TextField label="人物名称" rows={1} value={character.name} onChange={value => { patchCharacter(current => ({ ...current, name: value })) }} />
          <TextField label="原作署名" rows={4} value={(character.voiceAliases ?? []).join('\n')}
            onChange={value => { patchCharacter(current => ({ ...current, voiceAliases: value.split(/\r?\n/u) })) }} />
          <p className="story-studio-inline-note">每行一个原文中的全名、简称或其他写法，只用于识别导入资料里的说话人。</p>
          <TextField label="人物描述" rows={9} value={character.profile.description} onChange={value => { patchCharacter(current => ({ ...current, profile: { ...current.profile, description: value } })) }} />
          <TextField label="性格与行为" rows={7} value={character.profile.personality} onChange={value => { patchCharacter(current => ({ ...current, profile: { ...current.profile, personality: value } })) }} />
        </div>
      </section>
      <section className="story-character-panel"><div className="story-character-panel-heading"><div><strong>说话样本</strong><span>用对白校准措辞、节奏和人物之间的称呼，不规定当前剧情。</span></div></div>
        <TextField label="示例对话" rows={18} value={character.profile.exampleDialogue} onChange={value => { patchCharacter(current => ({ ...current, profile: { ...current.profile, exampleDialogue: value } })) }} />
      </section>
    </div>}
    {tab === 'state' && <div className="story-character-editor-grid">
      <section className="story-character-panel story-character-panel-wide"><div className="story-character-panel-heading"><div><strong>此刻</strong><span>由世界事件、连续性记录或手动修订持续更新。</span></div></div>
        <div className="story-character-state-grid">
          <TextField label="当前位置" rows={2} value={character.state.location} onChange={value => { patchCharacter(current => ({ ...current, state: { ...current.state, location: value } })) }} />
          <TextField label="身心状态" rows={2} value={character.state.condition} onChange={value => { patchCharacter(current => ({ ...current, state: { ...current.state, condition: value } })) }} />
        </div>
        <TextField label="当前目标" rows={3} value={character.state.objective} onChange={value => { patchCharacter(current => ({ ...current, state: { ...current.state, objective: value } })) }} />
        <TextField label="本局备注" rows={7} value={character.state.notes} onChange={value => { patchCharacter(current => ({ ...current, state: { ...current.state, notes: value } })) }} />
      </section>
      <section className="story-character-panel"><div className="story-character-panel-heading"><div><strong>入场情境</strong><span>角色卡 · Scenario</span></div></div>
        <TextField label="本局开始时" rows={12} value={character.profile.scenario} onChange={value => { patchCharacter(current => ({ ...current, profile: { ...current.profile, scenario: value } })) }} />
      </section>
    </div>}
    {tab === 'knowledge' && <div className="story-character-knowledge-layout">
      <section className="story-character-panel"><div className="story-character-panel-heading"><div><strong>{character.name} 已知的事实</strong><span>只显示会进入此人物 Worker 的认知。</span></div>
        <button className="story-studio-button story-studio-button-primary" type="button" onClick={addFact}>＋ 添加认知</button></div>
        <div className="story-character-fact-list">{knownFacts.map(fact => {
          const sourceEventId = fact.source.kind === 'event' ? fact.source.eventId : undefined
          const sourceEvent = sourceEventId === undefined ? undefined : workspace.events.find(event => event.id === sourceEventId)
          const effectiveKnownBy = factKnownBy(workspace, fact)
          const parentNode = fact.nodeId === undefined ? undefined : workspace.graph.nodes.find(node => node.id === fact.nodeId)
          return <article className="story-character-fact" key={fact.id}><div className="story-character-fact-main"><textarea className="story-studio-input" rows={2} value={fact.text}
              aria-label="人物事实" onChange={event => { patchFact(fact.id, current => ({ ...current, text: event.target.value })) }} />
              <div className="story-character-fact-source">{sourceEvent === undefined
                ? <span>{parentNode === undefined ? '手动记录 · 未归入故事簇' : `故事簇 · ${parentNode.title}`}</span>
                : <button className="story-citation-link" type="button" onClick={() => { selectEvent(sourceEvent.id) }}>第 {sourceEvent.turn} 回合 · {sourceEvent.title} ↗</button>}</div></div>
            <div className="story-character-fact-actions">{fact.nodeId !== undefined && <button className="story-studio-icon-button" type="button"
              aria-label={`切换认知继承：${fact.text.slice(0, 48)}`} title={fact.knowledgeMode === 'inherit' ? '正在继承故事簇' : '改为继承故事簇'}
              onClick={() => { patchFact(fact.id, current => ({ ...current, knowledgeMode: current.knowledgeMode === 'inherit' ? 'override' : 'inherit' })) }}>
              {fact.knowledgeMode === 'inherit' ? '↳' : '◇'}
            </button>}<select className="story-studio-input" aria-label="事实状态" value={fact.status}
              onChange={event => { patchFact(fact.id, current => ({ ...current, status: event.target.value as StoryFact['status'] })) }}>
              <option value="asserted">确认</option><option value="uncertain">不确定</option><option value="refuted">已否定</option>
            </select><button className="story-studio-button" type="button" onClick={() => { patchFact(fact.id, current => ({ ...current, knowledgeMode: 'override', knownBy: effectiveKnownBy.filter(id => id !== character.id) })) }}>移出此人物认知</button>
              <button className="story-studio-icon-button story-studio-danger" type="button" aria-label={`删除事实：${fact.text.slice(0, 48)}`} onClick={() => { deleteFact(fact.id) }}>×</button></div>
          </article>
        })}{knownFacts.length === 0 && <div className="story-studio-empty"><span>这个人物还没有自己的认知记录。</span></div>}</div>
      </section>
      <section className="story-character-panel"><div className="story-character-panel-heading"><div><strong>共同经历</strong><span>由人物参与的事件和后来得知的事件自动汇合。</span></div></div>
        <div className="story-character-event-list">{relatedEvents.map(event => <button key={event.id} type="button" onClick={() => { selectEvent(event.id) }}>
          <span>第 {event.turn} 回合</span><strong>{event.title}</strong><small>{event.summary}</small></button>)}
          {relatedEvents.length === 0 && <p className="story-character-help">人物参与故事回合后，经历会自动出现在这里。</p>}</div>
      </section>
    </div>}
    {tab === 'agent' && <div className="story-character-agent-layout">
      <section className="story-character-panel"><div className="story-character-panel-heading"><div><strong>人物 Worker 输入</strong><span>预览只包含人物档案、当前状态和此人物可见的信息。</span></div>
        <button className="story-studio-button" type="button" onClick={() => { setPreviewId(previewId === character.id ? undefined : character.id) }}>
          {previewId === character.id ? '收起完整预览' : '展开完整预览'}</button></div>
        <TextField label="系统指令" rows={6} value={character.profile.systemPrompt} onChange={value => { patchCharacter(current => ({ ...current, profile: { ...current.profile, systemPrompt: value } })) }} />
        <TextField label="历史后指令" rows={5} value={character.profile.postHistoryInstructions} onChange={value => { patchCharacter(current => ({ ...current, profile: { ...current.profile, postHistoryInstructions: value } })) }} />
        {previewId === character.id && <pre className="story-studio-preview story-character-preview">{compileCharacterPreview(workspace, character)}</pre>}
      </section>
      <details className="story-character-audit"><summary>高级：打开全局认知审计</summary>
        <KnowledgeAudit workspace={workspace} selectedCharacterId={character.id} update={update} selectEvent={selectEvent} />
      </details>
      <div className="story-character-danger-zone"><button className="story-studio-button story-studio-danger" type="button" onClick={() => { onDelete(character.id) }}>删除 {character.name}</button></div>
    </div>}
  </div>
}

function EventInspector({ workspace, event, update, onOpenKnowledge, onSelect, onDelete }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly event: StoryEvent
  readonly update: UpdateWorkspace
  readonly onOpenKnowledge: () => void
  readonly onSelect: (selection: StudioSelection) => void
  readonly onDelete: () => void
}) {
  const observations = workspace.facts.filter(fact => fact.source.kind === 'event' && fact.source.eventId === event.id)
  const citations = workspace.citations.filter(citation => citation.target?.kind === 'event' && citation.target.eventId === event.id)
  const suggestionBatch = storySuggestionBatch(workspace, event.id)
  const suggestedNodes = workspace.graph.nodes.filter(node => suggestionBatch.nodeIds.includes(node.id))
  const suggestedEdges = workspace.graph.edges.filter(edge => suggestionBatch.edgeIds.includes(edge.id))
  const suggestionCount = suggestedNodes.length + suggestedEdges.length
  const linkedNode = event.nodeId === undefined ? undefined : workspace.graph.nodes.find(node => node.id === event.nodeId)
  const worldEvents = (event.worldEventSequences ?? []).flatMap(sequence => {
    const worldEvent = workspace.world?.events.find(candidate => candidate.sequence === sequence)
    return worldEvent === undefined ? [] : [worldEvent]
  })
  const patch = (transform: (value: StoryEvent) => StoryEvent): void => {
    update(current => {
      const nextEvent = transform(current.events.find(item => item.id === event.id) ?? event)
      return {
        ...current,
        events: current.events.map(item => item.id === event.id ? nextEvent : item),
        facts: current.facts.map(fact => fact.source.kind === 'event' && fact.source.eventId === event.id
          ? { ...fact, source: { ...fact.source, evidence: nextEvent.evidence } }
          : fact),
      }
    })
  }
  const patchObservation = (factId: string, transform: (value: StoryFact) => StoryFact): void => {
    update(current => ({
      ...current,
      facts: current.facts.map(fact => fact.id === factId ? transform(fact) : fact),
    }))
  }
  const addObservation = (): void => {
    update(current => ({
      ...current,
      facts: [...current.facts, createEventObservationFact(`fact-${createClientOpaqueUuid()}`, event)],
    }))
  }
  const deleteObservation = (factId: string): void => {
    update(current => removeStoryFact(current, factId))
  }
  const toggleObserver = (fact: StoryFact, characterId: string, checked: boolean): void => {
    patchObservation(fact.id, current => ({
      ...current,
      knowledgeMode: 'override',
      knownBy: checked
        ? [...new Set([...current.knownBy, characterId])]
        : current.knownBy.filter(id => id !== characterId),
    }))
  }
  return <>
    <h2>{event.title}</h2><div className="story-studio-inspector-subtitle">第 {event.turn} 回合 · 已发生事件</div>
    {worldEvents.length > 0 && <div className="story-timeline-rule-sources"><strong>规则程序来源</strong>
      {worldEvents.map(worldEvent => <button type="button" key={worldEvent.id}
        onClick={() => { onSelect({ kind: 'world-event', id: worldEvent.id }) }}>
        <span>#{worldEvent.sequence}</span><b>{worldEvent.title}</b>
      </button>)}</div>}
    {citations.length > 0 && <div className="story-timeline-rule-sources"><strong>本回合资料依据</strong>
      {citations.map(citation => <button type="button" key={citation.id}
        onClick={() => { onSelect({ kind: 'citation', id: citation.id }) }}>
        <span>{workspace.sources.find(source => source.id === citation.sourceId)?.name ?? '本地资料'}</span><b>{citation.locator}</b>
      </button>)}</div>}
    <TextField label="事件标题" rows={1} value={event.title} onChange={value => { patch(current => ({ ...current, title: value })) }} />
    <TextField label="事件摘要" rows={5} value={event.summary} onChange={value => { patch(current => ({ ...current, summary: value })) }} />
    <TextField label="最终正文证据" rows={7} value={event.evidence} onChange={value => { patch(current => ({ ...current, evidence: value })) }} />
    <Field label="关联剧情节点"><select className="story-studio-input" value={event.nodeId ?? ''}
      onChange={change => { patch(current => change.target.value === '' ? eventWithoutNode(current) : { ...current, nodeId: change.target.value }) }}>
      <option value="">未关联</option>{workspace.graph.nodes.filter(node => node.lifecycle === 'canonical').map(node => <option key={node.id} value={node.id}>{node.title}</option>)}
    </select></Field>
    {linkedNode !== undefined && <button className="story-studio-button" type="button"
      onClick={() => { onSelect({ kind: 'node', id: linkedNode.id }) }}>在故事地图中打开“{linkedNode.title}”</button>}
    <div className="story-studio-field"><span>参与人物</span><div className="story-studio-checks">
      {workspace.characters.map(character => <label className="story-studio-check" key={character.id}>
        <input type="checkbox" checked={event.participantIds.includes(character.id)} onChange={change => { patch(current => ({
          ...current,
          participantIds: change.target.checked ? [...new Set([...current.participantIds, character.id])] : current.participantIds.filter(id => id !== character.id),
        })) }} />{character.name}
      </label>)}
    </div></div>
    <hr className="story-studio-divider" />
    <div className="story-event-observations">
      <div className="story-event-observations-heading"><div><strong>由此事件形成的认知</strong>
        <span>先写会影响后续判断的事实，再选择真正看见、听见或后来得知它的人物。</span></div>
        <button className="story-studio-button story-studio-button-primary" type="button" onClick={addObservation}>＋ 补记认知</button>
      </div>
      {observations.map(fact => {
        const effectiveKnownBy = factKnownBy(workspace, fact)
        return <div className="story-event-observation-editor" key={fact.id}>
          <div className="story-event-observation-main"><textarea aria-label="事件人物事实" className="story-studio-input" rows={3} value={fact.text}
            onChange={change => { patchObservation(fact.id, current => ({ ...current, text: change.target.value })) }} />
            <div className="story-event-observation-actions"><select className="story-studio-input" aria-label="认知状态" value={fact.status}
              onChange={change => { patchObservation(fact.id, current => ({ ...current, status: change.target.value as StoryFact['status'] })) }}>
              <option value="asserted">确认</option><option value="uncertain">不确定</option><option value="refuted">已否定</option>
            </select><button className="story-studio-icon-button story-studio-danger" type="button"
              aria-label={`删除认知：${fact.text.slice(0, 48)}`} onClick={() => { deleteObservation(fact.id) }}>×</button></div>
          </div>
          <div className="story-event-observation-knowers"><span>真正知情者</span><div className="story-studio-checks">{workspace.characters.map(character => <label className="story-studio-check" key={character.id}>
            <input type="checkbox" checked={effectiveKnownBy.includes(character.id)}
              onChange={change => { toggleObserver(fact, character.id, change.target.checked) }} />{character.name}
          </label>)}</div></div>
          {effectiveKnownBy.length === 0 && <small>尚未分配给任何人物 Worker。</small>}
        </div>
      })}
      {observations.length === 0 && <p>从这次经历中挑出会影响人物后续判断的事实。</p>}
      <button className="story-studio-button" type="button" onClick={onOpenKnowledge}>在全局认知审计中核对</button>
    </div>
    {suggestionCount > 0 && <>
      <hr className="story-studio-divider" />
      <div className="story-event-change-set"><div className="story-event-change-set-heading"><div>
        <strong>本回合候选变更</strong><span>{suggestedNodes.length} 个故事节点 · {suggestedEdges.length} 条关系</span>
      </div><span>{suggestionCount} 项待审</span></div>
      <div className="story-event-change-list">
        {suggestedNodes.map(node => <button type="button" key={node.id} onClick={() => { onSelect({ kind: 'node', id: node.id }) }}>
          <span>{nodeKindLabels[node.kind]}</span><strong>{node.title}</strong><small>查看并修改</small>
        </button>)}
        {suggestedEdges.map(edge => <button type="button" key={edge.id} onClick={() => { onSelect({ kind: 'edge', id: edge.id }) }}>
          <span>{edgeKindLabels[edge.kind]}</span><strong>{edge.label || '未命名关系'}</strong><small>查看并修改</small>
        </button>)}
      </div>
      <div className="story-studio-actions">
        <button className="story-studio-button story-studio-button-primary" type="button"
          onClick={() => { update(current => acceptStorySuggestionBatch(current, event.id)) }}>整组接受</button>
        <button className="story-studio-button" type="button"
          onClick={() => { update(current => rejectStorySuggestionBatch(current, event.id)) }}>整组拒绝</button>
      </div></div>
    </>}
    <hr className="story-studio-divider" />
    <button className="story-studio-button story-studio-danger" type="button" onClick={onDelete}>删除事件与其派生事实</button>
  </>
}

function WorldEventInspector({ workspace, event, onOpenWorld, onSelectStoryEvent }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly event: PlayWorldEvent
  readonly onOpenWorld: () => void
  readonly onSelectStoryEvent: (id: string) => void
}) {
  const actor = event.actorId === undefined ? undefined : workspace.characters.find(character => character.id === event.actorId)
  const representedBy = workspace.events.filter(storyEvent => storyEvent.worldEventSequences?.includes(event.sequence) === true)
  return <>
    <h2>{event.title}</h2><div className="story-studio-inspector-subtitle">规则事件 #{event.sequence} · {workspace.world?.title ?? '可执行世界'}</div>
    <div className="story-world-event-facts">
      <div><span>事件类型</span><strong>{event.type}</strong></div>
      <div><span>行动人物</span><strong>{actor?.name ?? '世界程序'}</strong></div>
    </div>
    <div className="story-studio-field"><span>权威结果</span><p className="story-world-event-summary">{event.summary}</p></div>
    <div className="story-studio-callout">规则程序保存这项结果，时间线通过来源链接与当前棋盘保持一致。</div>
    <button className="story-studio-button" type="button" onClick={onOpenWorld}>在游玩场地中查看</button>
    <hr className="story-studio-divider" />
    <div className="story-timeline-rule-sources"><strong>{representedBy.length === 0 ? '未关联正文回合' : '已进入正文回合'}</strong>
      {representedBy.map(storyEvent => <button type="button" key={storyEvent.id} onClick={() => { onSelectStoryEvent(storyEvent.id) }}>
        <span>第 {storyEvent.turn} 回合</span><b>{storyEvent.title}</b>
      </button>)}
      {representedBy.length === 0 && <p>下一次由人物推进并续写时，可以把新的规则结果连接到正文事件。</p>}
    </div>
  </>
}

function StoryTimelineEventCard({ workspace, event, selected, onSelect, onSelectWorldEvent }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly event: StoryEvent
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onSelectWorldEvent: (id: string) => void
}) {
  const batch = storySuggestionBatch(workspace, event.id)
  const pending = batch.nodeIds.length + batch.edgeIds.length
  const worldEvents = (event.worldEventSequences ?? []).flatMap(sequence => {
    const worldEvent = workspace.world?.events.find(candidate => candidate.sequence === sequence)
    return worldEvent === undefined ? [] : [worldEvent]
  })
  return <article className="story-studio-card" data-selected={selected} onClick={onSelect}>
    <h3>第 {event.turn} 回合 · {event.title}</h3><p>{event.summary}</p>
    {worldEvents.length > 0 && <div className="story-timeline-world-links"><span>规则来源</span>{worldEvents.map(worldEvent => <button type="button" key={worldEvent.id}
      onClick={click => { click.stopPropagation(); onSelectWorldEvent(worldEvent.id) }}>
      <b>#{worldEvent.sequence}</b>{worldEvent.title}
    </button>)}</div>}
    <div className="story-studio-card-meta"><span>{event.participantIds.map(id => workspace.characters.find(character => character.id === id)?.name).filter(Boolean).join(' · ') || '未标注参与人物'}</span>
      <span>{workspace.facts.filter(fact => fact.source.kind === 'event' && fact.source.eventId === event.id).length} 条人物观察</span>
      {pending > 0 && <span>{pending} 项候选变更</span>}
      {event.nodeId !== undefined && <span>场景：{workspace.graph.nodes.find(node => node.id === event.nodeId)?.title ?? '剧情节点'}</span>}</div>
  </article>
}

function StoryTimelineSection({ workspace, group, selectedEventId, onSelectEvent, onSelectWorldEvent }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly group: StoryTimelineGroup
  readonly selectedEventId: string | undefined
  readonly onSelectEvent: (id: string) => void
  readonly onSelectWorldEvent: (id: string) => void
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const containsSelection = group.events.some(event => event.id === selectedEventId)
  useEffect(() => {
    if (containsSelection && detailsRef.current !== null) detailsRef.current.open = true
  }, [containsSelection])
  const turnRange = group.firstTurn === group.lastTurn
    ? `第 ${String(group.firstTurn)} 回合`
    : `第 ${String(group.firstTurn)}–${String(group.lastTurn)} 回合`
  return <details className="story-timeline-group" ref={detailsRef}>
    <summary><span className="story-timeline-group-mark">{group.node?.kind === 'arc' ? '篇' : group.node === undefined ? '待' : '景'}</span>
      <span className="story-timeline-group-copy"><strong>{group.title}</strong><small>{group.summary}</small></span>
      <span className="story-timeline-group-meta"><b>{group.events.length} 件</b><small>{turnRange}</small></span>
    </summary>
    <div className="story-timeline-group-events">{group.events.map(event => <StoryTimelineEventCard workspace={workspace} event={event}
      selected={event.id === selectedEventId} key={event.id} onSelect={() => { onSelectEvent(event.id) }}
      onSelectWorldEvent={onSelectWorldEvent} />)}</div>
  </details>
}

function SourceInspector({ source, update, onDelete }: {
  readonly source: StorySource
  readonly update: UpdateWorkspace
  readonly onDelete: () => void
}) {
  const patch = (transform: (value: StorySource) => StorySource): void => {
    update(current => ({ ...current, sources: current.sources.map(item => item.id === source.id ? transform(item) : item) }))
  }
  return <>
    <h2>{source.name}</h2><div className="story-studio-inspector-subtitle">{sourceKindLabels[source.kind]}资料</div>
    {source.origin?.kind === 'web' && <div className="story-source-origin">
      <span>来自第 {source.origin.turn} 回合网络研究</span>
      <a href={source.origin.url} target="_blank" rel="noreferrer">打开原网页 ↗</a>
    </div>}
    {source.origin?.kind === 'url' && <div className="story-source-origin">
      <span>{source.origin.truncated ? '直接导入 · 正文已按安全上限截断' : '直接从网页导入'}</span>
      <a href={source.origin.url} target="_blank" rel="noreferrer">打开原网页 ↗</a>
    </div>}
    <TextField label="资料名称" rows={1} value={source.name} onChange={value => { patch(current => ({ ...current, name: value })) }} />
    <Field label="资料类型"><select className="story-studio-input" value={source.kind}
      onChange={event => { patch(current => ({ ...current, kind: event.target.value as StorySourceKind })) }}>
      {Object.entries(sourceKindLabels).map(([kind, label]) => <option value={kind} key={kind}>{label}</option>)}
    </select></Field>
    <label className="story-studio-check" style={{ marginBottom: 12 }}><input type="checkbox" checked={source.enabled}
      onChange={event => { patch(current => ({ ...current, enabled: event.target.checked })) }} />参与研究</label>
    <TextField label={source.kind === 'web' ? '查询范围与提示' : '原文、摘录或研究内容'} rows={15} value={source.content}
      onChange={value => { patch(current => ({ ...current, content: value })) }} />
    <button className="story-studio-button story-studio-danger" type="button" onClick={onDelete}>删除资料</button>
  </>
}

function CitationInspector({ workspace, citation, update, onDelete }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly citation: StoryCitation
  readonly update: UpdateWorkspace
  readonly onDelete: () => void
}) {
  const patch = (transform: (value: StoryCitation) => StoryCitation): void => {
    update(current => ({ ...current, citations: current.citations.map(item => item.id === citation.id ? transform(item) : item) }))
  }
  const source = workspace.sources.find(candidate => candidate.id === citation.sourceId)
  const canonicalNodes = workspace.graph.nodes.filter(node => node.lifecycle === 'canonical' && node.status !== 'dropped')
  const changeTargetKind = (kind: '' | 'node' | 'fact' | 'event'): void => {
    if (kind === '') patch(citationWithoutTarget)
    else if (kind === 'node') {
      const node = canonicalNodes[0]
      if (node !== undefined) patch(current => ({ ...current, target: { kind: 'node', nodeId: node.id } }))
    } else {
      if (kind === 'fact') {
        const fact = workspace.facts[0]
        if (fact !== undefined) patch(current => ({ ...current, target: { kind: 'fact', factId: fact.id } }))
      } else {
        const event = workspace.events[0]
        if (event !== undefined) patch(current => ({ ...current, target: { kind: 'event', eventId: event.id } }))
      }
    }
  }
  return <>
    <h2>资料引用</h2><div className="story-studio-inspector-subtitle">{citationSourceLabel(workspace, citation)}</div>
    <Field label="来源资料"><select className="story-studio-input" value={citation.sourceId}
      onChange={event => { patch(current => citationWithoutRefreshReview({ ...current, sourceId: event.target.value })) }}>
      {workspace.sources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></Field>
    <TextField label="原文位置" rows={1} value={citation.locator}
      onChange={value => { patch(current => citationWithoutRefreshReview({ ...current, locator: value })) }} />
    <TextField label="引用原文快照" rows={8} value={citation.quote}
      onChange={value => { patch(current => citationWithoutRefreshReview({ ...current, quote: value })) }} />
    <div className="story-citation-state" data-current={source?.content.includes(citation.quote) ?? false}>
      {source?.content.includes(citation.quote) === true ? '仍可在当前原文中定位' : '原文已变化；引用快照仍被保留'}
    </div>
    <TextField label="引用说明" rows={4} value={citation.note} onChange={value => { patch(current => ({ ...current, note: value })) }} />
    <Field label="支持的故事对象"><select className="story-studio-input" value={citation.target?.kind ?? ''}
      onChange={event => { changeTargetKind(event.target.value as '' | 'node' | 'fact' | 'event') }}>
      <option value="">暂未关联</option>
      <option value="node" disabled={canonicalNodes.length === 0}>剧情节点</option>
      <option value="fact" disabled={workspace.facts.length === 0}>人物事实</option>
      <option value="event" disabled={workspace.events.length === 0}>故事事件</option>
    </select></Field>
    {citation.target?.kind === 'node' && <Field label="剧情节点"><select className="story-studio-input" value={citation.target.nodeId}
      onChange={event => { patch(current => ({ ...current, target: { kind: 'node', nodeId: event.target.value } })) }}>
      {canonicalNodes.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}
    </select></Field>}
    {citation.target?.kind === 'fact' && <Field label="人物事实"><select className="story-studio-input" value={citation.target.factId}
      onChange={event => { patch(current => ({ ...current, target: { kind: 'fact', factId: event.target.value } })) }}>
      {workspace.facts.map(fact => <option key={fact.id} value={fact.id}>{fact.text.slice(0, 70)}</option>)}
    </select></Field>}
    {citation.target?.kind === 'event' && <Field label="故事事件"><select className="story-studio-input" value={citation.target.eventId}
      onChange={event => { patch(current => ({ ...current, target: { kind: 'event', eventId: event.target.value } })) }}>
      {workspace.events.map(event => <option key={event.id} value={event.id}>第 {event.turn} 回合 · {event.title}</option>)}
    </select></Field>}
    <button className="story-studio-button story-studio-danger" type="button" onClick={onDelete}>删除引用</button>
  </>
}

const SOURCE_VOICE_UNIT_PAGE_SIZE = 12
const SOURCE_VOICE_DIAGNOSTIC_LIMIT = 16

function normalizedSourceFilter(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
}

function passageContainsSpeaker(
  passage: LocatedStorySourcePassage,
  document: ReturnType<typeof parseStoryVoiceDocument>,
  speakerNames: readonly string[],
): boolean {
  return document.occurrences.some(line => line.sourceStart < passage.sourceEnd && line.sourceEnd > passage.sourceStart
    && storyVoiceSpeakerMatches(speakerNames, line.speaker))
}

const citationRefreshReviewLabels = {
  relocated: '已重新定位',
  ambiguous: '需要选择位置',
  missing: '新正文中缺失',
} as const

function CitationRefreshReviewPanel({ citations, passages, onSelectCitation, onResolve }: {
  readonly citations: readonly StoryCitation[]
  readonly passages: readonly StorySourcePassage[]
  readonly onSelectCitation: (id: string) => void
  readonly onResolve: (id: string, locator?: string) => void
}) {
  return <section className="story-source-refresh-reviews" aria-label="引用刷新审阅">
    <div className="story-source-refresh-reviews-heading"><div><strong>引用刷新待审</strong>
      <span>原句快照始终保留。确认新位置或选择保留历史快照后，再保存场地。</span></div><b>{citations.length}</b></div>
    <div className="story-source-refresh-review-list">{citations.map(citation => {
      const review = citation.refreshReview!
      const matches = findStorySourceQuoteMatches(passages, citation.quote)
      return <article className="story-source-refresh-review" data-kind={review.kind} key={citation.id}>
        <div className="story-source-refresh-review-heading"><span>{citationRefreshReviewLabels[review.kind]}</span>
          <button type="button" onClick={() => { onSelectCitation(citation.id) }}>查看引用</button></div>
        <blockquote>{citation.quote}</blockquote>
        <div className="story-source-refresh-review-location"><span>刷新前</span><b>{review.previousLocator || '未标注位置'}</b>
          {review.kind === 'relocated' && <><span>现在</span><b>{citation.locator || '未标注位置'}</b></>}</div>
        {review.kind === 'ambiguous' && <div className="story-source-refresh-candidates">
          <span>新正文中的候选段落</span>{matches.map(match => <button type="button" key={`${citation.id}:${match.passage.locator}`}
            onClick={() => { onResolve(citation.id, match.passage.locator) }}>
            <strong>{match.passage.locator}</strong><small>{match.occurrenceCount > 1 ? `同段出现 ${String(match.occurrenceCount)} 次` : '出现 1 次'}</small>
          </button>)}
        </div>}
        <div className="story-source-refresh-review-actions">
          {review.kind === 'relocated' && <button className="story-studio-button story-studio-button-primary" type="button"
            onClick={() => { onResolve(citation.id) }}>确认新位置</button>}
          {review.kind !== 'relocated' && <button className="story-studio-button" type="button"
            onClick={() => { onResolve(citation.id) }}>仅保留历史快照</button>}
        </div>
      </article>
    })}</div>
  </section>
}

function SourceReader({ workspace, source, selectedCitationId, busy, dirty, webFetchAvailable, onBack, onSelectCitation, onAddCitation, onEditCharacter, onRefresh, onResolveCitationReview }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly source: StorySource
  readonly selectedCitationId: string | undefined
  readonly busy: boolean
  readonly dirty: boolean
  readonly webFetchAvailable: boolean | null
  readonly onBack: () => void
  readonly onSelectCitation: (id: string) => void
  readonly onAddCitation: (passage: StorySourcePassage) => void
  readonly onEditCharacter: (id: string) => void
  readonly onRefresh: () => void
  readonly onResolveCitationReview: (id: string, locator?: string) => void
}) {
  const normalizedContent = useMemo(() => normalizeStorySourceContent(source.content), [source.content])
  const passages = useMemo(() => splitLocatedStorySourcePassages(source), [source])
  const citations = workspace.citations.filter(citation => citation.sourceId === source.id)
  const citationReviews = citations.filter(citation => citation.refreshReview !== undefined)
  const [selectedVoiceCharacterId, setSelectedVoiceCharacterId] = useState(workspace.characters[0]?.id)
  const [visibleVoiceUnitCount, setVisibleVoiceUnitCount] = useState(SOURCE_VOICE_UNIT_PAGE_SIZE)
  const [passageQuery, setPassageQuery] = useState('')
  const [passageSection, setPassageSection] = useState('')
  const [passageCharacterId, setPassageCharacterId] = useState('')
  const voiceDocument = useMemo(() => parseStoryVoiceDocument(normalizedContent), [normalizedContent])
  const characterVoices = useMemo(() => workspace.characters.map(character => {
    const names = [character.name, ...(character.voiceAliases ?? [])]
    const parts = attributeStoryVoiceDocument(names, voiceDocument)
    return {
      character,
      units: storyVoiceEvidenceUnits(parts).filter(unit => unit.owner === 'target'),
    }
  }), [voiceDocument, workspace.characters])
  const activeCharacterVoice = characterVoices.find(item => item.character.id === selectedVoiceCharacterId)
    ?? characterVoices[0]
  const voiceAttributions = useMemo(() => storyVoiceSpeakerAttributions(voiceDocument, workspace.characters.map(character => ({
    id: character.id,
    names: [character.name, ...(character.voiceAliases ?? [])],
  }))), [voiceDocument, workspace.characters])
  const unmatchedSpeakers = voiceAttributions.filter(item => item.characterIds.length === 0)
  const ambiguousSpeakers = voiceAttributions.filter(item => item.characterIds.length > 1)
  const passageSectionByOrdinal = useMemo(() => storySourcePassageSections(passages), [passages])
  const passageSections = useMemo(() => [...new Set(passageSectionByOrdinal)], [passageSectionByOrdinal])
  const passageCharacters = useMemo(() => workspace.characters.map(character => {
    const speakerNames = [character.name, ...(character.voiceAliases ?? [])]
    return {
      character,
      passageCount: passages.filter(passage => passageContainsSpeaker(passage, voiceDocument, speakerNames)).length,
    }
  }), [passages, voiceDocument, workspace.characters])
  const normalizedQuery = normalizedSourceFilter(passageQuery)
  const selectedPassageCharacter = workspace.characters.find(character => character.id === passageCharacterId)
  const selectedPassageSpeakerNames = selectedPassageCharacter === undefined
    ? []
    : [selectedPassageCharacter.name, ...(selectedPassageCharacter.voiceAliases ?? [])]
  const visiblePassages = passages.filter(passage => (passageSection === '' || passageSectionByOrdinal[passage.ordinal] === passageSection)
    && (normalizedQuery === '' || normalizedSourceFilter(`${passage.locator}\n${passage.text}`).includes(normalizedQuery))
    && (selectedPassageCharacter === undefined || passageContainsSpeaker(passage, voiceDocument, selectedPassageSpeakerNames)))
  useEffect(() => {
    setVisibleVoiceUnitCount(SOURCE_VOICE_UNIT_PAGE_SIZE)
  }, [activeCharacterVoice?.character.id, source.id])
  useEffect(() => {
    setPassageQuery('')
    setPassageSection('')
    setPassageCharacterId('')
  }, [source.id])
  return <div className="story-source-reader">
    <div className="story-studio-view-heading"><div><button className="story-source-back" type="button" onClick={onBack}>← 资料库</button>
      <h1>{source.name}</h1><p>{sourceKindLabels[source.kind]} · {passages.length} 段 · {citations.length} 条引用</p></div>
      {source.origin?.kind === 'url' && <div className="story-studio-actions">
        <a className="story-studio-button" href={source.origin.url} target="_blank" rel="noreferrer">打开原网页 ↗</a>
        <button className="story-studio-button story-studio-button-primary" type="button"
          disabled={busy || dirty || webFetchAvailable !== true}
          title={dirty ? '先保存当前修改，再刷新网页资料' : webFetchAvailable === false ? '当前 Host 没有网页正文读取能力' : undefined}
          onClick={onRefresh}>重新读取网页</button>
      </div>}
    </div>
    {citationReviews.length > 0 && <CitationRefreshReviewPanel citations={citationReviews} passages={passages}
      onSelectCitation={onSelectCitation} onResolve={onResolveCitationReview} />}
    {source.kind === 'original' && <section className="story-source-voice-inspection">
      <div className="story-source-voice-heading"><div><strong>原作声音</strong><span>逐句核对识别结果；署名遗漏或冲突可以回人物档案修正。</span></div>
        <span>{voiceDocument.orderedLines.length} 行署名台词</span></div>
      {characterVoices.length === 0
        ? <div className="story-source-voice-empty">先添加人物，再检查原作署名是否正确归属。</div>
        : <>
          <div className="story-source-voice-tabs" role="tablist" aria-label="选择人物声音">
            {characterVoices.map(item => <button aria-selected={activeCharacterVoice?.character.id === item.character.id}
              className="story-source-voice-tab" data-empty={item.units.length === 0} key={item.character.id} role="tab" type="button"
              onClick={() => { setSelectedVoiceCharacterId(item.character.id) }}>
              <span>{item.character.name}</span><b>{item.units.length} 句</b>
            </button>)}
          </div>
          {activeCharacterVoice !== undefined && <div className="story-source-voice-character">
            <div className="story-source-voice-character-heading"><div><strong>{activeCharacterVoice.character.name}</strong>
              <span>{activeCharacterVoice.units.length === 0
                ? '当前署名没有命中此人物。'
                : `已识别 ${String(activeCharacterVoice.units.length)} 个台词单元。`}</span></div>
              <button className="story-studio-button" type="button" onClick={() => { onEditCharacter(activeCharacterVoice.character.id) }}>编辑人物署名</button></div>
            {activeCharacterVoice.units.length === 0
              ? <div className="story-source-voice-empty">若原文确有此人物台词，请把原始署名补到人物档案的“原作署名”。</div>
              : <div className="story-source-voice-units">{activeCharacterVoice.units.slice(0, visibleVoiceUnitCount).map((unit, unitIndex) => <article
                className="story-source-voice-unit" key={`${activeCharacterVoice.character.id}:${String(unitIndex)}`}>
                <div className="story-source-voice-unit-heading"><span>台词 {String(unitIndex + 1)}</span><small>{[...new Set(unit.lines.map(line => line.speaker))].join(' / ')}</small></div>
                {unit.lines.map((line, lineIndex) => <div className="story-source-voice-line" data-variant={line.variant}
                  key={`${line.variant}:${line.speaker}:${String(lineIndex)}`}>
                  <small>{line.variant === 'original' ? '原文' : line.variant === 'translation' ? '参考译文' : '示例'} · {line.speaker}</small>
                  <p>{line.dialogue}</p>
                </div>)}
              </article>)}</div>}
            {visibleVoiceUnitCount < activeCharacterVoice.units.length && <button className="story-source-voice-more" type="button"
              onClick={() => { setVisibleVoiceUnitCount(count => count + SOURCE_VOICE_UNIT_PAGE_SIZE) }}>
              继续显示（还有 {String(activeCharacterVoice.units.length - visibleVoiceUnitCount)} 句）
            </button>}
          </div>}
        </>}
      {(unmatchedSpeakers.length > 0 || ambiguousSpeakers.length > 0) && <div className="story-source-voice-diagnostics">
        <div><strong>署名待校对</strong><span>未归属需要补充别名；多人物命中需要移除冲突别名。</span></div>
        {[...unmatchedSpeakers, ...ambiguousSpeakers].slice(0, SOURCE_VOICE_DIAGNOSTIC_LIMIT).map((item, index) => <div
          className="story-source-voice-diagnostic" data-kind={item.characterIds.length === 0 ? 'unmatched' : 'ambiguous'}
          key={`${item.labels.join(':')}:${String(index)}`}>
          <strong>{item.labels.join(' / ')}</strong><span>{item.characterIds.length === 0
            ? `未归属 · ${String(item.lineCount)} 行`
            : `同时命中 ${item.characterIds.map(id => workspace.characters.find(character => character.id === id)?.name ?? id).join('、')}`}</span>
        </div>)}
        {unmatchedSpeakers.length + ambiguousSpeakers.length > SOURCE_VOICE_DIAGNOSTIC_LIMIT
          && <small>另有 {String(unmatchedSpeakers.length + ambiguousSpeakers.length - SOURCE_VOICE_DIAGNOSTIC_LIMIT)} 个署名未展开。</small>}
      </div>}
    </section>}
    <section className="story-source-browser" aria-label="在资料中查找">
      <div className="story-source-browser-heading"><div><strong>在资料中查找</strong><span>按章节、人物署名或正文关键词收窄原文，不改动资料内容。</span></div>
        <b>{visiblePassages.length}/{passages.length} 段</b></div>
      <div className="story-source-browser-controls">
        <label><span>章节</span><select className="story-studio-input" value={passageSection} onChange={event => { setPassageSection(event.target.value) }}>
          <option value="">全部章节</option>{passageSections.map(section => <option value={section} key={section}>{section}</option>)}
        </select></label>
        <label><span>人物署名</span><select className="story-studio-input" value={passageCharacterId} onChange={event => { setPassageCharacterId(event.target.value) }}>
          <option value="">全部人物</option>{passageCharacters.map(({ character, passageCount }) => <option value={character.id} disabled={passageCount === 0} key={character.id}>
            {character.name}（{passageCount} 段）
          </option>)}
        </select></label>
        <label className="story-source-browser-query"><span>正文关键词</span><input className="story-studio-input" type="search" value={passageQuery}
          placeholder="输入一段原句、地点或事件" onChange={event => { setPassageQuery(event.target.value) }} /></label>
        {(passageSection !== '' || passageCharacterId !== '' || passageQuery !== '') && <button className="story-studio-button" type="button"
          onClick={() => { setPassageSection(''); setPassageCharacterId(''); setPassageQuery('') }}>清除筛选</button>}
      </div>
    </section>
    {citations.length > 0 && <div className="story-source-citations"><strong>已保存引用</strong><div>
      {citations.map(citation => <button className="story-citation-chip" data-selected={selectedCitationId === citation.id}
        data-review={citation.refreshReview?.kind}
        key={citation.id} type="button" onClick={() => { onSelectCitation(citation.id) }}>
        <span>{citation.locator}</span><small>{citation.refreshReview === undefined ? '' : `${citationRefreshReviewLabels[citation.refreshReview.kind]} · `}{citation.target === undefined ? '未关联'
          : citation.target.kind === 'node' ? '剧情节点' : citation.target.kind === 'fact' ? '人物事实' : '故事事件'}</small>
      </button>)}
    </div></div>}
    <div className="story-source-passages">{visiblePassages.map(passage => {
      const passageCitations = citations.filter(citation => citation.locator === passage.locator && citation.quote === passage.text)
      return <div className="story-source-passage" key={`${source.id}:${String(passage.ordinal)}`}>
        <div className="story-source-passage-heading"><span>{passage.locator}</span><button className="story-source-cite-button" type="button"
          onClick={() => { onAddCitation(passage) }}>引用此段</button></div>
        <p>{passage.text}</p>
        {passageCitations.length > 0 && <div className="story-source-passage-actions">{passageCitations.map(citation => <button className="story-citation-link" key={citation.id}
          type="button" onClick={() => { onSelectCitation(citation.id) }}>查看引用</button>)}</div>}
      </div>
    })}{passages.length === 0
      ? <div className="story-studio-empty"><span>在右侧加入原文或研究内容，阅读器会按标题和自然段整理。</span></div>
      : visiblePassages.length === 0 && <div className="story-studio-empty"><span>当前筛选没有命中段落；可以切换章节、人物或缩短关键词。</span></div>}</div>
  </div>
}

function OutputInspector({ workspace, output, update, onDelete }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly output: StoryOutput
  readonly update: UpdateWorkspace
  readonly onDelete: () => void
}) {
  const patch = (transform: (value: StoryOutput) => StoryOutput): void => {
    update(current => ({ ...current, outputs: current.outputs.map(item => item.id === output.id ? transform(item) : item) }))
  }
  const changeKind = (kind: StoryOutputKind): void => { patch(current => kind === 'character' ? { ...current, kind } : { ...selectWithoutCharacter(current), kind }) }
  return <>
    <h2>{output.name}</h2><div className="story-studio-inspector-subtitle">{outputKindLabels[output.kind]}分区</div>
    <TextField label="分区名称" rows={1} value={output.name} onChange={value => { patch(current => ({ ...current, name: value })) }} />
    <Field label="职责"><select className="story-studio-input" value={output.kind}
      onChange={event => { changeKind(event.target.value as StoryOutputKind) }}>
      <option value="prose">主正文</option><option value="character">人物分区</option><option value="history">历史分区</option>
    </select></Field>
    {output.kind === 'character' && <Field label="目标人物"><select className="story-studio-input" value={output.characterId ?? ''}
      onChange={event => { patch(current => event.target.value === '' ? selectWithoutCharacter(current) : { ...current, characterId: event.target.value }) }}>
      <option value="">每位参与人物各自一份</option>{workspace.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
    </select></Field>}
    <label className="story-studio-check" style={{ marginBottom: 12 }}><input type="checkbox" checked={output.enabled}
      onChange={event => { patch(current => ({ ...current, enabled: event.target.checked })) }} />生成此分区</label>
    <TextField label="写作职责与约束" rows={12} value={output.instructions} onChange={value => { patch(current => ({ ...current, instructions: value })) }} />
    <button className="story-studio-button story-studio-danger" type="button" onClick={onDelete}>删除分区</button>
  </>
}

function EmptyInspector() {
  return <div className="story-studio-empty"><span style={{ fontSize: 24 }}>◇</span><span>选择一个故事对象，在这里查看和编辑它的属性。</span></div>
}

function StoryMap({ workspace, selection, perspectiveId, update, setSelection, clearPerspective }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly selection: StudioSelection | undefined
  readonly perspectiveId: string | undefined
  readonly update: UpdateWorkspace
  readonly setSelection: (selection: StudioSelection | undefined) => void
  readonly clearPerspective: () => void
}) {
  const [dragPositions, setDragPositions] = useState<ReadonlyMap<string, StoryNode['position']>>(new Map())
  const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(new Set())
  const nodeById = useMemo(() => new Map(workspace.graph.nodes.map(node => [node.id, node])), [workspace.graph.nodes])
  const rootId = (id: string): string => {
    let current = nodeById.get(id)
    const visited = new Set<string>()
    while (current?.parentId !== undefined && !visited.has(current.id)) {
      visited.add(current.id)
      current = nodeById.get(current.parentId)
    }
    return current?.id ?? id
  }
  const perspectiveKnownNodeIds = useMemo(() => new Set(workspace.graph.nodes
    .filter(node => perspectiveId === undefined || nodeKnownBy(workspace, node.id).includes(perspectiveId))
    .map(node => node.id)), [perspectiveId, workspace])
  const visibleFacts = useMemo(() => workspace.facts.filter(fact => perspectiveId === undefined
    || factKnownBy(workspace, fact).includes(perspectiveId)), [perspectiveId, workspace])
  const perspectiveVisibleIds = useMemo(() => {
    if (perspectiveId === undefined) return new Set(workspace.graph.nodes.map(node => node.id))
    const visible = new Set<string>()
    const revealAncestors = (id: string): void => {
      let current = nodeById.get(id)
      while (current !== undefined && !visible.has(current.id)) {
        visible.add(current.id)
        current = current.parentId === undefined ? undefined : nodeById.get(current.parentId)
      }
    }
    for (const node of workspace.graph.nodes) {
      if (nodeKnownBy(workspace, node.id).includes(perspectiveId)) revealAncestors(node.id)
    }
    for (const fact of workspace.facts) {
      if (fact.nodeId !== undefined && factKnownBy(workspace, fact).includes(perspectiveId)) revealAncestors(fact.nodeId)
    }
    return visible
  }, [nodeById, perspectiveId, workspace])
  const visibleNodes = useMemo(() => workspace.graph.nodes.filter(node => node.parentId === undefined
    && perspectiveVisibleIds.has(node.id)), [perspectiveVisibleIds, workspace.graph.nodes])
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(node => node.id)), [visibleNodes])
  const nodes = useMemo((): readonly StoryCanvasNode[] => visibleNodes.map(node => {
    const rootKnown = perspectiveId === undefined || perspectiveKnownNodeIds.has(node.id)
    const children = workspace.graph.nodes.flatMap(child => {
      if (child.id === node.id || rootId(child.id) !== node.id || !perspectiveKnownNodeIds.has(child.id)) return []
      let depth = 0
      let current: StoryNode | undefined = child
      const visited = new Set<string>()
      while (current?.parentId !== undefined && !visited.has(current.id)) {
        visited.add(current.id)
        depth += 1
        current = nodeById.get(current.parentId)
      }
      return [{
        id: child.id,
        kind: child.kind,
        title: child.title,
        summary: child.summary,
        depth,
        detailCount: visibleFacts.filter(fact => fact.nodeId === child.id).length,
      }]
    })
    const details = visibleFacts.filter(fact => fact.nodeId !== undefined && rootId(fact.nodeId) === node.id).map(fact => {
      const names = factKnownBy(workspace, fact).map(id => workspace.characters.find(character => character.id === id)?.name)
        .filter((name): name is string => name !== undefined)
      const owner = fact.nodeId === undefined ? undefined : nodeById.get(fact.nodeId)
      return {
        id: fact.id,
        text: fact.text,
        location: owner === undefined || owner.id === node.id || !perspectiveKnownNodeIds.has(owner.id) ? '' : owner.title,
        knownBy: fact.knowledgeMode === 'inherit'
          ? `继承 · ${names.join(' · ') || '无人'}`
          : names.join(' · ') || '仅导演',
      }
    })
    return {
      id: node.id,
      type: 'story',
      position: dragPositions.get(node.id) ?? node.position,
      selected: selection?.kind === 'node' && rootId(selection.id) === node.id,
      data: {
        kind: node.kind,
        lifecycle: node.lifecycle,
        status: node.status,
        title: rootKnown ? node.title : '未公开的上级故事簇',
        summary: rootKnown ? node.summary : '展开后仅显示此人物已经知道的场景与信息。',
        people: rootKnown
          ? node.participantIds.map(id => workspace.characters.find(character => character.id === id)?.name ?? '').filter(Boolean).join(' · ')
          : '',
        knowledge: perspectiveId === undefined
          ? (() => {
              const names = nodeKnownBy(workspace, node.id).map(id => workspace.characters.find(character => character.id === id)?.name)
                .filter((name): name is string => name !== undefined)
              return names.length === 0 ? '默认不向人物暴露' : `默认知情：${names.join(' · ')}`
            })()
          : rootKnown ? '此人物知道这个故事簇' : '仅作为可知信息的层级入口',
        expanded: expandedNodeIds.has(node.id),
        children,
        details,
        onToggle: () => { setExpandedNodeIds(current => {
          const next = new Set(current)
          if (next.has(node.id)) next.delete(node.id)
          else next.add(node.id)
          return next
        }) },
        onSelectNode: id => { setSelection({ kind: 'node', id }) },
      },
    }
  }), [dragPositions, expandedNodeIds, nodeById, perspectiveId, perspectiveKnownNodeIds, selection, visibleFacts, visibleNodes, workspace])
  const edges = useMemo((): readonly StoryCanvasEdge[] => {
    const groups = new Map<string, StoryEdge[]>()
    for (const edge of workspace.graph.edges) {
      if (perspectiveId !== undefined && edge.audience !== 'public') continue
      if (perspectiveId !== undefined && (!perspectiveKnownNodeIds.has(edge.source) || !perspectiveKnownNodeIds.has(edge.target))) continue
      const source = rootId(edge.source)
      const target = rootId(edge.target)
      if (source === target || !visibleNodeIds.has(source) || !visibleNodeIds.has(target)) continue
      const key = `${source}\u0000${target}`
      groups.set(key, [...(groups.get(key) ?? []), edge])
    }
    return [...groups.entries()].map(([key, related]) => {
      const [source = '', target = ''] = key.split('\u0000')
      const first = related[0]
      if (first === undefined) throw new Error('故事关系投影为空')
      const labels = [...new Set(related.map(edge => edge.label === ''
        ? edgeKindLabels[edge.kind]
        : `${edgeKindLabels[edge.kind]} · ${edge.label}`))]
      const suggested = related.some(edge => edge.lifecycle === 'suggested')
      return {
        id: first.id,
        source,
        target,
        label: labels.length === 1 ? labels[0] : `${String(labels.length)} 条关系`,
        data: { kind: first.kind },
        animated: suggested,
        selected: selection?.kind === 'edge' && related.some(edge => edge.id === selection.id),
        markerEnd: { type: MarkerType.ArrowClosed },
        ...(suggested ? { style: { strokeDasharray: '5 4' } } : {}),
      }
    })
  }, [nodeById, perspectiveId, perspectiveKnownNodeIds, selection, visibleNodeIds, workspace.graph.edges])

  const addNode = (kind: StoryNodeKind): void => {
    const id = `node-${createClientOpaqueUuid()}`
    const count = workspace.graph.nodes.length
    const node: StoryNode = {
      id,
      kind,
      title: kind === 'arc' ? '新篇章' : kind === 'secret' ? '新秘密' : '新场景',
      summary: '',
      status: 'planned',
      lifecycle: 'canonical',
      audience: kind === 'beat' ? 'public' : 'director',
      position: { x: 120 + (count % 3) * 260, y: 120 + Math.floor(count / 3) * 190 },
      content: '',
      participantIds: [],
      knowledge: { mode: kind === 'beat' ? 'participants' : 'none', characterIds: [] },
    }
    clearPerspective()
    update(current => ({ ...current, graph: { ...current.graph, nodes: [...current.graph.nodes, node] } }))
    setSelection({ kind: 'node', id })
  }
  const connect = (connection: Connection): void => {
    if (connection.source === null || connection.target === null || connection.source === connection.target) return
    const endpoints = workspace.graph.nodes.filter(node => node.id === connection.source || node.id === connection.target)
    const edge: StoryEdge = {
      id: `edge-${createClientOpaqueUuid()}`,
      kind: 'precedes',
      source: connection.source,
      target: connection.target,
      label: '',
      lifecycle: endpoints.length === 2 && endpoints.every(node => node.lifecycle === 'canonical') ? 'canonical' : 'suggested',
      audience: 'director',
    }
    update(current => ({ ...current, graph: { ...current.graph, edges: [...current.graph.edges, edge] } }))
    setSelection({ kind: 'edge', id: edge.id })
  }
  const nodeChanges = (changes: readonly NodeChange<StoryCanvasNode>[]): void => {
    const selected = changes.findLast(change => change.type === 'select' && change.selected)
    if (selected?.type === 'select') setSelection({ kind: 'node', id: selected.id })
    const positions = new Map(changes.flatMap(change => change.type === 'position' && change.position !== undefined
      ? [[change.id, change.position] as const] : []))
    if (positions.size > 0) setDragPositions(current => {
      const next = new Map(current)
      for (const [id, position] of positions) next.set(id, position)
      return next
    })
  }
  const finishNodeDrag = (id: string, position: StoryNode['position']): void => {
    const stored = workspace.graph.nodes.find(node => node.id === id)?.position
    if (stored !== undefined && (stored.x !== position.x || stored.y !== position.y)) {
      update(current => ({ ...current, graph: {
        ...current.graph,
        nodes: current.graph.nodes.map(node => node.id === id ? { ...node, position } : node),
      } }))
    }
    setDragPositions(current => {
      if (!current.has(id)) return current
      const next = new Map(current)
      next.delete(id)
      return next
    })
  }
  const edgeChanges = (changes: readonly EdgeChange<StoryCanvasEdge>[]): void => {
    const selected = changes.findLast(change => change.type === 'select' && change.selected)
    if (selected?.type === 'select') setSelection({ kind: 'edge', id: selected.id })
  }
  const perspective = workspace.characters.find(character => character.id === perspectiveId)
  const suggestedNodeCount = workspace.graph.nodes.filter(node => node.lifecycle === 'suggested').length
  const suggestedEdgeCount = workspace.graph.edges.filter(edge => edge.lifecycle === 'suggested').length
  return <div className="story-studio-canvas">
    <div className="story-map-toolbar">
      <button className="story-studio-button" type="button" onClick={() => { addNode('arc') }}>＋ 篇章</button>
      <button className="story-studio-button" type="button" onClick={() => { addNode('beat') }}>＋ 场景</button>
      <button className="story-studio-button" type="button" onClick={() => { addNode('secret') }}>＋ 秘密</button>
      {suggestedNodeCount + suggestedEdgeCount > 0 && <span style={{ color: 'var(--studio-muted)', fontSize: 10, padding: '0 5px' }}>
        {suggestedNodeCount} 个候选节点 · {suggestedEdgeCount} 条候选关系
      </span>}
    </div>
    <ReactFlow<StoryCanvasNode, StoryCanvasEdge>
      nodes={[...nodes]}
      edges={[...edges]}
      nodeTypes={nodeTypes}
      onNodesChange={nodeChanges}
      onNodeDragStop={(_event, node) => { finishNodeDrag(node.id, node.position) }}
      onEdgesChange={edgeChanges}
      onConnect={connect}
      onPaneClick={() => { setSelection(undefined) }}
      fitView
      fitViewOptions={{ padding: .3 }}
      deleteKeyCode={null}
      minZoom={.2}
      maxZoom={2}
    >
      <Background gap={22} size={1} color="color-mix(in srgb, currentColor 12%, transparent)" />
      <Controls position="bottom-left" />
      <MiniMap pannable zoomable nodeColor={node => node.data.kind === 'secret' ? '#d89b55' : node.data.kind === 'arc' ? '#8b7cf6' : 'var(--story-accent)'} />
    </ReactFlow>
    {perspective !== undefined && <button className="story-map-perspective" type="button" onClick={clearPerspective}>
      正以 {perspective.name} 的视角查看 · 退出
    </button>}
  </div>
}

function StudioNavigation({ workspace, view, selection, setView, select, addCharacter, addSource }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly view: StudioView
  readonly selection: StudioSelection | undefined
  readonly setView: (view: StudioView) => void
  readonly select: (selection: StudioSelection) => void
  readonly addCharacter: () => void
  readonly addSource: () => void
}) {
  return <aside className="story-studio-sidebar">
    <div className="story-studio-nav-group">
      <div className="story-studio-nav-heading"><span>游玩</span></div>
      <button className="story-studio-nav-item" data-active={view === 'world'} type="button" onClick={() => { setView('world') }}>
        <span className="story-studio-nav-icon">✦</span><span>{workspace.world?.title ?? '选择世界'}</span>
        <span className="story-studio-nav-count">{workspace.world?.events.length ?? 0}</span>
      </button>
    </div>
    <div className="story-studio-nav-group">
      <div className="story-studio-nav-heading"><span>故事</span></div>
      <button className="story-studio-nav-item" data-active={view === 'map'} type="button" onClick={() => { setView('map') }}>
        <span className="story-studio-nav-icon">⌘</span><span>故事地图</span><span className="story-studio-nav-count">{workspace.graph.nodes.length}</span>
      </button>
      <button className="story-studio-nav-item" data-active={view === 'timeline'} type="button" onClick={() => { setView('timeline') }}>
        <span className="story-studio-nav-icon">◷</span><span>事件时间线</span><span className="story-studio-nav-count">{workspace.events.length + (workspace.world?.events.length ?? 0)}</span>
      </button>
    </div>
    <div className="story-studio-nav-group">
      <div className="story-studio-nav-heading"><span>人物</span><button className="story-studio-icon-button" type="button" aria-label="添加人物" onClick={addCharacter}>＋</button></div>
      {workspace.characters.map(character => <button key={character.id} className="story-studio-nav-item"
        data-active={view === 'characters' && (selection?.kind === 'character' ? selection.id === character.id : workspace.characters[0]?.id === character.id)}
        type="button" onClick={() => { select({ kind: 'character', id: character.id }) }}>
        <span className="story-studio-nav-icon">◉</span><span>{character.name}</span>
        <span className="story-studio-nav-count">{workspace.facts.filter(fact => factKnownBy(workspace, fact).includes(character.id)).length}</span>
      </button>)}
      {workspace.characters.length === 0 && <p style={{ color: 'var(--studio-muted)', fontSize: 10, margin: '7px 9px' }}>添加人物后可维护独立认知。</p>}
    </div>
    <div className="story-studio-nav-group">
      <div className="story-studio-nav-heading"><span>资料库</span><button className="story-studio-icon-button" type="button" aria-label="添加资料" onClick={addSource}>＋</button></div>
      <button className="story-studio-nav-item" data-active={view === 'sources' && selection?.kind !== 'source' && selection?.kind !== 'citation'}
        type="button" onClick={() => { setView('sources') }}>
        <span className="story-studio-nav-icon">⌁</span><span>研究收件箱</span><span className="story-studio-nav-count">{workspace.researchInbox.length}</span>
      </button>
      {workspace.sources.slice(0, 8).map(source => {
        const refreshReviewCount = workspace.citations.filter(citation => citation.sourceId === source.id && citation.refreshReview !== undefined).length
        return <button key={source.id} className="story-studio-nav-item"
          data-active={selection?.kind === 'source' && selection.id === source.id} type="button" onClick={() => { select({ kind: 'source', id: source.id }) }}>
          <span className="story-studio-nav-icon">▤</span><span>{source.name}</span>
          {refreshReviewCount > 0 && <span className="story-studio-nav-count" data-attention="true">{refreshReviewCount} 待审</span>}
        </button>
      })}
      {workspace.sources.length > 8 && <button className="story-studio-nav-item" type="button" onClick={() => { setView('sources') }}>
        <span className="story-studio-nav-icon">…</span><span>全部资料</span><span className="story-studio-nav-count">{workspace.sources.length}</span>
      </button>}
    </div>
    <div className="story-studio-nav-group">
      <div className="story-studio-nav-heading"><span>呈现</span></div>
      <button className="story-studio-nav-item" data-active={view === 'outputs'} type="button" onClick={() => { setView('outputs') }}>
        <span className="story-studio-nav-icon">☷</span><span>输出布局</span><span className="story-studio-nav-count">{workspace.outputs.length}</span>
      </button>
    </div>
  </aside>
}

const flyingChessColors = ['#df615c', '#4b9cda', '#e4ae43', '#67aa78'] as const

function flyingChessCell(index: number): { readonly column: number; readonly row: number } {
  if (index < 7) return { column: index + 1, row: 1 }
  if (index < 13) return { column: 7, row: index - 5 }
  if (index < 19) return { column: 19 - index, row: 7 }
  return { column: 1, row: 25 - index }
}

function flyingChessPieceCell(state: FlyingChessWorldState, piece: FlyingChessPiece): number | undefined {
  if (piece.status !== 'track') return undefined
  const playerIndex = state.playerOrder.indexOf(piece.ownerId)
  return (playerIndex * Math.floor(24 / state.playerOrder.length) + piece.steps - 1) % 24
}

function WorldEventList({ events }: { readonly events: readonly PlayWorldEvent[] }) {
  return <section className="story-world-events"><div><strong>世界事件</strong><span>由规则执行产生，可供时间线和 Agent 读取。</span></div>
    {[...events].reverse().slice(0, 10).map(item => <article key={item.id}><span>{item.sequence}</span><div><strong>{item.title}</strong><p>{item.summary}</p></div></article>)}
  </section>
}

function readinessCharacterNames(characters: readonly StoryCharacter[]): string {
  return characters.map(character => character.name).join('、')
}

function PlayWorldEvidenceStatus({ workspace, configureDisabled, onConfigureCast, onImportSourceUrl, onImportSources, onOpenCharacter, onOpenSources, onOpenOutputs }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly configureDisabled: boolean
  readonly onConfigureCast: (() => void) | undefined
  readonly onImportSourceUrl: () => void
  readonly onImportSources: () => void
  readonly onOpenCharacter: (id: string) => void
  readonly onOpenSources: () => void
  readonly onOpenOutputs: () => void
}) {
  const readiness = inspectStoryPlayWorldReadiness(workspace)
  const participantCount = readiness.participants.length
  const actorCount = participantCount - readiness.missingActors.length
  const dialogueCount = participantCount - readiness.missingDialogue.length
  const sourceVoiceCount = participantCount - readiness.missingSourceVoice.length
  const firstMissingDialogue = readiness.missingDialogue[0]
  const firstParticipant = readiness.participants[0]
  const openActor = onConfigureCast ?? (firstParticipant === undefined ? undefined : () => { onOpenCharacter(firstParticipant.id) })
  const evidenceSummary = readiness.enabledProseOutputCount === 0
    ? '先在输出布局中启用至少一个正文分区；没有正文去处时，场地不会开始或续写。'
    : participantCount === 0
    ? '先为这个世界选择参与人物，再补充各自的角色卡与原著证据。'
    : readiness.missingActors.length > 0
      ? `先为${readinessCharacterNames(readiness.missingActors)}绑定角色卡；绑定只更新人物档案，棋局状态保持原样。`
    : readiness.missingDialogue.length > 0
      ? `为${readinessCharacterNames(readiness.missingDialogue)}补充真实对话样本，声音阶段会优先使用原著证据。`
      : readiness.originalSourceCount === 0
        ? '从已知网页或本地 TXT / Markdown 导入原著后，声音阶段才能引用可核对的角色原句。'
        : readiness.missingSourceVoice.length > 0
          ? `现有原著还没有识别到${readinessCharacterNames(readiness.missingSourceVoice)}的署名；可在资料阅读器核对署名归属。`
          : '人物档案、角色样本和原著声音已经覆盖当前全部参与者。'
  return <section className="story-play-evidence" aria-label="场地准备状态">
    <div className="story-play-evidence-items">
      <button className="story-play-evidence-chip" type="button" data-ready={readiness.enabledProseOutputCount > 0}
        onClick={onOpenOutputs}><small>正文输出</small><strong>{readiness.enabledProseOutputCount}</strong></button>
      <button className="story-play-evidence-chip" type="button" data-ready={readiness.missingActors.length === 0}
        disabled={openActor === undefined || configureDisabled} onClick={openActor}><small>角色卡</small><strong>{actorCount}/{participantCount}</strong></button>
      <button className="story-play-evidence-chip" type="button" data-ready={readiness.missingDialogue.length === 0}
        disabled={firstMissingDialogue === undefined && firstParticipant === undefined}
        onClick={() => { onOpenCharacter((firstMissingDialogue ?? firstParticipant)!.id) }}><small>角色样本</small><strong>{dialogueCount}/{participantCount}</strong></button>
      <button className="story-play-evidence-chip" type="button" data-ready={readiness.missingSourceVoice.length === 0}
        onClick={onOpenSources}><small>原著声音</small><strong>{sourceVoiceCount}/{participantCount}</strong></button>
      <button className="story-play-evidence-chip" type="button" data-ready={readiness.originalSourceCount > 0}
        onClick={onOpenSources}><small>原著资料</small><strong>{readiness.originalSourceCount}</strong></button>
    </div>
    <div className="story-play-evidence-actions">
      {readiness.enabledProseOutputCount === 0 && <button className="story-studio-button story-studio-button-primary" type="button" onClick={onOpenOutputs}>配置输出布局</button>}
      {onConfigureCast !== undefined && <button className="story-studio-button" type="button" disabled={configureDisabled} onClick={onConfigureCast}>
        {readiness.missingActors.length > 0 ? '补人物来源' : '人物来源'}</button>}
      {firstMissingDialogue !== undefined && <button className="story-studio-button" type="button"
        onClick={() => { onOpenCharacter(firstMissingDialogue.id) }}>补角色样本</button>}
      {(readiness.missingSourceVoice.length > 0 || readiness.originalSourceCount === 0)
        && <><button className="story-studio-button story-studio-button-primary" type="button" onClick={onImportSourceUrl}>从网址导入原著</button>
          <button className="story-studio-button" type="button" onClick={onImportSources}>导入本地原著</button></>}
      <button className="story-studio-button" type="button" onClick={onOpenSources}>查看资料</button>
    </div>
    <p className="story-play-evidence-summary">{evidenceSummary}</p>
  </section>
}

function FlyingChessPlayView({ workspace, state, turn, authoring, busy, dirty, onConfigureCast, onConfigureNarrativeCards, onImportSourceUrl, onImportSources, onOpenCharacter, onOpenSources, onOpenOutputs, onRestart, onAction }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly state: FlyingChessWorldState
  readonly turn: PlayWorldTurnProjection | null
  readonly authoring: boolean
  readonly busy: boolean
  readonly dirty: boolean
  readonly onConfigureCast: (() => void) | undefined
  readonly onConfigureNarrativeCards: (() => void) | undefined
  readonly onImportSourceUrl: () => void
  readonly onImportSources: () => void
  readonly onOpenCharacter: (id: string) => void
  readonly onOpenSources: () => void
  readonly onOpenOutputs: () => void
  readonly onRestart: () => void
  readonly onAction: (actionId: string) => void
}) {
  const [restartArmed, setRestartArmed] = useState(false)
  const name = (id: string): string => workspace.characters.find(character => character.id === id)?.name ?? id
  const currentName = name(state.currentPlayerId)
  const legalActionIds = new Set(turn?.actions.map(action => action.id) ?? [])
  return <div className="story-play-view">
    <div className="story-play-heading"><div><span>第 {state.turn} 回合</span><h1>幻想乡飞行棋</h1>
      {authoring && <p>棋盘状态由规则程序维护；人物依据各自知道的信息行动。</p>}</div>
      <div className="story-play-turn"><small>{state.winnerId === undefined ? '当前行动' : '棋局结束'}</small><strong>{state.winnerId === undefined ? currentName : `${name(state.winnerId)}获胜`}</strong>
        <div className="story-play-turn-actions">
          {state.winnerId === undefined && state.pendingRoll === undefined && <button className="story-studio-button" type="button"
            disabled={busy || dirty || !legalActionIds.has('roll')} onClick={() => { onAction('roll') }}>亲自掷骰</button>}
          {state.pendingRoll !== undefined && <span className="story-die" aria-label={`骰点 ${state.pendingRoll.value}`}>{state.pendingRoll.value}</span>}
          {onConfigureNarrativeCards !== undefined && <button className="story-studio-button" type="button" disabled={busy || dirty}
            onClick={onConfigureNarrativeCards}>场景事件牌</button>}
          <button className="story-studio-button" type="button" disabled={busy || dirty} onClick={() => {
            if (!restartArmed) {
              setRestartArmed(true)
              return
            }
            setRestartArmed(false)
            onRestart()
          }}>{restartArmed ? '确认重新开局' : '重新开局'}</button>
        </div>
      </div>
    </div>
    {authoring && <PlayWorldEvidenceStatus workspace={workspace} configureDisabled={busy || dirty} onConfigureCast={onConfigureCast}
      onImportSourceUrl={onImportSourceUrl} onImportSources={onImportSources}
      onOpenCharacter={onOpenCharacter} onOpenSources={onOpenSources} onOpenOutputs={onOpenOutputs} />}
    {dirty && <div className="story-play-notice">先保存人物或故事修改，再推进棋局。</div>}
    <div className="story-flying-layout">
      <div className="story-flying-board" aria-label="24 格飞行棋棋盘">
        {Array.from({ length: 24 }, (_, index) => {
          const position = flyingChessCell(index)
          const pieces = state.pieces.filter(piece => flyingChessPieceCell(state, piece) === index)
          return <div className="story-flying-cell" key={index} style={{ gridColumn: position.column, gridRow: position.row }}>
            <small>{index + 1}</small><div>{pieces.map(piece => {
              const playerIndex = state.playerOrder.indexOf(piece.ownerId)
              return <span className="story-flying-token" key={piece.id} title={`${name(piece.ownerId)} ${piece.number} 号`}
                style={{ '--flying-color': flyingChessColors[playerIndex] } as CSSProperties}>{piece.number}</span>
            })}</div>
          </div>
        })}
        <div className="story-flying-center"><span>当前骰点</span><strong>{state.pendingRoll?.value ?? '—'}</strong><small>{currentName}</small></div>
      </div>
      <div className="story-flying-players">{state.playerOrder.map((playerId, playerIndex) => {
        const pieces = state.pieces.filter(piece => piece.ownerId === playerId)
        const isCurrent = state.currentPlayerId === playerId
        return <section className="story-flying-player" data-current={isCurrent} key={playerId}
          style={{ '--flying-color': flyingChessColors[playerIndex] } as CSSProperties}>
          <header><span className="story-flying-player-dot" /><strong>{name(playerId)}</strong><small>{isCurrent ? '行动中' : '等待'}</small></header>
          <div className="story-flying-piece-list">{pieces.map(piece => {
            const actionId = `move:${piece.id}`
            const legal = (state.pendingRoll?.legalPieceIds.includes(piece.id) ?? false) && legalActionIds.has(actionId)
            const location = piece.status === 'base' ? '基地' : piece.status === 'home' ? '已到达' : `航线 ${piece.steps}`
            return <button type="button" key={piece.id} data-legal={legal} disabled={!legal || busy || dirty}
              onClick={() => { onAction(actionId) }}>
              <span>{piece.number}</span><small>{location}</small>{legal && <b>亲自移动</b>}
            </button>
          })}</div>
        </section>
      })}</div>
    </div>
    {authoring && <WorldEventList events={workspace.world?.events ?? []} />}
  </div>
}

function GenericPlayWorldView({ workspace, module, turn, authoring, busy, dirty, renderPlayWorldView, onConfigureCast, onImportSourceUrl, onImportSources, onOpenCharacter, onOpenSources, onOpenOutputs, onRestart, onAction }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly module: PlayWorldModuleDescriptor | undefined
  readonly turn: PlayWorldTurnProjection | null
  readonly authoring: boolean
  readonly busy: boolean
  readonly dirty: boolean
  readonly renderPlayWorldView: StoryWorkspaceEditorProps['renderPlayWorldView']
  readonly onConfigureCast: (() => void) | undefined
  readonly onImportSourceUrl: () => void
  readonly onImportSources: () => void
  readonly onOpenCharacter: (id: string) => void
  readonly onOpenSources: () => void
  readonly onOpenOutputs: () => void
  readonly onRestart: () => void
  readonly onAction: (actionId: string) => void
}) {
  const [restartArmed, setRestartArmed] = useState(false)
  const characterName = turn === null
    ? '没有待执行行动'
    : workspace.characters.find(character => character.id === turn.characterId)?.name ?? turn.characterId
  const genericWorldView = <><section className="story-world-actions"><header><strong>{turn === null ? '当前没有待执行动作' : turn.instruction}</strong>
    <span>可用行动由当前世界规则给出；选择后会立即结算并记录为世界事件。</span></header>
    {turn !== null && <div>{turn.actions.map(action => <button className="story-world-action" type="button" key={action.id}
      disabled={busy || dirty} onClick={() => { onAction(action.id) }}><strong>{action.label}</strong><span>{action.description}</span></button>)}</div>}
  </section><WorldEventList events={workspace.world?.events ?? []} /></>
  const renderedWorldView = workspace.world === undefined || renderPlayWorldView === undefined
    ? genericWorldView
    : renderPlayWorldView(workspace.world.moduleId, {
      world: workspace.world,
      characters: storyPlayWorldParticipants(workspace).map(character => ({ id: character.id, name: character.name })),
      turn,
      busy,
      dirty,
      dispatchAction: onAction,
    }, genericWorldView)
  return <div className="story-play-view">
    <div className="story-play-heading"><div><span>世界游玩 · {module?.category === 'simulation' ? '模拟' : '游戏'}</span>
      <h1>{workspace.world?.title}</h1><p>{module?.summary ?? '这个世界由已安装模块维护权威状态与合法动作。'}</p></div>
      <div className="story-play-turn"><small>{turn === null ? '当前状态' : '当前行动'}</small><strong>{characterName}</strong>
        <div className="story-play-turn-actions"><button className="story-studio-button" type="button" disabled={busy || dirty} onClick={() => {
          if (!restartArmed) {
            setRestartArmed(true)
            return
          }
          setRestartArmed(false)
          onRestart()
        }}>{restartArmed ? '确认重新开始' : '重新开始'}</button></div></div>
    </div>
    {authoring && <PlayWorldEvidenceStatus workspace={workspace} configureDisabled={busy || dirty} onConfigureCast={onConfigureCast}
      onImportSourceUrl={onImportSourceUrl} onImportSources={onImportSources}
      onOpenCharacter={onOpenCharacter} onOpenSources={onOpenSources} onOpenOutputs={onOpenOutputs} />}
    {dirty && <div className="story-play-notice">先保存人物或故事修改，再推进世界。</div>}
    {renderedWorldView}
  </div>
}

function actorMatchesCharacter(actorName: string, character: StoryCharacter): boolean {
  return storyVoiceSpeakerMatches([character.name, ...(character.voiceAliases ?? [])], actorName)
}

function actorImportFailureMessage(failures: readonly { readonly fileName: string; readonly message: string }[]): string | undefined {
  if (failures.length === 0) return undefined
  const shown = failures.slice(0, 3).map(failure => `${failure.fileName}：${failure.message}`)
  if (failures.length > shown.length) shown.push(`另有 ${String(failures.length - shown.length)} 个文件未导入`)
  return shown.join('；')
}

function PlayWorldInstallerCard({ workspace, world, actorResources, busy, dirty, onImportActor, onInstall }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly world: PlayWorldResourceDescriptor
  readonly actorResources: readonly RoleplayResourceDescriptor[]
  readonly busy: boolean
  readonly dirty: boolean
  readonly onImportActor: (file: File) => Promise<ImportedWorldActor>
  readonly onInstall: (resource: PlayWorldResourceDescriptor['resource'], cast: readonly PlayWorldCastSelection[]) => void
}) {
  const actorFileInputRef = useRef<HTMLInputElement>(null)
  const [importingActor, setImportingActor] = useState(false)
  const [importActorError, setImportActorError] = useState<string>()
  const [actorBySlot, setActorBySlot] = useState<Readonly<Record<string, string>>>(() => Object.fromEntries(
    world.castSlots.flatMap(slot => {
      const exact = actorResources.find(actor => storyVoiceSpeakerMatches([slot.name, ...slot.aliases], actor.name))
      return exact === undefined ? [] : [[slot.id, exact.id]]
    }),
  ))
  const selectedCount = world.castSlots.filter(slot => actorBySlot[slot.id] !== undefined).length
  const selectedActorIds = new Set(Object.values(actorBySlot))
  const repeatsActor = selectedActorIds.size !== selectedCount
  const missingRequired = world.castSlots.some(slot => slot.required && actorBySlot[slot.id] === undefined)
  const enoughLegacyCharacters = world.castSlots.length === 0
    && workspace.characters.length >= world.minCharacters && workspace.characters.length <= world.maxCharacters
  const ready = world.moduleAvailable && (world.castSlots.length === 0
    ? enoughLegacyCharacters
    : !missingRequired && !repeatsActor && selectedCount >= world.minCharacters && selectedCount <= world.maxCharacters)
  const install = (): void => {
    const usedCharacterIds = new Set<string>()
    const cast = world.castSlots.flatMap(slot => {
      const actorId = actorBySlot[slot.id]
      if (actorId === undefined) return []
      const existing = workspace.characters.find(character => !usedCharacterIds.has(character.id)
        && (character.actor?.id === actorId || actorMatchesCharacter(slot.name, character)))
      if (existing !== undefined) usedCharacterIds.add(existing.id)
      return [{
        slotId: slot.id,
        actor: { kind: 'actor' as const, id: actorId },
        ...(existing === undefined ? {} : { characterId: existing.id }),
      }]
    })
    onInstall(world.resource, cast)
  }
  const importActors = (files: readonly File[]): void => {
    if (files.length === 0) return
    setImportingActor(true)
    setImportActorError(undefined)
    void (async () => {
      let assignments = actorBySlot
      const failures: { fileName: string; message: string }[] = []
      for (const file of files) {
        try {
          const { actor } = await onImportActor(file)
          assignments = assignImportedStoryWorldActor(assignments, world.castSlots.map(slot => ({
            slotId: slot.id,
            names: [slot.name, ...slot.aliases],
            required: slot.required,
          })), actor)
        } catch (reason) {
          failures.push({ fileName: file.name, message: errorMessage(reason) })
        }
      }
      setActorBySlot(assignments)
      setImportActorError(actorImportFailureMessage(failures))
    })().finally(() => { setImportingActor(false) })
  }
  return <article className="story-world-module-card">
    <span>{world.category === 'game' ? '游戏' : '模拟'}</span><h2>{world.name}</h2>
    <p>{world.summary}</p>
    {world.castSlots.length === 0
      ? <small>需要 {world.minCharacters}–{world.maxCharacters} 位人物 · 当前 {workspace.characters.length} 位</small>
      : <div className="story-world-cast-slots">{world.castSlots.map(slot => <label key={slot.id}>
        <span><b>{slot.name}</b><small>{slot.required ? '必需' : '可选'} · {slot.description}</small></span>
        <select className="story-studio-input" disabled={busy || dirty || importingActor}
          value={actorBySlot[slot.id] ?? ''} onChange={event => {
          const actorId = event.target.value
          setActorBySlot(current => {
            const next = { ...current }
            if (actorId === '') delete next[slot.id]
            else next[slot.id] = actorId
            return next
          })
        }}>
          <option value="">{slot.required ? '选择角色卡' : '不加入'}</option>
          {actorResources.map(actor => <option value={actor.id} key={actor.id}
            disabled={actorBySlot[slot.id] !== actor.id && selectedActorIds.has(actor.id)}>{actor.name}</option>)}
        </select>
      </label>)}<div className="story-world-cast-import">
        <input ref={actorFileInputRef} hidden multiple type="file" accept=".png,.json,.charx,image/png,application/json,application/zip" onChange={event => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          importActors(files)
        }} />
        <button className="story-studio-button" type="button" disabled={busy || dirty || importingActor}
          onClick={() => { actorFileInputRef.current?.click() }}>{importingActor ? '正在导入角色卡…' : '＋ 批量导入角色卡'}</button>
        <small>可一次选择多份 PNG / JSON / CHARX；同名角色优先匹配，其余依次填入空槽位。</small>
      </div></div>}
    {world.castSlots.length > 0 && actorResources.length === 0 && !importingActor && <small>还没有可用角色卡；可以在这里直接导入。</small>}
    {importActorError !== undefined && <small className="story-world-cast-error" role="alert">{importActorError}</small>}
    {repeatsActor && <small>同一张角色卡不能同时扮演多个世界人物。</small>}
    {!world.moduleAvailable && <small>需要安装规则模块：{world.id}</small>}
    <button className="story-studio-button story-studio-button-primary" type="button" disabled={!ready || busy || dirty}
      onClick={install}>{!world.moduleAvailable ? '规则模块尚未安装'
        : ready ? '用这些人物装入世界'
          : world.castSlots.length === 0 ? '先补齐人物' : '先选择必需角色卡'}</button>
  </article>
}

function initialInstalledCastCharacters(
  workspace: StoryWorkspaceSnapshot,
  world: PlayWorldResourceDescriptor,
): Readonly<Record<string, string>> {
  const characterById = new Map(workspace.characters.map(character => [character.id, character]))
  const slotIds = new Set(world.castSlots.map(slot => slot.id))
  const result: Record<string, string> = {}
  const usedCharacterIds = new Set<string>()
  for (const binding of workspace.worldBinding?.cast ?? []) {
    if (!slotIds.has(binding.slotId) || !characterById.has(binding.characterId) || usedCharacterIds.has(binding.characterId)) continue
    result[binding.slotId] = binding.characterId
    usedCharacterIds.add(binding.characterId)
  }
  if ((workspace.worldBinding?.cast.length ?? 0) > 0) return result
  const participantIds = workspace.world !== undefined && isFlyingChessWorldState(workspace.world.state)
    ? workspace.world.state.playerOrder
    : workspace.characters.map(character => character.id)
  const participants = participantIds.flatMap(id => {
    const character = characterById.get(id)
    return character === undefined ? [] : [character]
  })
  for (const slot of world.castSlots) {
    const exact = participants.find(character => !usedCharacterIds.has(character.id)
      && [slot.name, ...slot.aliases].some(name => actorMatchesCharacter(name, character)))
    if (exact === undefined) continue
    result[slot.id] = exact.id
    usedCharacterIds.add(exact.id)
  }
  for (const slot of world.castSlots) {
    if (result[slot.id] !== undefined) continue
    const next = participants.find(character => !usedCharacterIds.has(character.id))
    if (next === undefined) continue
    result[slot.id] = next.id
    usedCharacterIds.add(next.id)
  }
  return result
}

function InstalledWorldCastDrawer({ workspace, world, actorResources, busy, dirty, onImportActor, onUpdate, onClose }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly world: PlayWorldResourceDescriptor
  readonly actorResources: readonly RoleplayResourceDescriptor[]
  readonly busy: boolean
  readonly dirty: boolean
  readonly onImportActor: (file: File) => Promise<ImportedWorldActor>
  readonly onUpdate: (cast: readonly PlayWorldCastSelection[]) => Promise<boolean>
  readonly onClose: () => void
}) {
  const actorFileInputRef = useRef<HTMLInputElement>(null)
  const [importingActor, setImportingActor] = useState(false)
  const [importActorError, setImportActorError] = useState<string>()
  const [characterBySlot] = useState<Readonly<Record<string, string>>>(() => initialInstalledCastCharacters(workspace, world))
  const [actorBySlot, setActorBySlot] = useState<Readonly<Record<string, string>>>(() => Object.fromEntries(
    world.castSlots.flatMap(slot => {
      const character = workspace.characters.find(candidate => candidate.id === characterBySlot[slot.id])
      if (character === undefined) return []
      const actor = actorResources.find(candidate => candidate.id === character.actor?.id)
        ?? actorResources.find(candidate => actorMatchesCharacter(candidate.name, character))
      return actor === undefined ? [] : [[slot.id, actor.id]]
    }),
  ))
  const boundParticipantIds = (workspace.worldBinding?.cast ?? []).map(binding => binding.characterId)
  const participantIds = workspace.world !== undefined && isFlyingChessWorldState(workspace.world.state)
    ? workspace.world.state.playerOrder
    : boundParticipantIds.length > 0
      ? boundParticipantIds
      : workspace.characters.map(character => character.id)
  const assignedCharacterIds = new Set(Object.values(characterBySlot))
  const unassignedParticipant = participantIds.find(id => !assignedCharacterIds.has(id))
  const assignedSlots = world.castSlots.filter(slot => characterBySlot[slot.id] !== undefined)
  const selectedActorIds = assignedSlots.flatMap(slot => actorBySlot[slot.id] ?? [])
  const repeatsActor = new Set(selectedActorIds).size !== selectedActorIds.length
  const missingRequired = world.castSlots.some(slot => slot.required
    && (characterBySlot[slot.id] === undefined || actorBySlot[slot.id] === undefined))
  const missingAssignedActor = assignedSlots.some(slot => actorBySlot[slot.id] === undefined)
  const ready = !dirty && !missingRequired && !missingAssignedActor && !repeatsActor && unassignedParticipant === undefined
    && assignedSlots.length >= world.minCharacters && assignedSlots.length <= world.maxCharacters
  const importActors = (files: readonly File[]): void => {
    if (files.length === 0) return
    setImportingActor(true)
    setImportActorError(undefined)
    void (async () => {
      let assignments = actorBySlot
      const failures: { fileName: string; message: string }[] = []
      for (const file of files) {
        try {
          const { actor } = await onImportActor(file)
          assignments = assignImportedStoryWorldActor(assignments, world.castSlots.flatMap(slot => {
            const character = workspace.characters.find(candidate => candidate.id === characterBySlot[slot.id])
            return character === undefined ? [] : [{
              slotId: slot.id,
              names: [character.name, ...(character.voiceAliases ?? [])],
              required: slot.required,
            }]
          }), actor)
        } catch (reason) {
          failures.push({ fileName: file.name, message: errorMessage(reason) })
        }
      }
      setActorBySlot(assignments)
      setImportActorError(actorImportFailureMessage(failures))
    })().finally(() => { setImportingActor(false) })
  }
  const updateCast = (): void => {
    if (!ready) return
    const cast = world.castSlots.flatMap(slot => {
      const characterId = characterBySlot[slot.id]
      const actorId = actorBySlot[slot.id]
      return characterId === undefined || actorId === undefined ? [] : [{
        slotId: slot.id,
        actor: { kind: 'actor' as const, id: actorId },
        characterId,
      }]
    })
    void onUpdate(cast).then(updated => { if (updated) onClose() })
  }
  return <>
    <button className="story-studio-drawer-backdrop" type="button" aria-label="关闭人物来源" onClick={onClose} />
    <aside className="story-studio-drawer story-world-cast-drawer" aria-label="人物来源">
      <div className="story-studio-drawer-header"><h2>人物来源</h2><button className="story-studio-icon-button" type="button" onClick={onClose}>×</button></div>
      <p className="story-world-cast-drawer-intro">为当前人物选择资源中心里的角色卡。角色卡档案会更新；棋局位置、回合和事件原样保留。</p>
      <div className="story-world-cast-current">{world.castSlots.map(slot => {
        const character = workspace.characters.find(candidate => candidate.id === characterBySlot[slot.id])
        return <label key={slot.id}>
          <span><small>{slot.name} · {slot.required ? '必需' : '可选'}</small><strong>{character?.name ?? '没有可沿用的人物'}</strong>
            <em>{slot.description}</em></span>
          <select className="story-studio-input" disabled={character === undefined || busy || dirty || importingActor}
            value={actorBySlot[slot.id] ?? ''} onChange={event => {
              const actorId = event.target.value
              setActorBySlot(current => {
                const next = { ...current }
                if (actorId === '') delete next[slot.id]
                else next[slot.id] = actorId
                return next
              })
            }}>
            <option value="">选择角色卡</option>
            {actorResources.map(actor => <option value={actor.id} key={actor.id}
              disabled={actorBySlot[slot.id] !== actor.id && selectedActorIds.includes(actor.id)}>{actor.name}</option>)}
          </select>
        </label>
      })}</div>
      <div className="story-world-cast-import">
        <input ref={actorFileInputRef} hidden multiple type="file" accept=".png,.json,.charx,image/png,application/json,application/zip" onChange={event => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          importActors(files)
        }} />
        <button className="story-studio-button" type="button" disabled={busy || dirty || importingActor}
          onClick={() => { actorFileInputRef.current?.click() }}>{importingActor ? '正在导入角色卡…' : '＋ 批量导入角色卡'}</button>
        <small>可一次选择多份 PNG / JSON / CHARX；同名人物优先匹配，其余依次填入空槽位。</small>
      </div>
      {importActorError !== undefined && <small className="story-world-cast-error" role="alert">{importActorError}</small>}
      {unassignedParticipant !== undefined && <small className="story-world-cast-error">当前参与人物无法全部对应到世界槽位，请先检查世界资源。</small>}
      {missingRequired && <small>请为每个必需人物选择角色卡。</small>}
      {missingAssignedActor && !missingRequired && <small>当前参与世界的人物都需要角色卡来源。</small>}
      {repeatsActor && <small>同一张角色卡不能同时扮演多个世界人物。</small>}
      <div className="story-studio-actions"><button className="story-studio-button story-studio-button-primary" type="button"
        disabled={!ready || busy || importingActor} onClick={updateCast}>{busy ? '正在更新…' : '更新人物来源'}</button>
        <button className="story-studio-button" type="button" disabled={busy} onClick={onClose}>取消</button></div>
    </aside>
  </>
}

const narrativeCueLabels: Readonly<Record<FlyingChessNarrativeCard['cue']['kind'], string>> = {
  change: '局势变化',
  pressure: '现场压力',
  opportunity: '可用机会',
  relationship: '关系后果',
}

const narrativeResponderLabels: Readonly<Record<FlyingChessNarrativeCard['cue']['responders'], string>> = {
  none: '不开放人物额外反应',
  actor: '触发本轮的行动人物',
  opponents: '行动人物以外的棋手',
  all: '所有在场人物',
}

const narrativeOpportunityMoveLabels: Readonly<Record<
  NonNullable<FlyingChessNarrativeCard['cue']['opportunity']>['move'],
  string
>> = {
  command: '提出一项要求',
  question: '提出一个问题',
  propose: '提出一项提议',
}

const narrativeTriggerLabels: Readonly<Record<FlyingChessNarrativeCard['trigger']['kind'], string>> = {
  'consecutive-passes': '连续回合无棋可走',
  'piece-launched': '飞机离开基地',
  'piece-landed': '棋子停在指定步数',
  'piece-captured': '撞回对方棋子',
  'player-home-count': '己方棋子抵达终点',
}

function narrativeTriggerInvalid(trigger: FlyingChessNarrativeCard['trigger']): boolean {
  if (trigger.kind === 'consecutive-passes') {
    return !Number.isSafeInteger(trigger.count) || trigger.count < 2 || trigger.count > 32
  }
  if (trigger.kind === 'piece-landed') {
    return !Number.isSafeInteger(trigger.step) || trigger.step < 1 || trigger.step >= 24
  }
  if (trigger.kind === 'player-home-count') {
    return !Number.isSafeInteger(trigger.count) || trigger.count < 1 || trigger.count > 4
  }
  return false
}

function narrativeCardRelationsInvalid(cards: readonly FlyingChessNarrativeCard[]): boolean {
  const cardsById = new Map(cards.map(card => [card.id, card]))
  return cards.some(card => {
    if (card.afterCardId !== undefined && !cardsById.has(card.afterCardId)) return true
    const visited = new Set<string>()
    let current: FlyingChessNarrativeCard | undefined = card
    while (current !== undefined) {
      if (visited.has(current.id)) return true
      visited.add(current.id)
      current = current.afterCardId === undefined ? undefined : cardsById.get(current.afterCardId)
    }
    return false
  })
}

function installedFlyingChessNarrativeCards(workspace: StoryWorkspaceSnapshot): readonly FlyingChessNarrativeCard[] {
  const configuration = workspace.worldBinding?.configuration
  if (typeof configuration !== 'object' || configuration === null || Array.isArray(configuration)) return []
  const cards = (configuration as { readonly narrativeCards?: unknown }).narrativeCards
  return Array.isArray(cards) ? cards as unknown as readonly FlyingChessNarrativeCard[] : []
}

function FlyingChessNarrativeCardsDrawer({ workspace, busy, onUpdate, onClose }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly busy: boolean
  readonly onUpdate: (configuration: FlyingChessWorldConfiguration) => Promise<boolean>
  readonly onClose: () => void
}) {
  const [cards, setCards] = useState<readonly FlyingChessNarrativeCard[]>(() =>
    installedFlyingChessNarrativeCards(workspace).map(card => ({
      ...card,
      trigger: { ...card.trigger },
      event: { ...card.event },
      cue: { ...card.cue },
    })))
  const updateCard = (index: number, transform: (card: FlyingChessNarrativeCard) => FlyingChessNarrativeCard): void => {
    setCards(current => current.map((card, cardIndex) => cardIndex === index ? transform(card) : card))
  }
  const invalid = cards.some(card => card.event.title.trim() === '' || card.event.summary.trim() === ''
    || card.cue.text.trim() === '' || narrativeTriggerInvalid(card.trigger)
    || card.cue.opportunity !== undefined && card.cue.responders === 'none')
    || narrativeCardRelationsInvalid(cards)
  const save = (): void => {
    if (invalid || busy) return
    void onUpdate({ format: 0, ruleset: 'classic-24', narrativeCards: cards }).then(updated => {
      if (updated) onClose()
    })
  }
  return <>
    <button className="story-studio-drawer-backdrop" type="button" aria-label="关闭场景事件牌" onClick={onClose} />
    <aside className="story-studio-drawer story-world-narrative-drawer" aria-label="场景事件牌">
      <div className="story-studio-drawer-header"><div><h2>场景事件牌</h2><span>规则条件满足后，先记录世界事实，再让人物各自决定是否回应。</span></div>
        <button className="story-studio-icon-button" type="button" onClick={onClose}>×</button></div>
      <div className="story-world-narrative-list">{cards.map((card, index) => <article className="story-world-narrative-card" key={card.id}>
        <header><div><small>事件牌 {index + 1}</small><strong>{card.event.title.trim() || '未命名事件'}</strong></div>
          <button className="story-studio-icon-button story-studio-danger" type="button" aria-label={`删除${card.event.title || '事件牌'}`}
            onClick={() => { setCards(current => current.filter((_item, cardIndex) => cardIndex !== index)) }}>×</button></header>
        <div className="story-studio-field-row">
          <Field label="触发条件"><span className="story-world-trigger-field"><select className="story-studio-input" value={card.trigger.kind} onChange={event => {
            const kind = event.currentTarget.value as FlyingChessNarrativeCard['trigger']['kind']
            const trigger: FlyingChessNarrativeCard['trigger'] = kind === 'consecutive-passes'
              ? { kind, count: 4 }
              : kind === 'piece-launched'
                ? { kind }
              : kind === 'piece-landed'
                ? { kind, step: 8 }
                : kind === 'player-home-count'
                  ? { kind, count: 1 }
                  : { kind: 'piece-captured' }
            updateCard(index, current => ({ ...current, trigger }))
          }}>{Object.entries(narrativeTriggerLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select>
          {card.trigger.kind === 'consecutive-passes' && <><input className="story-studio-input" aria-label="连续回合数" type="number" min={2} max={32}
            value={card.trigger.count} onChange={event => {
              const count = Number(event.currentTarget.value)
              updateCard(index, current => ({ ...current, trigger: { kind: 'consecutive-passes', count } }))
            }} /><span>回合</span></>}
          {card.trigger.kind === 'piece-landed' && <><span>第</span><input className="story-studio-input" aria-label="航线步数" type="number" min={1} max={23}
            value={card.trigger.step} onChange={event => {
              const step = Number(event.currentTarget.value)
              updateCard(index, current => ({ ...current, trigger: { kind: 'piece-landed', step } }))
            }} /><span>步</span></>}
          {card.trigger.kind === 'player-home-count' && <><input className="story-studio-input" aria-label="抵达终点棋子数" type="number" min={1} max={4}
            value={card.trigger.count} onChange={event => {
              const count = Number(event.currentTarget.value)
              updateCard(index, current => ({ ...current, trigger: { kind: 'player-home-count', count } }))
            }} /><span>架</span></>}
          </span></Field>
          <Field label="形成的叙事方向"><select className="story-studio-input" value={card.cue.kind} onChange={event => {
            const kind = event.currentTarget.value as FlyingChessNarrativeCard['cue']['kind']
            updateCard(index, current => ({ ...current, cue: { ...current.cue, kind } }))
          }}>{Object.entries(narrativeCueLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></Field>
        </div>
        <Field label="承接事件"><select className="story-studio-input" value={card.afterCardId ?? ''} onChange={event => {
          const afterCardId = event.currentTarget.value
          updateCard(index, current => {
            if (afterCardId !== '') return { ...current, afterCardId }
            const { afterCardId: _afterCardId, ...independentCard } = current
            return independentCard
          })
        }}><option value="">独立触发</option>{cards.filter(candidate => candidate.id !== card.id).map(candidate => <option
          key={candidate.id} value={candidate.id}>{candidate.event.title.trim() || candidate.id}</option>)}</select></Field>
        <Field label="事件标题"><input className="story-studio-input" value={card.event.title} onChange={event => {
          const title = event.currentTarget.value
          updateCard(index, current => ({ ...current, event: { ...current.event, title } }))
        }} /></Field>
        <TextField label="已经发生的公开事实" rows={3} value={card.event.summary} onChange={summary => {
          updateCard(index, current => ({ ...current, event: { ...current.event, summary } }))
        }} />
        <TextField label="人物可以回应的现场条件" rows={3} value={card.cue.text} onChange={text => {
          updateCard(index, current => ({ ...current, cue: { ...current.cue, text } }))
        }} />
        <div className="story-world-narrative-card-foot"><label>回应范围：<select className="story-studio-input" value={card.cue.responders} onChange={event => {
          const responders = event.currentTarget.value as FlyingChessNarrativeCard['cue']['responders']
          updateCard(index, current => {
            if (responders !== 'none' || current.cue.opportunity === undefined) {
              return { ...current, cue: { ...current.cue, responders } }
            }
            const { opportunity: _opportunity, ...cue } = current.cue
            return { ...current, cue: { ...cue, responders } }
          })
        }}>{Object.entries(narrativeResponderLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="story-studio-check"><input type="checkbox" disabled={card.cue.responders === 'none'} checked={card.cue.opportunity !== undefined} onChange={event => {
          const enabled = event.currentTarget.checked
          updateCard(index, current => {
            if (enabled) return { ...current, cue: { ...current.cue, opportunity: {
              kind: 'speech', move: 'question', targets: 'opponents',
            } } }
            const { opportunity: _opportunity, ...cue } = current.cue
            return { ...current, cue }
          })
        }} />允许人物保留这次对白机会</label>
        {card.cue.opportunity !== undefined && <label>使用方式：<select className="story-studio-input"
          value={card.cue.opportunity.move} onChange={event => {
            const move = event.currentTarget.value as NonNullable<FlyingChessNarrativeCard['cue']['opportunity']>['move']
            updateCard(index, current => ({ ...current, cue: { ...current.cue, opportunity: {
              kind: 'speech', move, targets: 'opponents',
            } } }))
          }}>{Object.entries(narrativeOpportunityMoveLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        <label className="story-studio-check"><input type="checkbox" checked={card.repeat} onChange={event => {
          const repeat = event.currentTarget.checked
          updateCard(index, current => ({ ...current, repeat }))
        }} />条件再次满足时可重复触发</label></div>
      </article>)}</div>
      {cards.length === 0 && <div className="story-studio-empty story-world-narrative-empty"><strong>还没有场景事件牌</strong><span>纯规则回合仍会推进，但不会凭空获得额外场景材料。</span></div>}
      <button className="story-studio-button story-world-narrative-add" type="button" onClick={() => {
        setCards(current => [...current, {
          id: `event-${createClientOpaqueUuid()}`,
          trigger: { kind: 'consecutive-passes', count: 4 },
          event: { title: '新的场景变化', summary: '' },
          cue: { kind: 'opportunity', text: '', responders: 'all' },
          repeat: false,
        }])
      }}>＋ 添加事件牌</button>
      {invalid && <small className="story-world-cast-error">每张事件牌需要有效的触发条件、完整的公开事实与现场条件；承接事件必须存在且不能形成循环；可保留的对白机会需要至少一位回应人物。</small>}
      <div className="story-studio-actions"><button className="story-studio-button story-studio-button-primary" type="button"
        disabled={busy || invalid} onClick={save}>{busy ? '正在保存…' : '保存事件牌'}</button>
        <button className="story-studio-button" type="button" disabled={busy} onClick={onClose}>取消</button></div>
    </aside>
  </>
}

function PlayWorldView({ workspace, worlds, actorResources, turn, moduleAvailable, authoring, busy, dirty, renderPlayWorldView, onImportActor, onImportSourceUrl, onImportSources, onInstall, onUpdateCast, onUpdateConfiguration, onOpenCharacter, onOpenSources, onOpenOutputs, onRestart, onAction }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly worlds: readonly PlayWorldResourceDescriptor[]
  readonly actorResources: readonly RoleplayResourceDescriptor[]
  readonly turn: PlayWorldTurnProjection | null
  readonly moduleAvailable: boolean | null
  readonly authoring: boolean
  readonly busy: boolean
  readonly dirty: boolean
  readonly renderPlayWorldView: StoryWorkspaceEditorProps['renderPlayWorldView']
  readonly onImportActor: (file: File) => Promise<ImportedWorldActor>
  readonly onImportSourceUrl: () => void
  readonly onImportSources: () => void
  readonly onInstall: (resource: PlayWorldResourceDescriptor['resource'], cast: readonly PlayWorldCastSelection[]) => void
  readonly onUpdateCast: (cast: readonly PlayWorldCastSelection[]) => Promise<boolean>
  readonly onUpdateConfiguration: (configuration: FlyingChessWorldConfiguration) => Promise<boolean>
  readonly onOpenCharacter: (id: string) => void
  readonly onOpenSources: () => void
  readonly onOpenOutputs: () => void
  readonly onRestart: () => void
  readonly onAction: (actionId: string) => void
}) {
  const [castOpen, setCastOpen] = useState(false)
  const [narrativeCardsOpen, setNarrativeCardsOpen] = useState(false)
  useEffect(() => {
    setCastOpen(false)
    setNarrativeCardsOpen(false)
  }, [workspace.id, workspace.world?.moduleId, workspace.worldBinding?.resource?.id])
  if (workspace.world === undefined) {
    return <div className="story-studio-view"><div className="story-studio-view-heading"><div><h1>选择一个世界</h1>
      <p>世界模块承载规则、状态、动作和事件；普通世界书仍可只提供提示词资料。</p></div></div>
      <div className="story-world-module-grid">{worlds.map(world => <PlayWorldInstallerCard workspace={workspace} world={world}
        actorResources={actorResources} busy={busy} dirty={dirty} onImportActor={onImportActor} onInstall={onInstall}
        key={`${world.resource.kind}:${world.resource.id}`} />)}
      {worlds.length === 0 && <div className="story-studio-empty">当前没有可装入的世界资源。</div>}</div>
    </div>
  }
  const installedResource = worlds.find(world => workspace.worldBinding?.resource === undefined
    ? world.id === workspace.world?.moduleId
    : world.resource.id === workspace.worldBinding.resource.id)
  if (moduleAvailable === false) {
    return <div className="story-studio-view"><div className="story-studio-view-heading"><div>
      <h1>{workspace.world.title}</h1>
      <p>场地资料和上一局状态仍然完整保存；安装对应规则模块后即可继续。</p>
    </div></div><div className="story-play-notice">需要安装规则模块：{workspace.world.moduleId}</div>
      {authoring && <WorldEventList events={workspace.world.events} />}</div>
  }
  const configureCast = installedResource !== undefined && installedResource.castSlots.length > 0
    ? () => { setCastOpen(true) }
    : undefined
  const castDrawer = castOpen && installedResource !== undefined
    ? <InstalledWorldCastDrawer workspace={workspace} world={installedResource} actorResources={actorResources}
        busy={busy} dirty={dirty} onImportActor={onImportActor} onUpdate={onUpdateCast} onClose={() => { setCastOpen(false) }} />
    : undefined
  const narrativeCardsDrawer = narrativeCardsOpen && workspace.world.moduleId === FLYING_CHESS_WORLD_MODULE_ID
    ? <FlyingChessNarrativeCardsDrawer workspace={workspace} busy={busy} onUpdate={onUpdateConfiguration}
        onClose={() => { setNarrativeCardsOpen(false) }} />
    : undefined
  if (workspace.world.moduleId === FLYING_CHESS_WORLD_MODULE_ID && isFlyingChessWorldState(workspace.world.state)) {
    return <><FlyingChessPlayView workspace={workspace} state={workspace.world.state} turn={turn} authoring={authoring} busy={busy} dirty={dirty}
      onConfigureCast={configureCast}
      onImportSourceUrl={onImportSourceUrl} onImportSources={onImportSources} onOpenCharacter={onOpenCharacter} onOpenSources={onOpenSources}
      onOpenOutputs={onOpenOutputs}
      onConfigureNarrativeCards={authoring ? () => { setNarrativeCardsOpen(true) } : undefined}
      onRestart={onRestart} onAction={onAction} />{castDrawer}{narrativeCardsDrawer}</>
  }
  return <><GenericPlayWorldView workspace={workspace} module={installedResource}
    turn={turn} authoring={authoring} busy={busy} dirty={dirty}
    renderPlayWorldView={renderPlayWorldView}
    onConfigureCast={configureCast} onImportSourceUrl={onImportSourceUrl} onImportSources={onImportSources}
    onOpenCharacter={onOpenCharacter} onOpenSources={onOpenSources}
    onOpenOutputs={onOpenOutputs}
    onRestart={onRestart} onAction={onAction} />{castDrawer}</>
}

/** Explicit author studio for inspecting and editing one typed story workspace. */
export function StoryWorkspaceEditor({
  accent,
  initialWorkspaceId,
  sessionId,
  sessionWorkspaceId,
  storyTurn,
  launchTargets = [],
  defaultLaunchTargetId,
  launchUnavailableReason,
  onOpenSession,
  renderPlayWorldView,
  onClose,
}: StoryWorkspaceEditorProps) {
  const [items, setItems] = useState<readonly StoryWorkspaceSummary[]>([])
  const [playWorlds, setPlayWorlds] = useState<readonly PlayWorldResourceDescriptor[]>([])
  const [actorResources, setActorResources] = useState<readonly RoleplayResourceDescriptor[]>([])
  const [workspace, setWorkspace] = useState<StoryWorkspaceSnapshot>()
  const [worldTurn, setWorldTurn] = useState<PlayWorldTurnProjection | null>(null)
  const [worldModuleAvailable, setWorldModuleAvailable] = useState<boolean | null>(null)
  const [webFetchAvailable, setWebFetchAvailable] = useState<boolean | null>(null)
  const [webSearchAvailable, setWebSearchAvailable] = useState<boolean | null>(null)
  const [sourceUrlOpen, setSourceUrlOpen] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceUrlName, setSourceUrlName] = useState('')
  const [sourceUrlKind, setSourceUrlKind] = useState<'original' | 'reference'>('reference')
  const [view, setView] = useState<StudioView>('world')
  const [selection, setSelection] = useState<StudioSelection>()
  const [readerSourceId, setReaderSourceId] = useState<string>()
  const [perspectiveId, setPerspectiveId] = useState<string>()
  const [previewId, setPreviewId] = useState<string>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [launchTargetId, setLaunchTargetId] = useState(defaultLaunchTargetId ?? launchTargets[0]?.id)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [dragOutputId, setDragOutputId] = useState<string>()
  const sourceFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (launchTargetId !== undefined && launchTargets.some(target => target.id === launchTargetId)) return
    setLaunchTargetId(defaultLaunchTargetId !== undefined
      && launchTargets.some(target => target.id === defaultLaunchTargetId)
      ? defaultLaunchTargetId
      : launchTargets[0]?.id)
  }, [defaultLaunchTargetId, launchTargetId, launchTargets])

  const load = async (id: string): Promise<void> => {
    const next = await readWorkspace(id)
    setWorkspace(next.workspace)
    setWorldTurn(next.worldTurn)
    setWorldModuleAvailable(next.worldModuleAvailable)
    setWebFetchAvailable(next.webFetchAvailable)
    setWebSearchAvailable(next.webSearchAvailable)
    setDirty(false)
    setSelection(undefined)
    setReaderSourceId(undefined)
    setSourceUrlOpen(false)
    setSourceUrl('')
    setSourceUrlName('')
    setSourceUrlKind('reference')
    setView('world')
    setPerspectiveId(undefined)
    setPreviewId(undefined)
  }
  const refreshList = async (preferredId?: string): Promise<void> => {
    const next = await listWorkspaces()
    setItems(next)
    const id = preferredId ?? next[0]?.id
    if (id === undefined) {
      setWorkspace(undefined)
      setWorldTurn(null)
      setWorldModuleAvailable(null)
      setWebFetchAvailable(null)
      setWebSearchAvailable(null)
      setSelection(undefined)
      setReaderSourceId(undefined)
      return
    }
    await load(id)
  }
  useEffect(() => {
    let active = true
    setLoading(true)
    void Promise.all([listWorkspaces(), listPlayWorldResources(), listActorResources()]).then(async ([next, worlds, actors]) => {
      const selectedId = initialWorkspaceId !== undefined && next.some(item => item.id === initialWorkspaceId)
        ? initialWorkspaceId
        : next[0]?.id
      const selected = selectedId === undefined ? undefined : await readWorkspace(selectedId)
      if (!active) return
      setItems(next)
      setPlayWorlds(worlds)
      setActorResources(actors)
      setWorkspace(selected?.workspace)
      setWorldTurn(selected?.worldTurn ?? null)
      setWorldModuleAvailable(selected?.worldModuleAvailable ?? null)
      setWebFetchAvailable(selected?.webFetchAvailable ?? null)
      setWebSearchAvailable(selected?.webSearchAvailable ?? null)
      setSelection(undefined)
      setReaderSourceId(undefined)
    }).catch(reason => {
      if (active) setError(errorMessage(reason))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [initialWorkspaceId])
  const update: UpdateWorkspace = transform => {
    setWorkspace(current => current === undefined ? undefined : transform(current))
    setDirty(true)
    setNotice(undefined)
    setError(undefined)
    setDeleteArmed(false)
  }
  const select = (next: StudioSelection): void => {
    setSelection(next)
    if (next.kind === 'source') setReaderSourceId(next.id)
    else if (next.kind !== 'citation') setReaderSourceId(undefined)
    if (next.kind === 'node' || next.kind === 'edge') setView('map')
    else if (next.kind === 'event') setView('timeline')
    else if (next.kind === 'character') setView('characters')
    else if (next.kind === 'source' || next.kind === 'citation') setView('sources')
    else setView('outputs')
  }
  const navigate = (next: StudioView): void => {
    setView(next)
    setSelection(undefined)
    setReaderSourceId(undefined)
  }
  const changeProject = (id: string): void => {
    if (workspace?.id === id) return
    if (dirty && !window.confirm('当前修改尚未保存，仍要切换场地吗？')) return
    setSaving(true)
    setError(undefined)
    void load(id).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const createNew = (): void => {
    setSaving(true)
    setError(undefined)
    void createWorkspace(`新场地 ${items.length + 1}`).then(async created => {
      const next = await listWorkspaces()
      setItems(next)
      setWorkspace(created.workspace)
      setWorldTurn(created.worldTurn)
      setWorldModuleAvailable(created.worldModuleAvailable)
      setWebFetchAvailable(created.webFetchAvailable)
      setWebSearchAvailable(created.webSearchAvailable)
      setDirty(false)
      setSelection(undefined)
      setReaderSourceId(undefined)
      setSourceUrlOpen(false)
      setSourceUrl('')
      setSourceUrlName('')
      setSourceUrlKind('reference')
      setView('world')
      setNotice('新场地已经准备好')
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const save = (): void => {
    if (workspace === undefined) return
    setSaving(true)
    setError(undefined)
    void saveWorkspace(workspace).then(async saved => {
      setWorkspace(saved.workspace)
      setWorldTurn(saved.worldTurn)
      setWorldModuleAvailable(saved.worldModuleAvailable)
      setWebFetchAvailable(saved.webFetchAvailable)
      setWebSearchAvailable(saved.webSearchAvailable)
      setItems(await listWorkspaces())
      setDirty(false)
      setNotice('所有修改已保存')
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const installWorld = (resource: PlayWorldResourceDescriptor['resource'], cast: readonly PlayWorldCastSelection[]): void => {
    if (workspace === undefined || dirty) return
    setSaving(true)
    setError(undefined)
    void installPlayWorld(workspace, resource, cast).then(async saved => {
      setWorkspace(saved.workspace)
      setWorldTurn(saved.worldTurn)
      setWorldModuleAvailable(saved.worldModuleAvailable)
      setWebFetchAvailable(saved.webFetchAvailable)
      setWebSearchAvailable(saved.webSearchAvailable)
      setItems(await listWorkspaces())
      setView('world')
      setNotice(`${saved.workspace.world?.title ?? '世界'}已经装入场地`)
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const saveWorldCast = async (cast: readonly PlayWorldCastSelection[]): Promise<boolean> => {
    if (workspace === undefined || workspace.world === undefined || dirty) return false
    setSaving(true)
    setError(undefined)
    try {
      const saved = await updatePlayWorldCast(workspace, cast)
      setWorkspace(saved.workspace)
      setWorldTurn(saved.worldTurn)
      setWorldModuleAvailable(saved.worldModuleAvailable)
      setWebFetchAvailable(saved.webFetchAvailable)
      setWebSearchAvailable(saved.webSearchAvailable)
      setItems(await listWorkspaces())
      setView('world')
      setNotice('人物来源已更新，棋局状态与事件保持不变')
      return true
    } catch (reason) {
      setError(errorMessage(reason))
      return false
    } finally {
      setSaving(false)
    }
  }
  const saveWorldConfiguration = async (configuration: FlyingChessWorldConfiguration): Promise<boolean> => {
    if (workspace === undefined || workspace.world === undefined || dirty) return false
    setSaving(true)
    setError(undefined)
    try {
      const saved = await updatePlayWorldConfiguration(workspace, configuration)
      setWorkspace(saved.workspace)
      setWorldTurn(saved.worldTurn)
      setWorldModuleAvailable(saved.worldModuleAvailable)
      setWebFetchAvailable(saved.webFetchAvailable)
      setWebSearchAvailable(saved.webSearchAvailable)
      setItems(await listWorkspaces())
      setView('world')
      setNotice('场景事件牌已保存，棋局状态与既有事件保持不变')
      return true
    } catch (reason) {
      setError(errorMessage(reason))
      return false
    } finally {
      setSaving(false)
    }
  }
  const importActorResource = async (file: File): Promise<ImportedWorldActor> => {
    const imported = await importCharacterFile(file)
    const actors = await listActorResources()
    const actor = actors.find(candidate => candidate.id === `character:library:${imported.entry.id}`)
    if (actor === undefined) throw new Error('角色卡已经导入，但暂时没有出现在人物资源目录中')
    setActorResources(actors)
    return { actor, outcome: imported.outcome }
  }
  const importWorldActor = async (file: File): Promise<ImportedWorldActor> => {
    setSaving(true)
    setError(undefined)
    try {
      const imported = await importActorResource(file)
      const actor = imported.actor
      setNotice(imported.outcome === 'created'
        ? `角色卡「${actor.name}」已导入并加入人物槽位`
        : imported.outcome === 'restored'
          ? `角色卡「${actor.name}」已从收纳箱恢复并加入人物槽位`
          : `角色卡「${actor.name}」已在资源中心并加入人物槽位`)
      return { actor, outcome: imported.outcome }
    } finally {
      setSaving(false)
    }
  }
  const importCharacterActor = async (characterId: string, file: File): Promise<void> => {
    if (workspace === undefined || dirty) return
    setSaving(true)
    setError(undefined)
    try {
      const imported = await importActorResource(file)
      const saved = await bindStoryCharacterActor(workspace, characterId, { kind: 'actor', id: imported.actor.id })
      setWorkspace(saved.workspace)
      setWorldTurn(saved.worldTurn)
      setWorldModuleAvailable(saved.worldModuleAvailable)
      setWebFetchAvailable(saved.webFetchAvailable)
      setWebSearchAvailable(saved.webSearchAvailable)
      setItems(await listWorkspaces())
      setNotice(imported.outcome === 'created'
        ? `角色卡「${imported.actor.name}」已导入并绑定；本局动态与世界进度保持不变`
        : imported.outcome === 'restored'
          ? `角色卡「${imported.actor.name}」已恢复并绑定；本局动态与世界进度保持不变`
          : `角色卡「${imported.actor.name}」已绑定；本局动态与世界进度保持不变`)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }
  const restartWorld = (): void => {
    if (workspace === undefined || workspace.world === undefined || dirty) return
    setSaving(true)
    setError(undefined)
    void restartPlayWorld(workspace).then(async saved => {
      setWorkspace(saved.workspace)
      setWorldTurn(saved.worldTurn)
      setWorldModuleAvailable(saved.worldModuleAvailable)
      setWebFetchAvailable(saved.webFetchAvailable)
      setWebSearchAvailable(saved.webSearchAvailable)
      setItems(await listWorkspaces())
      setView('world')
      setNotice(`${saved.workspace.world?.title ?? '世界'}已经重新开局；旧局事件与临时状态已清空`)
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const runWorldAction = (actionId: string): void => {
    if (workspace === undefined || worldTurn === null || dirty) return
    const action = worldTurn.actions.find(candidate => candidate.id === actionId)
    if (action === undefined) return
    setSaving(true)
    setError(undefined)
    void dispatchPlayWorldAction(workspace, worldTurn, actionId).then(async saved => {
      setWorkspace(saved.workspace)
      setWorldTurn(saved.worldTurn)
      setWorldModuleAvailable(saved.worldModuleAvailable)
      setWebFetchAvailable(saved.webFetchAvailable)
      setWebSearchAvailable(saved.webSearchAvailable)
      setItems(await listWorkspaces())
      setNotice(`${action.label}已经结算`)
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const bindActor = (
    characterId: string,
    actor?: RoleplayResourceSelection,
  ): void => {
    if (workspace === undefined || dirty) return
    setSaving(true)
    setError(undefined)
    void bindStoryCharacterActor(workspace, characterId, actor).then(async saved => {
      setWorkspace(saved.workspace)
      setWorldTurn(saved.worldTurn)
      setWorldModuleAvailable(saved.worldModuleAvailable)
      setWebFetchAvailable(saved.webFetchAvailable)
      setWebSearchAvailable(saved.webSearchAvailable)
      setItems(await listWorkspaces())
      setNotice(actorSyncNotice(saved.sync))
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const removeWorkspace = (): void => {
    if (workspace === undefined) return
    if (!deleteArmed) {
      setDeleteArmed(true)
      return
    }
    setSaving(true)
    void deleteWorkspace(workspace.id).then(async () => {
      setSettingsOpen(false)
      setDirty(false)
      await refreshList()
      setNotice('场地已删除')
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const selectForSession = (workspaceId: string | null): void => {
    if (sessionId === undefined) return
    setSaving(true)
    setError(undefined)
    void executeAgentRpCommand(sessionId, `/rp-story-workspace ${JSON.stringify({ format: 0, workspaceId })}`)
      .then(result => {
        if (!result.matched) throw new Error('当前角色会话没有游玩场地命令')
        setNotice(workspaceId === null ? '当前会话已停止使用故事流水线' : '当前会话已连接这个故事')
      }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }

  const addCharacter = (): void => {
    if (workspace === undefined) return
    const id = `character-${createClientOpaqueUuid()}`
    update(current => ({ ...current, characters: [...current.characters, {
      id,
      name: `人物 ${current.characters.length + 1}`,
      voiceAliases: [],
      profile: { description: '', personality: '', scenario: '', exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '' },
      state: { location: '', condition: '', objective: '', notes: '' },
    }] }))
    select({ kind: 'character', id })
  }
  const addSource = (): void => {
    if (workspace === undefined) return
    const id = `source-${createClientOpaqueUuid()}`
    update(current => ({ ...current, sources: [...current.sources, {
      id, name: `资料 ${current.sources.length + 1}`, kind: 'original', enabled: true, content: '',
    }] }))
    select({ kind: 'source', id })
  }
  const importSourceFiles = async (files: readonly File[]): Promise<void> => {
    if (workspace === undefined || files.length === 0) return
    setSaving(true)
    setError(undefined)
    try {
      const imported = await Promise.all(files.map(async file => ({
        id: `source-${createClientOpaqueUuid()}`,
        name: storySourceNameFromFile(file.name),
        kind: 'original' as const,
        enabled: true,
        content: decodeStorySourceFile(new Uint8Array(await file.arrayBuffer())),
      })))
      update(current => ({ ...current, sources: [...current.sources, ...imported] }))
      select({ kind: 'source', id: imported[0]!.id })
      setNotice(`已从本机导入 ${String(imported.length)} 份原著资料；保存场地后生效`)
    } catch (reason: unknown) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
      if (sourceFileInputRef.current !== null) sourceFileInputRef.current.value = ''
    }
  }
  const importSourceFromUrl = (): void => {
    if (workspace === undefined || dirty || sourceUrl.trim() === '') return
    setSaving(true)
    setError(undefined)
    void importStorySourceUrl(workspace, sourceUrl.trim(), sourceUrlName, sourceUrlKind).then(async imported => {
      setWorkspace(imported.workspace)
      setWorldTurn(imported.worldTurn)
      setWorldModuleAvailable(imported.worldModuleAvailable)
      setWebFetchAvailable(imported.webFetchAvailable)
      setWebSearchAvailable(imported.webSearchAvailable)
      setItems(await listWorkspaces())
      setDirty(false)
      setSourceUrlOpen(false)
      setSourceUrl('')
      setSourceUrlName('')
      setSourceUrlKind('reference')
      select({ kind: 'source', id: imported.sourceId })
      setNotice(imported.truncated ? '网页资料已经导入；正文超过安全上限的部分未保存' : '网页资料已经导入并保留来源地址')
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const refreshSourceFromUrl = (source: StorySource): void => {
    if (workspace === undefined || dirty || webFetchAvailable !== true || source.origin?.kind !== 'url') return
    setSaving(true)
    setError(undefined)
    void refreshStorySourceUrl(workspace, source.id).then(async refreshed => {
      setWorkspace(refreshed.workspace)
      setWorldTurn(refreshed.worldTurn)
      setWorldModuleAvailable(refreshed.worldModuleAvailable)
      setWebFetchAvailable(refreshed.webFetchAvailable)
      setWebSearchAvailable(refreshed.webSearchAvailable)
      setItems(await listWorkspaces())
      setDirty(false)
      setReaderSourceId(source.id)
      setNotice(sourceRefreshNotice(refreshed.report))
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const addCitation = (source: StorySource, passage: StorySourcePassage): void => {
    const id = `citation-${createClientOpaqueUuid()}`
    update(current => ({ ...current, citations: [...current.citations, {
      id,
      sourceId: source.id,
      locator: passage.locator,
      quote: passage.text,
      note: '',
    }] }))
    setSelection({ kind: 'citation', id })
  }
  const resolveCitationRefreshReview = (id: string, locator?: string): void => {
    update(current => ({
      ...current,
      citations: current.citations.map(citation => citation.id !== id
        ? citation
        : citationWithoutRefreshReview(locator === undefined ? citation : { ...citation, locator })),
    }))
  }
  const acceptResearchExcerpt = (item: StoryResearchItem): void => {
    const id = `source-${createClientOpaqueUuid()}`
    const content = [`# ${item.title}`, '', item.snippet || '这个搜索结果没有提供摘要。', '', `来源：${item.url}`].join('\n')
    update(current => ({
      ...current,
      sources: [...current.sources, {
        id,
        name: item.title.slice(0, 120),
        kind: 'research',
        enabled: true,
        content,
        origin: {
          kind: 'web',
          url: item.url,
          query: item.query,
          sessionId: item.sessionId,
          turn: item.turn,
          resultEventSeq: item.resultEventSeq,
        },
      }],
      researchInbox: current.researchInbox.filter(candidate => candidate.id !== item.id),
    }))
    select({ kind: 'source', id })
    setNotice('已保留当前网络摘录；保存场地后生效')
  }
  const acceptResearchPage = (item: StoryResearchItem): void => {
    if (workspace === undefined || dirty || webFetchAvailable !== true) return
    setSaving(true)
    setError(undefined)
    void acceptStoryResearchItem(workspace, item.id).then(async accepted => {
      setWorkspace(accepted.workspace)
      setWorldTurn(accepted.worldTurn)
      setWorldModuleAvailable(accepted.worldModuleAvailable)
      setWebFetchAvailable(accepted.webFetchAvailable)
      setWebSearchAvailable(accepted.webSearchAvailable)
      setItems(await listWorkspaces())
      setDirty(false)
      select({ kind: 'source', id: accepted.sourceId })
      setNotice(accepted.truncated
        ? '网页正文已经收为资料；超过安全上限的部分未保存'
        : '网页正文已经收为资料，并保留原查询与回合来源')
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const dismissResearch = (id: string): void => {
    update(current => ({ ...current, researchInbox: current.researchInbox.filter(item => item.id !== id) }))
  }
  const addOutput = (): void => {
    if (workspace === undefined) return
    const id = `output-${createClientOpaqueUuid()}`
    update(current => ({ ...current, outputs: [...current.outputs, {
      id, name: `正文 ${current.outputs.length + 1}`, kind: 'prose', enabled: true, instructions: '',
    }] }))
    select({ kind: 'output', id })
  }

  const deleteNode = (id: string): void => {
    update(current => {
      const removedIds = new Set<string>([id])
      let changed = true
      while (changed) {
        changed = false
        for (const node of current.graph.nodes) {
          if (node.parentId !== undefined && removedIds.has(node.parentId) && !removedIds.has(node.id)) {
            removedIds.add(node.id)
            changed = true
          }
        }
      }
      const nodes = current.graph.nodes.filter(node => !removedIds.has(node.id))
      const edges = current.graph.edges.filter(edge => !removedIds.has(edge.source) && !removedIds.has(edge.target))
      const facts = current.facts.filter(fact => fact.nodeId === undefined || !removedIds.has(fact.nodeId))
      const factIds = new Set(facts.map(fact => fact.id))
      const graph = current.graph.activeNodeId !== undefined && removedIds.has(current.graph.activeNodeId)
        ? { nodes, edges }
        : { ...current.graph, nodes, edges }
      return {
        ...current,
        graph,
        facts,
        events: current.events.map(event => event.nodeId !== undefined && removedIds.has(event.nodeId) ? eventWithoutNode(event) : event),
        citations: current.citations.map(citation => citation.target?.kind === 'node' && removedIds.has(citation.target.nodeId)
          || citation.target?.kind === 'fact' && !factIds.has(citation.target.factId) ? citationWithoutTarget(citation) : citation),
      }
    })
    setSelection(undefined)
  }
  const deleteEdge = (id: string): void => {
    update(current => ({ ...current, graph: { ...current.graph, edges: current.graph.edges.filter(edge => edge.id !== id) } }))
    setSelection(undefined)
  }
  const deleteCharacter = (id: string): void => {
    update(current => {
      const facts = current.facts.map(fact => ({ ...fact, knownBy: fact.knownBy.filter(candidate => candidate !== id) }))
        .filter(fact => fact.knowledgeMode === 'inherit' || fact.knownBy.length > 0)
      const factIds = new Set(facts.map(fact => fact.id))
      return {
        ...current,
        characters: current.characters.filter(character => character.id !== id),
        graph: { ...current.graph, nodes: current.graph.nodes.map(node => ({
          ...node,
          participantIds: node.participantIds.filter(candidate => candidate !== id),
          knowledge: { ...node.knowledge, characterIds: node.knowledge.characterIds.filter(candidate => candidate !== id) },
        })) },
        facts,
        citations: current.citations.map(citation => citation.target?.kind === 'fact' && !factIds.has(citation.target.factId)
          ? citationWithoutTarget(citation) : citation),
        events: current.events.map(event => ({ ...event, participantIds: event.participantIds.filter(candidate => candidate !== id) })),
        outputs: current.outputs.map(output => output.characterId === id ? selectWithoutCharacter(output) : output),
      }
    })
    setPerspectiveId(current => current === id ? undefined : current)
    setPreviewId(current => current === id ? undefined : current)
    setSelection(undefined)
  }
  const deleteEvent = (id: string): void => {
    update(current => {
      const facts = current.facts.filter(fact => fact.source.kind !== 'event' || fact.source.eventId !== id)
      const factIds = new Set(facts.map(fact => fact.id))
      return {
        ...current,
        events: current.events.filter(event => event.id !== id),
        facts,
        citations: current.citations.map(citation => (
          citation.target?.kind === 'fact' && !factIds.has(citation.target.factId)
        ) || (
          citation.target?.kind === 'event' && citation.target.eventId === id
        ) ? citationWithoutTarget(citation) : citation),
        graph: {
          ...current.graph,
          nodes: current.graph.nodes.map(node => node.sourceEventId === id ? nodeWithoutSourceEvent(node) : node),
          edges: current.graph.edges.map(edge => edge.sourceEventId === id ? edgeWithoutSourceEvent(edge) : edge),
        },
      }
    })
    setSelection(undefined)
  }
  const reorderOutputs = (sourceId: string, targetId: string): void => {
    if (sourceId === targetId) return
    update(current => {
      const sourceIndex = current.outputs.findIndex(output => output.id === sourceId)
      const targetIndex = current.outputs.findIndex(output => output.id === targetId)
      if (sourceIndex < 0 || targetIndex < 0) return current
      const outputs = [...current.outputs]
      const [moved] = outputs.splice(sourceIndex, 1)
      if (moved === undefined) return current
      outputs.splice(targetIndex, 0, moved)
      return { ...current, outputs }
    })
  }
  const moveOutput = (sourceId: string, offset: -1 | 1): void => {
    const sourceIndex = workspace?.outputs.findIndex(output => output.id === sourceId) ?? -1
    const target = workspace?.outputs[sourceIndex + offset]
    if (target !== undefined) reorderOutputs(sourceId, target.id)
  }

  const selectedNode = selection?.kind === 'node' ? workspace?.graph.nodes.find(node => node.id === selection.id) : undefined
  const selectedEdge = selection?.kind === 'edge' ? workspace?.graph.edges.find(edge => edge.id === selection.id) : undefined
  const selectedCharacter = selection?.kind === 'character' ? workspace?.characters.find(character => character.id === selection.id) : undefined
  const activeCharacter = view === 'characters' ? selectedCharacter ?? workspace?.characters[0] : selectedCharacter
  const selectedEvent = selection?.kind === 'event' ? workspace?.events.find(event => event.id === selection.id) : undefined
  const selectedWorldEvent = selection?.kind === 'world-event' ? workspace?.world?.events.find(event => event.id === selection.id) : undefined
  const selectedSource = selection?.kind === 'source' ? workspace?.sources.find(source => source.id === selection.id) : undefined
  const selectedCitation = selection?.kind === 'citation' ? workspace?.citations.find(citation => citation.id === selection.id) : undefined
  const readerSource = selectedSource ?? (selectedCitation === undefined
    ? workspace?.sources.find(source => source.id === readerSourceId)
    : workspace?.sources.find(source => source.id === selectedCitation.sourceId))
  const selectedOutput = selection?.kind === 'output' ? workspace?.outputs.find(output => output.id === selection.id) : undefined
  const currentSessionUsesWorkspace = workspace !== undefined
    && sessionId !== undefined
    && sessionWorkspaceId === workspace.id
  const openInSession = (): void => {
    if (workspace === undefined || saving) return
    if (currentSessionUsesWorkspace) {
      onClose()
      return
    }
    if (dirty || launchTargetId === undefined || onOpenSession === undefined) return
    setSaving(true)
    setError(undefined)
    void onOpenSession(launchTargetId, workspace.id).then(onClose, reason => {
      setError(errorMessage(reason))
    }).finally(() => { setSaving(false) })
  }

  const inspector = workspace === undefined ? <EmptyInspector />
    : selectedNode !== undefined ? <NodeInspector workspace={workspace} node={selectedNode} update={update} onSelect={setSelection}
      onOpenEvent={id => { select({ kind: 'event', id }) }} onDelete={() => { deleteNode(selectedNode.id) }} />
      : selectedEdge !== undefined ? <EdgeInspector workspace={workspace} edge={selectedEdge} update={update} onDelete={() => { deleteEdge(selectedEdge.id) }} />
        : selectedCharacter !== undefined ? <EmptyInspector />
          : selectedEvent !== undefined ? <EventInspector workspace={workspace} event={selectedEvent} update={update}
            onOpenKnowledge={() => { setView('characters') }} onSelect={select}
            onDelete={() => { deleteEvent(selectedEvent.id) }} />
            : selectedWorldEvent !== undefined ? <WorldEventInspector workspace={workspace} event={selectedWorldEvent}
              onOpenWorld={() => { navigate('world') }} onSelectStoryEvent={id => { select({ kind: 'event', id }) }} />
            : selectedSource !== undefined ? <SourceInspector source={selectedSource} update={update} onDelete={() => {
              update(current => ({
                ...current,
                sources: current.sources.filter(source => source.id !== selectedSource.id),
                citations: current.citations.filter(citation => citation.sourceId !== selectedSource.id),
              })); setSelection(undefined); setReaderSourceId(undefined)
            }} />
              : selectedCitation !== undefined ? <CitationInspector workspace={workspace} citation={selectedCitation} update={update}
                onDelete={() => {
                  update(current => ({ ...current, citations: current.citations.filter(citation => citation.id !== selectedCitation.id) }))
                  setSelection({ kind: 'source', id: selectedCitation.sourceId })
                }} />
              : selectedOutput !== undefined ? <OutputInspector workspace={workspace} output={selectedOutput} update={update} onDelete={() => {
                update(current => ({ ...current, outputs: current.outputs.filter(output => output.id !== selectedOutput.id) })); setSelection(undefined)
              }} />
                : <EmptyInspector />

  let main: React.ReactNode
  if (workspace === undefined) {
    main = <div className="story-studio-empty"><span style={{ fontSize: 34 }}>✦</span><strong>创建一个游玩场地</strong><span>人物、世界规则、认知、事件与资料会在同一处持续演进。</span>
      <button className="story-studio-button story-studio-button-primary" disabled={saving} type="button" onClick={createNew}>创建场地</button></div>
  } else if (view === 'world') {
    main = <PlayWorldView workspace={workspace} worlds={playWorlds} actorResources={actorResources} turn={worldTurn} moduleAvailable={worldModuleAvailable} busy={saving} dirty={dirty}
      authoring
      renderPlayWorldView={renderPlayWorldView}
      onImportActor={importWorldActor} onImportSourceUrl={() => {
        setView('sources')
        setSelection(undefined)
        setReaderSourceId(undefined)
        setSourceUrlOpen(true)
        setSourceUrlKind('original')
      }} onImportSources={() => { sourceFileInputRef.current?.click() }}
      onInstall={installWorld} onUpdateCast={saveWorldCast} onUpdateConfiguration={saveWorldConfiguration}
      onOpenCharacter={id => { select({ kind: 'character', id }) }}
      onOpenSources={() => { setView('sources'); setSelection(undefined); setReaderSourceId(undefined) }}
      onOpenOutputs={() => { setView('outputs'); setSelection(undefined) }}
      onRestart={restartWorld} onAction={runWorldAction} />
  } else if (view === 'map') {
    main = <StoryMap workspace={workspace} selection={selection} perspectiveId={perspectiveId} update={update} setSelection={setSelection}
      clearPerspective={() => { setPerspectiveId(undefined) }} />
  } else if (view === 'timeline') {
    const events = [...workspace.events].sort((left, right) => left.turn - right.turn)
    const groups = groupStoryTimeline(workspace)
    const representedWorldSequences = new Set(events.flatMap(event => event.worldEventSequences ?? []))
    const pendingWorldEvents = (workspace.world?.events ?? []).filter(event => !representedWorldSequences.has(event.sequence))
    main = <div className="story-studio-view"><div className="story-studio-view-heading"><div><h1>事件时间线</h1><p>按游玩回合整理已经发生的情节，并保留可追溯的规则来源。</p></div></div>
      <div className="story-studio-card-list">
        {pendingWorldEvents.length > 0 && <section className="story-timeline-pending"><div className="story-timeline-section-heading"><div><strong>独立规则记录</strong><span>尚未关联正文回合的场地事件。</span></div><b>{pendingWorldEvents.length}</b></div>
          <div className="story-timeline-world-grid">{pendingWorldEvents.map(worldEvent => <button type="button" className="story-timeline-world-card"
            data-selected={selection?.kind === 'world-event' && selection.id === worldEvent.id} key={worldEvent.id}
            onClick={() => { setSelection({ kind: 'world-event', id: worldEvent.id }) }}>
            <span>#{worldEvent.sequence}</span><div><strong>{worldEvent.title}</strong><small>{worldEvent.summary}</small></div>
          </button>)}</div></section>}
        {groups.map(group => <StoryTimelineSection workspace={workspace} group={group} key={group.key}
          selectedEventId={selection?.kind === 'event' ? selection.id : undefined}
          onSelectEvent={id => { setSelection({ kind: 'event', id }) }}
          onSelectWorldEvent={id => { setSelection({ kind: 'world-event', id }) }} />)}
        {events.length === 0 && pendingWorldEvents.length === 0 && <div className="story-studio-empty"><span>人物或世界产生事件后，会在这里组成可追溯的时间线。</span></div>}</div>
    </div>
  } else if (view === 'characters') {
    main = <CharacterWorkspaceView workspace={workspace} character={activeCharacter} actorResources={actorResources} busy={saving} dirty={dirty} update={update}
      perspectiveId={perspectiveId} previewId={previewId} setPerspectiveId={setPerspectiveId} setPreviewId={setPreviewId}
      openStoryMap={() => { navigate('map') }}
      onBindActor={bindActor} onImportActor={importCharacterActor} onDelete={deleteCharacter}
      selectEvent={id => { select({ kind: 'event', id }) }} addCharacter={addCharacter} />
  } else if (view === 'sources') {
    main = readerSource === undefined
      ? <div className="story-studio-view"><div className="story-studio-view-heading"><div><h1>原著与研究资料</h1><p>按章节翻阅原文，把准确段落连接到剧情和人物事实。</p></div><div className="story-studio-actions">
        <span className="story-web-capability" data-available={webFetchAvailable === true}
          title={webSearchAvailable === true
            ? webFetchAvailable === true ? '研究 Worker 可以搜索网络并读取相关页面正文。' : '研究 Worker 可以搜索网络，但当前 Host 不能读取结果页面正文。'
            : webFetchAvailable === true ? '可以导入已知网页；研究 Worker 仍只使用本地资料。' : '研究 Worker 仍会使用本地资料，但不能追加网络查询。'}>
          {webSearchAvailable === null || webFetchAvailable === null
            ? '正在确认网络研究…'
            : webSearchAvailable ? webFetchAvailable ? '网络搜索与正文读取已接入' : '网络搜索已接入 · 无正文读取'
              : webFetchAvailable ? '可以导入已知网页 · 无网络搜索' : '当前 Host 未接入网络研究'}
        </span>
        <button className="story-studio-button" type="button" disabled={saving || dirty || webFetchAvailable !== true}
          title={dirty ? '先保存当前修改，再导入网页资料' : webFetchAvailable === false ? '当前 Host 没有网页正文读取能力' : undefined}
          onClick={() => { setSourceUrlOpen(current => !current) }}>从网址导入</button>
        <button className="story-studio-button story-studio-button-primary" type="button" disabled={saving}
          onClick={() => { sourceFileInputRef.current?.click() }}>导入 TXT / Markdown</button>
        <button className="story-studio-button" type="button" onClick={addSource}>＋ 空白资料</button>
      </div></div>
        {sourceUrlOpen && <section className="story-source-url-import" aria-label="从网址导入资料">
          <div className="story-source-url-fields">
            <Field label="网页地址"><input className="story-studio-input" type="url" placeholder="https://…" value={sourceUrl}
              onChange={event => { setSourceUrl(event.target.value) }} /></Field>
            <Field label="资料名称（可选）"><input className="story-studio-input" value={sourceUrlName}
              onChange={event => { setSourceUrlName(event.target.value) }} /></Field>
            <Field label="资料用途"><select className="story-studio-input" value={sourceUrlKind}
              onChange={event => { setSourceUrlKind(event.target.value === 'original' ? 'original' : 'reference') }}>
              <option value="reference">参考资料</option><option value="original">原著正文</option>
            </select></Field>
          </div>
          <div className="story-source-url-foot"><span>{sourceUrlKind === 'original'
            ? '原著正文会参与角色语气检索，请只用于你确认过的原作文本。'
            : '参考资料参与设定检索，但不会被当作角色原作台词。'}</span><div className="story-studio-actions">
            <button className="story-studio-button story-studio-button-primary" type="button" disabled={saving || sourceUrl.trim() === ''}
              onClick={importSourceFromUrl}>读取并导入</button>
            <button className="story-studio-button" type="button" disabled={saving} onClick={() => { setSourceUrlOpen(false) }}>取消</button>
          </div></div>
        </section>}
        {workspace.researchInbox.length > 0 && <section className="story-research-inbox">
          <div className="story-research-heading"><div><strong>研究收件箱</strong><span>网络结果不会自动成为故事事实；收为资料后才能被后续检索和引用。</span></div><span>{workspace.researchInbox.length} 条待处理</span></div>
          <div className="story-research-grid">{workspace.researchInbox.map(item => <article className="story-research-card" key={item.id}>
            <div className="story-research-card-heading"><div><span>第 {item.turn} 回合</span><h3>{item.title}</h3></div>
              <a href={item.url} target="_blank" rel="noreferrer">查看网页 ↗</a></div>
            <p>{item.snippet || '搜索服务没有返回摘要，可以先查看原网页再决定是否保留。'}</p>
            <div className="story-research-query">查询：{item.query}</div>
            <div className="story-studio-actions"><button className="story-studio-button story-studio-button-primary" type="button"
              disabled={saving || webFetchAvailable === null || webFetchAvailable === true && dirty}
              title={webFetchAvailable === true && dirty ? '先保存当前修改，再读取网页正文' : undefined}
              onClick={() => { if (webFetchAvailable === true) acceptResearchPage(item); else acceptResearchExcerpt(item) }}>
              {webFetchAvailable === null ? '正在确认正文读取…' : webFetchAvailable ? '读取正文并收为资料' : '保留当前摘录'}</button>
              {webFetchAvailable === true && <button className="story-studio-button" type="button" disabled={saving}
                onClick={() => { acceptResearchExcerpt(item) }}>只保留当前摘录</button>}
              <button className="story-studio-button" type="button" onClick={() => { dismissResearch(item.id) }}>忽略</button></div>
          </article>)}</div>
        </section>}
        <div className="story-studio-card-list">{workspace.sources.map(source => {
          const passages = splitStorySourcePassages(source)
          const citationCount = workspace.citations.filter(citation => citation.sourceId === source.id).length
          const refreshReviewCount = workspace.citations.filter(citation => citation.sourceId === source.id && citation.refreshReview !== undefined).length
          return <article className="story-studio-card" key={source.id} onClick={() => { select({ kind: 'source', id: source.id }) }}>
            <h3>{source.name}</h3><p>{passages[0]?.text.slice(0, 220) || '尚未添加内容'}</p>
            <div className="story-studio-card-meta"><span>{sourceKindLabels[source.kind]}</span><span>{passages.length} 段</span><span>{citationCount} 条引用</span>
              {refreshReviewCount > 0 && <span className="story-source-review-count">{refreshReviewCount} 条待审</span>}<span>{source.enabled ? '参与研究' : '暂不使用'}</span></div>
          </article>
        })}{workspace.sources.length === 0 && <div className="story-studio-empty"><span>添加原著章节、参考材料，或限定网络查询范围。</span></div>}</div>
      </div>
      : <SourceReader workspace={workspace} source={readerSource} selectedCitationId={selectedCitation?.id}
        busy={saving} dirty={dirty} webFetchAvailable={webFetchAvailable}
        onBack={() => { setSelection(undefined); setReaderSourceId(undefined) }} onSelectCitation={id => { setSelection({ kind: 'citation', id }) }}
        onAddCitation={passage => { addCitation(readerSource, passage) }} onEditCharacter={id => { select({ kind: 'character', id }) }}
        onRefresh={() => { refreshSourceFromUrl(readerSource) }} onResolveCitationReview={resolveCitationRefreshReview} />
  } else {
    main = <div className="story-studio-view"><div className="story-studio-view-heading"><div><h1>输出布局</h1><p>拖动卡片或使用上下按钮，决定生成和展示顺序。</p></div><button className="story-studio-button" type="button" onClick={addOutput}>＋ 添加分区</button></div>
      <div className="story-studio-card-list">{workspace.outputs.map((output, index) => <article draggable className="story-studio-card story-output-card"
        data-dragging={dragOutputId === output.id} data-selected={selection?.kind === 'output' && selection.id === output.id}
        key={output.id} onClick={() => { setSelection({ kind: 'output', id: output.id }) }}
        onDragStart={(event: DragEvent<HTMLElement>) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', output.id)
          setDragOutputId(output.id)
        }}
        onDragOver={(event: DragEvent<HTMLElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
        onDrop={(event: DragEvent<HTMLElement>) => {
          event.preventDefault()
          const sourceId = event.dataTransfer.getData('text/plain') || dragOutputId
          if (sourceId !== undefined) reorderOutputs(sourceId, output.id)
          setDragOutputId(undefined)
        }}
        onDragEnd={() => { setDragOutputId(undefined) }}>
        <span className="story-output-grip">⠿</span><div><h3>{output.name}</h3><div className="story-studio-card-meta"><span>{outputKindLabels[output.kind]}</span>
          {output.characterId !== undefined && <span>{workspace.characters.find(character => character.id === output.characterId)?.name}</span>}</div></div>
        <div className="story-output-actions"><span style={{ color: output.enabled ? 'var(--story-accent)' : 'var(--studio-muted)', fontSize: 10 }}>{output.enabled ? '启用' : '停用'}</span>
          <button aria-label={`上移 ${output.name}`} className="story-output-move" disabled={index === 0} type="button"
            onClick={event => { event.stopPropagation(); moveOutput(output.id, -1) }}>↑</button>
          <button aria-label={`下移 ${output.name}`} className="story-output-move" disabled={index === workspace.outputs.length - 1} type="button"
            onClick={event => { event.stopPropagation(); moveOutput(output.id, 1) }}>↓</button></div>
      </article>)}{workspace.outputs.length === 0 && <div className="story-studio-empty"><span>添加主正文、人物视角或前情回顾分区。</span></div>}</div>
    </div>
  }

  const views: readonly { readonly id: StudioView; readonly label: string }[] = [
    { id: 'world', label: '场地' },
    { id: 'map', label: '故事地图' },
    { id: 'timeline', label: '时间线' },
    { id: 'characters', label: '人物' },
    { id: 'sources', label: '资料' },
    { id: 'outputs', label: '输出布局' },
  ]

  return <div className="agent-rp-story-studio" role="dialog" aria-modal="true" aria-label="游玩场地"
    style={{ '--story-accent': accent } as CSSProperties}>
    <style>{xyFlowCss}</style><style>{storyStudioCss}</style>
    <input ref={sourceFileInputRef} hidden multiple type="file" accept={STORY_SOURCE_FILE_ACCEPT} disabled={workspace === undefined || saving}
      onChange={event => { void importSourceFiles(Array.from(event.target.files ?? [])) }} />
    <header className="story-studio-topbar">
      <div className="story-studio-brand"><span className="story-studio-brand-mark">✦</span><div><strong>游玩场地</strong><span>世界、人物与故事</span></div></div>
      <select className="story-studio-project" aria-label="当前场地" value={workspace?.id ?? ''} disabled={saving || items.length === 0}
        onChange={event => { changeProject(event.target.value) }}>
        {items.length === 0 && <option value="">还没有场地</option>}
        {items.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select>
      <button className="story-studio-icon-button" type="button" aria-label="新建场地" disabled={saving} onClick={createNew}>＋</button>
      <nav className="story-studio-tabs" aria-label="游玩场地视图">{views.map(item => <button className="story-studio-tab" aria-current={view === item.id ? 'page' : undefined}
        type="button" key={item.id} onClick={() => { navigate(item.id) }}>{item.label}</button>)}</nav>
      <div className="story-studio-session-launch">
        {!currentSessionUsesWorkspace && launchTargets.length > 1 && <select aria-label="会话工作区" value={launchTargetId ?? ''}
          disabled={saving} onChange={event => { setLaunchTargetId(event.target.value) }}>
          {launchTargets.map(target => <option value={target.id} key={target.id}>{target.title}</option>)}
        </select>}
        <button className="story-studio-button story-studio-button-primary" type="button"
          title={dirty ? '先保存场地修改' : launchUnavailableReason}
          disabled={workspace === undefined || saving || (!currentSessionUsesWorkspace
            && (dirty || launchTargetId === undefined || onOpenSession === undefined))}
          onClick={openInSession}>{currentSessionUsesWorkspace ? '回到会话' : '在会话中打开'}</button>
      </div>
      <button className="story-studio-button" type="button" disabled={workspace === undefined || saving || !dirty} onClick={save}>{saving ? '处理中…' : dirty ? '保存修改' : '已保存'}</button>
      <button className="story-studio-icon-button" type="button" aria-label="场地设置" disabled={workspace === undefined} onClick={() => { setSettingsOpen(true) }}>⚙</button>
      <button className="story-studio-icon-button" type="button" aria-label="关闭游玩场地" onClick={onClose}>×</button>
    </header>
    <div className="story-studio-shell" data-inspector-open={selection !== undefined && selection.kind !== 'character'}>
      {workspace !== undefined && <StudioNavigation workspace={workspace} view={view} selection={selection} setView={navigate} select={select}
        addCharacter={addCharacter} addSource={addSource} />}
      <main className="story-studio-main">{loading ? <div className="story-studio-empty">正在打开游玩场地…</div> : main}</main>
      <aside className="story-studio-inspector" data-open={selection !== undefined && selection.kind !== 'character'}>
        {selection !== undefined && selection.kind !== 'character' && <button className="story-studio-icon-button" style={{ float: 'right' }} type="button" aria-label="关闭属性面板" onClick={() => { setSelection(undefined) }}>×</button>}
        {inspector}
      </aside>
    </div>
    <footer className="story-studio-statusbar">
      <strong>作者检查器</strong><span className="story-studio-turn-progress" role="status">{storyTurnProgressText(workspace, storyTurn)}</span><StoryTurnTimingDetails workspace={workspace} progress={storyTurn} /><span>游玩与自由输入留在 DSH 会话中</span>
      {error !== undefined ? <span className="story-studio-status-error" role="alert">{error}</span>
        : notice !== undefined ? <span className="story-studio-status-message" role="status">{notice}</span>
          : dirty ? <span className="story-studio-status-message">有未保存修改</span> : undefined}
    </footer>
    {settingsOpen && workspace !== undefined && <>
      <button className="story-studio-drawer-backdrop" type="button" aria-label="关闭设置" onClick={() => { setSettingsOpen(false) }} />
      <aside className="story-studio-drawer" aria-label="场地设置">
        <div className="story-studio-drawer-header"><h2>场地设置</h2><button className="story-studio-icon-button" type="button" onClick={() => { setSettingsOpen(false) }}>×</button></div>
        <TextField label="场地名称" rows={1} value={workspace.name} onChange={value => { update(current => ({ ...current, name: value })) }} />
        <hr className="story-studio-divider" />
        <h3 style={{ fontSize: 13 }}>当前会话</h3>
        <p style={{ color: 'var(--studio-muted)', fontSize: 11, lineHeight: 1.5 }}>{sessionId === undefined ? '打开一个 Agent RP 角色会话后，可以让每轮生成使用这个故事。' : '连接后，下一轮会按人物认知、剧情节点、资料和输出布局运行。'}</p>
        <div className="story-studio-actions">
          <button className="story-studio-button story-studio-button-primary" type="button" disabled={sessionId === undefined || saving}
            onClick={() => { selectForSession(workspace.id) }}>连接这个故事</button>
          <button className="story-studio-button" type="button" disabled={sessionId === undefined || saving}
            onClick={() => { selectForSession(null) }}>停止使用</button>
        </div>
        <hr className="story-studio-divider" />
        <h3 style={{ fontSize: 13 }}>执行设置</h3>
        <Field label="同阶段最大并发"><input className="story-studio-input" type="number" min={1} max={8} value={workspace.pipeline.maxParallel}
          onChange={event => { update(current => ({ ...current, pipeline: { ...current.pipeline, maxParallel: Number(event.target.value) } })) }} /></Field>
        <Field label="研究最多轮数"><input className="story-studio-input" type="number" min={1} max={4} value={workspace.pipeline.researchMaxPasses}
          onChange={event => { update(current => ({ ...current, pipeline: { ...current.pipeline, researchMaxPasses: Number(event.target.value) } })) }} /></Field>
        <Field label="对白起草推理"><select className="story-studio-input" value={workspace.pipeline.voiceDraftReasoning}
          onChange={event => { update(current => ({ ...current, pipeline: {
            ...current.pipeline,
            voiceDraftReasoning: event.target.value === 'quality' ? 'quality' : 'routine',
          } })) }}>
          <option value="routine">精简（支持时关闭推理）</option>
          <option value="quality">质量（跟随会话）</option>
        </select></Field>
        <Field label="Worker provider（留空则跟随会话）"><input className="story-studio-input" value={workspace.pipeline.workerModel?.provider ?? ''}
          onChange={event => { update(current => ({ ...current, pipeline: { ...current.pipeline, workerModel: {
            provider: event.target.value,
            model: current.pipeline.workerModel?.model ?? '',
          } } })) }} /></Field>
        <Field label="Worker model（留空则跟随会话）"><input className="story-studio-input" value={workspace.pipeline.workerModel?.model ?? ''}
          onChange={event => { update(current => ({ ...current, pipeline: { ...current.pipeline, workerModel: {
            provider: current.pipeline.workerModel?.provider ?? '',
            model: event.target.value,
          } } })) }} /></Field>
        <p style={{ color: 'var(--studio-muted)', fontSize: 10, lineHeight: 1.5 }}>研究先读取本地证据，再按需要追查；人物、导演、分区与编辑按需运行，同阶段的人物和分区可以并行。对白的精简模式在模型明确支持时关闭推理，否则保持会话设置；质量模式跟随会话。</p>
        <hr className="story-studio-divider" />
        <button className="story-studio-button story-studio-danger" type="button" disabled={saving} onClick={removeWorkspace}>{deleteArmed ? '再次点击，确认删除故事' : '删除这个故事'}</button>
      </aside>
    </>}
  </div>
}
