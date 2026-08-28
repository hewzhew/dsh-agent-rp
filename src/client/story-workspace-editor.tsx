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
import {
  FLYING_CHESS_WORLD_MODULE_ID,
  isFlyingChessWorldState,
  type FlyingChessPiece,
  type FlyingChessWorldAction,
  type FlyingChessWorldState,
} from '../flying-chess-protocol.ts'
import {
  PLAY_WORLD_MODULES_PATH,
  type PlayWorldModuleDescriptor,
  type PlayWorldEvent,
} from '../play-world-protocol.ts'
import {
  ROLEPLAY_RESOURCE_CATALOG_PATH,
  type RoleplayResourceDescriptor,
} from '../roleplay-resource-catalog-protocol.ts'
import {
  STORY_WORKSPACES_PATH,
  type StoryCitation,
  type StoryCharacter,
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
  type StoryWorkspaceSnapshot,
  type StoryWorkspaceSummary,
} from '../story-workspace-protocol.ts'
import {
  acceptStorySuggestionBatch,
  rejectStorySuggestionBatch,
  storySuggestionBatch,
} from '../story-suggestion-batch.ts'
import { splitStorySourcePassages, type StorySourcePassage } from '../story-source.ts'
import { resolveStoryTurnRequest } from '../story-turn-request.ts'
import { executeAgentRpCommand } from './agent-rp-command.ts'
import { createClientOpaqueUuid } from './client-opaque-id.ts'
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
  readonly launchSourceSessionId?: string
  readonly onStartSession?: (sourceSessionId: string, workspaceId: string, request: string) => Promise<void>
  readonly onContinueSession?: (sessionId: string, workspaceId: string, request: string) => Promise<void>
  readonly onClose: () => void
}

interface StoryWorkspaceResponse {
  readonly format?: number
  readonly workspace?: StoryWorkspaceSnapshot
  readonly workspaces?: readonly StoryWorkspaceSummary[]
  readonly error?: string
}

interface PlayWorldModulesResponse {
  readonly format?: number
  readonly modules?: readonly PlayWorldModuleDescriptor[]
  readonly error?: string
}

interface RoleplayResourcesResponse {
  readonly format?: number
  readonly entries?: readonly RoleplayResourceDescriptor[]
  readonly error?: string
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

async function readWorkspace(id: string): Promise<StoryWorkspaceSnapshot> {
  const value = await storyRequest(`/${encodeURIComponent(id)}`)
  if (value.workspace === undefined) throw new Error('游玩场地读取响应无效')
  return value.workspace
}

async function createWorkspace(name: string): Promise<StoryWorkspaceSnapshot> {
  const value = await storyRequest('', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ format: 2, name }),
  })
  if (value.workspace === undefined) throw new Error('游玩场地创建响应无效')
  return value.workspace
}

async function saveWorkspace(workspace: StoryWorkspaceSnapshot): Promise<StoryWorkspaceSnapshot> {
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
  if (value.workspace === undefined) throw new Error('游玩场地保存响应无效')
  return value.workspace
}

async function listPlayWorldModules(): Promise<readonly PlayWorldModuleDescriptor[]> {
  const response = await fetch(PLAY_WORLD_MODULES_PATH, { headers: { accept: 'application/json' } })
  const value = await response.json() as PlayWorldModulesResponse
  if (!response.ok) throw new Error(value.error ?? `世界模块请求失败（${response.status}）`)
  if (value.format !== 0 || !Array.isArray(value.modules)) throw new Error('世界模块列表响应无效')
  return value.modules
}

async function listActorResources(): Promise<readonly RoleplayResourceDescriptor[]> {
  const response = await fetch(ROLEPLAY_RESOURCE_CATALOG_PATH, { headers: { accept: 'application/json' } })
  const value = await response.json() as RoleplayResourcesResponse
  if (!response.ok) throw new Error(value.error ?? `角色资源请求失败（${response.status}）`)
  if (value.format !== 0 || !Array.isArray(value.entries)) throw new Error('角色资源列表响应无效')
  return value.entries.filter(entry => entry.kind === 'actor' && entry.availability === 'available')
}

async function installPlayWorld(workspace: StoryWorkspaceSnapshot, moduleId: string): Promise<StoryWorkspaceSnapshot> {
  const value = await storyRequest(`/${encodeURIComponent(workspace.id)}/world`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ format: 0, revision: workspace.revision, moduleId }),
  })
  if (value.workspace === undefined) throw new Error('世界模块安装响应无效')
  return value.workspace
}

