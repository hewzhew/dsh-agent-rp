/** File-backed typed story workspaces and character-specific context compilation. */

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {
  StoryAudience,
  StoryCitation,
  StoryCharacter,
  StoryEdge,
  StoryEdgeKind,
  StoryEvent,
  StoryFact,
  StoryFactStatus,
  StoryForeshadowStatus,
  StoryNode,
  StoryNodeKind,
  StoryNodeLifecycle,
  StoryNodeStatus,
  StoryOutput,
  StoryOutputKind,
  StoryPipelineSettings,
  StoryResearchItem,
  StorySource,
  StorySourceOrigin,
  StorySourceKind,
  StoryTurnMaterialization,
  StoryWorkspaceCreateRequest,
  StoryWorkspaceSaveRequest,
  StoryWorkspaceSnapshot,
  StoryWorkspaceSummary,
} from './story-workspace-protocol.ts'

const UUID_SUFFIX = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const WORKSPACE_ID_PATTERN = new RegExp(`^story-${UUID_SUFFIX}$`, 'u')
const CHARACTER_ID_PATTERN = new RegExp(`^character-${UUID_SUFFIX}$`, 'u')
const NODE_ID_PATTERN = new RegExp(`^node-${UUID_SUFFIX}$`, 'u')
const EDGE_ID_PATTERN = new RegExp(`^edge-${UUID_SUFFIX}$`, 'u')
const FACT_ID_PATTERN = new RegExp(`^fact-${UUID_SUFFIX}$`, 'u')
const EVENT_ID_PATTERN = new RegExp(`^event-${UUID_SUFFIX}$`, 'u')
const OUTPUT_ID_PATTERN = new RegExp(`^output-${UUID_SUFFIX}$`, 'u')
const LEGACY_SECTION_ID_PATTERN = new RegExp(`^section-${UUID_SUFFIX}$`, 'u')
const SOURCE_ID_PATTERN = new RegExp(`^source-${UUID_SUFFIX}$`, 'u')
const CITATION_ID_PATTERN = new RegExp(`^citation-${UUID_SUFFIX}$`, 'u')
const RESEARCH_ID_PATTERN = new RegExp(`^research-${UUID_SUFFIX}$`, 'u')
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
const MAX_WORKSPACE_BYTES = 16 * 1024 * 1024
const MAX_CITATION_BYTES = 32 * 1024
const NODE_KINDS = new Set<StoryNodeKind>(['arc', 'beat', 'secret'])
const NODE_LIFECYCLES = new Set<StoryNodeLifecycle>(['canonical', 'suggested'])
const NODE_STATUSES = new Set<StoryNodeStatus>(['planned', 'active', 'completed', 'dropped'])
const EDGE_KINDS = new Set<StoryEdgeKind>(['precedes', 'causes', 'contains', 'foreshadows'])
const FORESHADOW_STATUSES = new Set<StoryForeshadowStatus>(['unplanted', 'planted', 'triggered', 'resolved', 'dropped'])
const AUDIENCES = new Set<StoryAudience>(['director', 'public'])
const FACT_STATUSES = new Set<StoryFactStatus>(['asserted', 'uncertain', 'refuted'])
const OUTPUT_KINDS = new Set<StoryOutputKind>(['prose', 'character', 'history'])
const SOURCE_KINDS = new Set<StorySourceKind>(['original', 'reference', 'research', 'web'])
const DEFAULT_STORY_PIPELINE: StoryPipelineSettings = { maxParallel: 4, researchMaxPasses: 2 }

interface StoredStoryNode extends Omit<StoryNode, 'content'> {}
interface StoredStoryCharacter extends Omit<StoryCharacter, 'persona'> {}
interface StoredStoryOutput extends Omit<StoryOutput, 'instructions'> {}
interface StoredStorySource extends Omit<StorySource, 'content'> {}

interface StoredStoryWorkspace {
  readonly format: 1
  readonly id: string
  readonly name: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly pipeline: StoryPipelineSettings
  readonly graph: {
    readonly activeNodeId?: string
    readonly nodes: readonly StoredStoryNode[]
    readonly edges: readonly StoryEdge[]
  }
  readonly characters: readonly StoredStoryCharacter[]
  readonly facts: readonly StoryFact[]
  readonly events: readonly StoryEvent[]
  readonly outputs: readonly StoredStoryOutput[]
  readonly sources: readonly StoredStorySource[]
  readonly citations: readonly StoryCitation[]
  readonly researchInbox: readonly StoryResearchItem[]
}

interface LegacyManifest {
  readonly format: 0
  readonly id: string
  readonly name: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly pipeline?: unknown
  readonly characters: readonly { readonly id: string; readonly name: string; readonly enabled: boolean }[]
  readonly sections: readonly {
    readonly id: string
    readonly name: string
    readonly kind: StoryOutputKind
    readonly enabled: boolean
    readonly characterId?: string
  }[]
  readonly sources: readonly {
    readonly id: string
    readonly name: string
    readonly kind: StorySourceKind
    readonly enabled: boolean
  }[]
}

/** Filesystem override used by focused checks and portable deployments. */
export interface StoryWorkspaceStoreOptions {
  readonly root?: string
}

/** Public facts from the current scene that every participating character may observe. */
export interface StoryPublicSceneContext {
  readonly playerInput: string
}

