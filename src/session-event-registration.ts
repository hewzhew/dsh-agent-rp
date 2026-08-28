/** Session event ownership and writes for Agent RP's durable vocabulary. */

import type { Context } from '@deepseek-ai/cordis'
import {
  type SessionEventMap,
} from '@deepseek-ai/dsh-session'

/** Stable npm owner used by DSH persistence when admitting Agent RP events. */
export const AGENT_RP_SESSION_EVENT_OWNER = '@hewzhew/dsh-agent-rp'

/** Complete private event vocabulary declaration-merged by Agent RP. */
export const AGENT_RP_SESSION_EVENT_TYPES = [
  'agent-rp/act-model-request',
  'agent-rp/act-model-result',
  'agent-rp/character-card-seed',
  'agent-rp/experience-selection',
  'agent-rp/memory-seed',
  'agent-rp/mvu-state',
  'agent-rp/generation-state',
  'agent-rp/narrative-review-request',
  'agent-rp/narrative-review-result',
  'agent-rp/native-prompt-policy-seed',
  'agent-rp/persona-seed',
  'agent-rp/regex-pack-seed',
  'agent-rp/sillytavern-chat-import',
  'agent-rp/sillytavern-preset-seed',
  'agent-rp/story-workspace-selection',
  'agent-rp/story-stage-request',
  'agent-rp/story-stage-result',
  'agent-rp/story-turn-brief',
  'agent-rp/story-turn-materialized',
  'agent-rp/story-web-fetch-request',
  'agent-rp/story-web-fetch-result',
  'agent-rp/story-web-search-request',
  'agent-rp/story-web-search-result',
  'agent-rp/staged-state-request',
  'agent-rp/staged-state-result',
  'agent-rp/state',
  'agent-rp/tavern-generation-request',
  'agent-rp/tavern-generation-result',
  'agent-rp/tavern-message-annotation',
  'agent-rp/tavern-state',
  'agent-rp/tavern-state-attachment',
  'agent-rp/turn-mode',
  'agent-rp/turn-plan',
  'agent-rp/turn-presentation',
  'agent-rp/turn-settlement',
  'agent-rp/turn-worker-result',
  'agent-rp/world-info-library-seed',
] as const satisfies readonly (keyof SessionEventMap)[]

export type AgentRpSessionEventType = typeof AGENT_RP_SESSION_EVENT_TYPES[number]

/** Register every required Agent RP event before persistence restores Sessions. */
export function registerAgentRpSessionEvents(ctx: Context): void {
  for (const type of AGENT_RP_SESSION_EVENT_TYPES) {
    ctx.sessions.registerEventType(type, AGENT_RP_SESSION_EVENT_OWNER)
  }
}