async function restartPlayWorld(workspace: StoryWorkspaceSnapshot): Promise<StoryWorkspaceSnapshot> {
  const value = await storyRequest(`/${encodeURIComponent(workspace.id)}/world/restart`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ format: 0, revision: workspace.revision }),
  })
  if (value.workspace === undefined) throw new Error('世界重新开局响应无效')
  return value.workspace
}

async function dispatchPlayWorldAction(workspace: StoryWorkspaceSnapshot, action: FlyingChessWorldAction): Promise<StoryWorkspaceSnapshot> {
  const value = await storyRequest(`/${encodeURIComponent(workspace.id)}/world/actions`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ format: 0, revision: workspace.revision, action }),
  })
  if (value.workspace === undefined) throw new Error('世界动作响应无效')
  return value.workspace
}

async function bindStoryCharacterActor(
  workspace: StoryWorkspaceSnapshot,
  characterId: string,
  actorId?: string,
): Promise<StoryWorkspaceSnapshot> {
  const value = await storyRequest(`/${encodeURIComponent(workspace.id)}/characters/${encodeURIComponent(characterId)}/actor`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      format: 0,
      revision: workspace.revision,
      characterId,
      ...(actorId === undefined ? {} : { actor: { kind: 'actor' as const, id: actorId } }),
    }),
  })
  if (value.workspace === undefined) throw new Error('人物角色卡绑定响应无效')
  return value.workspace
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