/** Exact private input compiled for one character Worker. */
export interface StoryCharacterContext {
  readonly workspaceId: string
  readonly characterId: string
  readonly characterName: string
  readonly persona: string
  readonly privateKnowledge: string
  readonly playerInput: string
  readonly text: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanName(value: unknown, subject: string): string {
  if (typeof value !== 'string') throw new Error(`${subject}名称不是文本`)
  const result = value.trim()
  if (result === '' || result.length > 120) throw new Error(`${subject}名称应为 1 至 120 个字符`)
  return result
}

function cleanLabel(value: unknown, subject: string, max = 240): string {
  if (typeof value !== 'string') throw new Error(`${subject}不是文本`)
  const result = value.trim()
  if (result.length > max) throw new Error(`${subject}不能超过 ${String(max)} 个字符`)
  return result
}

function cleanDocument(value: unknown, subject: string): string {
  if (typeof value !== 'string') throw new Error(`${subject}不是文本`)
  if (Buffer.byteLength(value, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new Error(`${subject}不能超过 ${String(MAX_DOCUMENT_BYTES)} 字节`)
  }
  return value.replace(/\r\n?/gu, '\n')
}

function safeInteger(value: unknown, subject: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${subject}无效`)
  }
  return value
}

function finiteCoordinate(value: unknown, subject: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 10_000_000) {
    throw new Error(`${subject}无效`)
  }
  return value
}

function assertId(id: unknown, pattern: RegExp, subject: string): asserts id is string {
  if (typeof id !== 'string' || !pattern.test(id)) throw new Error(`${subject} id 无效`)
}

function assertUnique(ids: readonly string[], subject: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`${subject} id 重复`)
}

function stringArray(value: unknown, subject: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${subject}不是文本数组`)
  return [...new Set(value)]
}

function normalizePipeline(value: unknown): StoryPipelineSettings {
  if (value === undefined) return DEFAULT_STORY_PIPELINE
  if (!isRecord(value)) throw new Error('故事流水线设置不是对象')
  const researchMaxPasses = value.researchMaxPasses === undefined ? DEFAULT_STORY_PIPELINE.researchMaxPasses : value.researchMaxPasses
  if (!Number.isSafeInteger(value.maxParallel) || (value.maxParallel as number) < 1
    || (value.maxParallel as number) > 8) {
    throw new Error('故事流水线并发数应为 1 至 8')
  }
  if (!Number.isSafeInteger(researchMaxPasses) || (researchMaxPasses as number) < 1
    || (researchMaxPasses as number) > 4) throw new Error('故事研究轮数应为 1 至 4')
  if (Object.keys(value).some(key => key !== 'maxParallel' && key !== 'researchMaxPasses' && key !== 'workerModel')) {
    throw new Error('故事流水线设置字段无效')
  }
  const normalized = { maxParallel: value.maxParallel as number, researchMaxPasses: researchMaxPasses as number }
  if (value.workerModel === undefined) return normalized
  if (!isRecord(value.workerModel)
    || Object.keys(value.workerModel).some(key => key !== 'provider' && key !== 'model')) {
    throw new Error('故事 Worker 模型路由字段无效')
  }
  const provider = cleanLabel(value.workerModel.provider, '故事 Worker provider', 200)
  const model = cleanLabel(value.workerModel.model, '故事 Worker model', 200)
  if (provider === '' && model === '') return normalized
  if (provider === '' || model === '') throw new Error('故事 Worker provider 与 model 必须同时填写')
  return { ...normalized, workerModel: { provider, model } }
}

function normalizeCharacter(value: unknown): StoryCharacter {
  if (!isRecord(value)) throw new Error('人物不是对象')
  assertId(value.id, CHARACTER_ID_PATTERN, '人物')
  return {
    id: value.id,
    name: cleanName(value.name, '人物'),
    persona: cleanDocument(value.persona, '人物 Persona'),
  }
}

function normalizeNode(value: unknown, characterIds: ReadonlySet<string>): StoryNode {
  if (!isRecord(value) || !isRecord(value.position)) throw new Error('故事节点字段无效')
  assertId(value.id, NODE_ID_PATTERN, '故事节点')
  if (!NODE_KINDS.has(value.kind as StoryNodeKind)
    || !NODE_STATUSES.has(value.status as StoryNodeStatus)
    || !NODE_LIFECYCLES.has(value.lifecycle as StoryNodeLifecycle)
    || !AUDIENCES.has(value.audience as StoryAudience)) {
    throw new Error('故事节点分类无效')
  }
  const participantIds = stringArray(value.participantIds, '故事节点参与人物')
  for (const id of participantIds) {
    if (!characterIds.has(id)) throw new Error(`故事节点引用未知人物 ${JSON.stringify(id)}`)
  }
  if (value.sourceEventId !== undefined) assertId(value.sourceEventId, EVENT_ID_PATTERN, '故事节点来源事件')
  return {
    id: value.id,
    kind: value.kind as StoryNodeKind,
    title: cleanName(value.title, '故事节点'),
    status: value.status as StoryNodeStatus,
    lifecycle: value.lifecycle as StoryNodeLifecycle,
    audience: value.audience as StoryAudience,
    position: {
      x: finiteCoordinate(value.position.x, '故事节点横坐标'),
      y: finiteCoordinate(value.position.y, '故事节点纵坐标'),
    },
    content: cleanDocument(value.content, '故事节点内容'),
    participantIds,
    ...(value.sourceEventId === undefined ? {} : { sourceEventId: value.sourceEventId }),
  }
}

function normalizeEdge(value: unknown, nodeIds: ReadonlySet<string>): StoryEdge {
  if (!isRecord(value)) throw new Error('故事关系不是对象')
  assertId(value.id, EDGE_ID_PATTERN, '故事关系')
  assertId(value.source, NODE_ID_PATTERN, '故事关系起点')
  assertId(value.target, NODE_ID_PATTERN, '故事关系终点')
  if (!nodeIds.has(value.source) || !nodeIds.has(value.target) || value.source === value.target) {
    throw new Error('故事关系必须连接两个不同的现有节点')
  }
  if (!EDGE_KINDS.has(value.kind as StoryEdgeKind)
    || !NODE_LIFECYCLES.has(value.lifecycle as StoryNodeLifecycle)
    || !AUDIENCES.has(value.audience as StoryAudience)) {
    throw new Error('故事关系分类无效')
  }
  if (value.kind === 'foreshadows') {
    if (!FORESHADOW_STATUSES.has(value.foreshadowStatus as StoryForeshadowStatus)) {
      throw new Error('伏笔关系状态无效')
    }
  } else if (value.foreshadowStatus !== undefined) {
    throw new Error('只有伏笔关系可以携带伏笔状态')
  }
  if (value.sourceEventId !== undefined) assertId(value.sourceEventId, EVENT_ID_PATTERN, '故事关系来源事件')
  return {
    id: value.id,
    kind: value.kind as StoryEdgeKind,
    source: value.source,
    target: value.target,
    label: cleanLabel(value.label, '故事关系标签'),
    lifecycle: value.lifecycle as StoryNodeLifecycle,
    audience: value.audience as StoryAudience,
    ...(value.kind === 'foreshadows' ? { foreshadowStatus: value.foreshadowStatus as StoryForeshadowStatus } : {}),
    ...(value.sourceEventId === undefined ? {} : { sourceEventId: value.sourceEventId }),
  }
}

function normalizeEvent(value: unknown, characterIds: ReadonlySet<string>, nodeIds: ReadonlySet<string>): StoryEvent {
  if (!isRecord(value)) throw new Error('故事事件不是对象')
  assertId(value.id, EVENT_ID_PATTERN, '故事事件')
  const participantIds = stringArray(value.participantIds, '故事事件参与人物')
  for (const id of participantIds) {
    if (!characterIds.has(id)) throw new Error(`故事事件引用未知人物 ${JSON.stringify(id)}`)
  }
  if (value.nodeId !== undefined) {
    assertId(value.nodeId, NODE_ID_PATTERN, '故事事件剧情节点')
    if (!nodeIds.has(value.nodeId)) throw new Error('故事事件引用未知剧情节点')
  }
  return {
    id: value.id,
    key: cleanLabel(value.key, '故事事件幂等键'),
    turn: safeInteger(value.turn, '故事事件回合'),
    title: cleanName(value.title, '故事事件'),
    summary: cleanDocument(value.summary, '故事事件摘要'),
    evidence: cleanDocument(value.evidence, '故事事件证据'),
    participantIds,
    ...(value.nodeId === undefined ? {} : { nodeId: value.nodeId }),
  }
}

function normalizeFact(value: unknown, characterIds: ReadonlySet<string>, eventIds: ReadonlySet<string>): StoryFact {
  if (!isRecord(value) || !isRecord(value.source)) throw new Error('人物事实字段无效')
  assertId(value.id, FACT_ID_PATTERN, '人物事实')
  if (!FACT_STATUSES.has(value.status as StoryFactStatus) || !AUDIENCES.has(value.audience as StoryAudience)) {
    throw new Error('人物事实分类无效')
  }
  const knownBy = stringArray(value.knownBy, '人物事实知情者')
  for (const id of knownBy) {
    if (!characterIds.has(id)) throw new Error(`人物事实引用未知人物 ${JSON.stringify(id)}`)
  }
  const source = value.source.kind === 'manual'
    ? { kind: 'manual' as const }
    : value.source.kind === 'event'
      ? (() => {
          assertId(value.source.eventId, EVENT_ID_PATTERN, '人物事实来源事件')
          if (!eventIds.has(value.source.eventId)) throw new Error('人物事实引用未知事件')
          return {
            kind: 'event' as const,
            eventId: value.source.eventId,
            evidence: cleanDocument(value.source.evidence, '人物事实证据'),
          }
        })()
      : undefined
  if (source === undefined) throw new Error('人物事实来源无效')
  return {
    id: value.id,
    text: cleanDocument(value.text, '人物事实'),
    status: value.status as StoryFactStatus,
    audience: value.audience as StoryAudience,
    knownBy,
    source,
  }
}

function normalizeOutput(value: unknown, characterIds: ReadonlySet<string>): StoryOutput {
  if (!isRecord(value)) throw new Error('输出分区不是对象')
  assertId(value.id, OUTPUT_ID_PATTERN, '输出分区')
  if (!OUTPUT_KINDS.has(value.kind as StoryOutputKind) || typeof value.enabled !== 'boolean') {
    throw new Error('输出分区字段无效')
  }
  if (value.characterId !== undefined) {
    assertId(value.characterId, CHARACTER_ID_PATTERN, '输出分区人物')
    if (value.kind !== 'character' || !characterIds.has(value.characterId)) throw new Error('人物输出分区目标无效')
  }
  return {
    id: value.id,
    name: cleanName(value.name, '输出分区'),
    kind: value.kind as StoryOutputKind,
    enabled: value.enabled,
    ...(value.characterId === undefined ? {} : { characterId: value.characterId }),
    instructions: cleanDocument(value.instructions, '输出分区说明'),
  }
}

function cleanWebUrl(value: unknown, subject: string): string {
  if (typeof value !== 'string' || value.length > 4_096) throw new Error(`${subject}无效`)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${subject}无效`)
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') {
    throw new Error(`${subject}无效`)
  }
  return url.href
}

function researchText(value: unknown, subject: string, max = MAX_CITATION_BYTES): string {
  const text = cleanDocument(value, subject).trim()
  if (Buffer.byteLength(text, 'utf8') > max) throw new Error(`${subject}过长`)
  return text
}

function normalizeSourceOrigin(value: unknown): StorySourceOrigin {
  if (!isRecord(value) || value.kind !== 'web') throw new Error('故事资料来源无效')
  const sessionId = cleanLabel(value.sessionId, '故事资料来源 Session', 240)
  if (sessionId === '') throw new Error('故事资料来源 Session 不能为空')
  return {
    kind: 'web',
    url: cleanWebUrl(value.url, '故事资料来源 URL'),
    query: researchText(value.query, '故事资料来源查询', 2_500),
    sessionId,
    turn: safeInteger(value.turn, '故事资料来源回合'),
    resultEventSeq: safeInteger(value.resultEventSeq, '故事资料来源事件'),
  }
}

function normalizeSource(value: unknown): StorySource {
  if (!isRecord(value)) throw new Error('故事资料不是对象')
  assertId(value.id, SOURCE_ID_PATTERN, '故事资料')
  if (!SOURCE_KINDS.has(value.kind as StorySourceKind) || typeof value.enabled !== 'boolean') {
    throw new Error('故事资料字段无效')
  }
  return {
    id: value.id,
    name: cleanName(value.name, '故事资料'),
    kind: value.kind as StorySourceKind,
    enabled: value.enabled,
    content: cleanDocument(value.content, '故事资料内容'),
    ...(value.origin === undefined ? {} : { origin: normalizeSourceOrigin(value.origin) }),
  }
}

function normalizeResearchItem(value: unknown): StoryResearchItem {
  if (!isRecord(value)) throw new Error('研究收件箱项目不是对象')
  assertId(value.id, RESEARCH_ID_PATTERN, '研究收件箱项目')
  const origin = normalizeSourceOrigin(value)
  const title = cleanLabel(value.title, '研究结果标题', 240)
  if (title === '') throw new Error('研究结果标题不能为空')
  const publishedAt = value.publishedAt === undefined
    ? undefined
    : cleanLabel(value.publishedAt, '研究结果发布时间', 120)
  return {
    id: value.id,
    ...origin,
    title,
    snippet: researchText(value.snippet, '研究结果摘录'),
    ...(publishedAt === undefined || publishedAt === '' ? {} : { publishedAt }),
  }
}

function citationText(value: unknown, subject: string, required: boolean): string {
  const text = cleanDocument(value, subject).trim()
  if (required && text === '') throw new Error(`${subject}不能为空`)
  if (Buffer.byteLength(text, 'utf8') > MAX_CITATION_BYTES) {
    throw new Error(`${subject}不能超过 ${String(MAX_CITATION_BYTES)} 字节`)
  }
  return text
}

function normalizeCitation(
  value: unknown,
  sourceIds: ReadonlySet<string>,
  nodeIds: ReadonlySet<string>,
  factIds: ReadonlySet<string>,
): StoryCitation {
  if (!isRecord(value)) throw new Error('资料引用不是对象')
  assertId(value.id, CITATION_ID_PATTERN, '资料引用')
  assertId(value.sourceId, SOURCE_ID_PATTERN, '资料引用来源')
  if (!sourceIds.has(value.sourceId)) throw new Error('资料引用指向未知资料')
  let target: StoryCitation['target']
  if (value.target !== undefined) {
    if (!isRecord(value.target)) throw new Error('资料引用目标无效')
    if (value.target.kind === 'node') {
      assertId(value.target.nodeId, NODE_ID_PATTERN, '资料引用剧情节点')
      if (!nodeIds.has(value.target.nodeId)) throw new Error('资料引用指向未知剧情节点')
      target = { kind: 'node', nodeId: value.target.nodeId }
    } else if (value.target.kind === 'fact') {
      assertId(value.target.factId, FACT_ID_PATTERN, '资料引用人物事实')
      if (!factIds.has(value.target.factId)) throw new Error('资料引用指向未知人物事实')
      target = { kind: 'fact', factId: value.target.factId }
    } else {
      throw new Error('资料引用目标分类无效')
    }
  }
  return {
    id: value.id,
    sourceId: value.sourceId,
    locator: cleanLabel(value.locator, '资料引用位置'),
    quote: citationText(value.quote, '资料引用原文', true),
    note: citationText(value.note, '资料引用说明', false),
    ...(target === undefined ? {} : { target }),
  }
}

function normalizeWorkspace(value: unknown): StoryWorkspaceSnapshot {
  if (!isRecord(value) || value.format !== 1 || !isRecord(value.graph)
    || !Array.isArray(value.characters) || !Array.isArray(value.graph.nodes)
    || !Array.isArray(value.graph.edges) || !Array.isArray(value.facts)
    || !Array.isArray(value.events) || !Array.isArray(value.outputs)
    || !Array.isArray(value.sources) || !Array.isArray(value.citations)
    || !Array.isArray(value.researchInbox)) {
    throw new Error('故事工作室字段无效')
  }
  assertId(value.id, WORKSPACE_ID_PATTERN, '故事工作室')
  const characters = value.characters.map(normalizeCharacter)
  assertUnique(characters.map(character => character.id), '人物')
  const characterIds = new Set(characters.map(character => character.id))
  const nodes = value.graph.nodes.map(node => normalizeNode(node, characterIds))
  assertUnique(nodes.map(node => node.id), '故事节点')
  const nodeIds = new Set(nodes.map(node => node.id))
  const edges = value.graph.edges.map(edge => normalizeEdge(edge, nodeIds))
  assertUnique(edges.map(edge => edge.id), '故事关系')
  const events = value.events.map(event => normalizeEvent(event, characterIds, nodeIds))
  assertUnique(events.map(event => event.id), '故事事件')
  assertUnique(events.map(event => event.key), '故事事件幂等键')
  const eventIds = new Set(events.map(event => event.id))
  const facts = value.facts.map(fact => normalizeFact(fact, characterIds, eventIds))
  assertUnique(facts.map(fact => fact.id), '人物事实')
  const factIds = new Set(facts.map(fact => fact.id))
  const outputs = value.outputs.map(output => normalizeOutput(output, characterIds))
  assertUnique(outputs.map(output => output.id), '输出分区')
  const sources = value.sources.map(normalizeSource)
  assertUnique(sources.map(source => source.id), '故事资料')
  const sourceIds = new Set(sources.map(source => source.id))
  const citations = value.citations.map(citation => normalizeCitation(citation, sourceIds, nodeIds, factIds))
  assertUnique(citations.map(citation => citation.id), '资料引用')
  const researchInbox = value.researchInbox.map(normalizeResearchItem)
  assertUnique(researchInbox.map(item => item.id), '研究收件箱项目')
  assertUnique(researchInbox.map(item => item.url), '研究收件箱 URL')
  const acceptedWebUrls = new Set(sources.flatMap(source => source.origin?.kind === 'web' ? [source.origin.url] : []))
  if (researchInbox.some(item => acceptedWebUrls.has(item.url))) throw new Error('研究收件箱包含已经收为资料的 URL')
  const activeNodeId = value.graph.activeNodeId
  if (activeNodeId !== undefined) {
    assertId(activeNodeId, NODE_ID_PATTERN, '当前剧情节点')
    const activeNode = nodes.find(node => node.id === activeNodeId)
    if (activeNode === undefined) throw new Error('当前剧情节点不存在')
    if (activeNode.kind !== 'beat' || activeNode.lifecycle !== 'canonical' || activeNode.status === 'dropped') {
      throw new Error('当前剧情节点必须是未放弃的正式剧情节点')
    }
  }
  for (const node of nodes) {
    if (node.sourceEventId !== undefined && !eventIds.has(node.sourceEventId)) {
      throw new Error('故事节点引用未知来源事件')
    }
  }
  for (const edge of edges) {
    if (edge.sourceEventId !== undefined && !eventIds.has(edge.sourceEventId)) {
      throw new Error('故事关系引用未知来源事件')
    }
  }
  const documents = nodes.map(node => node.content)
    .concat(characters.map(character => character.persona))
    .concat(facts.flatMap(fact => [fact.text, fact.source.kind === 'event' ? fact.source.evidence : '']))
    .concat(events.flatMap(event => [event.summary, event.evidence]))
    .concat(outputs.map(output => output.instructions))
    .concat(sources.map(source => source.content))
    .concat(citations.flatMap(citation => [citation.quote, citation.note]))
    .concat(researchInbox.flatMap(item => [item.query, item.title, item.snippet]))
  const bytes = documents.reduce((total, document) => total + Buffer.byteLength(document, 'utf8'), 0)
  if (bytes > MAX_WORKSPACE_BYTES) throw new Error(`故事工作室不能超过 ${String(MAX_WORKSPACE_BYTES)} 字节`)
  return {
    format: 1,
    id: value.id,
    name: cleanName(value.name, '故事工作室'),
    revision: safeInteger(value.revision, '故事工作室 revision'),
    createdAt: safeInteger(value.createdAt, '故事工作室创建时间'),
    updatedAt: safeInteger(value.updatedAt, '故事工作室更新时间'),
    pipeline: normalizePipeline(value.pipeline),
    graph: { ...(activeNodeId === undefined ? {} : { activeNodeId }), nodes, edges },
    characters,
    facts,
    events,
    outputs,
    sources,
    citations,
    researchInbox,
  }
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const staging = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(staging, content, { encoding: 'utf8', mode: 0o600 })
    renameSync(staging, path)
  } finally {
    rmSync(staging, { force: true })
  }
}

function readMarkdown(path: string): string {
  try {
    return readFileSync(path, 'utf8').replace(/\r\n?/gu, '\n')
  } catch (error: unknown) {
    throw new Error(`无法读取故事工作室文档 ${JSON.stringify(path)}`, { cause: error })
  }
}

function readOptionalMarkdown(path: string): string {
  return existsSync(path) ? readMarkdown(path) : ''
}

function withoutLegacyTurnMarkers(value: string): string {
  return value
    .replace(/^\s*<!--\s*agent-rp:story-turn:[^>]*-->\s*$/gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function compactStored(snapshot: StoryWorkspaceSnapshot): StoredStoryWorkspace {
  return {
    format: 1,
    id: snapshot.id,
    name: snapshot.name,
    revision: snapshot.revision,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    pipeline: snapshot.pipeline,
    graph: {
      ...(snapshot.graph.activeNodeId === undefined ? {} : { activeNodeId: snapshot.graph.activeNodeId }),
      nodes: snapshot.graph.nodes.map(({ content: _content, ...node }) => node),
      edges: snapshot.graph.edges,
    },
    characters: snapshot.characters.map(({ persona: _persona, ...character }) => character),
    facts: snapshot.facts,
    events: snapshot.events,
    outputs: snapshot.outputs.map(({ instructions: _instructions, ...output }) => output),
    sources: snapshot.sources.map(({ content: _content, ...source }) => source),
    citations: snapshot.citations,
    researchInbox: snapshot.researchInbox,
  }
}

function hydrateStored(root: string, value: unknown): StoryWorkspaceSnapshot {
  if (!isRecord(value) || value.format !== 1 || !isRecord(value.graph)
    || !Array.isArray(value.graph.nodes) || !Array.isArray(value.characters)
    || !Array.isArray(value.outputs) || !Array.isArray(value.sources)) {
    throw new Error('故事工作室索引字段无效')
  }
  const nodes = value.graph.nodes.map(item => {
    if (!isRecord(item)) throw new Error('故事节点索引无效')
    assertId(item.id, NODE_ID_PATTERN, '故事节点')
    return { ...item, content: readMarkdown(join(root, 'nodes', `${item.id}.md`)) }
  })
  const characters = value.characters.map(item => {
    if (!isRecord(item)) throw new Error('人物索引无效')
    assertId(item.id, CHARACTER_ID_PATTERN, '人物')
    return { ...item, persona: readMarkdown(join(root, 'characters', item.id, 'persona.md')) }
  })
  const outputs = value.outputs.map(item => {
    if (!isRecord(item)) throw new Error('输出分区索引无效')
    assertId(item.id, OUTPUT_ID_PATTERN, '输出分区')
    return { ...item, instructions: readMarkdown(join(root, 'outputs', `${item.id}.md`)) }
  })
  const sources = value.sources.map(item => {
    if (!isRecord(item)) throw new Error('故事资料索引无效')
    assertId(item.id, SOURCE_ID_PATTERN, '故事资料')
    return { ...item, content: readMarkdown(join(root, 'sources', `${item.id}.md`)) }
  })
  return normalizeWorkspace({
    ...value,
    graph: { ...value.graph, nodes },
    characters,
    outputs,
    sources,
    citations: Array.isArray(value.citations) ? value.citations : [],
    researchInbox: Array.isArray(value.researchInbox) ? value.researchInbox : [],
  })
}

function parseLegacyManifest(value: unknown): LegacyManifest {
  if (!isRecord(value) || value.format !== 0 || !Array.isArray(value.characters)
    || !Array.isArray(value.sections) || !Array.isArray(value.sources)) {
    throw new Error('旧故事工程索引字段无效')
  }
  assertId(value.id, WORKSPACE_ID_PATTERN, '旧故事工程')
  const characters = value.characters.map(item => {
    if (!isRecord(item)) throw new Error('旧人物字段无效')
    assertId(item.id, CHARACTER_ID_PATTERN, '旧人物')
    if (typeof item.enabled !== 'boolean') throw new Error('旧人物参与状态无效')
    return { id: item.id, name: cleanName(item.name, '旧人物'), enabled: item.enabled }
  })
  const characterIds = new Set(characters.map(character => character.id))
  const sections = value.sections.map(item => {
    if (!isRecord(item)) throw new Error('旧分区字段无效')
    assertId(item.id, LEGACY_SECTION_ID_PATTERN, '旧分区')
    if (!OUTPUT_KINDS.has(item.kind as StoryOutputKind) || typeof item.enabled !== 'boolean') {
      throw new Error('旧分区分类无效')
    }
    if (item.characterId !== undefined) {
      assertId(item.characterId, CHARACTER_ID_PATTERN, '旧分区人物')
      if (!characterIds.has(item.characterId)) throw new Error('旧分区引用未知人物')
    }
    return {
      id: item.id,
      name: cleanName(item.name, '旧分区'),
      kind: item.kind as StoryOutputKind,
      enabled: item.enabled,
      ...(item.characterId === undefined ? {} : { characterId: item.characterId }),
    }
  })
  const sources = value.sources.map(item => {
    if (!isRecord(item)) throw new Error('旧资料字段无效')
    assertId(item.id, SOURCE_ID_PATTERN, '旧资料')
    if (!SOURCE_KINDS.has(item.kind as StorySourceKind) || typeof item.enabled !== 'boolean') {
      throw new Error('旧资料分类无效')
    }
    return {
      id: item.id,
      name: cleanName(item.name, '旧资料'),
      kind: item.kind as StorySourceKind,
      enabled: item.enabled,
    }
  })
  return {
    format: 0,
    id: value.id,
    name: cleanName(value.name, '旧故事工程'),
    revision: safeInteger(value.revision, '旧故事工程 revision'),
    createdAt: safeInteger(value.createdAt, '旧故事工程创建时间'),
    updatedAt: safeInteger(value.updatedAt, '旧故事工程更新时间'),
    pipeline: value.pipeline,
    characters,
    sections,
    sources,
  }
}

/** Create an opaque character id. */
export function createStoryCharacterId(): string {
  return `character-${randomUUID()}`
}

/** Create an opaque story-map node id. */
export function createStoryNodeId(): string {
  return `node-${randomUUID()}`
}

/** Create an opaque story-map edge id. */
export function createStoryEdgeId(): string {
  return `edge-${randomUUID()}`
}

/** Create an opaque character-fact id. */
export function createStoryFactId(): string {
  return `fact-${randomUUID()}`
}

/** Create an opaque completed-event id. */
export function createStoryEventId(): string {
  return `event-${randomUUID()}`
}

/** Create an opaque output-section id. */
export function createStoryOutputId(): string {
  return `output-${randomUUID()}`
}

/** Create an opaque source id. */
export function createStorySourceId(): string {
  return `source-${randomUUID()}`
}

/** Create an opaque source-citation id. */
export function createStoryCitationId(): string {
  return `citation-${randomUUID()}`
}

/** Create an opaque pending-research id. */
export function createStoryResearchId(): string {
  return `research-${randomUUID()}`
}

/** Return current-scene characters in workspace order. */
export function storyParticipantCharacters(workspace: StoryWorkspaceSnapshot): readonly StoryCharacter[] {
  const active = workspace.graph.nodes.find(node => node.id === workspace.graph.activeNodeId)
  if (active === undefined) return workspace.characters
  const participants = new Set(active.participantIds)
  return workspace.characters.filter(character => participants.has(character.id))
}

/** Compile completed events into the public continuity input. */
export function storyPublicHistory(workspace: StoryWorkspaceSnapshot): string {
  return workspace.events.map(event => `## ${event.title}\n${event.summary}`).join('\n\n')
}

function renderStoryCitation(workspace: StoryWorkspaceSnapshot, citation: StoryCitation): string {
  const source = workspace.sources.find(candidate => candidate.id === citation.sourceId)
  const location = [source?.name ?? citation.sourceId, citation.locator].filter(Boolean).join(' · ')
  return `- ${location}: ${citation.quote}${citation.note === '' ? '' : `（${citation.note}）`}`
}

/** Compile canonical story objects and relationships for the director. */
export function storyDirectorMap(workspace: StoryWorkspaceSnapshot): string {
  const nodes = workspace.graph.nodes.filter(node => node.lifecycle === 'canonical' && node.status !== 'dropped')
  const nodeIds = new Set(nodes.map(node => node.id))
  const nodeText = nodes.map(node => {
    const citations = workspace.citations.filter(citation => citation.target?.kind === 'node' && citation.target.nodeId === node.id)
    return [
      `## [${node.kind}] ${node.title} (${node.status})\nid: ${node.id}`,
      node.content,
      citations.length === 0 ? '' : `资料依据：\n${citations.map(citation => renderStoryCitation(workspace, citation)).join('\n')}`,
    ].filter(Boolean).join('\n')
  }).join('\n\n')
  const edgeText = workspace.graph.edges
    .filter(edge => edge.lifecycle === 'canonical' && nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map(edge => {
      const source = nodes.find(node => node.id === edge.source)?.title ?? edge.source
      const target = nodes.find(node => node.id === edge.target)?.title ?? edge.target
      return `- ${source} --${edge.kind}${edge.label === '' ? '' : `:${edge.label}`}--> ${target}`
    }).join('\n')
  return [nodeText, edgeText === '' ? '' : `# 关系\n${edgeText}`].filter(Boolean).join('\n\n')
}

/** Compile unresolved canonical secrets and foreshadowing relationships. */
export function storyOpenForeshadowing(workspace: StoryWorkspaceSnapshot): string {
  const canonicalNodes = workspace.graph.nodes.filter(node => node.lifecycle === 'canonical' && node.status !== 'dropped')
  const nodeById = new Map(canonicalNodes.map(node => [node.id, node]))
  const secrets = canonicalNodes
    .filter(node => node.kind === 'secret' && node.status !== 'completed')
    .map(node => `- ${node.title}: ${node.content}`)
  const edges = workspace.graph.edges
    .filter(edge => edge.lifecycle === 'canonical' && edge.kind === 'foreshadows'
      && nodeById.has(edge.source) && nodeById.has(edge.target)
      && edge.foreshadowStatus !== 'resolved' && edge.foreshadowStatus !== 'dropped')
    .map(edge => `- ${nodeById.get(edge.source)?.title ?? edge.source} → ${nodeById.get(edge.target)?.title ?? edge.target} (${edge.foreshadowStatus})`)
  return [...secrets, ...edges].join('\n')
}

/** Local workspace store whose accepted ids cannot escape its configured root. */
export class StoryWorkspaceStore {
  readonly root: string

  constructor(options: StoryWorkspaceStoreOptions = {}) {
    this.root = resolve(options.root ?? dshHomePath('agent-rp', 'story-workspaces'))
  }

  /** List valid workspaces newest first, migrating format 0 on first access. */
  list(): readonly StoryWorkspaceSummary[] {
    if (!existsSync(this.root)) return []
    return readdirSync(this.root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && WORKSPACE_ID_PATTERN.test(entry.name))
      .map(entry => this.get(entry.name))
      .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name))
      .map(snapshot => ({
        id: snapshot.id,
        name: snapshot.name,
        revision: snapshot.revision,
        updatedAt: snapshot.updatedAt,
        characterCount: snapshot.characters.length,
      }))
  }

