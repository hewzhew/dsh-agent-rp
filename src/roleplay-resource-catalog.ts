/** Source-neutral, read-only registry of reusable Roleplay resources. */

import type { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, snapshotJsonValue, type JsonValue, type SessionEvent } from '@deepseek-ai/dsh-session'
import { isDeepStrictEqual } from 'node:util'
import {
  parseRoleplayResourceDetail,
  ROLEPLAY_RESOURCE_KINDS,
  type RoleplayResourceDescriptor,
  type RoleplayResourceDetail,
  type RoleplayResourceKind,
  type RoleplayResourceSelection,
  type RoleplayWorldCastSlotDetail,
  type RoleplayWorldResourceDetail,
} from './roleplay-resource-catalog-protocol.ts'

/** Host service used by trusted plugins to publish discoverable Roleplay resources. */
export const ROLEPLAY_RESOURCE_CATALOG_KEY = 'agentRp.resources'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Read-only Roleplay resource providers owned by the current Host. */
    'agentRp.resources': RoleplayResourceCatalog
  }
}

/** One trusted provider. Returned descriptors must be detached, synchronous values. */
export interface RoleplayResourceProvider {
  readonly id: string
  list(): readonly RoleplayResourceDescriptor[]
  /** Return bounded kind-specific presentation details without exposing source payloads. */
  inspect?(descriptor: RoleplayResourceDescriptor): RoleplayResourceDetail
  /** Preserve the Session-event prefix and append a snapshot when the selection is not already active. */
  materialize?(input: RoleplayResourceMaterializationInput): RoleplayResourceMaterialization
  /** Resolve one actor into a stable model-facing identity without exposing source payloads. */
  projectActor?(selection: RoleplayResourceSelection, descriptor: RoleplayResourceDescriptor): RoleplayActorProjection
  /** Resolve one world resource into a trusted executable module recipe. */
  projectWorld?(selection: RoleplayResourceSelection, descriptor: RoleplayResourceDescriptor): RoleplayWorldProjection
  /** Resolve one selected resource into an editable local research source. */
  projectStorySource?(selection: RoleplayResourceSelection, descriptor: RoleplayResourceDescriptor): RoleplayStorySourceProjection
}

/** Host-only actor snapshot stored by a play-space character instance. */
export interface RoleplayActorProjection {
  readonly name: string
  /** Source-card names used to recognize this character in imported original-language dialogue. */
  readonly voiceAliases: readonly string[]
  readonly profile: {
    readonly description: string
    readonly personality: string
    readonly scenario: string
    readonly exampleDialogue: string
    readonly systemPrompt: string
    readonly postHistoryInstructions: string
  }
}

/** Host-resolved recipe connecting one reusable world to trusted code and supporting sources. */
export interface RoleplayWorldProjection {
  readonly moduleId: string
  /** Durable browser-visible JSON; providers must not include credentials or private Host state. */
  readonly configuration: JsonValue
  readonly sources: readonly RoleplayResourceSelection[]
  readonly castSlots: readonly RoleplayWorldCastSlotDetail[]
}

/** Host-only source snapshot copied into a story workspace during world installation. */
export interface RoleplayStorySourceProjection {
  readonly name: string
  readonly kind: 'original' | 'reference' | 'research'
  readonly content: string
}

/** Source-neutral facts shared with each provider while a new experience is assembled. */
export interface RoleplayResourceMaterializationContext {
  readonly mode: 'character' | 'scene'
  readonly participantName?: string
}

/** Detached input given to the unique provider that owns the selected resource. */
export interface RoleplayResourceMaterializationInput {
  readonly selection: RoleplayResourceSelection
  readonly descriptor: RoleplayResourceDescriptor
  readonly events: readonly SessionEvent[]
  readonly context: RoleplayResourceMaterializationContext
}

