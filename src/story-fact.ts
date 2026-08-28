/** Pure operations for creating and removing story facts. */

import type {
  StoryEvent,
  StoryFact,
  StoryWorkspaceSnapshot,
} from './story-workspace-protocol.ts'

/**
 * Create an unassigned character observation backed by a completed event.
 *
 * @param id Opaque fact id allocated by the caller.
 * @param event Event that supplies provenance and the initial story cluster.
 * @returns A draft fact that is hidden from every character until its actual knowers are selected.
 */
export function createEventObservationFact(id: string, event: StoryEvent): StoryFact {
  return {
    id,
    ...(event.nodeId === undefined ? {} : { nodeId: event.nodeId }),
    text: '新认知',
    status: 'asserted',
    audience: 'director',
    knowledgeMode: 'override',
    knownBy: [],
    source: { kind: 'event', eventId: event.id, evidence: event.evidence },
  }
}

/**
 * Remove one fact and detach citations that targeted it.
 *
 * @param workspace Workspace containing the fact.
 * @param factId Fact to remove.
 * @returns A workspace value without the fact or dangling citation targets.
 */
export function removeStoryFact(workspace: StoryWorkspaceSnapshot, factId: string): StoryWorkspaceSnapshot {
  return {
    ...workspace,
    facts: workspace.facts.filter(fact => fact.id !== factId),
    citations: workspace.citations.map(citation => {
      if (citation.target?.kind !== 'fact' || citation.target.factId !== factId) return citation
      const { target: _target, ...detached } = citation
      return detached
    }),
  }
}