  /** Create one empty typed story workspace. */
  create(request: StoryWorkspaceCreateRequest): StoryWorkspaceSnapshot {
    if (request.format !== 1) throw new Error('故事工作室创建请求版本无效')
    const now = Date.now()
    const snapshot = normalizeWorkspace({
      format: 1,
      id: `story-${randomUUID()}`,
      name: request.name,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      pipeline: DEFAULT_STORY_PIPELINE,
      graph: { nodes: [], edges: [] },
      characters: [],
      facts: [],
      events: [],
      outputs: [],
      sources: [],
      citations: [],
      researchInbox: [],
    })
    this.writeSnapshot(snapshot)
    return snapshot
  }

  /** Read one complete workspace at its current revision. */
  get(id: string): StoryWorkspaceSnapshot {
    assertId(id, WORKSPACE_ID_PATTERN, '故事工作室')
    const root = this.workspacePath(id)
    const storyPath = join(root, 'story.json')
    if (!existsSync(storyPath)) return this.migrateLegacy(id)
    try {
      return hydrateStored(root, JSON.parse(readFileSync(storyPath, 'utf8')) as unknown)
    } catch (error: unknown) {
      throw new Error(`无法读取故事工作室 ${JSON.stringify(id)}`, { cause: error })
    }
  }