/** Complete event prefix after one provider has preserved it and optionally appended a snapshot. */
export interface RoleplayResourceMaterialization {
  readonly events: readonly SessionEvent[]
  readonly title?: string
}

/** Host-only ownership result used to dispatch a stable reference back to its provider. */
export interface LocatedRoleplayResource {
  readonly providerId: string
  readonly descriptor: RoleplayResourceDescriptor
}

/** One world resource whose provider supplies both presentation details and an installation recipe. */
export interface LocatedPlayWorldResource extends LocatedRoleplayResource {
  readonly detail: RoleplayWorldResourceDetail & { readonly playWorld: NonNullable<RoleplayWorldResourceDetail['playWorld']> }
}

interface Registration {
  readonly token: symbol
  readonly id: string
  readonly list: RoleplayResourceProvider['list']
  readonly inspect?: NonNullable<RoleplayResourceProvider['inspect']>
  readonly materialize?: NonNullable<RoleplayResourceProvider['materialize']>
  readonly projectActor?: NonNullable<RoleplayResourceProvider['projectActor']>
  readonly projectWorld?: NonNullable<RoleplayResourceProvider['projectWorld']>
  readonly projectStorySource?: NonNullable<RoleplayResourceProvider['projectStorySource']>
}

const KIND_ORDER = new Map<RoleplayResourceKind, number>(
  ROLEPLAY_RESOURCE_KINDS.map((kind, index) => [kind, index]),
)

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function stableId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || /\s/u.test(value)) {
    throw new Error(`${label} must be a non-empty stable id without whitespace`)
  }
  return value
}

function descriptor(value: RoleplayResourceDescriptor, providerId: string): RoleplayResourceDescriptor {
  const id = stableId(value.id, `Roleplay resource provider ${JSON.stringify(providerId)} resource id`)
  if (!ROLEPLAY_RESOURCE_KINDS.includes(value.kind)) {
    throw new Error(`Roleplay resource provider ${JSON.stringify(providerId)} returned an unknown resource kind`)
  }
  if (typeof value.name !== 'string' || value.name.trim() === '') {
    throw new Error(`Roleplay resource provider ${JSON.stringify(providerId)} resource ${JSON.stringify(id)} needs a name`)
  }
  if (value.availability !== 'available' && value.availability !== 'archived') {
    throw new Error(`Roleplay resource provider ${JSON.stringify(providerId)} resource ${JSON.stringify(id)} has invalid availability`)
  }
  if (value.updatedAt !== undefined
    && (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0)) {
    throw new Error(`Roleplay resource provider ${JSON.stringify(providerId)} resource ${JSON.stringify(id)} has invalid updatedAt`)
  }
  return Object.freeze({
    id,
    kind: value.kind,
    name: value.name,
    availability: value.availability,
    ...(value.updatedAt === undefined ? {} : { updatedAt: value.updatedAt }),
  })
}

function descriptorKey(value: Pick<RoleplayResourceDescriptor, 'kind' | 'id'>): string {
  return JSON.stringify([value.kind, value.id])
}

function compareDescriptors(left: RoleplayResourceDescriptor, right: RoleplayResourceDescriptor): number {
  return (KIND_ORDER.get(left.kind) ?? Number.MAX_SAFE_INTEGER)
    - (KIND_ORDER.get(right.kind) ?? Number.MAX_SAFE_INTEGER)
    || (left.availability === right.availability ? 0 : left.availability === 'available' ? -1 : 1)
    || compareText(left.name, right.name)
    || compareText(left.id, right.id)
}

/**
 * Live resource directory. Providers retain their own storage and mutation policy;
 * the catalog exposes only normalized discovery metadata and exact runtime ids.
 */
export class RoleplayResourceCatalog {
  readonly #providers = new Map<string, Registration>()

