/** Browser-safe records for executable worlds hosted by one play space. */

import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import type { RoleplayResourceSelection } from './roleplay-resource-catalog-protocol.ts'

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
}

/** One authoritative event emitted by an executable world. */
export interface PlayWorldEvent {
  readonly id: string
  readonly sequence: number
  readonly type: string
  readonly title: string
  readonly summary: string
  readonly actorId?: string
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
}

/** Request to attach a fresh executable world to one workspace revision. */
export interface PlayWorldInstallRequest {
  readonly format: 0
  readonly revision: number
  readonly resource: RoleplayResourceSelection
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