  /** Replace all editable fields when the caller still owns the observed revision. */
  save(request: StoryWorkspaceSaveRequest): StoryWorkspaceSnapshot {
    if (request.format !== 1) throw new Error('故事工作室保存请求版本无效')
    const current = this.get(request.id)
    if (!Number.isSafeInteger(request.revision) || request.revision < 0 || request.revision !== current.revision) {
      throw new Error(`故事工作室已更新；当前 revision 为 ${String(current.revision)}`)
    }
    const snapshot = normalizeWorkspace({
      ...request,
      revision: current.revision + 1,
      createdAt: current.createdAt,
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    })
    this.writeSnapshot(snapshot)
    this.removeUnreferenced(current, snapshot)
    return this.get(snapshot.id)
  }

  /** Idempotently append one visible turn as an event, character facts, and a typed suggestion batch. */
  materializeTurn(id: string, materialization: StoryTurnMaterialization): StoryWorkspaceSnapshot {
    if (!/^[A-Za-z0-9:_-]{1,240}$/u.test(materialization.key)) throw new Error('故事事件 key 无效')
    const current = this.get(id)
    if (current.events.some(event => event.key === materialization.key)) return current
    const characterIds = new Set(current.characters.map(character => character.id))
    for (const participantId of materialization.participantIds) {
      if (!characterIds.has(participantId)) throw new Error('故事事件包含未知参与人物')
    }
    const eventId = createStoryEventId()
    const activeNode = current.graph.nodes.find(node => node.id === current.graph.activeNodeId)
    const event: StoryEvent = {
      id: eventId,
      key: materialization.key,
      turn: materialization.turn,
      title: cleanName(materialization.title, '故事事件'),
      summary: cleanDocument(materialization.summary, '故事事件摘要'),
      evidence: cleanDocument(materialization.evidence, '故事事件证据'),
      participantIds: [...new Set(materialization.participantIds)],
      ...(activeNode === undefined ? {} : { nodeId: activeNode.id }),
    }
    const observations = materialization.observations.map(observation => {
      if (!characterIds.has(observation.characterId)) throw new Error('人物观察包含未知人物')
      return {
        id: createStoryFactId(),
        text: cleanDocument(observation.text, '人物观察'),
        status: 'asserted' as const,
        audience: 'public' as const,
        knownBy: [observation.characterId],
        source: { kind: 'event' as const, eventId, evidence: event.evidence },
      }
    }).filter(fact => fact.text.trim() !== '')
    const suggestionIds = new Map<string, string>()
    const suggestedNodes = materialization.nodeSuggestions.map((suggestion, index): StoryNode => {
      if (suggestionIds.has(suggestion.ref)) throw new Error('候选节点 ref 重复')
      for (const participantId of suggestion.participantIds) {
        if (!characterIds.has(participantId)) throw new Error('候选节点包含未知参与人物')
      }
      const nodeId = createStoryNodeId()
      suggestionIds.set(suggestion.ref, nodeId)
      return {
        id: nodeId,
        kind: suggestion.kind,
        title: suggestion.title,
        status: 'planned',
        lifecycle: 'suggested',
        audience: 'director',
        position: {
          x: (activeNode?.position.x ?? 0) + 360 + (index % 2) * 360,
          y: (activeNode?.position.y ?? 0) + Math.floor(index / 2) * 180,
        },
        content: suggestion.content,
        participantIds: [...new Set(suggestion.participantIds)],
        sourceEventId: eventId,
      }
    })
    const canonicalNodeIds = new Set(current.graph.nodes
      .filter(node => node.lifecycle === 'canonical' && node.status !== 'dropped').map(node => node.id))
    const resolveEndpoint = (endpoint: StoryTurnMaterialization['edgeSuggestions'][number]['source']): string => {
      if (endpoint.kind === 'proposal') {
        const nodeId = suggestionIds.get(endpoint.ref)
        if (nodeId === undefined) throw new Error('候选关系指向未知候选节点')
        return nodeId
      }
      if (!canonicalNodeIds.has(endpoint.nodeId)) throw new Error('候选关系指向未知正式节点')
      return endpoint.nodeId
    }
    const suggestedEdges = materialization.edgeSuggestions.map(suggestion => {
      if (suggestion.kind !== 'foreshadows' && suggestion.foreshadowStatus !== undefined) {
        throw new Error('只有伏笔候选关系可以携带伏笔状态')
      }
      return {
        id: createStoryEdgeId(),
        kind: suggestion.kind,
        source: resolveEndpoint(suggestion.source),
        target: resolveEndpoint(suggestion.target),
        label: suggestion.label,
        lifecycle: 'suggested' as const,
        audience: 'director' as const,
        ...(suggestion.kind === 'foreshadows'
          ? { foreshadowStatus: suggestion.foreshadowStatus ?? 'unplanted' as const }
          : {}),
        sourceEventId: eventId,
      }
    })
    const knownResearchUrls = new Set([
      ...current.researchInbox.map(item => item.url),
      ...current.sources.flatMap(source => source.origin?.kind === 'web' ? [source.origin.url] : []),
    ])
    const researchInbox = [...current.researchInbox]
    for (const candidate of materialization.webResearch) {
      const url = cleanWebUrl(candidate.url, '研究结果 URL')
      if (knownResearchUrls.has(url)) continue
      const item = normalizeResearchItem({ ...candidate, id: createStoryResearchId(), url })
      knownResearchUrls.add(item.url)
      researchInbox.push(item)
    }
    return this.save({
      format: 1,
      id: current.id,
      revision: current.revision,
      name: current.name,
      pipeline: current.pipeline,
      graph: {
        ...current.graph,
        nodes: [...current.graph.nodes, ...suggestedNodes],
        edges: [...current.graph.edges, ...suggestedEdges],
      },
      characters: current.characters,
      facts: [...current.facts, ...observations],
      events: [...current.events, event],
      outputs: current.outputs,
      sources: current.sources,
      citations: current.citations,
      researchInbox,
    })
  }

