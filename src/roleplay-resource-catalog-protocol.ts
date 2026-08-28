/** Browser-safe resource discovery values for the native Roleplay runtime. */

/** Same-origin read-only resource directory endpoint. */
export const ROLEPLAY_RESOURCE_CATALOG_PATH = '/api/agent-rp/resources'

/** Reusable resource categories that can be selected independently for an experience. */
export const ROLEPLAY_RESOURCE_KINDS = ['actor', 'persona', 'world', 'prompt-policy', 'regex'] as const

export type RoleplayResourceKind = typeof ROLEPLAY_RESOURCE_KINDS[number]

/** Source-neutral identity used to select one exact reusable resource. */
export interface RoleplayResourceReference {
  readonly kind: RoleplayResourceKind
  readonly id: string
}

/** One reusable resource plus an optional provider-owned immutable variant. */
export interface RoleplayResourceSelection extends RoleplayResourceReference {
  readonly variant?: string
}

/** One selectable actor opening; preview is bounded presentation text, not the durable snapshot. */
export interface RoleplayActorOpeningDetail {
  readonly id: string
  readonly label: string
  readonly preview: string
  readonly truncated: boolean
}

export interface RoleplayActorResourceDetail {
  readonly kind: 'actor'
  readonly openings: readonly RoleplayActorOpeningDetail[]
}

export interface RoleplayPersonaResourceDetail {
  readonly kind: 'persona'
  readonly description: string
}

/** One browser-visible role opening declared by an executable world recipe. */
export interface RoleplayWorldCastSlotDetail {
  readonly id: string
  readonly name: string
  /** Alternative written names used to match imported Character Cards to this role. */
  readonly aliases: readonly string[]
  readonly description: string
  readonly required: boolean
}

export interface RoleplayWorldResourceDetail {
  readonly kind: 'world'
  readonly entryCount: number
  /** Optional trusted rule program advertised by this world resource. */
  readonly playWorld?: {
    readonly moduleId: string
    readonly summary: string
    readonly category: 'game' | 'simulation'
    readonly minCharacters: number
    readonly maxCharacters: number
    readonly castSlots: readonly RoleplayWorldCastSlotDetail[]
  }
}

export interface RoleplayPromptPolicyResourceDetail {
  readonly kind: 'prompt-policy'
  readonly moduleCount: number
  readonly enabledModuleCount: number
}

export interface RoleplayRegexResourceDetail {
  readonly kind: 'regex'
  readonly scriptCount: number
  readonly enabledCount: number
  readonly displayCount: number
  readonly promptCount: number
}

/** Source-neutral, kind-specific information needed to configure one selection. */
export type RoleplayResourceDetail =
  | RoleplayActorResourceDetail
  | RoleplayPersonaResourceDetail
  | RoleplayWorldResourceDetail
  | RoleplayPromptPolicyResourceDetail
  | RoleplayRegexResourceDetail

function exactDetailKeys(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function detailId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || /\s/u.test(value)) {
    throw new Error(`${label} must be a non-empty stable id without whitespace`)
  }
  return value
}

