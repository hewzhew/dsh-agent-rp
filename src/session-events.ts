/** Read-only access to one Session's complete immutable event log. */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** Minimum alpha.5 Session capability needed by pure log projections. */
export type SessionEventReader = Pick<Session, 'snapshotEvents'>

/**
 * Read the complete immutable event log through the API exposed by the Host.
 *
 * @param session - Session owned by the current Agent.
 * @returns a stable event snapshot that does not grow after later appends.
 */
export function sessionEvents(session: SessionEventReader): readonly SessionEvent[] {
  return session.snapshotEvents()
}