  /** Register one provider and return a stale-disposer-safe revocation. */
  register(provider: RoleplayResourceProvider): () => void {
    const id = stableId(provider.id, 'Roleplay resource provider id')
    if (this.#providers.has(id)) {
      throw new Error(`Roleplay resource provider ${JSON.stringify(id)} is already registered`)
    }
    const registration = {
      token: Symbol(id),
      id,
      list: provider.list.bind(provider),
      ...(provider.inspect === undefined ? {} : { inspect: provider.inspect.bind(provider) }),
      ...(provider.materialize === undefined ? {} : { materialize: provider.materialize.bind(provider) }),
      ...(provider.projectActor === undefined ? {} : { projectActor: provider.projectActor.bind(provider) }),
      ...(provider.projectWorld === undefined ? {} : { projectWorld: provider.projectWorld.bind(provider) }),
      ...(provider.projectStorySource === undefined ? {} : { projectStorySource: provider.projectStorySource.bind(provider) }),
    }
    this.#providers.set(id, registration)
    return () => {
      if (this.#providers.get(id)?.token === registration.token) this.#providers.delete(id)
    }
  }

  #locations(kind?: RoleplayResourceKind): readonly LocatedRoleplayResource[] {
    if (kind !== undefined && !ROLEPLAY_RESOURCE_KINDS.includes(kind)) {
      throw new Error(`Unknown Roleplay resource kind ${JSON.stringify(kind)}`)
    }
    const entries: LocatedRoleplayResource[] = []
    const owners = new Map<string, string>()
    const providers = [...this.#providers.values()].sort((left, right) => compareText(left.id, right.id))
    for (const provider of providers) {
      const values = provider.list()
      if (!Array.isArray(values)) {
        throw new Error(`Roleplay resource provider ${JSON.stringify(provider.id)} returned an invalid list`)
      }
      for (const value of values) {
        const normalized = descriptor(value, provider.id)
        if (kind !== undefined && normalized.kind !== kind) continue
        const key = descriptorKey(normalized)
        const owner = owners.get(key)
        if (owner !== undefined) {
          throw new Error(`Roleplay resource ${key} is published by both ${JSON.stringify(owner)} and ${JSON.stringify(provider.id)}`)
        }
        owners.set(key, provider.id)
        entries.push(Object.freeze({ providerId: provider.id, descriptor: normalized }))
      }
    }
    return Object.freeze(entries.sort((left, right) => compareDescriptors(left.descriptor, right.descriptor)))
  }

  /** Resolve a deterministic detached snapshot from every currently loaded provider. */
  list(kind?: RoleplayResourceKind): readonly RoleplayResourceDescriptor[] {
    return Object.freeze(this.#locations(kind).map(value => value.descriptor))
  }

  /** Resolve one exact kind/id pair without exposing a provider-specific object. */
  get(kind: RoleplayResourceKind, id: string): RoleplayResourceDescriptor | undefined {
    return this.locate(kind, id)?.descriptor
  }

  /** Locate the unique Host provider that owns one stable resource reference. */
  locate(kind: RoleplayResourceKind, id: string): LocatedRoleplayResource | undefined {
    stableId(id, 'Roleplay resource id')
    return this.#locations(kind).find(value => value.descriptor.id === id)
  }

  /** Read bounded kind-specific details from the unique owning provider. */
  inspect(kind: RoleplayResourceKind, id: string): RoleplayResourceDetail {
    const located = this.locate(kind, id)
    if (located === undefined) throw new Error(`Roleplay resource ${descriptorKey({ kind, id })} is unavailable`)
    const registration = this.#providers.get(located.providerId)
    if (registration?.inspect === undefined) {
      throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} has no detail reader`)
    }
    return parseRoleplayResourceDetail(registration.inspect(located.descriptor), located.descriptor)
  }

  /** List only world resources backed by a provider-owned executable recipe. */
  listPlayWorlds(): readonly LocatedPlayWorldResource[] {
    return Object.freeze(this.#locations('world').flatMap(located => {
      const registration = this.#providers.get(located.providerId)
      if (registration?.projectWorld === undefined) return []
      if (registration.inspect === undefined) {
        throw new Error(`Executable world provider ${JSON.stringify(located.providerId)} has no detail reader`)
      }
      const detail = parseRoleplayResourceDetail(registration.inspect(located.descriptor), located.descriptor)
      if (detail.kind !== 'world' || detail.playWorld === undefined) return []
      return [Object.freeze({ ...located, detail }) as LocatedPlayWorldResource]
    }))
  }

  /** Resolve one actor selection into a bounded stable identity snapshot. */
  projectActor(selection: RoleplayResourceSelection): RoleplayActorProjection {
    if (selection.kind !== 'actor') throw new Error('人物实例只能绑定 actor 资源')
    const located = this.locate(selection.kind, selection.id)
    if (located === undefined) throw new Error(`Roleplay resource ${descriptorKey(selection)} is unavailable`)
    if (located.descriptor.availability !== 'available') throw new Error(`Roleplay resource ${descriptorKey(selection)} is archived`)
    if (selection.variant !== undefined) stableId(selection.variant, 'Roleplay resource variant')
    const registration = this.#providers.get(located.providerId)
    if (registration?.projectActor === undefined) {
      throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} cannot project actors`)
    }
    const projected = registration.projectActor(Object.freeze({ ...selection }), located.descriptor)
    const profile = projected?.profile
    if (typeof projected !== 'object' || projected === null || typeof projected.name !== 'string'
      || projected.name.trim() === '' || projected.name.length > 120 || typeof profile !== 'object' || profile === null
      || !Array.isArray(projected.voiceAliases) || projected.voiceAliases.length > 32
      || projected.voiceAliases.some(alias => typeof alias !== 'string' || alias.trim() === ''
        || alias.trim() !== alias || alias.length > 120)
      || new Set(projected.voiceAliases).size !== projected.voiceAliases.length
      || !['description', 'personality', 'scenario', 'exampleDialogue', 'systemPrompt', 'postHistoryInstructions']
        .every(field => typeof profile[field as keyof typeof profile] === 'string')
      || Object.keys(profile).some(field => !['description', 'personality', 'scenario', 'exampleDialogue', 'systemPrompt', 'postHistoryInstructions'].includes(field))
      || Buffer.byteLength(Object.values(profile).join('\n'), 'utf8') > 2 * 1024 * 1024) {
      throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} returned an invalid actor projection`)
    }
    return Object.freeze({
      name: projected.name.trim(),
      voiceAliases: Object.freeze([...projected.voiceAliases]),
      profile: Object.freeze({ ...profile }),
    })
  }

  /** Resolve a world selection into one bounded trusted-module recipe. */
  projectWorld(selection: RoleplayResourceSelection): RoleplayWorldProjection {
    if (selection.kind !== 'world') throw new Error('游玩世界只能绑定 world 资源')
    const located = this.locate(selection.kind, selection.id)
    if (located === undefined) throw new Error(`Roleplay resource ${descriptorKey(selection)} is unavailable`)
    if (located.descriptor.availability !== 'available') throw new Error(`Roleplay resource ${descriptorKey(selection)} is archived`)
    if (selection.variant !== undefined) stableId(selection.variant, 'Roleplay resource variant')
    const registration = this.#providers.get(located.providerId)
    if (registration?.projectWorld === undefined) {
      throw new Error(`世界资源 ${JSON.stringify(located.descriptor.name)} 没有可执行规则配方`)
    }
    const projected = registration.projectWorld(Object.freeze({ ...selection }), located.descriptor)
    if (typeof projected !== 'object' || projected === null || Array.isArray(projected)
      || Object.keys(projected).some(key => !['moduleId', 'configuration', 'sources', 'castSlots'].includes(key))
      || typeof projected.moduleId !== 'string'
      || !/^[a-z0-9][a-z0-9._:/-]{0,127}$/u.test(projected.moduleId)
      || !Array.isArray(projected.sources) || projected.sources.length > 64
      || !Array.isArray(projected.castSlots)) {
      throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} returned an invalid world projection`)
    }
    const configuration = snapshotJsonValue(projected.configuration) as JsonValue | undefined
    if (configuration === undefined || Buffer.byteLength(JSON.stringify(configuration), 'utf8') > 1024 * 1024) {
      throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} returned invalid world configuration`)
    }
    const sources = projected.sources.map(source => {
      if (typeof source !== 'object' || source === null || Array.isArray(source)
        || source.kind !== 'world' || typeof source.id !== 'string'
        || Object.keys(source).some(key => !['kind', 'id', 'variant'].includes(key))) {
        throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} returned an invalid world source reference`)
      }
      stableId(source.id, 'Roleplay world source id')
      if (source.variant !== undefined) stableId(source.variant, 'Roleplay world source variant')
      return Object.freeze({ kind: 'world' as const, id: source.id, ...(source.variant === undefined ? {} : { variant: source.variant }) })
    })
    if (new Set(sources.map(source => JSON.stringify(source))).size !== sources.length) {
      throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} repeated a world source reference`)
    }
    const castSlots = projected.castSlots.map((slot, index) => {
      if (typeof slot !== 'object' || slot === null || Array.isArray(slot)
        || Object.keys(slot).some(key => !['id', 'name', 'description', 'required'].includes(key))) {
        throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} returned invalid cast slot ${index}`)
      }
      const id = stableId(slot.id, 'Roleplay world cast slot id')
      if (typeof slot.name !== 'string' || slot.name.trim() === '' || slot.name.length > 120
        || typeof slot.description !== 'string' || slot.description.length > 500
        || typeof slot.required !== 'boolean') {
        throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} returned invalid cast slot ${JSON.stringify(id)}`)
      }
      return Object.freeze({ id, name: slot.name.trim(), description: slot.description, required: slot.required })
    })
    if (castSlots.length > 64 || new Set(castSlots.map(slot => slot.id)).size !== castSlots.length) {
      throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} returned invalid cast slots`)
    }
    const detail = registration.inspect === undefined ? undefined : parseRoleplayResourceDetail(
      registration.inspect(located.descriptor), located.descriptor,
    )
    if (detail?.kind === 'world' && detail.playWorld !== undefined && detail.playWorld.moduleId !== projected.moduleId) {
      throw new Error(`世界资源 ${JSON.stringify(located.descriptor.name)} 的规则模块声明不一致`)
    }
    if (detail?.kind === 'world' && detail.playWorld !== undefined
      && !isDeepStrictEqual(detail.playWorld.castSlots, castSlots)) {
      throw new Error(`世界资源 ${JSON.stringify(located.descriptor.name)} 的人物槽位声明不一致`)
    }
    return Object.freeze({
      moduleId: projected.moduleId,
      configuration,
      sources: Object.freeze(sources),
      castSlots: Object.freeze(castSlots),
    })
  }

  /** Copy one reusable resource into a bounded editable story source. */
  projectStorySource(selection: RoleplayResourceSelection): RoleplayStorySourceProjection {
    const located = this.locate(selection.kind, selection.id)
    if (located === undefined) throw new Error(`Roleplay resource ${descriptorKey(selection)} is unavailable`)
    if (located.descriptor.availability !== 'available') throw new Error(`Roleplay resource ${descriptorKey(selection)} is archived`)
    if (selection.variant !== undefined) stableId(selection.variant, 'Roleplay resource variant')
    const registration = this.#providers.get(located.providerId)
    if (registration?.projectStorySource === undefined) {
      throw new Error(`资源 ${JSON.stringify(located.descriptor.name)} 不能作为故事资料`)
    }
    const projected = registration.projectStorySource(Object.freeze({ ...selection }), located.descriptor)
    if (typeof projected !== 'object' || projected === null || Array.isArray(projected)
      || Object.keys(projected).some(key => !['name', 'kind', 'content'].includes(key))
      || typeof projected.name !== 'string' || projected.name.trim() === '' || projected.name.length > 120
      || !['original', 'reference', 'research'].includes(projected.kind)
      || typeof projected.content !== 'string' || Buffer.byteLength(projected.content, 'utf8') > 2 * 1024 * 1024) {
      throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} returned an invalid story source projection`)
    }
    return Object.freeze({ name: projected.name.trim(), kind: projected.kind, content: projected.content })
  }

  /** Dispatch one selection to its owning provider and verify append-only Session semantics. */
  materialize(
    selection: RoleplayResourceSelection,
    events: readonly SessionEvent[],
    context: RoleplayResourceMaterializationContext,
  ): RoleplayResourceMaterialization {
    const located = this.locate(selection.kind, selection.id)
    if (located === undefined) {
      throw new Error(`Roleplay resource ${descriptorKey(selection)} is unavailable`)
    }
    if (located.descriptor.availability !== 'available') {
      throw new Error(`Roleplay resource ${descriptorKey(selection)} is archived`)
    }
    if (selection.variant !== undefined) stableId(selection.variant, 'Roleplay resource variant')
    if (context.mode !== 'character' && context.mode !== 'scene') {
      throw new Error('Roleplay resource materialization has an unknown experience mode')
    }
    if (context.participantName !== undefined
      && (typeof context.participantName !== 'string' || context.participantName.trim() === '')) {
      throw new Error('Roleplay resource materialization has an invalid participant name')
    }
    const registration = this.#providers.get(located.providerId)
    if (registration?.materialize === undefined) {
      throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} cannot materialize selections`)
    }
    const prefix = Object.freeze(structuredClone(events))
    const input = Object.freeze({
      selection: Object.freeze({
        kind: located.descriptor.kind,
        id: located.descriptor.id,
        ...(selection.variant === undefined ? {} : { variant: selection.variant }),
      }),
      descriptor: located.descriptor,
      events: prefix,
      context: Object.freeze({
        mode: context.mode,
        ...(context.participantName === undefined ? {} : { participantName: context.participantName }),
      }),
    })
    const result = registration.materialize(input)
    if (typeof result === 'object' && result !== null
      && 'then' in result && typeof result.then === 'function') {
      throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} must materialize synchronously`)
    }
    if (typeof result !== 'object' || result === null || !Array.isArray(result.events)) {
      throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} returned invalid Session events`)
    }
    const next = structuredClone(result.events)
    if (next.length < prefix.length
      || !next.slice(0, prefix.length).every((event, index) => isDeepStrictEqual(event, prefix[index]))) {
      throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} must only append Session events`)
    }
    if (next.some((event, index) => event.seq !== index)) {
      throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} returned non-contiguous Session events`)
    }
    const validated = Session.create(SessionId('agent-rp-resource-materialization-validation'), next)
    const title = typeof result.title === 'string' ? result.title.trim() : undefined
    if (result.title !== undefined && (title === undefined || title === '')) {
      throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} returned an invalid title`)
    }
    return Object.freeze({
      events: Object.freeze(validated.events.slice(0, next.length)),
      ...(title === undefined ? {} : { title }),
    })
  }
}

/** Register through the caller's Cordis scope so unload always removes the provider. */
export function registerRoleplayResourceProvider(ctx: Context, provider: RoleplayResourceProvider): void {
  const catalog = ctx.get(ROLEPLAY_RESOURCE_CATALOG_KEY)
  if (catalog === undefined || typeof catalog.register !== 'function') {
    throw new Error('Agent RP resource catalog service is unavailable')
  }
  ctx.effect(
    () => catalog.register(provider),
    `agent-rp: resource provider ${provider.id}`,
  )
}
