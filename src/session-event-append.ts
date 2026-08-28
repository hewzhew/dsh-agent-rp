/** Typed writes for Agent RP's durable Session event vocabulary. */

import {
  type Session,
  type SessionEvent,
  type SessionEventMap,
} from '@deepseek-ai/dsh-session'

type AgentRpSessionEventType = Extract<keyof SessionEventMap, `agent-rp/${string}`>

/** Append one required Agent RP record through DSH's ordinary typed log API. */
export function appendAgentRpSessionEvent<T extends AgentRpSessionEventType>(
  session: Session,
  type: T,
  data: SessionEventMap[T],
): SessionEvent<T> {
  const append = session.append.bind(session) as <K extends AgentRpSessionEventType>(
    eventType: K,
    eventData: SessionEventMap[K],
  ) => SessionEvent<K>
  return append(type, data)
}
