/** File-backed typed story workspaces and character-specific context compilation. */

import { createHash, randomUUID } from 'node:crypto'
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
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-session'
import {
  createDefaultPlayWorldRegistry,
  projectPlayWorldTurn,
  type PlayWorldContext,
  type PlayWorldModule,
  type PlayWorldRegistry,
  type PlayWorldWorkspaceScaffold,
} from './play-world.ts'
import type {
  PlayWorldActionRequest,
  PlayWorldBinding,
  PlayWorldCastSelection,
  PlayWorldCastUpdateRequest,
  PlayWorldInstallRequest,
  PlayWorldResourceDescriptor,
  PlayWorldRestartRequest,
  PlayWorldSnapshot,
  PlayWorldTurnProjection,
} from './play-world-protocol.ts'
import {
  RoleplayResourceCatalog,
  type RoleplayActorProjection,
  type RoleplayWorldProjection,
} from './roleplay-resource-catalog.ts'
import type { RoleplayResourceSelection } from './roleplay-resource-catalog-protocol.ts'
import { flyingChessWorldResourceProvider } from './play-world-resource-provider.ts'
import type {
  StoryAudience,
  StoryCitation,
  StoryCharacter,
  StoryCharacterActorBaseline,
  StoryCharacterActorBindRequest,
  StoryCharacterActorField,
  StoryCharacterActorSyncReport,
  StoryCharacterProfile,
  StoryCharacterState,
  StoryEdge,
  StoryEdgeKind,
  StoryEvent,
  StoryFact,
  StoryFactStatus,
  StoryForeshadowStatus,
  StoryKnowledgePolicy,
  StoryNode,
  StoryNodeKind,
  StoryNodeLifecycle,
  StoryNodeStatus,
  StoryOutput,
  StoryOutputKind,
  StoryPipelineSettings,
  StoryVoiceDraftReasoning,
  StoryResearchItem,
  StorySource,
  StorySourceOrigin,
  StorySourceKind,
  StorySuggestionEndpoint,
  StoryTurnMaterialization,
  StoryWorldActionReceipt,
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
const MAX_WORLD_ACTION_RECEIPTS = 256
const MAX_CHARACTER_VOICE_ALIASES = 32
const NODE_KINDS = new Set<StoryNodeKind>(['arc', 'beat', 'secret'])
const NODE_LIFECYCLES = new Set<StoryNodeLifecycle>(['canonical', 'suggested'])
const NODE_STATUSES = new Set<StoryNodeStatus>(['planned', 'active', 'completed', 'dropped'])
const EDGE_KINDS = new Set<StoryEdgeKind>(['precedes', 'causes', 'foreshadows'])
const FORESHADOW_STATUSES = new Set<StoryForeshadowStatus>(['unplanted', 'planted', 'triggered', 'resolved', 'dropped'])
const AUDIENCES = new Set<StoryAudience>(['director', 'public'])
const FACT_STATUSES = new Set<StoryFactStatus>(['asserted', 'uncertain', 'refuted'])
const KNOWLEDGE_MODES = new Set<StoryKnowledgePolicy['mode']>(['inherit', 'none', 'participants', 'characters'])
const OUTPUT_KINDS = new Set<StoryOutputKind>(['prose', 'character', 'history'])
const SOURCE_KINDS = new Set<StorySourceKind>(['original', 'reference', 'research', 'web'])
const VOICE_DRAFT_REASONING = new Set<StoryVoiceDraftReasoning>(['routine', 'quality'])
const DEFAULT_STORY_PIPELINE: StoryPipelineSettings = {
  maxParallel: 4,
  researchMaxPasses: 2,
  voiceDraftReasoning: 'routine',
}
const DEFAULT_PLAY_WORLD_REGISTRY = createDefaultPlayWorldRegistry()
const DEFAULT_PLAY_WORLD_RESOURCES = new RoleplayResourceCatalog()
DEFAULT_PLAY_WORLD_RESOURCES.register(flyingChessWorldResourceProvider())

const CHARACTER_ACTOR_FIELDS = [
  'name',
  'voiceAliases',
  'description',
  'personality',
  'scenario',
  'exampleDialogue',
  'systemPrompt',
  'postHistoryInstructions',
] as const satisfies readonly StoryCharacterActorField[]
const CHARACTER_ACTOR_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u

interface StoredStoryNode extends Omit<StoryNode, 'content'> {}
interface StoredStoryCharacter extends Omit<StoryCharacter, 'profile'> {}
interface StoredStoryOutput extends Omit<StoryOutput, 'instructions'> {}
interface StoredStorySource extends Omit<StorySource, 'content'> {}

interface StoredStoryWorkspace {
  readonly format: 2
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
  readonly world?: PlayWorldSnapshot
  readonly worldBinding?: PlayWorldBinding
  readonly worldActionReceipts?: readonly StoryWorldActionReceipt[]
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
  readonly worlds?: PlayWorldRegistry
  readonly resources?: RoleplayResourceCatalog
}

/** One model-selected legal action guarded by a stable story-turn idempotency key. */
export interface StoryWorldCharacterActionRequest {
  readonly key: string
  readonly runKey: string
  readonly revision: number
  readonly cycleId: string
  readonly sequence: number
  readonly characterId: string
  readonly actionId: string
  readonly resultEventSeq: number
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
  readonly profile: StoryCharacterProfile
  readonly state: StoryCharacterState
  readonly privateKnowledge: string
  readonly worldContext: string
  readonly playerInput: string
  readonly text: string
}

/** Persisted workspace plus the field-level outcome of one Character Card source change. */
export interface StoryCharacterActorBindResult {
  readonly workspace: StoryWorkspaceSnapshot
  readonly sync: StoryCharacterActorSyncReport
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

function normalizeResourceSelection(value: unknown, kind: 'actor' | 'world', subject: string): RoleplayResourceSelection {
  if (!isRecord(value) || value.kind !== kind || typeof value.id !== 'string'
    || value.id.trim() === '' || value.id.trim() !== value.id || /\s/u.test(value.id)
    || value.variant !== undefined && (typeof value.variant !== 'string'
      || value.variant.trim() === '' || value.variant.trim() !== value.variant || /\s/u.test(value.variant))
    || Object.keys(value).some(key => key !== 'kind' && key !== 'id' && key !== 'variant')) {
    throw new Error(`${subject}无效`)
  }
  return {
    kind,
    id: value.id,
    ...(value.variant === undefined ? {} : { variant: value.variant }),
  }
}

function requiredLabel(value: unknown, subject: string, max = 240): string {
  const result = cleanLabel(value, subject, max)
  if (result === '') throw new Error(`${subject}不能为空`)
  return result
}

function normalizeWorldActionReceipt(value: unknown, characterIds: ReadonlySet<string>): StoryWorldActionReceipt {
  if (!isRecord(value) || !Array.isArray(value.eventSequences)) throw new Error('世界动作收据字段无效')
  const characterId = requiredLabel(value.characterId, '世界动作人物')
  assertId(characterId, CHARACTER_ID_PATTERN, '世界动作人物')
  if (!characterIds.has(characterId)) throw new Error('世界动作收据指向未知人物')
  if (value.eventSequences.length > 64) throw new Error('单次世界动作事件过多')
  return {
    key: requiredLabel(value.key, '世界动作收据 key'),
    runKey: requiredLabel(value.runKey, '世界动作运行 key'),
    worldInstanceId: requiredLabel(value.worldInstanceId, '世界实例 id'),
    cycleId: requiredLabel(value.cycleId, '世界回合 id'),
    sequence: safeInteger(value.sequence, '世界动作序号'),
    characterId,
    actionId: requiredLabel(value.actionId, '世界动作 id'),
    resultEventSeq: safeInteger(value.resultEventSeq, '世界动作决策事件序号'),
    eventSequences: value.eventSequences.map(sequence => safeInteger(sequence, '世界事件序号')),
  }
}

function normalizeWorldBinding(value: unknown, moduleId: string): PlayWorldBinding {
  if (value === undefined) {
    return { moduleId, configuration: {}, sourceReferences: [], sourceIds: [], cast: [] }
  }
  if (!isRecord(value) || value.moduleId !== moduleId || !Array.isArray(value.sourceReferences)
    || !Array.isArray(value.sourceIds) || value.cast !== undefined && !Array.isArray(value.cast)
    || Object.keys(value).some(key => !['resource', 'moduleId', 'configuration', 'sourceReferences', 'sourceIds', 'cast'].includes(key))) {
    throw new Error('游玩世界资源绑定无效')
  }
  const configuration = snapshotJsonValue(value.configuration) as JsonValue | undefined
  if (configuration === undefined || Buffer.byteLength(JSON.stringify(configuration), 'utf8') > 1024 * 1024) {
    throw new Error('游玩世界结构化配置无效')
  }
  const resource = value.resource === undefined
    ? undefined
    : normalizeResourceSelection(value.resource, 'world', '游玩世界资源引用')
  const sourceReferences = value.sourceReferences.map(reference => normalizeResourceSelection(
    reference, 'world', '游玩世界资料引用',
  ))
  if (new Set(sourceReferences.map(reference => JSON.stringify(reference))).size !== sourceReferences.length) {
    throw new Error('游玩世界资料引用重复')
  }
  const sourceIds = value.sourceIds.map(sourceId => {
    assertId(sourceId, SOURCE_ID_PATTERN, '游玩世界资料')
    return sourceId as string
  })
  if (new Set(sourceIds).size !== sourceIds.length || sourceIds.length !== sourceReferences.length) {
    throw new Error('游玩世界资料绑定无效')
  }
  const castValues = value.cast ?? []
  if (castValues.length > 64) throw new Error('游玩世界人物槽位绑定过多')
  const cast = castValues.map((item) => {
    if (!isRecord(item) || Object.keys(item).some(key => key !== 'slotId' && key !== 'characterId')) {
      throw new Error('游玩世界人物槽位绑定无效')
    }
    const slotId = requiredLabel(item.slotId, '游玩世界人物槽位 id')
    if (/\s/u.test(slotId)) throw new Error('游玩世界人物槽位 id 不能包含空白')
    assertId(item.characterId, CHARACTER_ID_PATTERN, '游玩世界人物')
    return { slotId, characterId: item.characterId as string }
  })
  if (new Set(cast.map(item => item.slotId)).size !== cast.length
    || new Set(cast.map(item => item.characterId)).size !== cast.length) {
    throw new Error('游玩世界人物槽位绑定重复')
  }
  return {
    ...(resource === undefined ? {} : { resource }),
    moduleId,
    configuration,
    sourceReferences,
    sourceIds,
    cast,
  }
}

function playWorldContext(
  characters: readonly StoryCharacter[],
  binding: PlayWorldBinding,
): PlayWorldContext {
  const selectedCharacters = binding.cast.length === 0
    ? characters
    : binding.cast.map(item => {
        const character = characters.find(candidate => candidate.id === item.characterId)
        if (character === undefined) throw new Error(`游玩世界人物槽位 ${JSON.stringify(item.slotId)} 指向未知人物`)
        return character
      })
  return {
    characters: selectedCharacters,
    configuration: binding.configuration,
    sourceReferences: binding.sourceReferences,
  }
}

function emptyCharacterProfile(description = ''): StoryCharacterProfile {
  return {
    description,
    personality: '',
    scenario: '',
    exampleDialogue: '',
    systemPrompt: '',
    postHistoryInstructions: '',
  }
}

function emptyCharacterState(): StoryCharacterState {
  return { location: '', condition: '', objective: '', notes: '' }
}

function normalizeCharacterProfile(value: unknown): StoryCharacterProfile {
  if (!isRecord(value) || Object.keys(value).some(key => ![
    'description', 'personality', 'scenario', 'exampleDialogue', 'systemPrompt', 'postHistoryInstructions',
  ].includes(key))) throw new Error('人物档案字段无效')
  return {
    description: cleanDocument(value.description, '人物描述'),
    personality: cleanDocument(value.personality, '人物性格'),
    scenario: cleanDocument(value.scenario, '人物场景基线'),
    exampleDialogue: cleanDocument(value.exampleDialogue, '人物对话示例'),
    systemPrompt: cleanDocument(value.systemPrompt, '人物系统指令'),
    postHistoryInstructions: cleanDocument(value.postHistoryInstructions, '人物历史后指令'),
  }
}

function normalizeCharacterState(value: unknown): StoryCharacterState {
  if (!isRecord(value) || Object.keys(value).some(key => !['location', 'condition', 'objective', 'notes'].includes(key))) {
    throw new Error('人物场地状态字段无效')
  }
  return {
    location: cleanDocument(value.location, '人物当前位置'),
    condition: cleanDocument(value.condition, '人物当前状态'),
    objective: cleanDocument(value.objective, '人物当前目标'),
    notes: cleanDocument(value.notes, '人物场地备注'),
  }
}

interface CharacterActorValues {
  readonly name: string
  readonly voiceAliases: readonly string[]
  readonly description: string
  readonly personality: string
  readonly scenario: string
  readonly exampleDialogue: string
  readonly systemPrompt: string
  readonly postHistoryInstructions: string
}

interface CharacterActorMergeResult {
  readonly character: StoryCharacter
  readonly report: StoryCharacterActorSyncReport
}

function normalizeCharacterActorBaseline(value: unknown): StoryCharacterActorBaseline {
  if (!isRecord(value) || value.format !== 0 || !isRecord(value.fingerprints)) {
    throw new Error('人物角色卡同步基线无效')
  }
  const fingerprints = value.fingerprints
  if (Object.keys(value).some(key => key !== 'format' && key !== 'fingerprints')
    || Object.keys(fingerprints).length !== CHARACTER_ACTOR_FIELDS.length
    || CHARACTER_ACTOR_FIELDS.some(field => !CHARACTER_ACTOR_FINGERPRINT_PATTERN.test(
      typeof fingerprints[field] === 'string' ? fingerprints[field] : '',
    ))) {
    throw new Error('人物角色卡同步基线无效')
  }
  return {
    format: 0,
    fingerprints: Object.fromEntries(CHARACTER_ACTOR_FIELDS.map(field => [field, fingerprints[field] as string])) as
      Readonly<Record<StoryCharacterActorField, string>>,
  }
}

function characterActorValues(character: StoryCharacter): CharacterActorValues {
  return {
    name: character.name,
    voiceAliases: character.voiceAliases ?? [],
    description: character.profile.description,
    personality: character.profile.personality,
    scenario: character.profile.scenario,
    exampleDialogue: character.profile.exampleDialogue,
    systemPrompt: character.profile.systemPrompt,
    postHistoryInstructions: character.profile.postHistoryInstructions,
  }
}

function projectedCharacterActorValues(projection: RoleplayActorProjection): CharacterActorValues {
  return {
    name: projection.name,
    voiceAliases: projection.voiceAliases,
    description: projection.profile.description,
    personality: projection.profile.personality,
    scenario: projection.profile.scenario,
    exampleDialogue: projection.profile.exampleDialogue,
    systemPrompt: projection.profile.systemPrompt,
    postHistoryInstructions: projection.profile.postHistoryInstructions,
  }
}

function actorValueFingerprint(value: string | readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function characterActorBaseline(values: CharacterActorValues): StoryCharacterActorBaseline {
  return {
    format: 0,
    fingerprints: Object.fromEntries(CHARACTER_ACTOR_FIELDS.map(field => [field, actorValueFingerprint(values[field])])) as
      Readonly<Record<StoryCharacterActorField, string>>,
  }
}

function sameResourceSelection(left: RoleplayResourceSelection | undefined, right: RoleplayResourceSelection): boolean {
  return left?.kind === right.kind && left.id === right.id && left.variant === right.variant
}

function characterWithActorValues(
  character: StoryCharacter,
  actor: RoleplayResourceSelection,
  values: CharacterActorValues,
  baseline: StoryCharacterActorBaseline,
): StoryCharacter {
  return {
    ...character,
    name: values.name,
    voiceAliases: values.voiceAliases,
    profile: {
      description: values.description,
      personality: values.personality,
      scenario: values.scenario,
      exampleDialogue: values.exampleDialogue,
      systemPrompt: values.systemPrompt,
      postHistoryInstructions: values.postHistoryInstructions,
    },
    actor,
    actorBaseline: baseline,
  }
}

function mergeCharacterActor(
  character: StoryCharacter,
  actor: RoleplayResourceSelection,
  projection: RoleplayActorProjection,
): CharacterActorMergeResult {
  const current = characterActorValues(character)
  const projected = projectedCharacterActorValues(projection)
  const nextBaseline = characterActorBaseline(projected)
  if (!sameResourceSelection(character.actor, actor)) {
    return {
      character: characterWithActorValues(character, actor, projected, nextBaseline),
      report: {
        mode: 'replaced',
        baselineCreated: false,
        updatedFields: CHARACTER_ACTOR_FIELDS.filter(field => (
          actorValueFingerprint(current[field]) !== nextBaseline.fingerprints[field]
        )),
        preservedFields: [],
      },
    }
  }
  const previousBaseline = character.actorBaseline
  const updatedFields: StoryCharacterActorField[] = []
  const preservedFields: StoryCharacterActorField[] = []
  const select = <Field extends StoryCharacterActorField>(field: Field): CharacterActorValues[Field] => {
    const currentFingerprint = actorValueFingerprint(current[field])
    const sourceManaged = previousBaseline === undefined
      ? currentFingerprint === nextBaseline.fingerprints[field]
      : currentFingerprint === previousBaseline.fingerprints[field]
    if (!sourceManaged) {
      preservedFields.push(field)
      return current[field]
    }
    if (currentFingerprint !== nextBaseline.fingerprints[field]) updatedFields.push(field)
    return projected[field]
  }
  const merged: CharacterActorValues = {
    name: select('name'),
    voiceAliases: select('voiceAliases'),
    description: select('description'),
    personality: select('personality'),
    scenario: select('scenario'),
    exampleDialogue: select('exampleDialogue'),
    systemPrompt: select('systemPrompt'),
    postHistoryInstructions: select('postHistoryInstructions'),
  }
  return {
    character: characterWithActorValues(character, actor, merged, nextBaseline),
    report: {
      mode: 'refreshed',
      baselineCreated: previousBaseline === undefined,
      updatedFields,
      preservedFields,
    },
  }
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
  const voiceDraftReasoning = value.voiceDraftReasoning === undefined
    ? DEFAULT_STORY_PIPELINE.voiceDraftReasoning
    : value.voiceDraftReasoning
  if (!Number.isSafeInteger(value.maxParallel) || (value.maxParallel as number) < 1
    || (value.maxParallel as number) > 8) {
    throw new Error('故事流水线并发数应为 1 至 8')
  }
  if (!Number.isSafeInteger(researchMaxPasses) || (researchMaxPasses as number) < 1
    || (researchMaxPasses as number) > 4) throw new Error('故事研究轮数应为 1 至 4')
  if (!VOICE_DRAFT_REASONING.has(voiceDraftReasoning as StoryVoiceDraftReasoning)) {
    throw new Error('对白起草推理策略无效')
  }
  if (Object.keys(value).some(key => key !== 'maxParallel' && key !== 'researchMaxPasses'
    && key !== 'voiceDraftReasoning' && key !== 'workerModel')) {
    throw new Error('故事流水线设置字段无效')
  }
  const normalized = {
    maxParallel: value.maxParallel as number,
    researchMaxPasses: researchMaxPasses as number,
    voiceDraftReasoning: voiceDraftReasoning as StoryVoiceDraftReasoning,
  }
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
  let actor: StoryCharacter['actor']
  if (value.actor !== undefined) {
    actor = normalizeResourceSelection(value.actor, 'actor', '人物绑定的角色资源')
  }
  if (actor === undefined && value.actorBaseline !== undefined) throw new Error('人物角色卡同步基线没有对应来源')
  const actorBaseline = value.actorBaseline === undefined
    ? undefined
    : normalizeCharacterActorBaseline(value.actorBaseline)
  return {
    id: value.id,
    name: cleanName(value.name, '人物'),
    voiceAliases: normalizeCharacterVoiceAliases(value.voiceAliases),
    profile: normalizeCharacterProfile(value.profile),
    state: normalizeCharacterState(value.state),
    ...(actor === undefined ? {} : { actor }),
    ...(actorBaseline === undefined ? {} : { actorBaseline }),
  }
}

function normalizeCharacterVoiceAliases(value: unknown): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(alias => typeof alias !== 'string')) {
    throw new Error(`人物原作署名应为不超过 ${String(MAX_CHARACTER_VOICE_ALIASES)} 项的文本数组`)
  }
  const rawAliases = value as readonly string[]
  const populated = rawAliases.map(alias => alias.trim()).filter(alias => alias !== '')
  if (populated.length > MAX_CHARACTER_VOICE_ALIASES) {
    throw new Error(`人物原作署名应为不超过 ${String(MAX_CHARACTER_VOICE_ALIASES)} 项的文本数组`)
  }
  const aliases: string[] = []
  const normalized = new Set<string>()
  for (const rawAlias of populated) {
    const alias = cleanName(rawAlias, '人物原作署名')
    const key = alias.normalize('NFKC')
    if (normalized.has(key)) continue
    normalized.add(key)
    aliases.push(alias)
  }
  return aliases
}

function normalizeKnowledgePolicy(value: unknown, characterIds: ReadonlySet<string>): StoryKnowledgePolicy {
  if (!isRecord(value) || !KNOWLEDGE_MODES.has(value.mode as StoryKnowledgePolicy['mode'])) {
    throw new Error('故事节点认知策略无效')
  }
  const ids = stringArray(value.characterIds, '故事节点认知人物')
  for (const id of ids) {
    if (!characterIds.has(id)) throw new Error(`故事节点认知策略引用未知人物 ${JSON.stringify(id)}`)
  }
  if (value.mode !== 'characters' && ids.length > 0) throw new Error('只有指定人物认知策略可以列出人物')
  return { mode: value.mode as StoryKnowledgePolicy['mode'], characterIds: ids }
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
  if (value.parentId !== undefined) assertId(value.parentId, NODE_ID_PATTERN, '故事节点父级')
  if (value.sourceEventId !== undefined) assertId(value.sourceEventId, EVENT_ID_PATTERN, '故事节点来源事件')
  return {
    id: value.id,
    kind: value.kind as StoryNodeKind,
    ...(value.parentId === undefined ? {} : { parentId: value.parentId }),
    title: cleanName(value.title, '故事节点'),
    summary: cleanDocument(value.summary, '故事节点摘要'),
    status: value.status as StoryNodeStatus,
    lifecycle: value.lifecycle as StoryNodeLifecycle,
    audience: value.audience as StoryAudience,
    position: {
      x: finiteCoordinate(value.position.x, '故事节点横坐标'),
      y: finiteCoordinate(value.position.y, '故事节点纵坐标'),
    },
    content: cleanDocument(value.content, '故事节点内容'),
    participantIds,
    knowledge: normalizeKnowledgePolicy(value.knowledge, characterIds),
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

function normalizeEvent(
  value: unknown,
  characterIds: ReadonlySet<string>,
  nodeIds: ReadonlySet<string>,
  worldEventSequences: ReadonlySet<number>,
): StoryEvent {
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
  const referencedWorldEvents = value.worldEventSequences === undefined
    ? []
    : Array.isArray(value.worldEventSequences)
      ? value.worldEventSequences.map(sequence => safeInteger(sequence, '故事事件世界事件序号'))
      : (() => { throw new Error('故事事件世界事件序号字段无效') })()
  if (referencedWorldEvents.length > 64 || new Set(referencedWorldEvents).size !== referencedWorldEvents.length) {
    throw new Error('故事事件引用了过多或重复的世界事件')
  }
  if (referencedWorldEvents.some(sequence => !worldEventSequences.has(sequence))) {
    throw new Error('故事事件引用未知世界事件')
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
    ...(referencedWorldEvents.length === 0 ? {} : { worldEventSequences: referencedWorldEvents }),
  }
}

function normalizeFact(
  value: unknown,
  characterIds: ReadonlySet<string>,
  eventIds: ReadonlySet<string>,
  nodeIds: ReadonlySet<string>,
): StoryFact {
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
  if (value.knowledgeMode !== 'inherit' && value.knowledgeMode !== 'override') throw new Error('人物事实认知模式无效')
  if (value.nodeId !== undefined) {
    assertId(value.nodeId, NODE_ID_PATTERN, '人物事实所属节点')
    if (!nodeIds.has(value.nodeId)) throw new Error('人物事实引用未知故事节点')
  }
  if (value.knowledgeMode === 'inherit' && value.nodeId === undefined) throw new Error('继承认知的人物事实必须属于故事节点')
  return {
    id: value.id,
    ...(value.nodeId === undefined ? {} : { nodeId: value.nodeId }),
    text: cleanDocument(value.text, '人物事实'),
    status: value.status as StoryFactStatus,
    audience: value.audience as StoryAudience,
    knowledgeMode: value.knowledgeMode,
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
  if (!isRecord(value)) throw new Error('故事资料来源无效')
  if (value.kind === 'resource') {
    if (Object.keys(value).some(key => key !== 'kind' && key !== 'resource')) throw new Error('故事资料来源无效')
    return { kind: 'resource', resource: normalizeResourceSelection(value.resource, 'world', '故事资料资源引用') }
  }
  if (value.kind === 'url') {
    if (typeof value.truncated !== 'boolean'
      || Object.keys(value).some(key => !['kind', 'url', 'requestedUrl', 'truncated'].includes(key))) {
      throw new Error('故事资料 URL 来源无效')
    }
    const url = cleanWebUrl(value.url, '故事资料来源 URL')
    const requestedUrl = value.requestedUrl === undefined
      ? undefined
      : cleanWebUrl(value.requestedUrl, '故事资料请求 URL')
    return {
      kind: 'url',
      url,
      ...(requestedUrl === undefined || requestedUrl === url ? {} : { requestedUrl }),
      truncated: value.truncated,
    }
  }
  if (value.kind !== 'web') throw new Error('故事资料来源无效')
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

function sourceOriginUrls(source: StorySource): readonly string[] {
  if (source.origin?.kind === 'web') return [source.origin.url]
  if (source.origin?.kind !== 'url') return []
  return source.origin.requestedUrl === undefined
    ? [source.origin.url]
    : [source.origin.url, source.origin.requestedUrl]
}

function normalizeResearchItem(value: unknown): StoryResearchItem {
  if (!isRecord(value)) throw new Error('研究收件箱项目不是对象')
  assertId(value.id, RESEARCH_ID_PATTERN, '研究收件箱项目')
  const origin = normalizeSourceOrigin(value)
  if (origin.kind !== 'web') throw new Error('研究收件箱来源必须是网络结果')
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
  eventIds: ReadonlySet<string>,
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
    } else if (value.target.kind === 'event') {
      assertId(value.target.eventId, EVENT_ID_PATTERN, '资料引用故事事件')
      if (!eventIds.has(value.target.eventId)) throw new Error('资料引用指向未知故事事件')
      target = { kind: 'event', eventId: value.target.eventId }
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

function normalizeWorkspace(value: unknown, worlds: PlayWorldRegistry): StoryWorkspaceSnapshot {
  if (!isRecord(value) || value.format !== 2 || !isRecord(value.graph)
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
  const rawWorldModuleId = isRecord(value.world) && typeof value.world.moduleId === 'string'
    ? value.world.moduleId
    : undefined
  if (value.world !== undefined && rawWorldModuleId === undefined) throw new Error('游玩世界快照无效')
  const worldBinding = rawWorldModuleId === undefined
    ? undefined
    : normalizeWorldBinding(value.worldBinding, rawWorldModuleId)
  if (value.world === undefined && value.worldBinding !== undefined) throw new Error('游玩世界资源绑定没有对应世界')
  const world = value.world === undefined || worldBinding === undefined
    ? undefined
    : worlds.normalizeStored(value.world, playWorldContext(characters, worldBinding))
  const worldActionReceipts = value.worldActionReceipts === undefined
    ? []
    : Array.isArray(value.worldActionReceipts)
      ? value.worldActionReceipts.map(receipt => normalizeWorldActionReceipt(receipt, characterIds))
      : (() => { throw new Error('世界动作收据字段无效') })()
  if (worldActionReceipts.length > MAX_WORLD_ACTION_RECEIPTS) throw new Error('世界动作收据过多')
  assertUnique(worldActionReceipts.map(receipt => receipt.key), '世界动作收据')
  if (world === undefined && worldActionReceipts.length > 0
    || world !== undefined && worldActionReceipts.some(receipt => receipt.worldInstanceId !== world.instanceId)) {
    throw new Error('世界动作收据不属于当前世界实例')
  }
  const nodes = value.graph.nodes.map(node => normalizeNode(node, characterIds))
  assertUnique(nodes.map(node => node.id), '故事节点')
  const nodeIds = new Set(nodes.map(node => node.id))
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  for (const node of nodes) {
    if (node.parentId === undefined) continue
    if (!nodeIds.has(node.parentId) || node.parentId === node.id) throw new Error('故事节点父级无效')
    const directParent = nodeById.get(node.parentId)
    if (directParent?.kind !== 'arc' && directParent?.kind !== 'beat') throw new Error('故事节点父级必须是篇章或场景')
    if (node.lifecycle === 'canonical' && directParent.lifecycle !== 'canonical') {
      throw new Error('正式故事节点不能属于候选故事簇')
    }
    const visited = new Set<string>([node.id])
    let parentId: string | undefined = node.parentId
    while (parentId !== undefined) {
      if (visited.has(parentId)) throw new Error('故事节点层级不能形成循环')
      visited.add(parentId)
      parentId = nodeById.get(parentId)?.parentId
    }
  }
  const edges = value.graph.edges.map(edge => normalizeEdge(edge, nodeIds))
  assertUnique(edges.map(edge => edge.id), '故事关系')
  const worldEventSequences = new Set(world?.events.map(event => event.sequence) ?? [])
  const events = value.events.map(event => normalizeEvent(event, characterIds, nodeIds, worldEventSequences))
  assertUnique(events.map(event => event.id), '故事事件')
  assertUnique(events.map(event => event.key), '故事事件幂等键')
  const representedWorldEvents = events.flatMap(event => event.worldEventSequences ?? [])
  if (new Set(representedWorldEvents).size !== representedWorldEvents.length) {
    throw new Error('一个世界事件不能归属多个故事事件')
  }
  const eventIds = new Set(events.map(event => event.id))
  const facts = value.facts.map(fact => normalizeFact(fact, characterIds, eventIds, nodeIds))
  assertUnique(facts.map(fact => fact.id), '人物事实')
  const factIds = new Set(facts.map(fact => fact.id))
  const outputs = value.outputs.map(output => normalizeOutput(output, characterIds))
  assertUnique(outputs.map(output => output.id), '输出分区')
  const sources = value.sources.map(normalizeSource)
  assertUnique(sources.map(source => source.id), '故事资料')
  const sourceIds = new Set(sources.map(source => source.id))
  if (worldBinding !== undefined) {
    for (const [index, sourceId] of worldBinding.sourceIds.entries()) {
      const source = sources.find(candidate => candidate.id === sourceId)
      const expected = worldBinding.sourceReferences[index]
      if (source === undefined || source.origin?.kind !== 'resource'
        || expected === undefined || JSON.stringify(source.origin.resource) !== JSON.stringify(expected)) {
        throw new Error('游玩世界资料绑定指向不一致的故事资料')
      }
    }
  }
  const citations = value.citations.map(citation => normalizeCitation(citation, sourceIds, nodeIds, factIds, eventIds))
  assertUnique(citations.map(citation => citation.id), '资料引用')
  const researchInbox = value.researchInbox.map(normalizeResearchItem)
  assertUnique(researchInbox.map(item => item.id), '研究收件箱项目')
  assertUnique(researchInbox.map(item => item.url), '研究收件箱 URL')
  const acceptedWebUrls = new Set(sources.flatMap(sourceOriginUrls))
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
  const documents = nodes.flatMap(node => [node.summary, node.content])
    .concat(characters.flatMap(character => [
      ...Object.values(character.profile),
      ...Object.values(character.state),
    ]))
    .concat(facts.flatMap(fact => [fact.text, fact.source.kind === 'event' ? fact.source.evidence : '']))
    .concat(events.flatMap(event => [event.summary, event.evidence]))
    .concat(outputs.map(output => output.instructions))
    .concat(sources.map(source => source.content))
    .concat(citations.flatMap(citation => [citation.quote, citation.note]))
    .concat(researchInbox.flatMap(item => [item.query, item.title, item.snippet]))
  const bytes = documents.reduce((total, document) => total + Buffer.byteLength(document, 'utf8'), 0)
    + (world === undefined ? 0 : Buffer.byteLength(JSON.stringify(world), 'utf8'))
    + (worldBinding === undefined ? 0 : Buffer.byteLength(JSON.stringify(worldBinding), 'utf8'))
    + Buffer.byteLength(JSON.stringify(worldActionReceipts), 'utf8')
  if (bytes > MAX_WORKSPACE_BYTES) throw new Error(`故事工作室不能超过 ${String(MAX_WORKSPACE_BYTES)} 字节`)
  return {
    format: 2,
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
    ...(world === undefined ? {} : { world }),
    ...(worldBinding === undefined ? {} : { worldBinding }),
    ...(worldActionReceipts.length === 0 ? {} : { worldActionReceipts }),
  }
}

/** Reconstruct the exact module context retained with one durable workspace world. */
export function resolveStoryPlayWorldContext(workspace: StoryWorkspaceSnapshot): PlayWorldContext {
  if (workspace.world === undefined) throw new Error('当前游玩场地没有可执行世界')
  return playWorldContext(
    workspace.characters,
    workspace.worldBinding ?? normalizeWorldBinding(undefined, workspace.world.moduleId),
  )
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

function readCharacterProfile(root: string, id: string): StoryCharacterProfile {
  const characterRoot = join(root, 'characters', id)
  const descriptionPath = join(characterRoot, 'description.md')
  if (!existsSync(descriptionPath)) {
    return emptyCharacterProfile(readOptionalMarkdown(join(characterRoot, 'persona.md')))
  }
  return {
    description: readMarkdown(descriptionPath),
    personality: readOptionalMarkdown(join(characterRoot, 'personality.md')),
    scenario: readOptionalMarkdown(join(characterRoot, 'scenario.md')),
    exampleDialogue: readOptionalMarkdown(join(characterRoot, 'example-dialogue.md')),
    systemPrompt: readOptionalMarkdown(join(characterRoot, 'system-prompt.md')),
    postHistoryInstructions: readOptionalMarkdown(join(characterRoot, 'post-history-instructions.md')),
  }
}

function withoutLegacyTurnMarkers(value: string): string {
  return value
    .replace(/^\s*<!--\s*agent-rp:story-turn:[^>]*-->\s*$/gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function compactStored(snapshot: StoryWorkspaceSnapshot): StoredStoryWorkspace {
  return {
    format: 2,
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
    characters: snapshot.characters.map(({ profile: _profile, ...character }) => character),
    facts: snapshot.facts,
    events: snapshot.events,
    outputs: snapshot.outputs.map(({ instructions: _instructions, ...output }) => output),
    sources: snapshot.sources.map(({ content: _content, ...source }) => source),
    citations: snapshot.citations,
    researchInbox: snapshot.researchInbox,
    ...(snapshot.world === undefined ? {} : { world: snapshot.world }),
    ...(snapshot.worldBinding === undefined ? {} : { worldBinding: snapshot.worldBinding }),
    ...(snapshot.worldActionReceipts === undefined ? {} : { worldActionReceipts: snapshot.worldActionReceipts }),
  }
}

function hydrateStored(root: string, value: unknown, worlds: PlayWorldRegistry): StoryWorkspaceSnapshot {
  if (!isRecord(value) || value.format !== 2 || !isRecord(value.graph)
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
    return { ...item, state: item.state ?? emptyCharacterState(), profile: readCharacterProfile(root, item.id) }
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
    graph: {
      ...value.graph,
      nodes,
      edges: Array.isArray(value.graph.edges)
        ? value.graph.edges.filter(edge => !isRecord(edge) || edge.kind !== 'contains')
        : value.graph.edges,
    },
    characters,
    outputs,
    sources,
    citations: Array.isArray(value.citations) ? value.citations : [],
    researchInbox: Array.isArray(value.researchInbox) ? value.researchInbox : [],
  }, worlds)
}

function migrateTypedFormat1(root: string, value: unknown, worlds: PlayWorldRegistry): StoryWorkspaceSnapshot {
  if (!isRecord(value) || value.format !== 1 || !isRecord(value.graph)
    || !Array.isArray(value.graph.nodes) || !Array.isArray(value.characters)
    || !Array.isArray(value.facts) || !Array.isArray(value.events)
    || !Array.isArray(value.outputs) || !Array.isArray(value.sources)) {
    throw new Error('旧类型化故事工作室索引字段无效')
  }
  const events = value.events
  const eventNodeIds = new Map(events.flatMap(event => isRecord(event)
    && typeof event.id === 'string' && typeof event.nodeId === 'string'
    ? [[event.id, event.nodeId] as const]
    : []))
  const legacyEdges = Array.isArray(value.graph.edges) ? value.graph.edges : []
  const parentByNode = new Map(legacyEdges.flatMap(edge => isRecord(edge)
    && edge.kind === 'contains' && typeof edge.source === 'string' && typeof edge.target === 'string'
    ? [[edge.target, edge.source] as const]
    : []))
  const nodes = value.graph.nodes.map(item => {
    if (!isRecord(item)) throw new Error('旧类型化故事节点索引无效')
    assertId(item.id, NODE_ID_PATTERN, '故事节点')
    const content = readMarkdown(join(root, 'nodes', `${item.id}.md`))
    const participants = Array.isArray(item.participantIds) ? item.participantIds : []
    return {
      ...item,
      ...(parentByNode.get(item.id) === undefined ? {} : { parentId: parentByNode.get(item.id) }),
      summary: content.trim().split('\n').find(line => line.trim() !== '')?.slice(0, 280) ?? String(item.title ?? ''),
      knowledge: item.kind === 'beat'
        ? { mode: 'participants', characterIds: [] }
        : { mode: 'none', characterIds: [] },
      content,
      participantIds: participants,
    }
  })
  const characters = value.characters.map(item => {
    if (!isRecord(item)) throw new Error('人物索引无效')
    assertId(item.id, CHARACTER_ID_PATTERN, '人物')
    return { ...item, state: emptyCharacterState(), profile: readCharacterProfile(root, item.id) }
  })
  const facts = value.facts.map(item => {
    if (!isRecord(item)) throw new Error('旧类型化人物事实索引无效')
    const sourceEventId = isRecord(item.source) && item.source.kind === 'event' && typeof item.source.eventId === 'string'
      ? item.source.eventId
      : undefined
    const nodeId = sourceEventId === undefined ? undefined : eventNodeIds.get(sourceEventId)
    return { ...item, knowledgeMode: 'override', ...(nodeId === undefined ? {} : { nodeId }) }
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
    format: 2,
    graph: { ...value.graph, nodes, edges: legacyEdges.filter(edge => !isRecord(edge) || edge.kind !== 'contains') },
    characters,
    facts,
    events,
    outputs,
    sources,
    citations: Array.isArray(value.citations) ? value.citations : [],
    researchInbox: Array.isArray(value.researchInbox) ? value.researchInbox : [],
  }, worlds)
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

/** Resolve the characters who inherit one story cluster's information. */
export function storyNodeKnownBy(workspace: StoryWorkspaceSnapshot, nodeId: string): readonly string[] {
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

/** Resolve one detail's effective character knowledge after cluster inheritance. */
export function storyFactKnownBy(workspace: StoryWorkspaceSnapshot, fact: StoryFact): readonly string[] {
  return fact.knowledgeMode === 'override'
    ? fact.knownBy
    : fact.nodeId === undefined ? [] : storyNodeKnownBy(workspace, fact.nodeId)
}

/** Compile completed events into the public continuity input. */
export function storyPublicHistory(workspace: StoryWorkspaceSnapshot): string {
  return workspace.events.map(event => {
    const citations = workspace.citations.filter(citation => citation.target?.kind === 'event' && citation.target.eventId === event.id)
    return [
      `## ${event.title}\n${event.summary}`,
      citations.length === 0 ? '' : `本回合研究依据：\n${citations.map(citation => renderStoryCitation(workspace, citation)).join('\n')}`,
    ].filter(Boolean).join('\n')
  }).join('\n\n')
}

function renderStoryCitation(workspace: StoryWorkspaceSnapshot, citation: StoryCitation): string {
  const source = workspace.sources.find(candidate => candidate.id === citation.sourceId)
  const location = [source?.name ?? citation.sourceId, citation.locator].filter(Boolean).join(' · ')
  return `- ${location}: ${citation.quote}${citation.note === '' ? '' : `（${citation.note}）`}`
}

/** Compile canonical story objects and relationships for the director. */
export function storyDirectorMap(workspace: StoryWorkspaceSnapshot): string {
  const canonicalNodes = workspace.graph.nodes.filter(node => node.lifecycle === 'canonical' && node.status !== 'dropped')
  const canonicalNodeIds = new Set(canonicalNodes.map(node => node.id))
  const edges = workspace.graph.edges.filter(edge => edge.lifecycle === 'canonical'
    && canonicalNodeIds.has(edge.source) && canonicalNodeIds.has(edge.target))
  const relatedNodeIds = new Set(edges.flatMap(edge => [edge.source, edge.target]))
  const citedNodeIds = new Set(workspace.citations.flatMap(citation => citation.target?.kind === 'node'
    ? [citation.target.nodeId]
    : []))
  const nodes = canonicalNodes.filter(node => node.content.trim() !== '' || node.kind === 'secret'
    || relatedNodeIds.has(node.id) || citedNodeIds.has(node.id))
  const nodeIds = new Set(nodes.map(node => node.id))
  const nodeText = nodes.map(node => {
    const citations = workspace.citations.filter(citation => citation.target?.kind === 'node' && citation.target.nodeId === node.id)
    return [
      `## [${node.kind}] ${node.title} (${node.status})\nid: ${node.id}`,
      node.content,
      citations.length === 0 ? '' : `资料依据：\n${citations.map(citation => renderStoryCitation(workspace, citation)).join('\n')}`,
    ].filter(Boolean).join('\n')
  }).join('\n\n')
  const edgeText = edges
    .filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target))
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

function materializePlayWorldWorkspaceScaffold(
  scaffold: PlayWorldWorkspaceScaffold,
): Pick<StoryWorkspaceSnapshot, 'graph' | 'outputs'> {
  const nodeKeys = scaffold.nodes.map(node => requiredLabel(node.key, '世界场景模板 key'))
  assertUnique(nodeKeys, '世界场景模板')
  const nodeIdByKey = new Map(nodeKeys.map(key => [key, createStoryNodeId()]))
  const resolveNodeId = (key: string, subject: string): string => {
    const nodeId = nodeIdByKey.get(requiredLabel(key, subject))
    if (nodeId === undefined) throw new Error(`${subject}引用了未知世界场景模板`)
    return nodeId
  }
  const nodes: StoryNode[] = scaffold.nodes.map((node, index) => ({
    id: nodeIdByKey.get(nodeKeys[index]!)!,
    kind: node.kind,
    ...(node.parentKey === undefined ? {} : { parentId: resolveNodeId(node.parentKey, '世界场景模板父级') }),
    title: node.title,
    summary: node.summary,
    status: node.status,
    lifecycle: 'canonical',
    audience: node.audience,
    position: node.position,
    content: node.content,
    participantIds: node.participantIds,
    knowledge: node.knowledge,
  }))
  const edgeKeys = scaffold.edges.map(edge => requiredLabel(edge.key, '世界关系模板 key'))
  assertUnique(edgeKeys, '世界关系模板')
  const edges: StoryEdge[] = scaffold.edges.map(edge => ({
    id: createStoryEdgeId(),
    kind: edge.kind,
    source: resolveNodeId(edge.sourceKey, '世界关系模板起点'),
    target: resolveNodeId(edge.targetKey, '世界关系模板终点'),
    label: edge.label,
    lifecycle: 'canonical',
    audience: edge.audience,
    ...(edge.foreshadowStatus === undefined ? {} : { foreshadowStatus: edge.foreshadowStatus }),
  }))
  const outputKeys = scaffold.outputs.map(output => requiredLabel(output.key, '世界输出模板 key'))
  assertUnique(outputKeys, '世界输出模板')
  const outputs: StoryOutput[] = scaffold.outputs.map(output => ({
    id: createStoryOutputId(),
    name: output.name,
    kind: output.kind,
    enabled: output.enabled,
    ...(output.characterId === undefined ? {} : { characterId: output.characterId }),
    instructions: output.instructions,
  }))
  return {
    graph: {
      ...(scaffold.activeNodeKey === undefined
        ? {}
        : { activeNodeId: resolveNodeId(scaffold.activeNodeKey, '世界活动场景模板') }),
      nodes,
      edges,
    },
    outputs,
  }
}

function missingPlayWorldWorkspaceScaffold(
  current: StoryWorkspaceSnapshot,
  module: PlayWorldModule,
  context: PlayWorldContext,
): Partial<Pick<StoryWorkspaceSnapshot, 'graph' | 'outputs'>> {
  const needsGraph = current.graph.nodes.length === 0
  const needsOutputs = current.outputs.length === 0
  if (!needsGraph && !needsOutputs) return {}
  const scaffold = module.createWorkspaceScaffold?.(context)
  if (scaffold === undefined) return {}
  const materialized = materializePlayWorldWorkspaceScaffold(scaffold)
  return {
    ...(needsGraph ? { graph: materialized.graph } : {}),
    ...(needsOutputs ? { outputs: materialized.outputs } : {}),
  }
}

function assemblePlayWorldCast(
  current: StoryWorkspaceSnapshot,
  recipe: RoleplayWorldProjection,
  module: PlayWorldModule,
  resources: RoleplayResourceCatalog,
  requestedCast: readonly PlayWorldCastSelection[],
  existingOnly: boolean,
): { readonly characters: readonly StoryCharacter[]; readonly cast: PlayWorldBinding['cast'] } {
  if (!Array.isArray(requestedCast) || requestedCast.length > 64) {
    throw new Error('游玩世界人物槽位选择无效')
  }
  const castSelections = requestedCast.map(selection => {
    if (!isRecord(selection) || Object.keys(selection).some(key => !['slotId', 'actor', 'characterId'].includes(key))) {
      throw new Error('游玩世界人物槽位选择无效')
    }
    const slotId = requiredLabel(selection.slotId, '游玩世界人物槽位 id')
    if (/\s/u.test(slotId)) throw new Error('游玩世界人物槽位 id 不能包含空白')
    const actor = normalizeResourceSelection(selection.actor, 'actor', `人物槽位 ${JSON.stringify(slotId)} 的角色资源`)
    if (selection.characterId !== undefined) assertId(selection.characterId, CHARACTER_ID_PATTERN, '游玩世界既有人物')
    if (existingOnly && selection.characterId === undefined) {
      throw new Error(`人物槽位 ${JSON.stringify(slotId)} 必须保留当前场地人物`)
    }
    return {
      slotId,
      actor,
      ...(selection.characterId === undefined ? {} : { characterId: selection.characterId as string }),
    }
  })
  if (new Set(castSelections.map(selection => selection.slotId)).size !== castSelections.length
    || new Set(castSelections.map(selection => JSON.stringify(selection.actor))).size !== castSelections.length
    || new Set(castSelections.flatMap(selection => selection.characterId === undefined ? [] : [selection.characterId])).size
      !== castSelections.filter(selection => selection.characterId !== undefined).length) {
    throw new Error('游玩世界人物槽位选择重复')
  }
  const slotById = new Map(recipe.castSlots.map(slot => [slot.id, slot]))
  if (castSelections.some(selection => !slotById.has(selection.slotId))) {
    throw new Error('游玩世界人物槽位选择包含未知槽位')
  }
  const selectedSlotIds = new Set(castSelections.map(selection => selection.slotId))
  const missingRequiredSlot = recipe.castSlots.find(slot => slot.required && !selectedSlotIds.has(slot.id))
  if (missingRequiredSlot !== undefined) {
    throw new Error(`请为人物槽位 ${JSON.stringify(missingRequiredSlot.name)} 选择角色卡`)
  }
  if (recipe.castSlots.length === 0 && castSelections.length > 0
    || recipe.castSlots.length > 0 && (castSelections.length < module.descriptor.minCharacters
      || castSelections.length > module.descriptor.maxCharacters)) {
    throw new Error(`游玩世界需要 ${String(module.descriptor.minCharacters)}–${String(module.descriptor.maxCharacters)} 位人物`)
  }
  const usedCharacterIds = new Set<string>()
  const projectedCast = castSelections.map(selection => {
    const projection = resources.projectActor(selection.actor)
    const existing = selection.characterId === undefined
      ? current.characters.find(character => character.actor !== undefined
        && JSON.stringify(character.actor) === JSON.stringify(selection.actor)
        && !usedCharacterIds.has(character.id))
      : current.characters.find(character => character.id === selection.characterId)
    if (selection.characterId !== undefined && existing === undefined) {
      throw new Error(`人物槽位 ${JSON.stringify(selection.slotId)} 指向的既有人物不存在`)
    }
    const character: StoryCharacter = existing === undefined
      ? {
          id: createStoryCharacterId(),
          name: projection.name,
          voiceAliases: projection.voiceAliases,
          profile: projection.profile,
          state: emptyCharacterState(),
          actor: selection.actor,
          actorBaseline: characterActorBaseline(projectedCharacterActorValues(projection)),
        }
      : mergeCharacterActor(existing, selection.actor, projection).character
    usedCharacterIds.add(character.id)
    return { selection, character }
  })
  const replacements = new Map(projectedCast.map(item => [item.character.id, item.character]))
  const characters = current.characters.map(character => replacements.get(character.id) ?? character)
    .concat(projectedCast.flatMap(item => current.characters.some(character => character.id === item.character.id)
      ? []
      : [item.character]))
  const cast = recipe.castSlots.flatMap(slot => {
    const selected = projectedCast.find(item => item.selection.slotId === slot.id)
    return selected === undefined ? [] : [{ slotId: slot.id, characterId: selected.character.id }]
  })
  return { characters, cast }
}

function materializePlayWorldSources(
  resources: RoleplayResourceCatalog,
  currentSources: readonly StorySource[],
  references: readonly RoleplayResourceSelection[],
): { readonly sourceIds: readonly string[]; readonly sources: readonly StorySource[] } {
  const existingSources = new Map(currentSources.flatMap(source => source.origin?.kind === 'resource'
    ? [[JSON.stringify(source.origin.resource), source] as const]
    : []))
  const sourceIds: string[] = []
  const addedSources: StorySource[] = []
  for (const reference of references) {
    const projection = resources.projectStorySource(reference)
    const existing = existingSources.get(JSON.stringify(reference))
    if (existing !== undefined) {
      sourceIds.push(existing.id)
      continue
    }
    const source: StorySource = {
      id: createStorySourceId(),
      name: projection.name,
      kind: projection.kind,
      enabled: true,
      content: projection.content,
      origin: { kind: 'resource', resource: reference },
    }
    sourceIds.push(source.id)
    addedSources.push(source)
  }
  return { sourceIds, sources: [...currentSources, ...addedSources] }
}

function recoverPlayWorldResource(
  resources: RoleplayResourceCatalog,
  moduleId: string,
): RoleplayResourceSelection {
  const candidates = resources.listPlayWorlds().filter(({ descriptor, detail }) =>
    descriptor.availability === 'available' && detail.playWorld.moduleId === moduleId)
  if (candidates.length === 0) throw new Error('当前游玩世界没有可更新的人物配方')
  if (candidates.length > 1) throw new Error('当前游玩世界对应多个资源配方，无法自动选择人物来源')
  return { kind: 'world', id: candidates[0]!.descriptor.id }
}

/** Local workspace store whose accepted ids cannot escape its configured root. */
export class StoryWorkspaceStore {
  readonly root: string
  readonly worlds: PlayWorldRegistry
  readonly resources: RoleplayResourceCatalog | undefined

  constructor(options: StoryWorkspaceStoreOptions = {}) {
    this.root = resolve(options.root ?? dshHomePath('agent-rp', 'story-workspaces'))
    this.worlds = options.worlds ?? DEFAULT_PLAY_WORLD_REGISTRY
    this.resources = options.resources ?? DEFAULT_PLAY_WORLD_RESOURCES
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
    if (request.format !== 2) throw new Error('故事工作室创建请求版本无效')
    const now = Date.now()
    const snapshot = normalizeWorkspace({
      format: 2,
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
    }, this.worlds)
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
      const stored = JSON.parse(readFileSync(storyPath, 'utf8')) as unknown
      if (isRecord(stored) && stored.format === 1) {
        const migrated = migrateTypedFormat1(root, stored, this.worlds)
        this.writeSnapshot(migrated)
        return migrated
      }
      return hydrateStored(root, stored, this.worlds)
    } catch (error: unknown) {
      throw new Error(`无法读取故事工作室 ${JSON.stringify(id)}`, { cause: error })
    }
  }

  /** Replace all editable fields when the caller still owns the observed revision. */
  save(request: StoryWorkspaceSaveRequest): StoryWorkspaceSnapshot {
    if (request.format !== 2) throw new Error('故事工作室保存请求版本无效')
    const current = this.get(request.id)
    if (!Number.isSafeInteger(request.revision) || request.revision < 0 || request.revision !== current.revision) {
      throw new Error(`故事工作室已更新；当前 revision 为 ${String(current.revision)}`)
    }
    const snapshot = normalizeWorkspace({
      ...request,
      revision: current.revision + 1,
      createdAt: current.createdAt,
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
      ...(current.world === undefined ? {} : { world: current.world }),
      ...(current.worldBinding === undefined ? {} : { worldBinding: current.worldBinding }),
      ...(current.worldActionReceipts === undefined ? {} : { worldActionReceipts: current.worldActionReceipts }),
    }, this.worlds)
    this.writeSnapshot(snapshot)
    this.removeUnreferenced(current, snapshot)
    return this.get(snapshot.id)
  }

  /** Append one already-fetched source without overwriting a concurrently edited workspace. */
  appendSource(id: string, revision: number, source: StorySource): StoryWorkspaceSnapshot {
    const current = this.get(id)
    this.assertRevision(current, revision)
    const normalized = normalizeSource(source)
    const importedUrls = new Set(sourceOriginUrls(normalized))
    if (importedUrls.size > 0 && current.sources.some(candidate =>
      sourceOriginUrls(candidate).some(url => importedUrls.has(url)))) throw new Error('这个网页已经在场地资料中')
    const snapshot = normalizeWorkspace({
      ...current,
      revision: current.revision + 1,
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
      sources: [...current.sources, normalized],
      researchInbox: current.researchInbox.filter(item => !importedUrls.has(item.url)),
    }, this.worlds)
    this.writeSnapshot(snapshot)
    return this.get(snapshot.id)
  }

  /** List resource-owned worlds, including recipes whose trusted module is not currently installed. */
  worldResources(): readonly PlayWorldResourceDescriptor[] {
    if (this.resources === undefined) return []
    const modules = new Map(this.worlds.list().map(module => [module.id, module]))
    return this.resources.listPlayWorlds().map(({ descriptor: resource, detail }) => {
      const module = modules.get(detail.playWorld.moduleId)
      if (module !== undefined && (module.summary !== detail.playWorld.summary
        || module.category !== detail.playWorld.category
        || module.minCharacters !== detail.playWorld.minCharacters
        || module.maxCharacters !== detail.playWorld.maxCharacters)) {
        throw new Error(`世界资源 ${JSON.stringify(resource.name)} 与规则模块元数据不一致`)
      }
      return {
        id: detail.playWorld.moduleId,
        resource: { kind: 'world' as const, id: resource.id },
        name: resource.name,
        summary: detail.playWorld.summary,
        category: detail.playWorld.category,
        minCharacters: detail.playWorld.minCharacters,
        maxCharacters: detail.playWorld.maxCharacters,
        moduleAvailable: module !== undefined,
        castSlots: detail.playWorld.castSlots,
      }
    }).sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Project the current legal world choices without exposing executable module payloads. */
  worldTurn(id: string): PlayWorldTurnProjection | undefined {
    const current = this.get(id)
    if (current.world === undefined) return undefined
    if (!this.worlds.has(current.world.moduleId)) return undefined
    const module = this.worlds.get(current.world.moduleId)
    return projectPlayWorldTurn(module.characterTurn(current.world, playWorldContext(
      current.characters,
      current.worldBinding ?? normalizeWorldBinding(undefined, current.world.moduleId),
    )))
  }

  /** Replace the executable world with one fresh module-owned instance. */
  installWorld(id: string, request: PlayWorldInstallRequest): StoryWorkspaceSnapshot {
    const current = this.get(id)
    this.assertRevision(current, request.revision)
    if (request.format !== 0 || this.resources === undefined) throw new Error('游玩世界资源目录不可用')
    const resource = normalizeResourceSelection(request.resource, 'world', '游玩世界资源引用')
    const recipe = this.resources.projectWorld(resource)
    const module = this.worlds.get(recipe.moduleId)
    const { characters, cast } = assemblePlayWorldCast(current, recipe, module, this.resources, request.cast, false)
    const { sourceIds, sources } = materializePlayWorldSources(this.resources, current.sources, recipe.sources)
    const binding: PlayWorldBinding = {
      resource,
      moduleId: recipe.moduleId,
      configuration: recipe.configuration,
      sourceReferences: recipe.sources,
      sourceIds,
      cast,
    }
    const context = playWorldContext(characters, binding)
    const world = module.create(context)
    if (world.moduleId !== recipe.moduleId) throw new Error('游玩世界模块创建了另一模块的状态')
    return this.commitWorld(current, world, [], {
      worldBinding: binding,
      characters,
      sources,
      ...missingPlayWorldWorkspaceScaffold(current, module, context),
    })
  }

  /** Bind actor resources to the current cast without resetting module state or world events. */
  updateWorldCast(id: string, request: PlayWorldCastUpdateRequest): StoryWorkspaceSnapshot {
    const current = this.get(id)
    this.assertRevision(current, request.revision)
    if (request.format !== 0 || this.resources === undefined || current.world === undefined) {
      throw new Error('当前游玩世界没有可更新的人物配方')
    }
    const existingBinding = current.worldBinding
    const resource = existingBinding?.resource === undefined
      ? recoverPlayWorldResource(this.resources, current.world.moduleId)
      : normalizeResourceSelection(existingBinding.resource, 'world', '游玩世界资源引用')
    const recipe = this.resources.projectWorld(resource)
    if (recipe.moduleId !== current.world.moduleId
      || existingBinding !== undefined && existingBinding.moduleId !== current.world.moduleId) {
      throw new Error('当前游玩世界资源与状态所有者不一致')
    }
    const recoveredSources = existingBinding?.resource === undefined
      ? materializePlayWorldSources(this.resources, current.sources, recipe.sources)
      : { sourceIds: existingBinding.sourceIds, sources: current.sources }
    const bindingBase: PlayWorldBinding = existingBinding?.resource === undefined
      ? {
          resource,
          moduleId: recipe.moduleId,
          configuration: recipe.configuration,
          sourceReferences: recipe.sources,
          sourceIds: recoveredSources.sourceIds,
          cast: existingBinding?.cast ?? [],
        }
      : existingBinding
    const currentCastBySlot = new Map(bindingBase.cast.map(binding => [binding.slotId, binding.characterId]))
    if (currentCastBySlot.size > 0 && (request.cast.length !== currentCastBySlot.size
      || request.cast.some(selection => selection.characterId !== currentCastBySlot.get(selection.slotId)))) {
      throw new Error('人物来源更新必须保留当前槽位中的人物')
    }
    const module = this.worlds.get(current.world.moduleId)
    const { characters, cast } = assemblePlayWorldCast(current, recipe, module, this.resources, request.cast, true)
    const worldBinding: PlayWorldBinding = { ...bindingBase, cast }
    const context = playWorldContext(characters, worldBinding)
    const world = module.normalize(current.world, context)
    return this.commitWorld(current, world, current.worldActionReceipts ?? [], {
      characters,
      worldBinding,
      sources: recoveredSources.sources,
      ...missingPlayWorldWorkspaceScaffold(current, module, context),
    })
  }

  /** Recreate the attached world while preserving authored assets and accepted story-map decisions. */
  restartWorld(id: string, request: PlayWorldRestartRequest): StoryWorkspaceSnapshot {
    const current = this.get(id)
    this.assertRevision(current, request.revision)
    if (request.format !== 0 || current.world === undefined) throw new Error('当前游玩场地没有可重新开始的世界')
    const module = this.worlds.get(current.world.moduleId)
    const binding = current.worldBinding ?? normalizeWorldBinding(undefined, current.world.moduleId)
    const world = module.create(playWorldContext(current.characters, binding))
    if (world.moduleId !== current.world.moduleId) throw new Error('游玩世界模块重新开局时改变了状态所有者')
    const removedNodeIds = new Set(current.graph.nodes
      .filter(node => node.lifecycle === 'suggested' && node.sourceEventId !== undefined)
      .map(node => node.id))
    const removedFactIds = new Set(current.facts
      .filter(fact => fact.source.kind === 'event')
      .map(fact => fact.id))
    const nodes = current.graph.nodes.flatMap(node => {
      if (removedNodeIds.has(node.id)) return []
      if (node.sourceEventId === undefined) return [node]
      const { sourceEventId: _sourceEventId, ...retained } = node
      return [retained]
    })
    const edges = current.graph.edges.flatMap(edge => {
      if (removedNodeIds.has(edge.source) || removedNodeIds.has(edge.target)
        || edge.lifecycle === 'suggested' && edge.sourceEventId !== undefined) return []
      if (edge.sourceEventId === undefined) return [edge]
      const { sourceEventId: _sourceEventId, ...retained } = edge
      return [retained]
    })
    const citations = current.citations.map(citation => {
      if (citation.target?.kind === 'node' && removedNodeIds.has(citation.target.nodeId)
        || citation.target?.kind === 'fact' && removedFactIds.has(citation.target.factId)) {
        const { target: _target, ...retained } = citation
        return retained
      }
      return citation
    })
    const snapshot = normalizeWorkspace({
      ...current,
      revision: current.revision + 1,
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
      graph: { ...current.graph, nodes, edges },
      characters: current.characters.map(character => ({ ...character, state: emptyCharacterState() })),
      facts: current.facts.filter(fact => !removedFactIds.has(fact.id)),
      events: [],
      citations,
      world,
      worldActionReceipts: [],
    }, this.worlds)
    this.writeSnapshot(snapshot)
    this.removeUnreferenced(current, snapshot)
    return this.get(snapshot.id)
  }

  /** Resolve and apply one action from the current Host-advertised turn. */
  dispatchWorldAction(id: string, request: PlayWorldActionRequest): StoryWorkspaceSnapshot {
    const current = this.get(id)
    this.assertRevision(current, request.revision)
    if (request.format !== 0 || typeof request.cycleId !== 'string' || typeof request.actionId !== 'string'
      || current.world === undefined) throw new Error('当前游玩场地没有可执行世界')
    const module = this.worlds.get(current.world.moduleId)
    const binding = current.worldBinding ?? normalizeWorldBinding(undefined, current.world.moduleId)
    const context = playWorldContext(current.characters, binding)
    const turn = module.characterTurn(current.world, context)
    if (turn === undefined || turn.id !== request.cycleId) throw new Error('游玩世界回合已经变化')
    const action = turn.actions.find(candidate => candidate.id === request.actionId)
    if (action === undefined) throw new Error('游玩世界动作不再合法')
    const world = module.dispatch(current.world, action.action, context)
    if (world.moduleId !== current.world.moduleId || world.instanceId !== current.world.instanceId
      || world.events.length < current.world.events.length
      || current.world.events.some((event, index) => world.events[index]?.id !== event.id)) {
      throw new Error('世界动作没有保留所属模块、实例或既有事件')
    }
    return this.commitWorld(current, world)
  }

  /** Apply one module-advertised character choice once, including across pipeline retries. */
  dispatchWorldCharacterAction(id: string, request: StoryWorldCharacterActionRequest): StoryWorkspaceSnapshot {
    const current = this.get(id)
    const existing = current.worldActionReceipts?.find(receipt => receipt.key === request.key)
    if (existing !== undefined) {
      if (existing.runKey !== request.runKey || existing.cycleId !== request.cycleId
        || existing.sequence !== request.sequence || existing.characterId !== request.characterId
        || existing.actionId !== request.actionId || existing.resultEventSeq !== request.resultEventSeq) {
        throw new Error('世界动作幂等键已用于另一项动作')
      }
      return current
    }
    this.assertRevision(current, request.revision)
    if (current.world === undefined) throw new Error('当前游玩场地没有可执行世界')
    const module = this.worlds.get(current.world.moduleId)
    const binding = current.worldBinding ?? normalizeWorldBinding(undefined, current.world.moduleId)
    const context = playWorldContext(current.characters, binding)
    const turn = module.characterTurn(current.world, context)
    if (turn === undefined || turn.id !== request.cycleId || turn.characterId !== request.characterId) {
      throw new Error('人物选择的世界回合已经变化')
    }
    const action = turn.actions.find(candidate => candidate.id === request.actionId)
    if (action === undefined) throw new Error('人物选择的世界动作不再合法')
    const world = module.dispatch(current.world, action.action, context)
    if (world.moduleId !== current.world.moduleId || world.instanceId !== current.world.instanceId
      || world.events.length < current.world.events.length
      || current.world.events.some((event, index) => world.events[index]?.id !== event.id)) {
      throw new Error('世界动作没有保留所属模块、实例或既有事件')
    }
    const receipt: StoryWorldActionReceipt = {
      key: requiredLabel(request.key, '世界动作收据 key'),
      runKey: requiredLabel(request.runKey, '世界动作运行 key'),
      worldInstanceId: current.world.instanceId,
      cycleId: requiredLabel(request.cycleId, '世界回合 id'),
      sequence: safeInteger(request.sequence, '世界动作序号'),
      characterId: request.characterId,
      actionId: requiredLabel(request.actionId, '世界动作 id'),
      resultEventSeq: safeInteger(request.resultEventSeq, '世界动作决策事件序号'),
      eventSequences: world.events.slice(current.world.events.length).map(event => event.sequence),
    }
    const receipts = [...(current.worldActionReceipts ?? []), receipt].slice(-MAX_WORLD_ACTION_RECEIPTS)
    return this.commitWorld(current, world, receipts)
  }

  /** Bind an actor snapshot to one character, or detach it while retaining the editable snapshot. */
  bindCharacterActor(
    id: string,
    request: StoryCharacterActorBindRequest,
    projection?: RoleplayActorProjection,
  ): StoryCharacterActorBindResult {
    const current = this.get(id)
    this.assertRevision(current, request.revision)
    assertId(request.characterId, CHARACTER_ID_PATTERN, '人物')
    if (request.format !== 0 || (request.actor !== undefined) !== (projection !== undefined)
      || (request.actor !== undefined && request.actor.kind !== 'actor')) {
      throw new Error('人物角色卡绑定请求无效')
    }
    if (!current.characters.some(character => character.id === request.characterId)) throw new Error('要绑定的场地人物不存在')
    let sync: StoryCharacterActorSyncReport | undefined
    const characters = current.characters.map(character => {
      if (character.id !== request.characterId) return character
      if (request.actor === undefined || projection === undefined) {
        const { actor: _actor, actorBaseline: _actorBaseline, ...detached } = character
        sync = {
          mode: 'detached',
          baselineCreated: false,
          updatedFields: [],
          preservedFields: [],
        }
        return detached
      }
      const merged = mergeCharacterActor(character, request.actor, projection)
      sync = merged.report
      return merged.character
    })
    const snapshot = normalizeWorkspace({
      ...current,
      revision: current.revision + 1,
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
      characters,
    }, this.worlds)
    this.writeSnapshot(snapshot)
    if (sync === undefined) throw new Error('人物角色卡绑定结果缺失')
    return { workspace: this.get(snapshot.id), sync }
  }

  /** Idempotently append one visible turn as an event and one typed story change set. */
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
    const worldEventSequences = [...new Set(materialization.worldEventSequences ?? [])]
    const representedWorldEvents = new Set(current.events.flatMap(event => event.worldEventSequences ?? []))
    if (worldEventSequences.length !== (materialization.worldEventSequences?.length ?? 0)
      || worldEventSequences.length > 64
      || worldEventSequences.some(sequence => !Number.isSafeInteger(sequence)
        || current.world?.events.some(event => event.sequence === sequence) !== true
        || representedWorldEvents.has(sequence))) {
      throw new Error('故事事件引用未知、重复或过多的世界事件')
    }
    const event: StoryEvent = {
      id: eventId,
      key: materialization.key,
      turn: materialization.turn,
      title: cleanName(materialization.title, '故事事件'),
      summary: cleanDocument(materialization.summary, '故事事件摘要'),
      evidence: cleanDocument(materialization.evidence, '故事事件证据'),
      participantIds: [...new Set(materialization.participantIds)],
      ...(activeNode === undefined ? {} : { nodeId: activeNode.id }),
      ...(worldEventSequences.length === 0 ? {} : { worldEventSequences }),
    }
    const stateChanges = new Map(materialization.changes.characters.map(change => [change.characterId, change]))
    if (stateChanges.size !== materialization.changes.characters.length
      || [...stateChanges].some(([characterId]) => !characterIds.has(characterId))) {
      throw new Error('人物状态变更包含未知或重复人物')
    }
    const characters = current.characters.map(character => {
      const change = stateChanges.get(character.id)
      if (change === undefined) return character
      return {
        ...character,
        state: {
          location: change.location === undefined ? character.state.location : cleanDocument(change.location, '人物当前位置'),
          condition: change.condition === undefined ? character.state.condition : cleanDocument(change.condition, '人物当前状态'),
          objective: change.objective === undefined ? character.state.objective : cleanDocument(change.objective, '人物当前目标'),
          notes: change.notes === undefined ? character.state.notes : cleanDocument(change.notes, '人物场地备注'),
        },
      }
    })
    const factChanges = new Map<string, Set<string>>()
    for (const change of materialization.changes.facts) {
      const text = cleanDocument(change.text, '人物观察')
      const knownBy = [...new Set(change.knownBy)]
      if (knownBy.length === 0 || knownBy.some(characterId => !characterIds.has(characterId))) {
        throw new Error('事实变更包含未知或空的知情人物')
      }
      if (text.trim() === '') continue
      const accumulated = factChanges.get(text) ?? new Set<string>()
      for (const characterId of knownBy) accumulated.add(characterId)
      factChanges.set(text, accumulated)
    }
    const facts = [...factChanges].map(([text, knownBy]) => {
      return {
        id: createStoryFactId(),
        ...(activeNode === undefined ? {} : { nodeId: activeNode.id }),
        text,
        status: 'asserted' as const,
        audience: 'public' as const,
        knowledgeMode: 'override' as const,
        knownBy: [...knownBy],
        source: { kind: 'event' as const, eventId, evidence: event.evidence },
      }
    })
    const suggestionIds = new Map<string, string>()
    for (const suggestion of materialization.changes.nodes) {
      if (suggestionIds.has(suggestion.ref)) throw new Error('候选节点 ref 重复')
      for (const participantId of suggestion.participantIds) {
        if (!characterIds.has(participantId)) throw new Error('候选节点包含未知参与人物')
      }
      suggestionIds.set(suggestion.ref, createStoryNodeId())
    }
    const canonicalNodeIds = new Set(current.graph.nodes
      .filter(node => node.lifecycle === 'canonical' && node.status !== 'dropped').map(node => node.id))
    const resolveEndpoint = (endpoint: StorySuggestionEndpoint): string => {
      if (endpoint.kind === 'proposal') {
        const nodeId = suggestionIds.get(endpoint.ref)
        if (nodeId === undefined) throw new Error('候选变更指向未知候选节点')
        return nodeId
      }
      if (!canonicalNodeIds.has(endpoint.nodeId)) throw new Error('候选变更指向未知正式节点')
      return endpoint.nodeId
    }
    const suggestedNodes = materialization.changes.nodes.map((suggestion, index): StoryNode => {
      const nodeId = suggestionIds.get(suggestion.ref)
      if (nodeId === undefined) throw new Error('候选节点缺少已分配 id')
      return {
        id: nodeId,
        kind: suggestion.kind,
        ...(suggestion.parent === undefined ? {} : { parentId: resolveEndpoint(suggestion.parent) }),
        title: suggestion.title,
        summary: suggestion.summary,
        status: 'planned',
        lifecycle: 'suggested',
        audience: 'director',
        position: {
          x: (activeNode?.position.x ?? 0) + 360 + (index % 2) * 360,
          y: (activeNode?.position.y ?? 0) + Math.floor(index / 2) * 180,
        },
        content: suggestion.content,
        participantIds: [...new Set(suggestion.participantIds)],
        knowledge: suggestion.knowledge,
        sourceEventId: eventId,
      }
    })
    const suggestedEdges = materialization.changes.edges.map(suggestion => {
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
      ...current.sources.flatMap(sourceOriginUrls),
    ])
    const researchInbox = [...current.researchInbox]
    for (const candidate of materialization.webResearch) {
      const url = cleanWebUrl(candidate.url, '研究结果 URL')
      if (knownResearchUrls.has(url)) continue
      const item = normalizeResearchItem({ ...candidate, id: createStoryResearchId(), url })
      knownResearchUrls.add(item.url)
      researchInbox.push(item)
    }
    const citationKeys = new Set(current.citations.map(citation => [
      citation.sourceId,
      citation.locator,
      citation.quote,
      citation.target?.kind === 'event' ? citation.target.eventId : '',
    ].join('\n')))
    const citations = [...current.citations]
    for (const candidate of materialization.citations ?? []) {
      const key = [candidate.sourceId, candidate.locator, candidate.quote, eventId].join('\n')
      if (citationKeys.has(key)) continue
      citationKeys.add(key)
      citations.push({
        id: createStoryCitationId(),
        sourceId: candidate.sourceId,
        locator: candidate.locator,
        quote: candidate.quote,
        note: candidate.note,
        target: { kind: 'event', eventId },
      })
    }
    return this.save({
      format: 2,
      id: current.id,
      revision: current.revision,
      name: current.name,
      pipeline: current.pipeline,
      graph: {
        ...current.graph,
        nodes: [...current.graph.nodes, ...suggestedNodes],
        edges: [...current.graph.edges, ...suggestedEdges],
      },
      characters,
      facts: [...current.facts, ...facts],
      events: [...current.events, event],
      outputs: current.outputs,
      sources: current.sources,
      citations,
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
    const snapshot = normalizeWorkspace(value, this.worlds)
    const root = this.workspacePath(snapshot.id)
    for (const node of snapshot.graph.nodes) atomicWrite(join(root, 'nodes', `${node.id}.md`), node.content)
    for (const character of snapshot.characters) {
      const characterRoot = join(root, 'characters', character.id)
      atomicWrite(join(characterRoot, 'description.md'), character.profile.description)
      atomicWrite(join(characterRoot, 'personality.md'), character.profile.personality)
      atomicWrite(join(characterRoot, 'scenario.md'), character.profile.scenario)
      atomicWrite(join(characterRoot, 'example-dialogue.md'), character.profile.exampleDialogue)
      atomicWrite(join(characterRoot, 'system-prompt.md'), character.profile.systemPrompt)
      atomicWrite(join(characterRoot, 'post-history-instructions.md'), character.profile.postHistoryInstructions)
    }
    for (const output of snapshot.outputs) atomicWrite(join(root, 'outputs', `${output.id}.md`), output.instructions)
    for (const source of snapshot.sources) atomicWrite(join(root, 'sources', `${source.id}.md`), source.content)
    atomicWrite(join(root, 'story.json'), `${JSON.stringify(compactStored(snapshot), null, 2)}\n`)
  }

  private assertRevision(current: StoryWorkspaceSnapshot, revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision !== current.revision) {
      throw new Error(`故事工作室已更新；当前 revision 为 ${String(current.revision)}`)
    }
  }

  private commitWorld(
    current: StoryWorkspaceSnapshot,
    world: PlayWorldSnapshot,
    worldActionReceipts = current.worldActionReceipts ?? [],
    workspacePatch: Partial<Pick<StoryWorkspaceSnapshot, 'graph' | 'outputs' | 'sources' | 'characters' | 'worldBinding'>> = {},
  ): StoryWorkspaceSnapshot {
    const snapshot = normalizeWorkspace({
      ...current,
      ...workspacePatch,
      revision: current.revision + 1,
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
      world,
      worldActionReceipts,
    }, this.worlds)
    this.writeSnapshot(snapshot)
    return this.get(snapshot.id)
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
      profile: emptyCharacterProfile(readOptionalMarkdown(join(root, 'characters', character.id, 'persona.md'))),
      state: emptyCharacterState(),
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
        summary: outline.trim().split('\n').find(line => line.trim() !== '')?.slice(0, 280) ?? '故事大纲',
        status: 'active' as const,
        lifecycle: 'canonical' as const,
        audience: 'director' as const,
        position: { x: 0, y: 0 },
        content: outline,
        participantIds: [],
        knowledge: { mode: 'none' as const, characterIds: [] },
      }]),
      {
        id: activeId,
        kind: 'beat',
        ...(outline.trim() === '' ? {} : { parentId: arcId }),
        title: '当前场景',
        summary: '当前正在推进的场景',
        status: 'active',
        lifecycle: 'canonical',
        audience: 'public',
        position: { x: 360, y: 0 },
        content: '',
        participantIds,
        knowledge: { mode: 'participants', characterIds: [] },
      },
      ...(foreshadowing.trim() === '' ? [] : [{
        id: secretId,
        kind: 'secret' as const,
        ...(outline.trim() === '' ? {} : { parentId: arcId }),
        title: '未整理伏笔',
        summary: foreshadowing.trim().split('\n').find(line => line.trim() !== '')?.slice(0, 280) ?? '未整理伏笔',
        status: 'planned' as const,
        lifecycle: 'canonical' as const,
        audience: 'director' as const,
        position: { x: 360, y: 240 },
        content: foreshadowing,
        participantIds: [],
        knowledge: { mode: 'none' as const, characterIds: [] },
      }]),
      ...(proposals.trim() === '' ? [] : [{
        id: createStoryNodeId(),
        kind: 'beat' as const,
        ...(outline.trim() === '' ? {} : { parentId: arcId }),
        title: '迁移的待审建议',
        summary: proposals.trim().split('\n').find(line => line.trim() !== '')?.slice(0, 280) ?? '迁移的待审建议',
        status: 'planned' as const,
        lifecycle: 'suggested' as const,
        audience: 'director' as const,
        position: { x: 720, y: 0 },
        content: proposals,
        participantIds,
        knowledge: { mode: 'none' as const, characterIds: [] },
      }]),
    ]
    const edges: StoryEdge[] = []
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
        nodeId: activeId,
        text: knowledge,
        status: 'asserted' as const,
        audience: 'director' as const,
        knowledgeMode: 'override' as const,
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
      format: 2,
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
    }, this.worlds)
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
  worlds: PlayWorldRegistry = DEFAULT_PLAY_WORLD_REGISTRY,
): StoryCharacterContext {
  const character = workspace.characters.find(candidate => candidate.id === characterId)
  if (character === undefined) throw new Error(`故事工作室中没有人物 ${JSON.stringify(characterId)}`)
  const facts = workspace.facts.filter(fact => fact.status !== 'refuted' && storyFactKnownBy(workspace, fact).includes(characterId))
  const privateKnowledge = facts.map(fact => {
    const prefix = fact.status === 'uncertain' ? '[不确定] ' : ''
    const citations = workspace.citations.filter(citation => citation.target?.kind === 'fact' && citation.target.factId === fact.id)
    return [`- ${prefix}${fact.text}`, ...citations.map(citation => `  ${renderStoryCitation(workspace, citation)}`)].join('\n')
  }).join('\n')
  const playerInput = cleanDocument(scene.playerInput, '本轮玩家输入')
  const worldContext = workspace.world === undefined
    ? ''
    : worlds.get(workspace.world.moduleId).projectForCharacter(
        workspace.world, characterId, resolveStoryPlayWorldContext(workspace),
      ).text
  const text = [
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
    privateKnowledge,
    ...(worldContext === '' ? [] : ['## 此人物可见的世界状态', worldContext]),
    '## 本轮玩家输入',
    playerInput,
    '只能依据以上材料决定该人物此刻相信什么、注意到什么和采取什么行动。入场情境只描述本局起点；与当前场地状态冲突时，以当前场地状态为准。不得假设其他人物的私有知识，也不得读取导演故事图、建议节点或未公开的未来安排。',
    ...(character.profile.postHistoryInstructions.trim() === '' ? [] : ['## 历史后指令', character.profile.postHistoryInstructions]),
  ].join('\n\n')
  return {
    workspaceId: workspace.id,
    characterId,
    characterName: character.name,
    profile: character.profile,
    state: character.state,
    privateKnowledge,
    worldContext,
    playerInput,
    text,
  }
}

/** Compile authoritative world state for director and continuity Workers. */
export function compileStoryDirectorWorldContext(
  workspace: StoryWorkspaceSnapshot,
  worlds: PlayWorldRegistry = DEFAULT_PLAY_WORLD_REGISTRY,
): string {
  if (workspace.world === undefined) return ''
  return worlds.get(workspace.world.moduleId).projectForDirector(
    workspace.world, resolveStoryPlayWorldContext(workspace),
  ).text
}
