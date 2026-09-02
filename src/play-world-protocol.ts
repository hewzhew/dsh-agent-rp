/** Browser-safe records for executable worlds hosted by one play space. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  RoleplayResourceSelection,
  RoleplayWorldCastSlotDetail,
} from './roleplay-resource-catalog-protocol.ts'

/** Same-origin discovery endpoint for resource-owned executable worlds. */
export const PLAY_WORLD_RESOURCES_PATH = '/api/agent-rp/play-world-resources'

/** Stable presentation metadata for one executable world module. */
export interface PlayWorldModuleDescriptor {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly category: 'game' | 'simulation'
  readonly minCharacters: number
  readonly maxCharacters: number
}

/** Browser-safe world resource plus the availability of its trusted rule module. */
export interface PlayWorldResourceDescriptor extends PlayWorldModuleDescriptor {
  readonly resource: RoleplayResourceSelection
  readonly moduleAvailable: boolean
  readonly castSlots: readonly RoleplayWorldCastSlotDetail[]
}

/** One authoritative event emitted by an executable world. */
export interface PlayWorldEvent {
  readonly id: string
  readonly sequence: number
  readonly type: string
  readonly title: string
  readonly summary: string
  readonly actorId?: string
  /** Module-owned machine-readable cause and values used by clients and model projections. */
  readonly data?: JsonValue
}

/** Durable module-owned state attached to one play space. */
export interface PlayWorldSnapshot {
  readonly format: 0
  readonly instanceId: string
  readonly moduleId: string
  readonly moduleVersion: number
  readonly title: string
  readonly state: unknown
  readonly events: readonly PlayWorldEvent[]
}

/** Durable installation recipe resolved by the Host from one selected world resource. */
export interface PlayWorldBinding {
  readonly resource?: RoleplayResourceSelection
  readonly moduleId: string
  readonly configuration: JsonValue
  readonly sourceReferences: readonly RoleplayResourceSelection[]
  readonly sourceIds: readonly string[]
  readonly cast: readonly PlayWorldCastBinding[]
}

/** Durable association between one recipe slot and its play-space character instance. */
export interface PlayWorldCastBinding {
  readonly slotId: string
  readonly characterId: string
}

/** Actor selection used to fill one recipe slot while installing a fresh world. */
export interface PlayWorldCastSelection {
  readonly slotId: string
  readonly actor: RoleplayResourceSelection
  /** Existing character to update in place so authored graph references remain stable. */
  readonly characterId?: string
}

/** Request to attach a fresh executable world to one workspace revision. */
export interface PlayWorldInstallRequest {
  readonly format: 0
  readonly revision: number
  readonly resource: RoleplayResourceSelection
  readonly cast: readonly PlayWorldCastSelection[]
}

/** Request to bind actor resources to the current world's existing character identities. */
export interface PlayWorldCastUpdateRequest {
  readonly format: 0
  readonly revision: number
  readonly cast: readonly PlayWorldCastSelection[]
}

/** Request to replace editable module configuration without resetting world state. */
export interface PlayWorldConfigurationUpdateRequest {
  readonly format: 0
  readonly revision: number
  readonly configuration: JsonValue
}

/** Request to recreate the current executable world and discard this playthrough's derived story state. */
export interface PlayWorldRestartRequest {
  readonly format: 0
  readonly revision: number
}

/** One browser-safe legal choice whose executable payload remains inside the Host module. */
export interface PlayWorldActionDescriptor {
  readonly id: string
  readonly label: string
  readonly description: string
}

/** One short fact displayed in the native Session world surface. */
export interface PlayWorldSurfaceFact {
  readonly label: string
  readonly value: string
}

/** One optional prompt that only fills the native DSH composer. */
export interface PlayWorldComposerSuggestion {
  readonly id: string
  readonly label: string
  readonly draft: string
}

/** Module-owned browser projection hosted beside the native DSH conversation. */
export interface PlayWorldSurfaceProjection {
  readonly title: string
  readonly status: string
  readonly summary: string
  readonly facts: readonly PlayWorldSurfaceFact[]
  /** Stable renderer kind plus browser-safe module data; the Host owns placement and collapse behavior. */
  readonly viewport?: {
    readonly kind: string
    readonly data: JsonValue
  }
  readonly composerSuggestions: readonly PlayWorldComposerSuggestion[]
}

/** Current Host-advertised turn projected without module-owned action payloads. */
export interface PlayWorldTurnProjection {
  readonly cycleId: string
  readonly characterId: string
  readonly instruction: string
  readonly actions: readonly PlayWorldActionDescriptor[]
}

/** Request to apply one currently advertised action to the authoritative state. */
export interface PlayWorldActionRequest {
  readonly format: 0
  readonly revision: number
  readonly cycleId: string
  readonly actionId: string
}

/** Character-specific model input produced without revealing private world state. */
export interface PlayWorldPromptProjection {
  readonly title: string
  readonly text: string
}

/** How selected world events should occupy the next visible story passage. */
export type PlayWorldNarrativeCadence = 'transition' | 'scene' | 'resolution'

/** One immutable public fact backed by selected authoritative world events. */
export interface PlayWorldNarrativeFact {
  readonly eventSequences: readonly number[]
  readonly text: string
}

/** One optional dramatic direction made available by selected world events. */
export interface PlayWorldNarrativeCue {
  readonly eventSequences: readonly number[]
  readonly kind: 'change' | 'pressure' | 'opportunity' | 'relationship'
  readonly text: string
  readonly characterIds: readonly string[]
}

/** One non-rendered world truth that every narrative rendering must preserve. */
export interface PlayWorldNarrativeInvariant {
  readonly id: string
  readonly text: string
}

/** Public story material derived from one selected batch of authoritative events. */
export interface PlayWorldNarrativeProjection {
  readonly cadence: PlayWorldNarrativeCadence
  readonly facts: readonly PlayWorldNarrativeFact[]
  readonly cues: readonly PlayWorldNarrativeCue[]
  /** Stable facts used to reject contradictions without forcing them into the prose. */
  readonly invariants?: readonly PlayWorldNarrativeInvariant[]
}