function CharacterWorkspaceView({ workspace, character, actorResources, busy, dirty, update, perspectiveId, previewId, setPerspectiveId, setPreviewId, openStoryMap, onBindActor, onDelete, selectEvent, addCharacter }: {
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
  readonly onBindActor: (characterId: string, actorId?: string) => void
  readonly onDelete: (id: string) => void
  readonly selectEvent: (id: string) => void
  readonly addCharacter: () => void
}) {
  const [tab, setTab] = useState<'profile' | 'state' | 'knowledge' | 'agent'>('profile')
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
    update(current => ({
      ...current,
      facts: current.facts.filter(fact => fact.id !== factId),
      citations: current.citations.map(citation => citation.target?.kind === 'fact' && citation.target.factId === factId
        ? citationWithoutTarget(citation) : citation),
    }))
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
            onChange={event => { onBindActor(character.id, event.target.value === '' ? undefined : event.target.value) }}>
            <option value="">手写人物</option>{actorResources.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
          </select></Field>
          {dirty && <p className="story-studio-inline-note">保存当前修改后即可更换角色卡来源。</p>}
          <TextField label="人物名称" rows={1} value={character.name} onChange={value => { patchCharacter(current => ({ ...current, name: value })) }} />
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
    {citations.length > 0 && <div className="story-timeline-rule-sources"><strong>本回合研究依据</strong>
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
    <div className="story-event-observations"><strong>由此事件形成的认知</strong>
      {observations.map(fact => <div className="story-event-observation-editor" key={fact.id}>
        <textarea aria-label="事件人物事实" className="story-studio-input" rows={3} value={fact.text}
          onChange={change => { patchObservation(fact.id, current => ({ ...current, text: change.target.value })) }} />
        <div className="story-studio-checks">{workspace.characters.map(character => <label className="story-studio-check" key={character.id}>
          <input type="checkbox" checked={fact.knownBy.includes(character.id)}
            onChange={change => { toggleObserver(fact, character.id, change.target.checked) }} />{character.name}
        </label>)}</div>
      </div>)}
      {observations.length === 0 && <p>这次事件还没有形成可供人物使用的观察。</p>}
      <button className="story-studio-button" type="button" onClick={onOpenKnowledge}>在认知矩阵中核对</button>
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
      onChange={event => { patch(current => ({ ...current, sourceId: event.target.value })) }}>
      {workspace.sources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></Field>
    <TextField label="原文位置" rows={1} value={citation.locator} onChange={value => { patch(current => ({ ...current, locator: value })) }} />
    <TextField label="引用原文快照" rows={8} value={citation.quote} onChange={value => { patch(current => ({ ...current, quote: value })) }} />
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

function SourceReader({ workspace, source, selectedCitationId, onBack, onSelectCitation, onAddCitation }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly source: StorySource
  readonly selectedCitationId: string | undefined
  readonly onBack: () => void
  readonly onSelectCitation: (id: string) => void
  readonly onAddCitation: (passage: StorySourcePassage) => void
}) {
  const passages = splitStorySourcePassages(source)
  const citations = workspace.citations.filter(citation => citation.sourceId === source.id)
  return <div className="story-source-reader">
    <div className="story-studio-view-heading"><div><button className="story-source-back" type="button" onClick={onBack}>← 资料库</button>
      <h1>{source.name}</h1><p>{sourceKindLabels[source.kind]} · {passages.length} 段 · {citations.length} 条引用</p></div></div>
    {citations.length > 0 && <div className="story-source-citations"><strong>已保存引用</strong><div>
      {citations.map(citation => <button className="story-citation-chip" data-selected={selectedCitationId === citation.id}
        key={citation.id} type="button" onClick={() => { onSelectCitation(citation.id) }}>
        <span>{citation.locator}</span><small>{citation.target === undefined ? '未关联'
          : citation.target.kind === 'node' ? '剧情节点' : citation.target.kind === 'fact' ? '人物事实' : '故事事件'}</small>
      </button>)}
    </div></div>}
    <div className="story-source-passages">{passages.map(passage => {
      const passageCitations = citations.filter(citation => citation.locator === passage.locator && citation.quote === passage.text)
      return <div className="story-source-passage" key={`${source.id}:${String(passage.ordinal)}`}>
        <div className="story-source-passage-heading"><span>{passage.locator}</span><button className="story-source-cite-button" type="button"
          onClick={() => { onAddCitation(passage) }}>引用此段</button></div>
        <p>{passage.text}</p>
        {passageCitations.length > 0 && <div className="story-source-passage-actions">{passageCitations.map(citation => <button className="story-citation-link" key={citation.id}
          type="button" onClick={() => { onSelectCitation(citation.id) }}>查看引用</button>)}</div>}
      </div>
    })}{passages.length === 0 && <div className="story-studio-empty"><span>在右侧加入原文或研究内容，阅读器会按标题和自然段整理。</span></div>}</div>
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
      <option value="">全部参与人物</option>{workspace.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
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
      {workspace.sources.slice(0, 8).map(source => <button key={source.id} className="story-studio-nav-item"
        data-active={selection?.kind === 'source' && selection.id === source.id} type="button" onClick={() => { select({ kind: 'source', id: source.id }) }}>
        <span className="story-studio-nav-icon">▤</span><span>{source.name}</span>
      </button>)}
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

function FlyingChessPlayView({ workspace, state, busy, dirty, sessionAction, onAdvanceSession, onRestart, onAction }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly state: FlyingChessWorldState
  readonly busy: boolean
  readonly dirty: boolean
  readonly sessionAction: 'start' | 'continue' | undefined
  readonly onAdvanceSession: (request: string) => void
  readonly onRestart: () => void
  readonly onAction: (action: FlyingChessWorldAction) => void
}) {
  const [restartArmed, setRestartArmed] = useState(false)
  const [turnDirection, setTurnDirection] = useState('')
  const name = (id: string): string => workspace.characters.find(character => character.id === id)?.name ?? id
  const currentName = name(state.currentPlayerId)
  const latestEvent = workspace.world?.events.at(-1)
  return <div className="story-play-view">
    <div className="story-play-heading"><div><span>可执行世界 · 第 {state.turn} 回合</span><h1>幻想乡飞行棋</h1>
      <p>棋盘是权威状态；正文和 Agent 只能读取投影，不能靠叙述改写棋子位置。</p></div>
      <div className="story-play-turn"><small>{state.winnerId === undefined ? '当前行动' : '棋局结束'}</small><strong>{state.winnerId === undefined ? currentName : `${name(state.winnerId)}获胜`}</strong>
        <div className="story-play-turn-actions">
          {state.winnerId === undefined && state.pendingRoll === undefined && <button className="story-studio-button" type="button"
            disabled={busy || dirty} onClick={() => { onAction({ type: 'roll', actorId: state.currentPlayerId }) }}>亲自掷骰</button>}
          {state.pendingRoll !== undefined && <span className="story-die" aria-label={`骰点 ${state.pendingRoll.value}`}>{state.pendingRoll.value}</span>}
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
    {sessionAction !== undefined && <section className="story-play-session-action">
      <div className="story-play-session-copy"><strong>{sessionAction === 'start' ? '让人物开始第一回合' : `让${currentName}行动`}</strong>
        <span>{latestEvent === undefined ? '当前人物只会从规则程序给出的合法动作中选择；结算后再写成场面。' : `从“${latestEvent.title}”之后继续，由规则程序结算下一步。`}</span></div>
      <label className="story-play-session-input"><span>希望这一回合怎样发展？</span><textarea value={turnDirection} maxLength={4_000}
        placeholder="可以留空，让当前人物依据自己的认知选择；也可以补充一句方向。"
        onChange={event => { setTurnDirection(event.target.value) }} /></label>
      <button className="story-studio-button story-studio-button-primary" type="button" disabled={busy || dirty}
        onClick={() => { onAdvanceSession(resolveStoryTurnRequest(workspace, turnDirection)) }}>
        {sessionAction === 'start' ? '开始游玩' : `让${currentName}行动并续写`}
      </button>
    </section>}
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
            const legal = state.pendingRoll?.legalPieceIds.includes(piece.id) ?? false
            const location = piece.status === 'base' ? '基地' : piece.status === 'home' ? '已到达' : `航线 ${piece.steps}`
            return <button type="button" key={piece.id} data-legal={legal} disabled={!legal || busy || dirty}
              onClick={() => { onAction({ type: 'move', actorId: playerId, pieceId: piece.id }) }}>
              <span>{piece.number}</span><small>{location}</small>{legal && <b>亲自移动</b>}
            </button>
          })}</div>
        </section>
      })}</div>
    </div>
    <section className="story-world-events"><div><strong>世界事件</strong><span>由规则执行产生，可供时间线和 Agent 读取。</span></div>
      {[...(workspace.world?.events ?? [])].reverse().slice(0, 10).map(item => <article key={item.id}><span>{item.sequence}</span><div><strong>{item.title}</strong><p>{item.summary}</p></div></article>)}
    </section>
  </div>
}

