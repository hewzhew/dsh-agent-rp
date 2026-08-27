/** Browser-safe requests for creating a seeded Agent RP Session. */

import type { SessionPersonaSnapshot } from './persona-library-protocol.ts'
import type { RoleplayResourceSelection } from './roleplay-resource-catalog-protocol.ts'

/** Same-origin endpoint that creates one complete roleplay Session. */
export const AGENT_RP_SESSION_PATH = '/api/agent-rp/sessions'

/** Start a new Session from one reusable Character Card. */
export interface CharacterSessionLaunchRequest {
  readonly format: 0
  readonly sourceSessionId: string
  readonly kind: 'character'
  readonly characterId: string
  readonly greetingIndex: number
  readonly persona?: SessionPersonaSnapshot
  readonly presetId?: string
  /** DSH Agent composition providing tools and runtime capabilities. */
  readonly agentPresetId?: string
  /** Additional retained World Info sources in stable prompt order. */
  readonly worldInfoIds?: readonly string[]
  /** Explicitly copy the source Session's currently active memory for the same character. */
  readonly memory?: 'copy-active'
}

/** Start a new Session from one retained standalone World Info source. */
export interface WorldInfoSessionLaunchRequest {
  readonly format: 0
  readonly sourceSessionId: string
  readonly kind: 'world-info'
  readonly importId: string
  readonly persona?: SessionPersonaSnapshot
  readonly presetId?: string
  /** DSH Agent composition providing tools and runtime capabilities. */
  readonly agentPresetId?: string
  /** Supporting retained World Info sources after the primary scenario book. */
  readonly worldInfoIds?: readonly string[]
}

/** Start a new Session from one retained SillyTavern JSONL import. */
export interface ChatSessionLaunchRequest {
  readonly format: 0
  readonly sourceSessionId: string
  readonly kind: 'chat'
  readonly importId: string
  readonly characterId?: string
  readonly presetId?: string
  /** DSH Agent composition providing tools and runtime capabilities. */
  readonly agentPresetId?: string
}

/** Start one source-neutral experience from independently selected reusable resources. */
export interface RoleplayExperienceSessionLaunchRequest {
  readonly format: 0
  readonly sourceSessionId: string
  readonly kind: 'experience'
  readonly mode: 'character' | 'scene'
  readonly actor?: RoleplayResourceSelection
  readonly participant?: RoleplayResourceSelection
  readonly worlds?: readonly RoleplayResourceSelection[]
  readonly promptPolicy?: RoleplayResourceSelection
  readonly regexPacks?: readonly RoleplayResourceSelection[]
  /** DSH Agent composition providing tools and runtime capabilities. */
  readonly agentPresetId?: string
}

/** Start one Session directly from an executable play space. */
export interface StoryWorkspaceSessionLaunchRequest {
  readonly format: 0
  readonly sourceSessionId: string
  readonly kind: 'story-workspace'
  readonly workspaceId: string
  /** DSH Agent composition providing tools and runtime capabilities. */
  readonly agentPresetId?: string
}

/** Start a child Session immediately before one completed user turn. */
export interface RewriteSessionLaunchRequest {
  readonly format: 0
  readonly sourceSessionId: string
  readonly kind: 'rewrite'
  readonly turn: number
  readonly text: string
}

/** Complete model-free Session launch accepted by the Agent RP Host. */
export type AgentRpSessionLaunchRequest =
  | CharacterSessionLaunchRequest
  | WorldInfoSessionLaunchRequest
  | ChatSessionLaunchRequest
  | RoleplayExperienceSessionLaunchRequest
  | StoryWorkspaceSessionLaunchRequest
  | RewriteSessionLaunchRequest

/** Library-backed launch request that does not depend on an existing RP transcript. */
export type LibrarySessionLaunchRequest =
  | CharacterSessionLaunchRequest
  | WorldInfoSessionLaunchRequest
  | ChatSessionLaunchRequest
  | RoleplayExperienceSessionLaunchRequest
  | StoryWorkspaceSessionLaunchRequest

/** Successful launch result returned after the Agent is published. */
export interface AgentRpSessionLaunchResponse {
  readonly format: 0
  readonly sessionId: string
  readonly title: string
  /** Non-fatal reason the created Session could not inherit a Workspace. */
  readonly workspaceWarning?: string
}