/** Parse the one shared bounded detail contract used by providers, HTTP and browser clients. */
export function parseRoleplayResourceDetail(
  value: unknown,
  reference: RoleplayResourceReference,
): RoleplayResourceDetail {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || (value as { readonly kind?: unknown }).kind !== reference.kind) {
    throw new Error(`Roleplay resource ${JSON.stringify([reference.kind, reference.id])} returned mismatched details`)
  }
  const detail = value as RoleplayResourceDetail
  if (detail.kind === 'actor') {
    if (!exactDetailKeys(detail, ['kind', 'openings'])
      || !Array.isArray(detail.openings) || detail.openings.length > 1024) {
      throw new Error(`Roleplay actor ${JSON.stringify(reference.id)} returned invalid openings`)
    }
    const openings = detail.openings.map((opening, index) => {
      if (typeof opening !== 'object' || opening === null || Array.isArray(opening)
        || !exactDetailKeys(opening, ['id', 'label', 'preview', 'truncated'])) {
        throw new Error(`Roleplay actor ${JSON.stringify(reference.id)} opening ${index} is invalid`)
      }
      const id = detailId(opening.id, `Roleplay actor ${JSON.stringify(reference.id)} opening id`)
      if (typeof opening.label !== 'string' || opening.label.trim() === '' || opening.label.length > 120
        || typeof opening.preview !== 'string' || opening.preview.length > 2000
        || typeof opening.truncated !== 'boolean') {
        throw new Error(`Roleplay actor ${JSON.stringify(reference.id)} opening ${JSON.stringify(id)} is invalid`)
      }
      return Object.freeze({
        id,
        label: opening.label.trim(),
        preview: opening.preview,
        truncated: opening.truncated,
      })
    })
    if (new Set(openings.map(opening => opening.id)).size !== openings.length) {
      throw new Error(`Roleplay actor ${JSON.stringify(reference.id)} repeats an opening id`)
    }
    return Object.freeze({ kind: 'actor', openings: Object.freeze(openings) })
  }
  if (detail.kind === 'persona') {
    if (!exactDetailKeys(detail, ['kind', 'description'])
      || typeof detail.description !== 'string' || detail.description.length > 12_000) {
      throw new Error(`Roleplay Persona ${JSON.stringify(reference.id)} returned invalid details`)
    }
    return Object.freeze({ kind: 'persona', description: detail.description })
  }
  if (detail.kind === 'world') {
    if (!exactDetailKeys(detail, ['kind', 'entryCount', 'playWorld'])
      || !Number.isSafeInteger(detail.entryCount) || detail.entryCount < 0) {
      throw new Error(`Roleplay world ${JSON.stringify(reference.id)} returned invalid details`)
    }
    const playWorld = detail.playWorld
    if (playWorld !== undefined && (typeof playWorld !== 'object' || playWorld === null
      || !exactDetailKeys(playWorld, ['moduleId', 'summary', 'category', 'minCharacters', 'maxCharacters', 'castSlots'])
      || typeof playWorld.moduleId !== 'string'
      || !/^[a-z0-9][a-z0-9._:/-]{0,127}$/u.test(playWorld.moduleId)
      || typeof playWorld.summary !== 'string' || playWorld.summary.trim() === '' || playWorld.summary.length > 500
      || playWorld.category !== 'game' && playWorld.category !== 'simulation'
      || !Number.isSafeInteger(playWorld.minCharacters) || playWorld.minCharacters < 1
      || !Number.isSafeInteger(playWorld.maxCharacters) || playWorld.maxCharacters < playWorld.minCharacters
      || playWorld.maxCharacters > 64 || !Array.isArray(playWorld.castSlots)
      || playWorld.castSlots.length > playWorld.maxCharacters)) {
      throw new Error(`Roleplay world ${JSON.stringify(reference.id)} returned invalid play-world details`)
    }
    const castSlots = playWorld?.castSlots.map((slot, index) => {
      if (typeof slot !== 'object' || slot === null || Array.isArray(slot)
        || !exactDetailKeys(slot, ['id', 'name', 'aliases', 'description', 'required'])) {
        throw new Error(`Roleplay world ${JSON.stringify(reference.id)} cast slot ${index} is invalid`)
      }
      const id = detailId(slot.id, `Roleplay world ${JSON.stringify(reference.id)} cast slot id`)
      if (typeof slot.name !== 'string' || slot.name.trim() === '' || slot.name.length > 120
        || !Array.isArray(slot.aliases) || slot.aliases.length > 32
        || slot.aliases.some(alias => typeof alias !== 'string' || alias.trim() === '' || alias.length > 120)
        || typeof slot.description !== 'string' || slot.description.length > 500
        || typeof slot.required !== 'boolean') {
        throw new Error(`Roleplay world ${JSON.stringify(reference.id)} cast slot ${JSON.stringify(id)} is invalid`)
      }
      const aliases = slot.aliases.map(alias => alias.trim())
      if (new Set(aliases).size !== aliases.length || aliases.includes(slot.name.trim())) {
        throw new Error(`Roleplay world ${JSON.stringify(reference.id)} cast slot ${JSON.stringify(id)} repeats a name`)
      }
      return Object.freeze({
        id,
        name: slot.name.trim(),
        aliases: Object.freeze(aliases),
        description: slot.description,
        required: slot.required,
      })
    }) ?? []
    const requiredCastCount = castSlots.filter(slot => slot.required).length
    if (new Set(castSlots.map(slot => slot.id)).size !== castSlots.length
      || castSlots.length > 0 && requiredCastCount < (playWorld?.minCharacters ?? 0)
      || requiredCastCount > (playWorld?.maxCharacters ?? 0)) {
      throw new Error(`Roleplay world ${JSON.stringify(reference.id)} returned invalid cast slots`)
    }
    return Object.freeze({
      kind: 'world',
      entryCount: detail.entryCount,
      ...(playWorld === undefined ? {} : { playWorld: Object.freeze({ ...playWorld, castSlots: Object.freeze(castSlots) }) }),
    })
  }
  if (detail.kind === 'prompt-policy') {
    if (!exactDetailKeys(detail, ['kind', 'moduleCount', 'enabledModuleCount'])
      || !Number.isSafeInteger(detail.moduleCount) || detail.moduleCount < 0
      || !Number.isSafeInteger(detail.enabledModuleCount) || detail.enabledModuleCount < 0
      || detail.enabledModuleCount > detail.moduleCount) {
      throw new Error(`Roleplay prompt policy ${JSON.stringify(reference.id)} returned invalid details`)
    }
    return Object.freeze({
      kind: 'prompt-policy',
      moduleCount: detail.moduleCount,
      enabledModuleCount: detail.enabledModuleCount,
    })
  }
  if (!exactDetailKeys(detail, ['kind', 'scriptCount', 'enabledCount', 'displayCount', 'promptCount'])
    || ![detail.scriptCount, detail.enabledCount, detail.displayCount, detail.promptCount]
      .every(count => Number.isSafeInteger(count) && count >= 0)
    || detail.enabledCount > detail.scriptCount || detail.displayCount > detail.scriptCount
    || detail.promptCount > detail.scriptCount) {
    throw new Error(`Roleplay regex pack ${JSON.stringify(reference.id)} returned invalid details`)
  }
  return Object.freeze({
    kind: 'regex',
    scriptCount: detail.scriptCount,
    enabledCount: detail.enabledCount,
    displayCount: detail.displayCount,
    promptCount: detail.promptCount,
  })
}

/** Stable reference and presentation metadata without source-format payloads. */
export interface RoleplayResourceDescriptor extends RoleplayResourceReference {
  readonly name: string
  readonly availability: 'available' | 'archived'
  readonly updatedAt?: number
}

/** Content-free snapshot returned to the local Roleplay UI. */
export interface RoleplayResourceCatalogResponse {
  readonly format: 0
  readonly entries: readonly RoleplayResourceDescriptor[]
}

/** Explicit detail read for one resource; the collection endpoint remains content-free. */
export interface RoleplayResourceDetailResponse {
  readonly format: 0
  readonly descriptor: RoleplayResourceDescriptor
  readonly detail: RoleplayResourceDetail
}
