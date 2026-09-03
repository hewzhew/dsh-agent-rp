/** Registry and lifecycle boundary for executable play-space worlds. */

import type { Context } from '@deepseek-ai/cordis'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type { RoleplayResourceSelection } from './roleplay-resource-catalog-protocol.ts'
import type {
  StoryAudience,
  StoryCharacter,
  StoryEdgeKind,
  StoryForeshadowStatus,
  StoryKnowledgePolicy,
  StoryNodeKind,
  StoryNodePosition,
  StoryNodeStatus,
  StoryOutputKind,
} from './story-workspace-protocol.ts'
import { createFlyingChessWorldModule } from './flying-chess-world.ts'
import { isPlayWorldOpportunitySpeechMove } from './play-world-protocol.ts'
import type {
  PlayWorldCharacterOpportunity,
  PlayWorldCharacterOpportunityResolution,
  PlayWorldModuleDescriptor,
  PlayWorldNarrativeProjection,
  PlayWorldPromptProjection,
  PlayWorldSnapshot,
  PlayWorldSurfaceProjection,
  PlayWorldTurnProjection,
} from './play-world-protocol.ts'

/** Host service used by trusted plugins to install executable play worlds. */
export const PLAY_WORLD_REGISTRY_KEY = 'agentRp.playWorlds'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Executable play-world modules available to Agent RP workspaces. */
    'agentRp.playWorlds': PlayWorldRegistry
  }
}

/** Inputs available when a module creates or advances one world instance. */
export interface PlayWorldContext {
  readonly characters: readonly StoryCharacter[]
  readonly configuration: JsonValue
  readonly sourceReferences: readonly RoleplayResourceSelection[]
}

/** One legal character choice whose executable payload stays inside its owning module. */
export interface PlayWorldCharacterAction {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly action: unknown
}

/** One module-defined character turn that may require several consecutive choices. */
export interface PlayWorldCharacterTurn {
  readonly id: string
  readonly characterId: string
  readonly instruction: string
  readonly actions: readonly PlayWorldCharacterAction[]
}

/** One module-local canonical node created only when a workspace has no authored graph. */
export interface PlayWorldWorkspaceNodeTemplate {
  readonly key: string
  readonly kind: StoryNodeKind
  readonly parentKey?: string
  readonly title: string
  readonly summary: string
  readonly status: StoryNodeStatus
  readonly audience: StoryAudience
  readonly position: StoryNodePosition
  readonly content: string
  readonly participantIds: readonly string[]
  readonly knowledge: StoryKnowledgePolicy
}

/** One module-local canonical relationship created with a fresh world scaffold. */
export interface PlayWorldWorkspaceEdgeTemplate {
  readonly key: string
  readonly kind: StoryEdgeKind
  readonly sourceKey: string
  readonly targetKey: string
  readonly label: string
  readonly audience: StoryAudience
  readonly foreshadowStatus?: StoryForeshadowStatus
}

/** One ordered output card recommended by a world for an otherwise empty layout. */
export interface PlayWorldWorkspaceOutputTemplate {
  readonly key: string
  readonly name: string
  readonly kind: StoryOutputKind
  readonly enabled: boolean
  readonly characterId?: string
  readonly instructions: string
}

/** Optional authoring defaults that never replace existing story objects. */
export interface PlayWorldWorkspaceScaffold {
  readonly activeNodeKey?: string
  readonly nodes: readonly PlayWorldWorkspaceNodeTemplate[]
  readonly edges: readonly PlayWorldWorkspaceEdgeTemplate[]
  readonly outputs: readonly PlayWorldWorkspaceOutputTemplate[]
}

