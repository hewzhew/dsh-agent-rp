/** Public records for the typed Agent RP story studio. */

/** Same-origin collection endpoint for local story workspaces. */
export const STORY_WORKSPACES_PATH = '/api/agent-rp/story-workspaces'

/** Editable role assigned to one ordered output section. */
export type StoryOutputKind = 'prose' | 'character' | 'history'

/** Provenance assigned to one local research source. */
export type StorySourceKind = 'original' | 'reference' | 'research' | 'web'

/** Node categories rendered on the story map. */
export type StoryNodeKind = 'arc' | 'beat' | 'secret'

/** Lifecycle of one canonical or AI-suggested story node. */
export type StoryNodeLifecycle = 'canonical' | 'suggested'

/** Progress state of one story node. */
export type StoryNodeStatus = 'planned' | 'active' | 'completed' | 'dropped'

/** Typed relationship between story-map nodes. */
export type StoryEdgeKind = 'precedes' | 'causes' | 'contains' | 'foreshadows'

/** Progress state carried only by foreshadowing relationships. */
export type StoryForeshadowStatus = 'unplanted' | 'planted' | 'triggered' | 'resolved' | 'dropped'

/** Reader visibility of a story object; character knowledge is tracked separately. */
export type StoryAudience = 'director' | 'public'

/** Epistemic status of one character-addressable fact. */
export type StoryFactStatus = 'asserted' | 'uncertain' | 'refuted'

/** Optional model route used only by story-engine auxiliary Workers. */
export interface StoryWorkerModelRoute {
  readonly provider: string
  readonly model: string
}

/** Execution settings that preserve stage order while parallelizing peers. */
export interface StoryPipelineSettings {
  readonly maxParallel: number
  readonly workerModel?: StoryWorkerModelRoute
}

/** Stable canvas coordinates owned by one story node. */
export interface StoryNodePosition {
  readonly x: number
  readonly y: number
}

/** One canonical or suggested object on the story map. */
export interface StoryNode {
  readonly id: string
  readonly kind: StoryNodeKind
  readonly title: string
  readonly status: StoryNodeStatus
  readonly lifecycle: StoryNodeLifecycle
  readonly audience: StoryAudience
  readonly position: StoryNodePosition
  readonly content: string
  readonly participantIds: readonly string[]
  readonly sourceEventId?: string
}

/** One typed, directed relationship on the story map. */
export interface StoryEdge {
  readonly id: string
  readonly kind: StoryEdgeKind
  readonly source: string
  readonly target: string
  readonly label: string
  readonly lifecycle: StoryNodeLifecycle
  readonly audience: StoryAudience
  readonly foreshadowStatus?: StoryForeshadowStatus
  readonly sourceEventId?: string
}

/** Story graph plus the beat that supplies current-scene participation. */
export interface StoryGraph {
  readonly activeNodeId?: string
  readonly nodes: readonly StoryNode[]
  readonly edges: readonly StoryEdge[]
}

/** One independently prompted story character. */
export interface StoryCharacter {
  readonly id: string
  readonly name: string
  readonly persona: string
}

/** Provenance for a manually authored or observed fact. */
export type StoryFactSource =
  | { readonly kind: 'manual' }
  | { readonly kind: 'event'; readonly eventId: string; readonly evidence: string }

/** One fact whose knownBy list is the authority for character Worker input. */
export interface StoryFact {
  readonly id: string
  readonly text: string
  readonly status: StoryFactStatus
  readonly audience: StoryAudience
  readonly knownBy: readonly string[]
  readonly source: StoryFactSource
}

/** One completed story event derived from the actually visible reply. */
export interface StoryEvent {
  readonly id: string
  readonly key: string
  readonly turn: number
  readonly title: string
  readonly summary: string
  readonly evidence: string
  readonly participantIds: readonly string[]
  readonly nodeId?: string
}

/** One ordered card compiled into a section Worker request. */
export interface StoryOutput {
  readonly id: string
  readonly name: string
  readonly kind: StoryOutputKind
  readonly enabled: boolean
  readonly characterId?: string
  readonly instructions: string
}

/** One local or web-oriented source available to the research stage. */
export interface StorySource {
  readonly id: string
  readonly name: string
  readonly kind: StorySourceKind
  readonly enabled: boolean
  readonly content: string
}

/** Story object supported by one exact source excerpt. */
export type StoryCitationTarget =
  | { readonly kind: 'node'; readonly nodeId: string }
  | { readonly kind: 'fact'; readonly factId: string }

/** Durable source excerpt whose quote remains evidence if the source later changes. */
export interface StoryCitation {
  readonly id: string
  readonly sourceId: string
  readonly locator: string
  readonly quote: string
  readonly note: string
  readonly target?: StoryCitationTarget
}

/** Coherent revision returned by local storage and HTTP reads. */
export interface StoryWorkspaceSnapshot {
  readonly format: 1
  readonly id: string
  readonly name: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly pipeline: StoryPipelineSettings
  readonly graph: StoryGraph
  readonly characters: readonly StoryCharacter[]
  readonly facts: readonly StoryFact[]
  readonly events: readonly StoryEvent[]
  readonly outputs: readonly StoryOutput[]
  readonly sources: readonly StorySource[]
  readonly citations: readonly StoryCitation[]
}

/** Lightweight workspace list item. */
export interface StoryWorkspaceSummary {
  readonly id: string
  readonly name: string
  readonly revision: number
  readonly updatedAt: number
  readonly characterCount: number
}

/** Request to create an empty typed story workspace. */
export interface StoryWorkspaceCreateRequest {
  readonly format: 1
  readonly name: string
}

/** Whole-workspace edit guarded by the last observed revision. */
export interface StoryWorkspaceSaveRequest {
  readonly format: 1
  readonly id: string
  readonly revision: number
  readonly name: string
  readonly pipeline: StoryPipelineSettings
  readonly graph: StoryGraph
  readonly characters: readonly StoryCharacter[]
  readonly facts: readonly StoryFact[]
  readonly events: readonly StoryEvent[]
  readonly outputs: readonly StoryOutput[]
  readonly sources: readonly StorySource[]
  readonly citations: readonly StoryCitation[]
}

/** One completed visible turn materialized into events, facts, and suggestions. */
export interface StoryTurnMaterialization {
  readonly key: string
  readonly turn: number
  readonly title: string
  readonly summary: string
  readonly evidence: string
  readonly participantIds: readonly string[]
  readonly observations: readonly {
    readonly characterId: string
    readonly text: string
  }[]
  readonly plotSuggestions: readonly string[]
  readonly foreshadowSuggestions: readonly string[]
}