  /** Remove one workspace and every local document it owns. */
  remove(id: string): StoryWorkspaceSummary {
    const snapshot = this.get(id)
    rmSync(this.workspacePath(id), { recursive: true })
    return {
      id: snapshot.id,
      name: snapshot.name,
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
      characterCount: snapshot.characters.length,
    }
  }

  private workspacePath(id: string): string {
    assertId(id, WORKSPACE_ID_PATTERN, '故事工作室')
    return join(this.root, id)
  }

  private writeSnapshot(value: StoryWorkspaceSnapshot): void {
    const snapshot = normalizeWorkspace(value)
    const root = this.workspacePath(snapshot.id)
    for (const node of snapshot.graph.nodes) atomicWrite(join(root, 'nodes', `${node.id}.md`), node.content)
    for (const character of snapshot.characters) {
      atomicWrite(join(root, 'characters', character.id, 'persona.md'), character.persona)
    }
    for (const output of snapshot.outputs) atomicWrite(join(root, 'outputs', `${output.id}.md`), output.instructions)
    for (const source of snapshot.sources) atomicWrite(join(root, 'sources', `${source.id}.md`), source.content)
    atomicWrite(join(root, 'story.json'), `${JSON.stringify(compactStored(snapshot), null, 2)}\n`)
  }

