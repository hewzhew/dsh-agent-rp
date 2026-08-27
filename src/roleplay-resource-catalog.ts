/** Source-neutral, read-only registry of reusable Roleplay resources. */

import type { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { isDeepStrictEqual } from 'node:util'
import {
  parseRoleplayResourceDetail,
  ROLEPLAY_RESOURCE_KINDS,
  type RoleplayResourceDescriptor,
  type RoleplayResourceDetail,
  type RoleplayResourceKind,
  type RoleplayResourceSelection,
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
}

/** Host-only actor snapshot stored by a play-space character instance. */
export interface RoleplayActorProjection {
  readonly name: string
  readonly profile: {
    readonly description: string
    readonly personality: string
    readonly scenario: string
    readonly exampleDialogue: string
    readonly systemPrompt: string
    readonly postHistoryInstructions: string
  }
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

interface Registration {
  readonly token: symbol
  readonly id: string
  readonly list: RoleplayResourceProvider['list']
  readonly inspect?: NonNullable<RoleplayResourceProvider['inspect']>
  readonly materialize?: NonNullable<RoleplayResourceProvider['materialize']>
  readonly projectActor?: NonNullable<RoleplayResourceProvider['projectActor']>
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
      || !['description', 'personality', 'scenario', 'exampleDialogue', 'systemPrompt', 'postHistoryInstructions']
        .every(field => typeof profile[field as keyof typeof profile] === 'string')
      || Object.keys(profile).some(field => !['description', 'personality', 'scenario', 'exampleDialogue', 'systemPrompt', 'postHistoryInstructions'].includes(field))
      || Buffer.byteLength(Object.values(profile).join('\n'), 'utf8') > 2 * 1024 * 1024) {
      throw new Error(`Roleplay resource provider ${JSON.stringify(located.providerId)} returned an invalid actor projection`)
    }
    return Object.freeze({ name: projected.name.trim(), profile: Object.freeze({ ...profile }) })
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