function PlayWorldView({ workspace, modules, busy, dirty, sessionAction, onAdvanceSession, onInstall, onRestart, onAction }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly modules: readonly PlayWorldModuleDescriptor[]
  readonly busy: boolean
  readonly dirty: boolean
  readonly sessionAction: 'start' | 'continue' | undefined
  readonly onAdvanceSession: (request: string) => void
  readonly onInstall: (moduleId: string) => void
  readonly onRestart: () => void
  readonly onAction: (action: FlyingChessWorldAction) => void
}) {
  if (workspace.world === undefined) {
    return <div className="story-studio-view"><div className="story-studio-view-heading"><div><h1>选择一个世界</h1>
      <p>世界模块承载规则、状态、动作和事件；普通世界书仍可只提供提示词资料。</p></div></div>
      <div className="story-world-module-grid">{modules.map(module => {
        const ready = workspace.characters.length >= module.minCharacters && workspace.characters.length <= module.maxCharacters
        return <article className="story-world-module-card" key={module.id}><span>{module.category === 'game' ? '游戏' : '模拟'}</span><h2>{module.name}</h2>
          <p>{module.summary}</p><small>需要 {module.minCharacters}–{module.maxCharacters} 位人物 · 当前 {workspace.characters.length} 位</small>
          <button className="story-studio-button story-studio-button-primary" type="button" disabled={!ready || busy || dirty}
            onClick={() => { onInstall(module.id) }}>{ready ? '装入这个世界' : '先补齐人物'}</button></article>
      })}{modules.length === 0 && <div className="story-studio-empty">当前没有已安装的世界模块。</div>}</div>
    </div>
  }
  if (workspace.world.moduleId === FLYING_CHESS_WORLD_MODULE_ID && isFlyingChessWorldState(workspace.world.state)) {
    return <FlyingChessPlayView workspace={workspace} state={workspace.world.state} busy={busy} dirty={dirty}
      sessionAction={sessionAction} onAdvanceSession={onAdvanceSession} onRestart={onRestart} onAction={onAction} />
  }
  return <div className="story-studio-empty"><strong>{workspace.world.title}</strong><span>这个世界模块尚未提供原生场地视图。</span></div>
}

