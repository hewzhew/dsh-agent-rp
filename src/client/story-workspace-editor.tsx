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
  useState,
} from 'react'
import xyFlowCss from '@xyflow/react/dist/style.css?raw'
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
  type StorySource,
  type StorySourceKind,
  type StoryWorkspaceSnapshot,
  type StoryWorkspaceSummary,
} from '../story-workspace-protocol.ts'
import { splitStorySourcePassages, type StorySourcePassage } from '../story-source.ts'
import { executeAgentRpCommand } from './agent-rp-command.ts'
import { createClientOpaqueUuid } from './client-opaque-id.ts'
import storyStudioCss from './story-workspace-editor.css?raw'

interface StoryWorkspaceEditorProps {
  readonly accent: string
  readonly sessionId?: string
  readonly onClose: () => void
}

interface StoryWorkspaceResponse {
  readonly format?: number
  readonly workspace?: StoryWorkspaceSnapshot
  readonly workspaces?: readonly StoryWorkspaceSummary[]
  readonly error?: string
}

type StudioView = 'map' | 'timeline' | 'characters' | 'sources' | 'outputs'

type StudioSelection =
  | { readonly kind: 'node'; readonly id: string }
  | { readonly kind: 'edge'; readonly id: string }
  | { readonly kind: 'character'; readonly id: string }
  | { readonly kind: 'event'; readonly id: string }
  | { readonly kind: 'source'; readonly id: string }
  | { readonly kind: 'citation'; readonly id: string }
  | { readonly kind: 'output'; readonly id: string }

interface StoryCanvasNodeData extends Record<string, unknown> {
  readonly kind: StoryNodeKind
  readonly lifecycle: StoryNode['lifecycle']
  readonly status: StoryNode['status']
  readonly title: string
  readonly people: string
}

type StoryCanvasNode = Node<StoryCanvasNodeData, 'story'>
type StoryCanvasEdge = Edge<{ readonly kind: StoryEdgeKind }>
type UpdateWorkspace = (transform: (current: StoryWorkspaceSnapshot) => StoryWorkspaceSnapshot) => void

const nodeKindLabels: Readonly<Record<StoryNodeKind, string>> = {
  arc: '篇章',
  beat: '剧情',
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
  contains: '属于',
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
    throw new Error(`故事工作室响应无法识别（${response.status}）`)
  }
  if (!response.ok) throw new Error(value.error ?? `故事工作室请求失败（${response.status}）`)
  if (value.format !== 1) throw new Error('故事工作室响应版本无效')
  return value
}

async function listWorkspaces(): Promise<readonly StoryWorkspaceSummary[]> {
  const value = await storyRequest()
  if (!Array.isArray(value.workspaces)) throw new Error('故事工作室列表响应无效')
  return value.workspaces
}

async function readWorkspace(id: string): Promise<StoryWorkspaceSnapshot> {
  const value = await storyRequest(`/${encodeURIComponent(id)}`)
  if (value.workspace === undefined) throw new Error('故事工作室读取响应无效')
  return value.workspace
}

async function createWorkspace(name: string): Promise<StoryWorkspaceSnapshot> {
  const value = await storyRequest('', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ format: 1, name }),
  })
  if (value.workspace === undefined) throw new Error('故事工作室创建响应无效')
  return value.workspace
}

async function saveWorkspace(workspace: StoryWorkspaceSnapshot): Promise<StoryWorkspaceSnapshot> {
  const value = await storyRequest(`/${encodeURIComponent(workspace.id)}`, {
    method: 'PUT',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      format: 1,
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
    }),
  })
  if (value.workspace === undefined) throw new Error('故事工作室保存响应无效')
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
    {data.people !== '' && <div className="story-canvas-node-people">{data.people}</div>}
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
  const facts = workspace.facts.filter(fact => fact.status !== 'refuted' && fact.knownBy.includes(character.id))
    .map(fact => {
      const citations = workspace.citations.filter(citation => citation.target?.kind === 'fact' && citation.target.factId === fact.id)
      return [`- ${fact.status === 'uncertain' ? '[不确定] ' : ''}${fact.text}`,
        ...citations.map(citation => `  - 依据：${citationSourceLabel(workspace, citation)} — ${citation.quote}`)].join('\n')
    }).join('\n')
  return [
    `# 人物：${character.name}`,
    '## Persona',
    character.persona,
    '## 此人物已经知道的事实',
    facts,
    '## 本轮玩家输入',
    '（将在生成时填入）',
  ].join('\n\n')
}