/** Host implementation of one typed, deterministic world transition system. */
export interface PlayWorldModule {
  readonly descriptor: PlayWorldModuleDescriptor
  /** Create one fresh authoritative snapshot. */
  create(context: PlayWorldContext): PlayWorldSnapshot
  /** Recommend a story scene and output layout for an otherwise empty workspace. */
  createWorkspaceScaffold?(context: PlayWorldContext): PlayWorldWorkspaceScaffold
  /** Parse durable state owned by this module. */
  normalize(value: unknown, context: PlayWorldContext): PlayWorldSnapshot
  /** Apply one validated action and return the complete next snapshot. */
  dispatch(snapshot: PlayWorldSnapshot, action: unknown, context: PlayWorldContext): PlayWorldSnapshot
  /** Return only the legal choices for the character currently controlling the world. */
  characterTurn(snapshot: PlayWorldSnapshot, context: PlayWorldContext): PlayWorldCharacterTurn | undefined
  /** Project compact status, an optional viewport, and native-composer suggestions for the Session UI. */
  projectSurface(snapshot: PlayWorldSnapshot, context: PlayWorldContext): PlayWorldSurfaceProjection
  /** Project only knowledge available to one character Worker. */
  projectForCharacter(snapshot: PlayWorldSnapshot, characterId: string, context: PlayWorldContext): PlayWorldPromptProjection
  /** Return unresolved choices owned by one character without exposing another character's choices. */
  characterOpportunities?(
    snapshot: PlayWorldSnapshot,
    characterId: string,
    context: PlayWorldContext,
  ): readonly PlayWorldCharacterOpportunity[]
  /** Persist one explicit character choice after its required public evidence exists. */
  resolveCharacterOpportunity?(
    snapshot: PlayWorldSnapshot,
    resolution: PlayWorldCharacterOpportunityResolution,
    context: PlayWorldContext,
  ): PlayWorldSnapshot
  /** Project authoritative state for the director Worker. */
  projectForDirector(snapshot: PlayWorldSnapshot, context: PlayWorldContext): PlayWorldPromptProjection
  /** Project immutable facts, optional dramatic directions, non-rendered invariants, and presentation cadence. */
  projectNarrative(
    snapshot: PlayWorldSnapshot,
    eventSequences: readonly number[],
    context: PlayWorldContext,
  ): PlayWorldNarrativeProjection
}

/** Validate character-owned world opportunities before they enter a Worker request. */
export function projectPlayWorldCharacterOpportunities(
  opportunities: readonly PlayWorldCharacterOpportunity[],
  snapshot: PlayWorldSnapshot,
  characterId: string,
  context: PlayWorldContext,
): readonly PlayWorldCharacterOpportunity[] {
  if (!Array.isArray(opportunities) || opportunities.length > 32) {
    throw new Error('游玩世界人物机会集合无效')
  }
  const worldEventSequences = new Set(snapshot.events.map(event => event.sequence))
  const characterIds = new Set(context.characters.map(character => character.id))
  if (!characterIds.has(characterId)) throw new Error('游玩世界人物机会指向未知人物')
  const opportunityIds = new Set<string>()
  return Object.freeze(opportunities.map((opportunity, index) => {
    const id = requiredProjectionText(opportunity.id, `游玩世界人物机会 ${String(index + 1)} id`, 240)
    if (opportunityIds.has(id)) throw new Error(`游玩世界人物机会 ${JSON.stringify(id)}重复`)
    opportunityIds.add(id)
    if (opportunity.characterId !== characterId
      || opportunity.status !== 'available' && opportunity.status !== 'retained'
      || !Array.isArray(opportunity.sourceEventSequences) || opportunity.sourceEventSequences.length === 0
      || opportunity.sourceEventSequences.length > 64
      || new Set(opportunity.sourceEventSequences).size !== opportunity.sourceEventSequences.length
      || opportunity.sourceEventSequences.some((sequence: number) => !Number.isSafeInteger(sequence)
        || !worldEventSequences.has(sequence))
      || !Array.isArray(opportunity.responderIds) || opportunity.responderIds.length === 0
      || new Set(opportunity.responderIds).size !== opportunity.responderIds.length
      || opportunity.responderIds.some((id: string) => id === characterId || !characterIds.has(id))
      || opportunity.use.kind !== 'speech' || !isPlayWorldOpportunitySpeechMove(opportunity.use.move)) {
      throw new Error(`游玩世界人物机会 ${String(index + 1)}无效`)
    }
    return Object.freeze({
      id,
      sourceEventSequences: Object.freeze([...opportunity.sourceEventSequences]),
      characterId,
      responderIds: Object.freeze([...opportunity.responderIds]),
      status: opportunity.status,
      instruction: requiredProjectionText(opportunity.instruction, `游玩世界人物机会 ${String(index + 1)}说明`, 2_000),
      use: Object.freeze({ kind: 'speech' as const, move: opportunity.use.move }),
    })
  }))
}

interface PlayWorldRegistration {
  readonly token: symbol
  readonly module: PlayWorldModule
  readonly descriptor: PlayWorldModuleDescriptor
}

function stableModuleId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() !== value
    || !/^[a-z0-9][a-z0-9._:/-]{0,127}$/u.test(value)) {
    throw new Error('游玩世界模块 id 必须是稳定的小写标识')
  }
  return value
}