  private removeUnreferenced(before: StoryWorkspaceSnapshot, after: StoryWorkspaceSnapshot): void {
    const root = this.workspacePath(after.id)
    const nodeIds = new Set(after.graph.nodes.map(node => node.id))
    for (const node of before.graph.nodes) {
      if (!nodeIds.has(node.id)) rmSync(join(root, 'nodes', `${node.id}.md`), { force: true })
    }
    const characterIds = new Set(after.characters.map(character => character.id))
    for (const character of before.characters) {
      if (!characterIds.has(character.id)) rmSync(join(root, 'characters', character.id), { recursive: true, force: true })
    }
    const outputIds = new Set(after.outputs.map(output => output.id))
    for (const output of before.outputs) {
      if (!outputIds.has(output.id)) rmSync(join(root, 'outputs', `${output.id}.md`), { force: true })
    }
    const sourceIds = new Set(after.sources.map(source => source.id))
    for (const source of before.sources) {
      if (!sourceIds.has(source.id)) rmSync(join(root, 'sources', `${source.id}.md`), { force: true })
    }
  }

  private migrateLegacy(id: string): StoryWorkspaceSnapshot {
    const root = this.workspacePath(id)
    const manifestPath = join(root, 'manifest.json')
    if (!existsSync(manifestPath)) throw new Error(`故事工作室 ${JSON.stringify(id)} 不存在`)
    let legacy: LegacyManifest
    try {
      legacy = parseLegacyManifest(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown)
    } catch (error: unknown) {
      throw new Error(`无法迁移旧故事工程 ${JSON.stringify(id)}`, { cause: error })
    }
    const outline = readOptionalMarkdown(join(root, 'outline.md'))
    const foreshadowing = readOptionalMarkdown(join(root, 'foreshadowing.md'))
    const proposals = withoutLegacyTurnMarkers(readOptionalMarkdown(join(root, 'proposals.md')))
    const history = withoutLegacyTurnMarkers(readOptionalMarkdown(join(root, 'history.md')))
    const characters: StoryCharacter[] = legacy.characters.map(character => ({
      id: character.id,
      name: character.name,
      persona: readOptionalMarkdown(join(root, 'characters', character.id, 'persona.md')),
    }))
    const participantIds = legacy.characters.filter(character => character.enabled).map(character => character.id)
    const arcId = createStoryNodeId()
    const activeId = createStoryNodeId()
    const secretId = createStoryNodeId()
    const nodes: StoryNode[] = [
      ...(outline.trim() === '' ? [] : [{
        id: arcId,
        kind: 'arc' as const,
        title: '故事大纲',
        status: 'active' as const,
        lifecycle: 'canonical' as const,
        audience: 'director' as const,
        position: { x: 0, y: 0 },
        content: outline,
        participantIds: [],
      }]),
      {
        id: activeId,
        kind: 'beat',
        title: '当前场景',
        status: 'active',
        lifecycle: 'canonical',
        audience: 'public',
        position: { x: 360, y: 0 },
        content: '',
        participantIds,
      },
      ...(foreshadowing.trim() === '' ? [] : [{
        id: secretId,
        kind: 'secret' as const,
        title: '未整理伏笔',
        status: 'planned' as const,
        lifecycle: 'canonical' as const,
        audience: 'director' as const,
        position: { x: 360, y: 240 },
        content: foreshadowing,
        participantIds: [],
      }]),
      ...(proposals.trim() === '' ? [] : [{
        id: createStoryNodeId(),
        kind: 'beat' as const,
        title: '迁移的待审建议',
        status: 'planned' as const,
        lifecycle: 'suggested' as const,
        audience: 'director' as const,
        position: { x: 720, y: 0 },
        content: proposals,
        participantIds,
      }]),
    ]
    const edges: StoryEdge[] = outline.trim() === '' ? [] : [{
      id: createStoryEdgeId(),
      kind: 'contains',
      source: arcId,
      target: activeId,
      label: '',
      lifecycle: 'canonical',
      audience: 'director',
    }]
    const eventId = history.trim() === '' ? undefined : createStoryEventId()
    const events: StoryEvent[] = eventId === undefined ? [] : [{
      id: eventId,
      key: 'migration:format-0-history',
      turn: 0,
      title: '迁移前历史',
      summary: history,
      evidence: history,
      participantIds,
    }]
    const facts: StoryFact[] = legacy.characters.flatMap(character => {
      const knowledge = withoutLegacyTurnMarkers(readOptionalMarkdown(join(root, 'characters', character.id, 'knowledge.md')))
      return knowledge.trim() === '' ? [] : [{
        id: createStoryFactId(),
        text: knowledge,
        status: 'asserted' as const,
        audience: 'director' as const,
        knownBy: [character.id],
        source: { kind: 'manual' as const },
      }]
    })
    const outputs: StoryOutput[] = legacy.sections.map(section => ({
      id: createStoryOutputId(),
      name: section.name,
      kind: section.kind,
      enabled: section.enabled,
      ...(section.characterId === undefined ? {} : { characterId: section.characterId }),
      instructions: readOptionalMarkdown(join(root, 'sections', `${section.id}.md`)),
    }))
    const sources: StorySource[] = legacy.sources.map(source => ({
      ...source,
      content: readOptionalMarkdown(join(root, 'sources', `${source.id}.md`)),
    }))
    const migrated = normalizeWorkspace({
      format: 1,
      id: legacy.id,
      name: legacy.name,
      revision: legacy.revision + 1,
      createdAt: legacy.createdAt,
      updatedAt: Math.max(Date.now(), legacy.updatedAt + 1),
      pipeline: normalizePipeline(legacy.pipeline),
      graph: { activeNodeId: activeId, nodes, edges },
      characters,
      facts,
      events,
      outputs,
      sources,
      citations: [],
      researchInbox: [],
    })
    this.writeSnapshot(migrated)
    for (const path of ['manifest.json', 'outline.md', 'foreshadowing.md', 'proposals.md', 'history.md']) {
      rmSync(join(root, path), { force: true })
    }
    for (const character of legacy.characters) {
      rmSync(join(root, 'characters', character.id, 'knowledge.md'), { force: true })
    }
    rmSync(join(root, 'sections'), { recursive: true, force: true })
    return this.get(id)
  }
}