function NodeInspector({ workspace, node, update, onSelect, onDelete }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly node: StoryNode
  readonly update: UpdateWorkspace
  readonly onSelect: (selection: StudioSelection | undefined) => void
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
  return <>
    <h2>{node.title}</h2>
    <div className="story-studio-inspector-subtitle">{nodeKindLabels[node.kind]} · {node.lifecycle === 'suggested' ? '候选变更' : '正式故事数据'}</div>
    {node.lifecycle === 'suggested' && <div className="story-studio-actions" style={{ marginBottom: 14 }}>
      <button className="story-studio-button story-studio-button-primary" type="button"
        onClick={() => { patch(value => ({ ...value, lifecycle: 'canonical' })) }}>接受建议</button>
      <button className="story-studio-button" type="button" onClick={onDelete}>拒绝</button>
    </div>}
    <TextField label="标题" rows={1} value={node.title} onChange={value => { patch(current => ({ ...current, title: value })) }} />
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
    <Field label="可见范围"><select className="story-studio-input" value={node.audience}
      onChange={event => { patch(current => ({ ...current, audience: event.target.value as StoryNode['audience'] })) }}>
      <option value="director">导演</option><option value="public">公开</option>
    </select></Field>
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
      <button className="story-studio-button story-studio-danger" type="button" onClick={() => { onSelect(undefined); onDelete() }}>删除节点</button>
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
    {edge.lifecycle === 'suggested' && <button className="story-studio-button story-studio-button-primary" type="button"
      disabled={!endpointsCanonical} onClick={() => { patch(value => ({ ...value, lifecycle: 'canonical' })) }}>
      {endpointsCanonical ? '接受关系' : '先接受两端节点'}
    </button>}
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
    <button className="story-studio-button story-studio-danger" type="button" onClick={onDelete}>删除关系</button>
  </>
}