function moduleDescriptor(value: PlayWorldModuleDescriptor): PlayWorldModuleDescriptor {
  const id = stableModuleId(value.id)
  if (typeof value.name !== 'string' || value.name.trim() === '' || value.name.length > 120
    || typeof value.summary !== 'string' || value.summary.trim() === '' || value.summary.length > 1_000
    || value.category !== 'game' && value.category !== 'simulation'
    || !Number.isSafeInteger(value.minCharacters) || value.minCharacters < 1
    || !Number.isSafeInteger(value.maxCharacters) || value.maxCharacters < value.minCharacters) {
    throw new Error(`游玩世界模块 ${JSON.stringify(id)} 描述无效`)
  }
  return Object.freeze({
    id,
    name: value.name,
    summary: value.summary,
    category: value.category,
    minCharacters: value.minCharacters,
    maxCharacters: value.maxCharacters,
  })
}

function requiredProjectionText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new Error(`${label}无效`)
  }
  return value
}

/** Validate a module narrative projection before it reaches any model request. */
export function projectPlayWorldNarrative(
  projection: PlayWorldNarrativeProjection,
  eventSequences: readonly number[],
  context: PlayWorldContext,
): PlayWorldNarrativeProjection {
  if (projection.cadence !== 'transition' && projection.cadence !== 'scene'
    && projection.cadence !== 'resolution') {
    throw new Error('游玩世界叙事节奏无效')
  }
  if (!Array.isArray(projection.facts) || projection.facts.length === 0 || projection.facts.length > 64
    || !Array.isArray(projection.cues) || projection.cues.length > 32
    || projection.invariants !== undefined
      && (!Array.isArray(projection.invariants) || projection.invariants.length > 32)) {
    throw new Error('游玩世界叙事投影无效')
  }
  const selected = new Set(eventSequences)
  const characterIds = new Set(context.characters.map(character => character.id))
  const validateEventReferences = (references: readonly number[], label: string): readonly number[] => {
    if (!Array.isArray(references) || references.length === 0 || references.length > 64
      || new Set(references).size !== references.length
      || references.some(sequence => !Number.isSafeInteger(sequence) || !selected.has(sequence))) {
      throw new Error(`${label}引用了未选择的世界事件`)
    }
    return Object.freeze([...references])
  }
  const facts = projection.facts.map((fact, index) => Object.freeze({
    eventSequences: validateEventReferences(fact.eventSequences, `游玩世界叙事事实 ${String(index + 1)}`),
    retention: (() => {
      if (fact.retention !== 'essential' && fact.retention !== 'compressible') {
        throw new Error(`游玩世界叙事事实 ${String(index + 1)}保留方式无效`)
      }
      return fact.retention
    })(),
    text: requiredProjectionText(fact.text, `游玩世界叙事事实 ${String(index + 1)}`, 4_000),
  }))
  const cues = projection.cues.map((cue, index) => {
    if (cue.kind !== 'change' && cue.kind !== 'pressure' && cue.kind !== 'opportunity'
      && cue.kind !== 'relationship') {
      throw new Error(`游玩世界叙事方向 ${String(index + 1)}类型无效`)
    }
    if (!Array.isArray(cue.characterIds) || new Set(cue.characterIds).size !== cue.characterIds.length
      || cue.characterIds.some((characterId: string) => !characterIds.has(characterId))) {
      throw new Error(`游玩世界叙事方向 ${String(index + 1)}人物无效`)
    }
    return Object.freeze({
      eventSequences: validateEventReferences(cue.eventSequences, `游玩世界叙事方向 ${String(index + 1)}`),
      kind: cue.kind,
      text: requiredProjectionText(cue.text, `游玩世界叙事方向 ${String(index + 1)}`, 2_000),
      characterIds: Object.freeze([...cue.characterIds]),
    })
  })
  const invariantIds = new Set<string>()
  const invariants = (projection.invariants ?? []).map((invariant, index) => {
    const id = requiredProjectionText(invariant.id, `游玩世界叙事不变量 ${String(index + 1)} id`, 120)
    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(id) || invariantIds.has(id)) {
      throw new Error(`游玩世界叙事不变量 ${String(index + 1)} id 无效`)
    }
    invariantIds.add(id)
    return Object.freeze({
      id,
      text: requiredProjectionText(invariant.text, `游玩世界叙事不变量 ${String(index + 1)}`, 2_000),
    })
  })
  return Object.freeze({
    cadence: projection.cadence,
    facts: Object.freeze(facts),
    cues: Object.freeze(cues),
    ...(projection.invariants === undefined ? {} : { invariants: Object.freeze(invariants) }),
  })
}

