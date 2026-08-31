/** Relationship between executable-world events and materialized story turns. */

import type { PlayWorldEvent } from './play-world-protocol.ts'
import type { StoryWorkspaceSnapshot } from './story-workspace-protocol.ts'

/**
 * Return authoritative world events that no completed story turn has processed yet.
 *
 * @param workspace Story workspace containing world and story histories.
 * @returns Unprocessed events in authoritative sequence order.
 */
export function storyPendingWorldEvents(workspace: StoryWorkspaceSnapshot): readonly PlayWorldEvent[] {
  if (workspace.world === undefined) return []
  const processed = new Set(workspace.events.flatMap(event => event.worldEventSequences ?? []))
  return workspace.world.events.filter(event => !processed.has(event.sequence))
}

/**
 * Report whether a character-owned world result must be written before another automatic action.
 *
 * @param workspace Story workspace to inspect.
 * @returns Whether an unrepresented event names its acting character.
 */
export function hasPendingCharacterWorldResult(workspace: StoryWorkspaceSnapshot): boolean {
  return storyPendingWorldEvents(workspace).some(event => event.actorId !== undefined)
}