function CharacterInspector({ workspace, character, update, perspectiveId, previewId, setPerspectiveId, setPreviewId, onDelete }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly character: StoryCharacter
  readonly update: UpdateWorkspace
  readonly perspectiveId: string | undefined
  readonly previewId: string | undefined
  readonly setPerspectiveId: (id: string | undefined) => void
  readonly setPreviewId: (id: string | undefined) => void
  readonly onDelete: () => void
}) {
  const facts = workspace.facts.filter(fact => fact.knownBy.includes(character.id))
  const patchCharacter = (transform: (value: StoryCharacter) => StoryCharacter): void => {
    update(current => ({ ...current, characters: current.characters.map(item => item.id === character.id ? transform(item) : item) }))
  }
  const patchFact = (factId: string, transform: (value: StoryFact) => StoryFact): void => {
    update(current => ({ ...current, facts: current.facts.map(item => item.id === factId ? transform(item) : item) }))
  }
  const addFact = (): void => {
    update(current => ({ ...current, facts: [...current.facts, {
      id: `fact-${createClientOpaqueUuid()}`,
      text: '新事实',
      status: 'asserted',
      audience: 'director',
      knownBy: [character.id],
      source: { kind: 'manual' },
    }] }))
  }
  return <>
    <h2>{character.name}</h2>
    <div className="story-studio-inspector-subtitle">人物档案与可追溯认知</div>
    <TextField label="人物名称" rows={1} value={character.name} onChange={value => { patchCharacter(current => ({ ...current, name: value })) }} />
    <TextField label="Persona" rows={7} value={character.persona} onChange={value => { patchCharacter(current => ({ ...current, persona: value })) }} />
    <div className="story-studio-actions">
      <button className="story-studio-button" type="button" onClick={() => { setPerspectiveId(perspectiveId === character.id ? undefined : character.id) }}>
        {perspectiveId === character.id ? '退出人物视角' : '以此人物查看'}
      </button>
      <button className="story-studio-button" type="button" onClick={() => { setPreviewId(previewId === character.id ? undefined : character.id) }}>
        {previewId === character.id ? '收起 Worker 输入' : '预览 Worker 输入'}
      </button>
    </div>
    {previewId === character.id && <pre className="story-studio-preview">{compileCharacterPreview(workspace, character)}</pre>}
    <hr className="story-studio-divider" />
    <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}><strong style={{ fontSize: 12 }}>此人物知道的事实</strong>
      <button className="story-studio-icon-button" type="button" aria-label="添加人物事实" onClick={addFact}>＋</button></div>
    {facts.length === 0 && <p style={{ color: 'var(--studio-muted)', fontSize: 11 }}>还没有记录可供此人物使用的事实。</p>}
    {facts.map(fact => <div className="story-studio-fact" key={fact.id}>
      <textarea className="story-studio-input" rows={3} value={fact.text}
        onChange={event => { patchFact(fact.id, current => ({ ...current, text: event.target.value })) }} />
      <div className="story-studio-field-row" style={{ marginTop: 7 }}>
        <select className="story-studio-input" aria-label="事实状态" value={fact.status}
          onChange={event => { patchFact(fact.id, current => ({ ...current, status: event.target.value as StoryFact['status'] })) }}>
          <option value="asserted">确认</option><option value="uncertain">不确定</option><option value="refuted">已否定</option>
        </select>
        <select className="story-studio-input" aria-label="事实可见范围" value={fact.audience}
          onChange={event => { patchFact(fact.id, current => ({ ...current, audience: event.target.value as StoryFact['audience'] })) }}>
          <option value="director">导演</option><option value="public">公开</option>
        </select>
      </div>
      <small>{fact.source.kind === 'manual' ? '来源：玩家记录' : `来源：事件证据「${fact.source.evidence}」`}</small>
      <button className="story-studio-button story-studio-danger" style={{ marginTop: 7 }} type="button"
        onClick={() => { update(current => ({
          ...current,
          facts: current.facts.filter(item => item.id !== fact.id),
          citations: current.citations.map(citation => citation.target?.kind === 'fact' && citation.target.factId === fact.id
            ? citationWithoutTarget(citation) : citation),
        })) }}>删除事实</button>
    </div>)}
    <hr className="story-studio-divider" />
    <button className="story-studio-button story-studio-danger" type="button" onClick={onDelete}>删除人物</button>
  </>
}

