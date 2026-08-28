/** Public records for the typed Agent RP play space. */

import type { PlayWorldSnapshot } from './play-world-protocol.ts'
import type { RoleplayResourceSelection } from './roleplay-resource-catalog-protocol.ts'

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
export type StoryEdgeKind = 'precedes' | 'causes' | 'foreshadows'

/** Progress state carried only by foreshadowing relationships. */
export type StoryForeshadowStatus = 'unplanted' | 'planted' | 'triggered' | 'resolved' | 'dropped'

/** Reader visibility of a story object; character knowledge is tracked separately. */
export type StoryAudience = 'director' | 'public'

/** Epistemic status of one character-addressable fact. */
export type StoryFactStatus = 'asserted' | 'uncertain' | 'refuted'

/** Default character-knowledge rule inherited by details inside one story cluster. */
export type StoryKnowledgeMode = 'inherit' | 'none' | 'participants' | 'characters'

/** Character knowledge granted by one cluster before per-detail overrides. */
export interface StoryKnowledgePolicy {
  readonly mode: StoryKnowledgeMode
  readonly characterIds: readonly string[]
}

/** Optional model route used only by story-engine auxiliary Workers. */
export interface StoryWorkerModelRoute {
  readonly provider: string
  readonly model: string
}

/** Portable reasoning policy for initial and retry dialogue drafts. */
export type StoryVoiceDraftReasoning = 'routine' | 'quality'