/** Remove Host-only action payloads from one module-advertised character turn. */
export function projectPlayWorldTurn(turn: PlayWorldCharacterTurn | undefined): PlayWorldTurnProjection | undefined {
  if (turn === undefined) return undefined
  const cycleId = requiredProjectionText(turn.id, '游玩世界回合 id', 256)
  const characterId = requiredProjectionText(turn.characterId, '游玩世界行动人物 id', 256)
  const instruction = requiredProjectionText(turn.instruction, '游玩世界回合说明', 4_000)
  if (!Array.isArray(turn.actions) || turn.actions.length === 0 || turn.actions.length > 128) {
    throw new Error('游玩世界合法动作集合无效')
  }
  const ids = new Set<string>()
  const actions = turn.actions.map((action) => {
    const id = requiredProjectionText(action.id, '游玩世界动作 id', 240)
    if (ids.has(id)) throw new Error(`游玩世界动作 ${JSON.stringify(id)} 重复`)
    ids.add(id)
    return Object.freeze({
      id,
      label: requiredProjectionText(action.label, `游玩世界动作 ${JSON.stringify(id)} 标题`, 200),
      description: requiredProjectionText(action.description, `游玩世界动作 ${JSON.stringify(id)} 说明`, 1_000),
    })
  })
  return Object.freeze({ cycleId, characterId, instruction, actions: Object.freeze(actions) })
}

/** Validate one module-owned native Session surface before sending it to a browser. */
export function projectPlayWorldSurface(surface: PlayWorldSurfaceProjection): PlayWorldSurfaceProjection {
  const title = requiredProjectionText(surface.title, '游玩世界场地标题', 160)
  const status = requiredProjectionText(surface.status, '游玩世界场地状态', 300)
  const summary = requiredProjectionText(surface.summary, '游玩世界场地摘要', 2_000)
  if (!Array.isArray(surface.facts) || surface.facts.length > 16
    || !Array.isArray(surface.composerSuggestions) || surface.composerSuggestions.length > 12) {
    throw new Error('游玩世界场地投影无效')
  }
  const facts = surface.facts.map((fact, index) => Object.freeze({
    label: requiredProjectionText(fact.label, `游玩世界场地事实 ${String(index + 1)} 标题`, 80),
    value: requiredProjectionText(fact.value, `游玩世界场地事实 ${String(index + 1)} 内容`, 200),
  }))
  const suggestionIds = new Set<string>()
  const composerSuggestions = surface.composerSuggestions.map((suggestion) => {
    const id = requiredProjectionText(suggestion.id, '游玩世界输入建议 id', 120)
    if (suggestionIds.has(id)) throw new Error(`游玩世界输入建议 ${JSON.stringify(id)} 重复`)
    suggestionIds.add(id)
    return Object.freeze({
      id,
      label: requiredProjectionText(suggestion.label, `游玩世界输入建议 ${JSON.stringify(id)} 标题`, 120),
      draft: requiredProjectionText(suggestion.draft, `游玩世界输入建议 ${JSON.stringify(id)} 内容`, 4_000),
    })
  })
  const viewport = surface.viewport === undefined ? undefined : Object.freeze({
    kind: requiredProjectionText(surface.viewport.kind, '游玩世界视图类型', 120),
    data: surface.viewport.data,
  })
  return Object.freeze({
    title,
    status,
    summary,
    facts: Object.freeze(facts),
    ...(viewport === undefined ? {} : { viewport }),
    composerSuggestions: Object.freeze(composerSuggestions),
  })
}

/** Installed world modules keyed by stable module id. */
export class PlayWorldRegistry {
  readonly #modules = new Map<string, PlayWorldRegistration>()