function EventInspector({ workspace, event, update, onDelete }: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly event: StoryEvent
  readonly update: UpdateWorkspace
  readonly onDelete: () => void
}) {
  const patch = (transform: (value: StoryEvent) => StoryEvent): void => {
    update(current => ({ ...current, events: current.events.map(item => item.id === event.id ? transform(item) : item) }))
  }
  return <>
    <h2>{event.title}</h2><div className="story-studio-inspector-subtitle">第 {event.turn} 回合 · 已发生事件</div>
    <TextField label="事件标题" rows={1} value={event.title} onChange={value => { patch(current => ({ ...current, title: value })) }} />
    <TextField label="事件摘要" rows={5} value={event.summary} onChange={value => { patch(current => ({ ...current, summary: value })) }} />
    <TextField label="最终正文证据" rows={7} value={event.evidence} onChange={value => { patch(current => ({ ...current, evidence: value })) }} />
    <Field label="关联剧情节点"><select className="story-studio-input" value={event.nodeId ?? ''}
      onChange={change => { patch(current => change.target.value === '' ? eventWithoutNode(current) : { ...current, nodeId: change.target.value }) }}>
      <option value="">未关联</option>{workspace.graph.nodes.filter(node => node.lifecycle === 'canonical').map(node => <option key={node.id} value={node.id}>{node.title}</option>)}
    </select></Field>
    <div className="story-studio-field"><span>参与人物</span><div className="story-studio-checks">
      {workspace.characters.map(character => <label className="story-studio-check" key={character.id}>
        <input type="checkbox" checked={event.participantIds.includes(character.id)} onChange={change => { patch(current => ({
          ...current,
          participantIds: change.target.checked ? [...new Set([...current.participantIds, character.id])] : current.participantIds.filter(id => id !== character.id),
        })) }} />{character.name}
      </label>)}
    </div></div>
    <button className="story-studio-button story-studio-danger" type="button" onClick={onDelete}>删除事件与其派生事实</button>
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
  const changeTargetKind = (kind: '' | 'node' | 'fact'): void => {
    if (kind === '') patch(citationWithoutTarget)
    else if (kind === 'node') {
      const node = canonicalNodes[0]
      if (node !== undefined) patch(current => ({ ...current, target: { kind: 'node', nodeId: node.id } }))
    } else {
      const fact = workspace.facts[0]
      if (fact !== undefined) patch(current => ({ ...current, target: { kind: 'fact', factId: fact.id } }))
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
      onChange={event => { changeTargetKind(event.target.value as '' | 'node' | 'fact') }}>
      <option value="">暂未关联</option>
      <option value="node" disabled={canonicalNodes.length === 0}>剧情节点</option>
      <option value="fact" disabled={workspace.facts.length === 0}>人物事实</option>
    </select></Field>
    {citation.target?.kind === 'node' && <Field label="剧情节点"><select className="story-studio-input" value={citation.target.nodeId}
      onChange={event => { patch(current => ({ ...current, target: { kind: 'node', nodeId: event.target.value } })) }}>
      {canonicalNodes.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}
    </select></Field>}
    {citation.target?.kind === 'fact' && <Field label="人物事实"><select className="story-studio-input" value={citation.target.factId}
      onChange={event => { patch(current => ({ ...current, target: { kind: 'fact', factId: event.target.value } })) }}>
      {workspace.facts.map(fact => <option key={fact.id} value={fact.id}>{fact.text.slice(0, 70)}</option>)}
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
        <span>{citation.locator}</span><small>{citation.target === undefined ? '未关联' : citation.target.kind === 'node' ? '剧情节点' : '人物事实'}</small>
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
  const visibleNodes = perspectiveId === undefined
    ? workspace.graph.nodes
    : workspace.graph.nodes.filter(node => node.audience === 'public')
  const visibleNodeIds = new Set(visibleNodes.map(node => node.id))
  const nodes = useMemo((): readonly StoryCanvasNode[] => visibleNodes.map(node => ({
    id: node.id,
    type: 'story',
    position: node.position,
    selected: selection?.kind === 'node' && selection.id === node.id,
    data: {
      kind: node.kind,
      lifecycle: node.lifecycle,
      status: node.status,
      title: node.title,
      people: node.participantIds.map(id => workspace.characters.find(character => character.id === id)?.name ?? '').filter(Boolean).join(' · '),
    },
  })), [selection, visibleNodes, workspace.characters])
  const edges = useMemo((): readonly StoryCanvasEdge[] => workspace.graph.edges
    .filter(edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
      && (perspectiveId === undefined || edge.audience === 'public'))
    .map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label === '' ? edgeKindLabels[edge.kind] : `${edgeKindLabels[edge.kind]} · ${edge.label}`,
      data: { kind: edge.kind },
      animated: edge.lifecycle === 'suggested',
      selected: selection?.kind === 'edge' && selection.id === edge.id,
      markerEnd: { type: MarkerType.ArrowClosed },
      ...(edge.lifecycle === 'suggested' ? { style: { strokeDasharray: '5 4' } } : {}),
    })), [perspectiveId, selection, visibleNodeIds, workspace.graph.edges])

  const addNode = (kind: StoryNodeKind): void => {
    const id = `node-${createClientOpaqueUuid()}`
    const count = workspace.graph.nodes.length
    const node: StoryNode = {
      id,
      kind,
      title: kind === 'arc' ? '新篇章' : kind === 'secret' ? '新秘密' : '新剧情节点',
      status: 'planned',
      lifecycle: 'canonical',
      audience: kind === 'beat' ? 'public' : 'director',
      position: { x: 120 + (count % 3) * 260, y: 120 + Math.floor(count / 3) * 190 },
      content: '',
      participantIds: [],
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
    if (positions.size > 0) update(current => ({ ...current, graph: {
      ...current.graph,
      nodes: current.graph.nodes.map(node => {
        const position = positions.get(node.id)
        return position === undefined ? node : { ...node, position }
      }),
    } }))
  }
  const edgeChanges = (changes: readonly EdgeChange<StoryCanvasEdge>[]): void => {
    const selected = changes.findLast(change => change.type === 'select' && change.selected)
    if (selected?.type === 'select') setSelection({ kind: 'edge', id: selected.id })
  }
  const perspective = workspace.characters.find(character => character.id === perspectiveId)
  return <div className="story-studio-canvas">
    <div className="story-map-toolbar">
      <button className="story-studio-button" type="button" onClick={() => { addNode('arc') }}>＋ 篇章</button>
      <button className="story-studio-button" type="button" onClick={() => { addNode('beat') }}>＋ 剧情</button>
      <button className="story-studio-button" type="button" onClick={() => { addNode('secret') }}>＋ 秘密</button>
      {workspace.graph.nodes.some(node => node.lifecycle === 'suggested') && <span style={{ color: 'var(--studio-muted)', fontSize: 10, padding: '0 5px' }}>
        {workspace.graph.nodes.filter(node => node.lifecycle === 'suggested').length} 条 AI 建议
      </span>}
    </div>
    <ReactFlow<StoryCanvasNode, StoryCanvasEdge>
      nodes={[...nodes]}
      edges={[...edges]}
      nodeTypes={nodeTypes}
      onNodesChange={nodeChanges}
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
      <div className="story-studio-nav-heading"><span>故事</span></div>
      <button className="story-studio-nav-item" data-active={view === 'map'} type="button" onClick={() => { setView('map') }}>
        <span className="story-studio-nav-icon">⌘</span><span>故事地图</span><span className="story-studio-nav-count">{workspace.graph.nodes.length}</span>
      </button>
      <button className="story-studio-nav-item" data-active={view === 'timeline'} type="button" onClick={() => { setView('timeline') }}>
        <span className="story-studio-nav-icon">◷</span><span>事件时间线</span><span className="story-studio-nav-count">{workspace.events.length}</span>
      </button>
    </div>
    <div className="story-studio-nav-group">
      <div className="story-studio-nav-heading"><span>人物</span><button className="story-studio-icon-button" type="button" aria-label="添加人物" onClick={addCharacter}>＋</button></div>
      {workspace.characters.map(character => <button key={character.id} className="story-studio-nav-item"
        data-active={selection?.kind === 'character' && selection.id === character.id} type="button" onClick={() => { select({ kind: 'character', id: character.id }) }}>
        <span className="story-studio-nav-icon">◉</span><span>{character.name}</span>
        <span className="story-studio-nav-count">{workspace.facts.filter(fact => fact.knownBy.includes(character.id)).length}</span>
      </button>)}
      {workspace.characters.length === 0 && <p style={{ color: 'var(--studio-muted)', fontSize: 10, margin: '7px 9px' }}>添加人物后可维护独立认知。</p>}
    </div>
    <div className="story-studio-nav-group">
      <div className="story-studio-nav-heading"><span>资料库</span><button className="story-studio-icon-button" type="button" aria-label="添加资料" onClick={addSource}>＋</button></div>
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

/** Full-screen story studio backed by the typed workspace model. */
export function StoryWorkspaceEditor({ accent, sessionId, onClose }: StoryWorkspaceEditorProps) {
  const [items, setItems] = useState<readonly StoryWorkspaceSummary[]>([])
  const [workspace, setWorkspace] = useState<StoryWorkspaceSnapshot>()
  const [view, setView] = useState<StudioView>('map')
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

  const load = async (id: string): Promise<void> => {
    const next = await readWorkspace(id)
    setWorkspace(next)
    setDirty(false)
    setSelection(undefined)
    setReaderSourceId(undefined)
    setView('map')
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
    void listWorkspaces().then(async next => {
      const selected = next[0] === undefined ? undefined : await readWorkspace(next[0].id)
      if (!active) return
      setItems(next)
      setWorkspace(selected)
      setSelection(undefined)
      setReaderSourceId(undefined)
    }).catch(reason => {
      if (active) setError(errorMessage(reason))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

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
    if (dirty && !window.confirm('当前修改尚未保存，仍要切换故事吗？')) return
    setSaving(true)
    setError(undefined)
    void load(id).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const createNew = (): void => {
    setSaving(true)
    setError(undefined)
    void createWorkspace(`新故事 ${items.length + 1}`).then(async created => {
      const next = await listWorkspaces()
      setItems(next)
      setWorkspace(created)
      setDirty(false)
      setSelection(undefined)
      setReaderSourceId(undefined)
      setView('map')
      setNotice('新故事已经准备好')
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
      setNotice('故事已删除')
    }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }
  const selectForSession = (workspaceId: string | null): void => {
    if (sessionId === undefined) return
    setSaving(true)
    setError(undefined)
    void executeAgentRpCommand(sessionId, `/rp-story-workspace ${JSON.stringify({ format: 0, workspaceId })}`)
      .then(result => {
        if (!result.matched) throw new Error('当前角色会话没有故事工作室命令')
        setNotice(workspaceId === null ? '当前会话已停止使用故事流水线' : '当前会话已连接这个故事')
      }).catch(reason => { setError(errorMessage(reason)) }).finally(() => { setSaving(false) })
  }

  const addCharacter = (): void => {
    if (workspace === undefined) return
    const id = `character-${createClientOpaqueUuid()}`
    update(current => ({ ...current, characters: [...current.characters, { id, name: `人物 ${current.characters.length + 1}`, persona: '' }] }))
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
      const nodes = current.graph.nodes.filter(node => node.id !== id)
      const edges = current.graph.edges.filter(edge => edge.source !== id && edge.target !== id)
      const graph = current.graph.activeNodeId === id
        ? { nodes, edges }
        : { ...current.graph, nodes, edges }
      return {
        ...current,
        graph,
        events: current.events.map(event => event.nodeId === id ? eventWithoutNode(event) : event),
        citations: current.citations.map(citation => citation.target?.kind === 'node' && citation.target.nodeId === id
          ? citationWithoutTarget(citation) : citation),
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
        .filter(fact => fact.knownBy.length > 0)
      const factIds = new Set(facts.map(fact => fact.id))
      return {
        ...current,
        characters: current.characters.filter(character => character.id !== id),
        graph: { ...current.graph, nodes: current.graph.nodes.map(node => ({ ...node, participantIds: node.participantIds.filter(candidate => candidate !== id) })) },
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
        citations: current.citations.map(citation => citation.target?.kind === 'fact' && !factIds.has(citation.target.factId)
          ? citationWithoutTarget(citation) : citation),
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
  const selectedEvent = selection?.kind === 'event' ? workspace?.events.find(event => event.id === selection.id) : undefined
  const selectedSource = selection?.kind === 'source' ? workspace?.sources.find(source => source.id === selection.id) : undefined
  const selectedCitation = selection?.kind === 'citation' ? workspace?.citations.find(citation => citation.id === selection.id) : undefined
  const readerSource = selectedSource ?? (selectedCitation === undefined
    ? workspace?.sources.find(source => source.id === readerSourceId)
    : workspace?.sources.find(source => source.id === selectedCitation.sourceId))
  const selectedOutput = selection?.kind === 'output' ? workspace?.outputs.find(output => output.id === selection.id) : undefined

  const inspector = workspace === undefined ? <EmptyInspector />
    : selectedNode !== undefined ? <NodeInspector workspace={workspace} node={selectedNode} update={update} onSelect={setSelection} onDelete={() => { deleteNode(selectedNode.id) }} />
      : selectedEdge !== undefined ? <EdgeInspector workspace={workspace} edge={selectedEdge} update={update} onDelete={() => { deleteEdge(selectedEdge.id) }} />
        : selectedCharacter !== undefined ? <CharacterInspector workspace={workspace} character={selectedCharacter} update={update}
          perspectiveId={perspectiveId} previewId={previewId} setPerspectiveId={setPerspectiveId} setPreviewId={setPreviewId}
          onDelete={() => { deleteCharacter(selectedCharacter.id) }} />
          : selectedEvent !== undefined ? <EventInspector workspace={workspace} event={selectedEvent} update={update} onDelete={() => { deleteEvent(selectedEvent.id) }} />
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
    main = <div className="story-studio-empty"><span style={{ fontSize: 34 }}>✦</span><strong>从一个新故事开始</strong><span>人物、剧情关系、事件与资料会在同一个工作室中持续生长。</span>
      <button className="story-studio-button story-studio-button-primary" disabled={saving} type="button" onClick={createNew}>创建故事</button></div>
  } else if (view === 'map') {
    main = <StoryMap workspace={workspace} selection={selection} perspectiveId={perspectiveId} update={update} setSelection={setSelection}
      clearPerspective={() => { setPerspectiveId(undefined) }} />
  } else if (view === 'timeline') {
    const events = [...workspace.events].sort((left, right) => left.turn - right.turn)
    main = <div className="story-studio-view"><div className="story-studio-view-heading"><div><h1>事件时间线</h1><p>已经发生的情节及其最终正文证据。</p></div></div>
      <div className="story-studio-card-list">{events.map(event => <article className="story-studio-card" data-selected={selection?.kind === 'event' && selection.id === event.id}
        key={event.id} onClick={() => { setSelection({ kind: 'event', id: event.id }) }}>
        <h3>第 {event.turn} 回合 · {event.title}</h3><p>{event.summary}</p>
        <div className="story-studio-card-meta"><span>{event.participantIds.map(id => workspace.characters.find(character => character.id === id)?.name).filter(Boolean).join(' · ') || '未标注参与人物'}</span>
          {event.nodeId !== undefined && <span>关联：{workspace.graph.nodes.find(node => node.id === event.nodeId)?.title ?? '剧情节点'}</span>}</div>
      </article>)}{events.length === 0 && <div className="story-studio-empty"><span>第一轮故事完成后，事件会出现在这里。</span></div>}</div>
    </div>
  } else if (view === 'characters') {
    main = <div className="story-studio-view"><div className="story-studio-view-heading"><div><h1>人物与认知</h1><p>每个人物只依据自己获得过的事实决定行动。</p></div><button className="story-studio-button" type="button" onClick={addCharacter}>＋ 添加人物</button></div>
      <div className="story-studio-card-list">{workspace.characters.map(character => {
        const facts = workspace.facts.filter(fact => fact.knownBy.includes(character.id) && fact.status !== 'refuted')
        return <article className="story-studio-card" data-selected={selection?.kind === 'character' && selection.id === character.id}
          key={character.id} onClick={() => { setSelection({ kind: 'character', id: character.id }) }}>
          <h3>{character.name}</h3><p>{character.persona || '尚未填写 Persona'}</p>
          <div className="story-studio-card-meta"><span>{facts.length} 条当前认知</span><span>{workspace.graph.nodes.filter(node => node.participantIds.includes(character.id)).length} 个参与节点</span></div>
        </article>
      })}{workspace.characters.length === 0 && <div className="story-studio-empty"><span>添加第一个人物，为其建立独立 Persona 与认知来源。</span></div>}</div>
    </div>
  } else if (view === 'sources') {
    main = readerSource === undefined
      ? <div className="story-studio-view"><div className="story-studio-view-heading"><div><h1>原著与研究资料</h1><p>按章节翻阅原文，把准确段落连接到剧情和人物事实。</p></div><button className="story-studio-button" type="button" onClick={addSource}>＋ 添加资料</button></div>
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
    { id: 'map', label: '故事地图' },
    { id: 'timeline', label: '时间线' },
    { id: 'characters', label: '人物' },
    { id: 'sources', label: '资料' },
    { id: 'outputs', label: '输出布局' },
  ]

  return <div className="agent-rp-story-studio" role="dialog" aria-modal="true" aria-label="故事工作室"
    style={{ '--story-accent': accent } as CSSProperties}>
    <style>{xyFlowCss}</style><style>{storyStudioCss}</style>
    <header className="story-studio-topbar">
      <div className="story-studio-brand"><span className="story-studio-brand-mark">✦</span><div><strong>故事工作室</strong><span>人物、剧情与资料</span></div></div>
      <select className="story-studio-project" aria-label="当前故事" value={workspace?.id ?? ''} disabled={saving || items.length === 0}
        onChange={event => { changeProject(event.target.value) }}>
        {items.length === 0 && <option value="">还没有故事</option>}
        {items.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select>
      <button className="story-studio-icon-button" type="button" aria-label="新建故事" disabled={saving} onClick={createNew}>＋</button>
      <nav className="story-studio-tabs" aria-label="故事工作室视图">{views.map(item => <button className="story-studio-tab" aria-current={view === item.id ? 'page' : undefined}
        type="button" key={item.id} onClick={() => { navigate(item.id) }}>{item.label}</button>)}</nav>
      <button className="story-studio-button" type="button" disabled={workspace === undefined || saving || !dirty} onClick={save}>{saving ? '处理中…' : dirty ? '保存修改' : '已保存'}</button>
      <button className="story-studio-icon-button" type="button" aria-label="故事设置" disabled={workspace === undefined} onClick={() => { setSettingsOpen(true) }}>⚙</button>
      <button className="story-studio-icon-button" type="button" aria-label="关闭故事工作室" onClick={onClose}>×</button>
    </header>
    <div className="story-studio-shell">
      {workspace !== undefined && <StudioNavigation workspace={workspace} view={view} selection={selection} setView={navigate} select={select}
        addCharacter={addCharacter} addSource={addSource} />}
      <main className="story-studio-main">{loading ? <div className="story-studio-empty">正在打开故事工作室…</div> : main}</main>
      <aside className="story-studio-inspector" data-open={selection !== undefined}>
        {selection !== undefined && <button className="story-studio-icon-button" style={{ float: 'right' }} type="button" aria-label="关闭属性面板" onClick={() => { setSelection(undefined) }}>×</button>}
        {inspector}
      </aside>
    </div>
    <footer className="story-studio-statusbar">
      <strong>故事流水线</strong><span>研究 → 人物 → 导演 → 分区 → 编辑</span><span>{sessionId === undefined ? '打开角色会话后可连接' : '当前会话可连接'}</span>
      {error !== undefined ? <span className="story-studio-status-error" role="alert">{error}</span>
        : notice !== undefined ? <span className="story-studio-status-message" role="status">{notice}</span>
          : dirty ? <span className="story-studio-status-message">有未保存修改</span> : undefined}
    </footer>
    {settingsOpen && workspace !== undefined && <>
      <button className="story-studio-drawer-backdrop" type="button" aria-label="关闭设置" onClick={() => { setSettingsOpen(false) }} />
      <aside className="story-studio-drawer" aria-label="故事设置">
        <div className="story-studio-drawer-header"><h2>故事设置</h2><button className="story-studio-icon-button" type="button" onClick={() => { setSettingsOpen(false) }}>×</button></div>
        <TextField label="故事名称" rows={1} value={workspace.name} onChange={value => { update(current => ({ ...current, name: value })) }} />
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
        <p style={{ color: 'var(--studio-muted)', fontSize: 10, lineHeight: 1.5 }}>研究、人物、导演、分区与编辑保持阶段顺序；同阶段的人物和分区可以并行。</p>
        <hr className="story-studio-divider" />
        <button className="story-studio-button story-studio-danger" type="button" disabled={saving} onClick={removeWorkspace}>{deleteArmed ? '再次点击，确认删除故事' : '删除这个故事'}</button>
      </aside>
    </>}
  </div>
}