/** Execution settings that preserve stage order while parallelizing peers. */
export interface StoryPipelineSettings {
  /** Maximum number of same-stage character or output Workers. */
  readonly maxParallel: number
  /** Maximum research Worker passes, including the initial local-evidence pass. */
  readonly researchMaxPasses: number
  /** Reasoning policy shared by initial and retry dialogue drafts. */
  readonly voiceDraftReasoning: StoryVoiceDraftReasoning
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
  readonly parentId?: string
  readonly title: string
  readonly summary: string
  readonly status: StoryNodeStatus
  readonly lifecycle: StoryNodeLifecycle
  readonly audience: StoryAudience
  readonly position: StoryNodePosition
  readonly content: string
  readonly participantIds: readonly string[]
  readonly knowledge: StoryKnowledgePolicy
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

/** Reusable identity fields carried by one story character or bound Character Card snapshot. */
export interface StoryCharacterProfile {
  readonly description: string
  readonly personality: string
  readonly scenario: string
  readonly exampleDialogue: string
  readonly systemPrompt: string
  readonly postHistoryInstructions: string
}

/** Mutable state owned by one character instance in the current play space. */
export interface StoryCharacterState {
  readonly location: string
  readonly condition: string
  readonly objective: string
  readonly notes: string
}

/** One independently prompted story character. */
export interface StoryCharacter {
  readonly id: string
  readonly name: string
  /** Alternative source-dialogue signatures used only to attribute imported lines to this character. */
  readonly voiceAliases?: readonly string[]
  readonly profile: StoryCharacterProfile
  readonly state: StoryCharacterState
  /** Stable source reference for a Character Card snapshot bound from the resource center. */
  readonly actor?: RoleplayResourceSelection
}

/** Revision-guarded request to bind or detach one actor resource from a character instance. */
export interface StoryCharacterActorBindRequest {
  readonly format: 0
  readonly revision: number
  readonly characterId: string
  readonly actor?: RoleplayResourceSelection
}

/** Provenance for a manually authored or observed fact. */
export type StoryFactSource =
  | { readonly kind: 'manual' }
  | { readonly kind: 'event'; readonly eventId: string; readonly evidence: string }

/** One fact whose knownBy list is the authority for character Worker input. */
export interface StoryFact {
  readonly id: string
  readonly nodeId?: string
  readonly text: string
  readonly status: StoryFactStatus
  readonly audience: StoryAudience
  /** Inherit the parent cluster policy or use `knownBy` as the complete override. */
  readonly knowledgeMode: 'inherit' | 'override'
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
  /** Authoritative executable-world events represented by this visible story turn. */
  readonly worldEventSequences?: readonly number[]
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
  readonly origin?: StorySourceOrigin
}

/** Network provenance retained when an inbox result becomes a durable source. */
export interface StorySourceOrigin {
  readonly kind: 'web'
  readonly url: string
  readonly query: string
  readonly sessionId: string
  readonly turn: number
  readonly resultEventSeq: number
}

/** One network result waiting for the player to keep or dismiss it. */
export interface StoryResearchItem extends StorySourceOrigin {
  readonly id: string
  readonly title: string
  readonly snippet: string
  readonly publishedAt?: string
}

/** Story object supported by one exact source excerpt. */
export type StoryCitationTarget =
  | { readonly kind: 'node'; readonly nodeId: string }
  | { readonly kind: 'fact'; readonly factId: string }
  | { readonly kind: 'event'; readonly eventId: string }

/** Exact local-source excerpt ready to attach after a visible turn is committed. */
export interface StoryCitationDraft {
  readonly sourceId: string
  readonly locator: string
  readonly quote: string
  readonly note: string
}

/** Durable source excerpt whose quote remains evidence if the source later changes. */
export interface StoryCitation {
  readonly id: string
  readonly sourceId: string
  readonly locator: string
  readonly quote: string
  readonly note: string
  readonly target?: StoryCitationTarget
}

/** Durable proof that one model-selected world action was applied exactly once. */
export interface StoryWorldActionReceipt {
  readonly key: string
  readonly runKey: string
  readonly worldInstanceId: string
  readonly cycleId: string
  readonly sequence: number
  readonly characterId: string
  readonly actionId: string
  readonly resultEventSeq: number
  readonly eventSequences: readonly number[]
}

/** Coherent revision returned by local storage and HTTP reads. */
export interface StoryWorkspaceSnapshot {
  readonly format: 2
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
  readonly researchInbox: readonly StoryResearchItem[]
  /** Executable authoritative world; mutations use the dedicated action endpoint. */
  readonly world?: PlayWorldSnapshot
  /** Recent idempotency receipts for character-selected executable-world actions. */
  readonly worldActionReceipts?: readonly StoryWorldActionReceipt[]
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
  readonly format: 2
  readonly name: string
}

/** Whole-workspace edit guarded by the last observed revision. */
export interface StoryWorkspaceSaveRequest {
  readonly format: 2
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
  readonly researchInbox: readonly StoryResearchItem[]
}

/** Temporary endpoint used while one AI suggestion batch has no durable node ids. */
export type StorySuggestionEndpoint =
  | { readonly kind: 'node'; readonly nodeId: string }
  | { readonly kind: 'proposal'; readonly ref: string }

/** One typed story node proposed from a completed visible turn. */
export interface StoryNodeSuggestion {
  readonly ref: string
  readonly kind: StoryNodeKind
  readonly parent?: StorySuggestionEndpoint
  readonly title: string
  readonly summary: string
  readonly content: string
  readonly participantIds: readonly string[]
  readonly knowledge: StoryKnowledgePolicy
}

/** One typed relationship proposed between canonical or same-batch nodes. */
export interface StoryEdgeSuggestion {
  readonly kind: StoryEdgeKind
  readonly source: StorySuggestionEndpoint
  readonly target: StorySuggestionEndpoint
  readonly label: string
  readonly foreshadowStatus?: StoryForeshadowStatus
}

/** One observed fact and the complete set of characters who perceived it. */
export interface StoryFactChange {
  readonly text: string
  readonly knownBy: readonly string[]
}

/** Current-play-space state fields changed by one completed visible turn. */
export interface StoryCharacterStateChange {
  readonly characterId: string
  readonly location?: string
  readonly condition?: string
  readonly objective?: string
  readonly notes?: string
}

/** One atomic typed change set proposed from a completed visible turn. */
export interface StoryChangeSet {
  readonly characters: readonly StoryCharacterStateChange[]
  readonly facts: readonly StoryFactChange[]
  readonly nodes: readonly StoryNodeSuggestion[]
  readonly edges: readonly StoryEdgeSuggestion[]
}

/** One completed visible turn materialized into an event and one typed change set. */
export interface StoryTurnMaterialization {
  readonly key: string
  readonly turn: number
  readonly title: string
  readonly summary: string
  readonly evidence: string
  readonly participantIds: readonly string[]
  /** Executable-world events that the visible reply was required to represent. */
  readonly worldEventSequences?: readonly number[]
  readonly changes: StoryChangeSet
  /** Local research excerpts shown to the director for this turn. */
  readonly citations?: readonly StoryCitationDraft[]
  readonly webResearch: readonly Omit<StoryResearchItem, 'id'>[]
}
