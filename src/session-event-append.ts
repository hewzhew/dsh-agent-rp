/** Typed writes for Agent RP's durable Session event vocabulary. */

import {
  Session,
  type SessionEvent,
  type SessionEventMap,
} from '@deepseek-ai/dsh-session'

export type AgentRpSessionEventType = Extract<keyof SessionEventMap, `agent-rp/${string}`>

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
] as const satisfies readonly `agent-rp/${string}`[]

type IgnorableSession = Session & {
  appendIgnorable<T extends AgentRpSessionEventType>(
    type: T,
    data: SessionEventMap[T],
  ): SessionEvent<T> & { readonly ignorable: true }
}

/** Whether this Host build exposes the replay-safe external-event writer. */
export function hostSupportsAgentRpSessionEvents(): boolean {
  return typeof (Session.prototype as unknown as Partial<IgnorableSession>).appendIgnorable === 'function'
}

/** Whether this Session can append replay-safe Agent RP records. */
export function supportsAgentRpSessionEvents(session: Session): session is IgnorableSession {
  return typeof (session as Partial<IgnorableSession>).appendIgnorable === 'function'
}

/** Append one Agent RP record that a Host without this plugin may safely skip. */
export function appendAgentRpSessionEvent<T extends AgentRpSessionEventType>(
  session: Session,
  type: T,
  data: SessionEventMap[T],
): SessionEvent<T> & { readonly ignorable: true } {
  if (!supportsAgentRpSessionEvents(session)) {
    throw new Error('当前 DSH Host 缺少安全的插件事件写入能力；已拒绝写入，避免重启后会话无法加载')
  }
  return session.appendIgnorable(type, data)
}
