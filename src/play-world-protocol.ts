/** Browser-safe records for executable worlds hosted by one play space. */

/** Same-origin discovery endpoint for installed world modules. */
export const PLAY_WORLD_MODULES_PATH = '/api/agent-rp/play-world-modules'

/** Stable presentation metadata for one executable world module. */
export interface PlayWorldModuleDescriptor {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly category: 'game' | 'simulation'
  readonly minCharacters: number
  readonly maxCharacters: number
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

/** Request to attach a fresh executable world to one workspace revision. */
export interface PlayWorldInstallRequest {
  readonly format: 0
  readonly revision: number
  readonly moduleId: string
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