/** Full-screen play space backed by typed story and executable-world state. */
export function StoryWorkspaceEditor({ accent, initialWorkspaceId, sessionId, launchSourceSessionId, onStartSession, onContinueSession, onClose }: StoryWorkspaceEditorProps) {
  const [items, setItems] = useState<readonly StoryWorkspaceSummary[]>([])
  const [worldModules, setWorldModules] = useState<readonly PlayWorldModuleDescriptor[]>([])
  const [actorResources, setActorResources] = useState<readonly RoleplayResourceDescriptor[]>([])
  const [workspace, setWorkspace] = useState<StoryWorkspaceSnapshot>()
  const [view, setView] = useState<StudioView>('world')
  const [selection, setSelection] = useState<StudioSelection>()
  const [readerSourceId, setReaderSourceId] = useState<string>()
  const [perspectiveId, setPerspectiveId] = useState<string>()
  const [previewId, setPreviewId] = useState<string>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [dragOutputId, setDragOutputId] = useState<string>()
  const sourceFileInputRef = useRef<HTMLInputElement>(null)

  const load = async (id: string): Promise<void> => {
    const next = await readWorkspace(id)
    setWorkspace(next)
    setDirty(false)
    setSelection(undefined)
    setReaderSourceId(undefined)
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
      setSelection(undefined)
      setReaderSourceId(undefined)
      return
    }
    await load(id)
  }
  useEffect(() => {
    let active = true
    setLoading(true)
    void Promise.all([listWorkspaces(), listPlayWorldModules(), listActorResources()]).then(async ([next, modules, actors]) => {
      const selectedId = initialWorkspaceId !== undefined && next.some(item => item.id === initialWorkspaceId)
        ? initialWorkspaceId
        : next[0]?.id
      const selected = selectedId === undefined ? undefined : await readWorkspace(selectedId)
      if (!active) return
      setItems(next)
      setWorldModules(modules)
      setActorResources(actors)
      setWorkspace(selected)
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
      setWorkspace(created)
      setDirty(false)
      setSelection(undefined)
      setReaderSourceId(undefined)
      setView('world')
      setNotice('新场地已经准备好')
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const save = (): void => {
    if (workspace === undefined) return
    setSaving(true)
    setError(undefined)
    void saveWorkspace(workspace).then(async saved => {
      setWorkspace(saved)
      setItems(await listWorkspaces())
      setDirty(false)
      setNotice('所有修改已保存')
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const installWorld = (moduleId: string): void => {
    if (workspace === undefined || dirty) return
    setSaving(true)
    setError(undefined)
    void installPlayWorld(workspace, moduleId).then(async saved => {
      setWorkspace(saved)
      setItems(await listWorkspaces())
      setView('world')
      setNotice(`${saved.world?.title ?? '世界'}已经装入场地`)
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const restartWorld = (): void => {
    if (workspace === undefined || workspace.world === undefined || dirty) return
    setSaving(true)
    setError(undefined)
    void restartPlayWorld(workspace).then(async saved => {
      setWorkspace(saved)
      setItems(await listWorkspaces())
      setView('world')
      setNotice(`${saved.world?.title ?? '世界'}已经重新开局；旧局事件与临时状态已清空`)
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const runWorldAction = (action: FlyingChessWorldAction): void => {
    if (workspace === undefined || dirty) return
    setSaving(true)
    setError(undefined)
    void dispatchPlayWorldAction(workspace, action).then(async saved => {
      setWorkspace(saved)
      setItems(await listWorkspaces())
      setNotice(action.type === 'roll' ? '骰点已经记录' : '棋子已经移动')
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const bindActor = (characterId: string, actorId?: string): void => {
    if (workspace === undefined || dirty) return
    setSaving(true)
    setError(undefined)
    void bindStoryCharacterActor(workspace, characterId, actorId).then(async saved => {
      setWorkspace(saved)
      setItems(await listWorkspaces())
      setNotice(actorId === undefined ? '人物已经改为手写档案' : '角色卡已经绑定到本局人物')
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const advanceSession = (request: string): void => {
    if (workspace === undefined || dirty) return
    setSaving(true)
    setError(undefined)
    const pending = launchSourceSessionId !== undefined && onStartSession !== undefined
      ? onStartSession(launchSourceSessionId, workspace.id, request)
      : sessionId !== undefined && onContinueSession !== undefined
        ? onContinueSession(sessionId, workspace.id, request)
        : undefined
    if (pending === undefined) {
      setSaving(false)
      return
    }
    void pending.then(() => {
      onClose()
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
  const acceptResearch = (item: StoryResearchItem): void => {
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
    main = <PlayWorldView workspace={workspace} modules={worldModules} busy={saving} dirty={dirty}
      sessionAction={launchSourceSessionId !== undefined && onStartSession !== undefined
        ? 'start'
        : sessionId !== undefined && onContinueSession !== undefined ? 'continue' : undefined}
      onAdvanceSession={advanceSession}
      onInstall={installWorld} onRestart={restartWorld} onAction={runWorldAction} />
  } else if (view === 'map') {
    main = <StoryMap workspace={workspace} selection={selection} perspectiveId={perspectiveId} update={update} setSelection={setSelection}
      clearPerspective={() => { setPerspectiveId(undefined) }} />
  } else if (view === 'timeline') {
    const events = [...workspace.events].sort((left, right) => left.turn - right.turn)
    const representedWorldSequences = new Set(events.flatMap(event => event.worldEventSequences ?? []))
    const pendingWorldEvents = (workspace.world?.events ?? []).filter(event => !representedWorldSequences.has(event.sequence))
    main = <div className="story-studio-view"><div className="story-studio-view-heading"><div><h1>事件时间线</h1><p>按正文回合整理已经发生的情节，并保留可追溯的规则来源。</p></div></div>
      <div className="story-studio-card-list">
        {pendingWorldEvents.length > 0 && <section className="story-timeline-pending"><div className="story-timeline-section-heading"><div><strong>独立规则记录</strong><span>尚未关联正文回合的场地事件。</span></div><b>{pendingWorldEvents.length}</b></div>
          <div className="story-timeline-world-grid">{pendingWorldEvents.map(worldEvent => <button type="button" className="story-timeline-world-card"
            data-selected={selection?.kind === 'world-event' && selection.id === worldEvent.id} key={worldEvent.id}
            onClick={() => { setSelection({ kind: 'world-event', id: worldEvent.id }) }}>
            <span>#{worldEvent.sequence}</span><div><strong>{worldEvent.title}</strong><small>{worldEvent.summary}</small></div>
          </button>)}</div></section>}
        {events.map(event => {
        const batch = storySuggestionBatch(workspace, event.id)
        const pending = batch.nodeIds.length + batch.edgeIds.length
        const worldEvents = (event.worldEventSequences ?? []).flatMap(sequence => {
          const worldEvent = workspace.world?.events.find(candidate => candidate.sequence === sequence)
          return worldEvent === undefined ? [] : [worldEvent]
        })
        return <article className="story-studio-card" data-selected={selection?.kind === 'event' && selection.id === event.id}
          key={event.id} onClick={() => { setSelection({ kind: 'event', id: event.id }) }}>
          <h3>第 {event.turn} 回合 · {event.title}</h3><p>{event.summary}</p>
          {worldEvents.length > 0 && <div className="story-timeline-world-links"><span>规则来源</span>{worldEvents.map(worldEvent => <button type="button" key={worldEvent.id}
            onClick={click => { click.stopPropagation(); setSelection({ kind: 'world-event', id: worldEvent.id }) }}>
            <b>#{worldEvent.sequence}</b>{worldEvent.title}
          </button>)}</div>}
          <div className="story-studio-card-meta"><span>{event.participantIds.map(id => workspace.characters.find(character => character.id === id)?.name).filter(Boolean).join(' · ') || '未标注参与人物'}</span>
            <span>{workspace.facts.filter(fact => fact.source.kind === 'event' && fact.source.eventId === event.id).length} 条人物观察</span>
            {pending > 0 && <span>{pending} 项候选变更</span>}
            {event.nodeId !== undefined && <span>关联：{workspace.graph.nodes.find(node => node.id === event.nodeId)?.title ?? '剧情节点'}</span>}</div>
        </article>
      })}{events.length === 0 && pendingWorldEvents.length === 0 && <div className="story-studio-empty"><span>人物或世界产生事件后，会在这里组成可追溯的时间线。</span></div>}</div>
    </div>
  } else if (view === 'characters') {
    main = <CharacterWorkspaceView workspace={workspace} character={activeCharacter} actorResources={actorResources} busy={saving} dirty={dirty} update={update}
      perspectiveId={perspectiveId} previewId={previewId} setPerspectiveId={setPerspectiveId} setPreviewId={setPreviewId}
      openStoryMap={() => { navigate('map') }}
      onBindActor={bindActor} onDelete={deleteCharacter} selectEvent={id => { select({ kind: 'event', id }) }} addCharacter={addCharacter} />
  } else if (view === 'sources') {
    main = readerSource === undefined
      ? <div className="story-studio-view"><div className="story-studio-view-heading"><div><h1>原著与研究资料</h1><p>按章节翻阅原文，把准确段落连接到剧情和人物事实。</p></div><div className="story-studio-actions">
        <input ref={sourceFileInputRef} hidden multiple type="file" accept={STORY_SOURCE_FILE_ACCEPT} onChange={event => {
          void importSourceFiles(Array.from(event.target.files ?? []))
        }} />
        <button className="story-studio-button story-studio-button-primary" type="button" disabled={saving}
          onClick={() => { sourceFileInputRef.current?.click() }}>导入 TXT / Markdown</button>
        <button className="story-studio-button" type="button" onClick={addSource}>＋ 空白资料</button>
      </div></div>
        {workspace.researchInbox.length > 0 && <section className="story-research-inbox">
          <div className="story-research-heading"><div><strong>研究收件箱</strong><span>网络结果不会自动成为故事事实；收为资料后才能被后续检索和引用。</span></div><span>{workspace.researchInbox.length} 条待处理</span></div>
          <div className="story-research-grid">{workspace.researchInbox.map(item => <article className="story-research-card" key={item.id}>
            <div className="story-research-card-heading"><div><span>第 {item.turn} 回合</span><h3>{item.title}</h3></div>
              <a href={item.url} target="_blank" rel="noreferrer">查看网页 ↗</a></div>
            <p>{item.snippet || '搜索服务没有返回摘要，可以先查看原网页再决定是否保留。'}</p>
            <div className="story-research-query">查询：{item.query}</div>
            <div className="story-studio-actions"><button className="story-studio-button story-studio-button-primary" type="button"
              onClick={() => { acceptResearch(item) }}>收为资料</button>
              <button className="story-studio-button" type="button" onClick={() => { dismissResearch(item.id) }}>忽略</button></div>
          </article>)}</div>
        </section>}
        <div className="story-studio-card-list">{workspace.sources.map(source => {
          const passages = splitStorySourcePassages(source)
          const citationCount = workspace.citations.filter(citation => citation.sourceId === source.id).length
          return <article className="story-studio-card" key={source.id} onClick={() => { select({ kind: 'source', id: source.id }) }}>
            <h3>{source.name}</h3><p>{passages[0]?.text.slice(0, 220) || '尚未添加内容'}</p>
            <div className="story-studio-card-meta"><span>{sourceKindLabels[source.kind]}</span><span>{passages.length} 段</span><span>{citationCount} 条引用</span><span>{source.enabled ? '参与研究' : '暂不使用'}</span></div>
          </article>
        })}{workspace.sources.length === 0 && <div className="story-studio-empty"><span>添加原著章节、参考材料，或限定网络查询范围。</span></div>}</div>
      </div>
      : <SourceReader workspace={workspace} source={readerSource} selectedCitationId={selectedCitation?.id}
        onBack={() => { setSelection(undefined); setReaderSourceId(undefined) }} onSelectCitation={id => { setSelection({ kind: 'citation', id }) }}
        onAddCitation={passage => { addCitation(readerSource, passage) }} />
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
      <strong>回合写作</strong><span>查找资料 → 人物行动 → 整理场面 → 写作 → 润色</span><span>{sessionId === undefined ? '从空白会话开始游玩' : '可以在当前会话继续'}</span>
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
          <option value="routine">平衡（支持时使用 Low）</option>
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
        <p style={{ color: 'var(--studio-muted)', fontSize: 10, lineHeight: 1.5 }}>研究先读取本地证据，再按需要追查；人物、导演、分区与编辑保持阶段顺序，同阶段的人物和分区可以并行。对白的平衡模式只在模型明确支持时使用 Low，否则保持会话设置。</p>
        <hr className="story-studio-divider" />
        <button className="story-studio-button story-studio-danger" type="button" disabled={saving} onClick={removeWorkspace}>{deleteArmed ? '再次点击，确认删除故事' : '删除这个故事'}</button>
      </aside>
    </>}
  </div>
}