  /** Register one module and return a stale-disposer-safe revocation. */
  register(module: PlayWorldModule): () => void {
    const descriptor = moduleDescriptor(module.descriptor)
    if (this.#modules.has(descriptor.id)) {
      throw new Error(`游玩世界模块 ${JSON.stringify(descriptor.id)} 重复注册`)
    }
    const registration = { token: Symbol(descriptor.id), module, descriptor }
    this.#modules.set(descriptor.id, registration)
    return () => {
      if (this.#modules.get(descriptor.id)?.token === registration.token) this.#modules.delete(descriptor.id)
    }
  }

  /** List installed modules in stable presentation order. */
  list(): readonly PlayWorldModuleDescriptor[] {
    return [...this.#modules.values()].map(registration => registration.descriptor)
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Report whether one durable module owner is currently installed. */
  has(id: string): boolean {
    return this.#modules.has(id)
  }

  /** Resolve one installed module or fail before state can be changed. */
  get(id: string): PlayWorldModule {
    const registration = this.#modules.get(id)
    if (registration === undefined) throw new Error(`游玩世界模块 ${JSON.stringify(id)} 未安装`)
    return registration.module
  }

  /** Parse one durable world through its owning module. */
  normalize(value: unknown, context: PlayWorldContext): PlayWorldSnapshot {
    if (typeof value !== 'object' || value === null || Array.isArray(value)
      || typeof (value as { readonly moduleId?: unknown }).moduleId !== 'string') {
      throw new Error('游玩世界快照无效')
    }
    return this.get((value as { readonly moduleId: string }).moduleId).normalize(value, context)
  }

  /** Retain a validated inert snapshot when its trusted module is temporarily unavailable. */
  normalizeStored(value: unknown, context: PlayWorldContext): PlayWorldSnapshot {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)
      && typeof (value as { readonly moduleId?: unknown }).moduleId === 'string'
      && this.has((value as { readonly moduleId: string }).moduleId)) {
      return this.normalize(value, context)
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('游玩世界快照无效')
    const record = value as Record<string, unknown>
    if (Object.keys(record).some(key => !['format', 'instanceId', 'moduleId', 'moduleVersion', 'title', 'state', 'events'].includes(key))
      || record.format !== 0 || typeof record.instanceId !== 'string' || record.instanceId.trim() === '' || record.instanceId.length > 240
      || typeof record.moduleId !== 'string' || !/^[a-z0-9][a-z0-9._:/-]{0,127}$/u.test(record.moduleId)
      || !Number.isSafeInteger(record.moduleVersion) || Number(record.moduleVersion) < 0
      || typeof record.title !== 'string' || record.title.trim() === '' || record.title.length > 120
      || !Array.isArray(record.events) || record.events.length > 100_000) {
      throw new Error('游玩世界快照无效')
    }
    const state = snapshotJsonValue(record.state) as JsonValue | undefined
    if (state === undefined) throw new Error('游玩世界状态不是 JSON')
    const events = record.events.map((item, index) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('游玩世界事件无效')
      const event = item as Record<string, unknown>
      if (Object.keys(event).some(key => !['id', 'sequence', 'type', 'title', 'summary', 'actorId', 'data'].includes(key))
        || typeof event.id !== 'string' || event.id.trim() === '' || event.id.length > 240
        || event.sequence !== index || typeof event.type !== 'string' || event.type.trim() === '' || event.type.length > 120
        || typeof event.title !== 'string' || event.title.trim() === '' || event.title.length > 240
        || typeof event.summary !== 'string' || event.summary.length > 4000
        || event.actorId !== undefined && (typeof event.actorId !== 'string' || event.actorId.trim() === '' || event.actorId.length > 240)) {
        throw new Error('游玩世界事件无效')
      }
      const data = event.data === undefined ? undefined : snapshotJsonValue(event.data) as JsonValue | undefined
      if (event.data !== undefined && data === undefined) throw new Error('游玩世界事件数据不是 JSON')
      return Object.freeze({
        id: event.id,
        sequence: index,
        type: event.type,
        title: event.title,
        summary: event.summary,
        ...(event.actorId === undefined ? {} : { actorId: event.actorId }),
        ...(data === undefined ? {} : { data }),
      })
    })
    return Object.freeze({
      format: 0,
      instanceId: record.instanceId,
      moduleId: record.moduleId,
      moduleVersion: Number(record.moduleVersion),
      title: record.title,
      state,
      events: Object.freeze(events),
    })
  }
}

/** Register one trusted module for the lifetime of its Cordis plugin context. */
export function registerPlayWorldModule(ctx: Context, module: PlayWorldModule): void {
  const registry = ctx.get(PLAY_WORLD_REGISTRY_KEY)
  if (registry === undefined || typeof registry.register !== 'function') {
    throw new Error('Agent RP 游玩世界注册表不可用')
  }
  ctx.effect(() => registry.register(module), `agent-rp: play world ${module.descriptor.id}`)
}

/** Create the first-party world registry used by local story workspaces. */
export function createDefaultPlayWorldRegistry(): PlayWorldRegistry {
  const registry = new PlayWorldRegistry()
  registry.register(createFlyingChessWorldModule())
  return registry
}