/** Compile a character Worker input without director-only or other-character facts. */
export function compileStoryCharacterContext(
  workspace: StoryWorkspaceSnapshot,
  characterId: string,
  scene: StoryPublicSceneContext,
): StoryCharacterContext {
  const character = workspace.characters.find(candidate => candidate.id === characterId)
  if (character === undefined) throw new Error(`故事工作室中没有人物 ${JSON.stringify(characterId)}`)
  const facts = workspace.facts.filter(fact => fact.status !== 'refuted' && fact.knownBy.includes(characterId))
  const privateKnowledge = facts.map(fact => {
    const prefix = fact.status === 'uncertain' ? '[不确定] ' : ''
    const citations = workspace.citations.filter(citation => citation.target?.kind === 'fact' && citation.target.factId === fact.id)
    return [`- ${prefix}${fact.text}`, ...citations.map(citation => `  ${renderStoryCitation(workspace, citation)}`)].join('\n')
  }).join('\n')
  const playerInput = cleanDocument(scene.playerInput, '本轮玩家输入')
  const text = [
    `# 人物：${character.name}`,
    '## Persona',
    character.persona,
    '## 此人物已经知道的事实',
    privateKnowledge,
    '## 本轮玩家输入',
    playerInput,
    '只能依据以上材料决定该人物此刻相信什么、注意到什么和采取什么行动。不得假设其他人物的私有知识，也不得读取导演故事图、建议节点或未公开的未来安排。',
  ].join('\n\n')
  return {
    workspaceId: workspace.id,
    characterId,
    characterName: character.name,
    persona: character.persona,
    privateKnowledge,
    playerInput,
    text,
  }
}
