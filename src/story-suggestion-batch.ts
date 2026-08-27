/** Atomic review operations for one event's pending story suggestions. */

import type {
  StoryCitation,
  StoryEvent,
  StoryFact,
  StoryWorkspaceSnapshot,
} from './story-workspace-protocol.ts'

/** Pending graph changes produced by one completed story event. */
export interface StorySuggestionBatch {
  readonly nodeIds: readonly string[]
  readonly edgeIds: readonly string[]
}

/** Find the still-pending node and relationship suggestions produced by an event. */
export function storySuggestionBatch(
  workspace: StoryWorkspaceSnapshot,
  eventId: string,
): StorySuggestionBatch {
  return {
    nodeIds: workspace.graph.nodes
      .filter(node => node.lifecycle === 'suggested' && node.sourceEventId === eventId)
      .map(node => node.id),
    edgeIds: workspace.graph.edges
      .filter(edge => edge.lifecycle === 'suggested' && edge.sourceEventId === eventId)
      .map(edge => edge.id),
  }
}

/** Accept every pending graph change from one event in a single workspace edit. */
export function acceptStorySuggestionBatch(
  workspace: StoryWorkspaceSnapshot,
  eventId: string,
): StoryWorkspaceSnapshot {
  const batch = storySuggestionBatch(workspace, eventId)
  const nodeIds = new Set(batch.nodeIds)
  const edgeIds = new Set(batch.edgeIds)
  const nodeById = new Map(workspace.graph.nodes.map(node => [node.id, node]))
  const willBeCanonical = (nodeId: string): boolean => {
    const node = nodeById.get(nodeId)
    return node?.lifecycle === 'canonical' || nodeIds.has(nodeId)
  }
  for (const nodeId of nodeIds) {
    const parentId = nodeById.get(nodeId)?.parentId
    if (parentId !== undefined && !willBeCanonical(parentId)) {
      throw new Error('候选变更组依赖另一个尚未接受的故事簇')
    }
  }
  for (const edge of workspace.graph.edges) {
    if (edgeIds.has(edge.id) && (!willBeCanonical(edge.source) || !willBeCanonical(edge.target))) {
      throw new Error('候选变更组依赖另一个尚未接受的关系端点')
    }
  }
  if (nodeIds.size === 0 && edgeIds.size === 0) return workspace
  return {
    ...workspace,
    graph: {
      ...workspace.graph,
      nodes: workspace.graph.nodes.map(node => nodeIds.has(node.id) ? { ...node, lifecycle: 'canonical' } : node),
      edges: workspace.graph.edges.map(edge => edgeIds.has(edge.id) ? { ...edge, lifecycle: 'canonical' } : edge),
    },
  }
}

function citationWithoutRemovedTarget(citation: StoryCitation, nodeIds: ReadonlySet<string>, factIds: ReadonlySet<string>): StoryCitation {
  if (citation.target?.kind === 'node' && nodeIds.has(citation.target.nodeId)
    || citation.target?.kind === 'fact' && factIds.has(citation.target.factId)) {
    const { target: _target, ...rest } = citation
    return rest
  }
  return citation
}

function eventWithoutRemovedNode(event: StoryEvent, nodeIds: ReadonlySet<string>): StoryEvent {
  if (event.nodeId === undefined || !nodeIds.has(event.nodeId)) return event
  const { nodeId: _nodeId, ...rest } = event
  return rest
}

/** Reject every pending graph change from one event and dependent suggested descendants. */
export function rejectStorySuggestionBatch(
  workspace: StoryWorkspaceSnapshot,
  eventId: string,
): StoryWorkspaceSnapshot {
  const batch = storySuggestionBatch(workspace, eventId)
  const nodeIds = new Set(batch.nodeIds)
  const edgeIds = new Set(batch.edgeIds)
  let changed = true
  while (changed) {
    changed = false
    for (const node of workspace.graph.nodes) {
      if (node.lifecycle === 'suggested' && node.parentId !== undefined
        && nodeIds.has(node.parentId) && !nodeIds.has(node.id)) {
        nodeIds.add(node.id)
        changed = true
      }
    }
  }
  if (nodeIds.size === 0 && edgeIds.size === 0) return workspace
  const removedFacts = workspace.facts.filter(fact => fact.nodeId !== undefined && nodeIds.has(fact.nodeId))
  const removedFactIds = new Set(removedFacts.map(fact => fact.id))
  const facts: readonly StoryFact[] = workspace.facts.filter(fact => !removedFactIds.has(fact.id))
  const nodes = workspace.graph.nodes.filter(node => !nodeIds.has(node.id))
  const edges = workspace.graph.edges.filter(edge => !edgeIds.has(edge.id)
    && !nodeIds.has(edge.source) && !nodeIds.has(edge.target))
  const { activeNodeId, ...graph } = workspace.graph
  return {
    ...workspace,
    graph: {
      ...graph,
      ...(activeNodeId === undefined || nodeIds.has(activeNodeId) ? {} : { activeNodeId }),
      nodes,
      edges,
    },
    facts,
    events: workspace.events.map(event => eventWithoutRemovedNode(event, nodeIds)),
    citations: workspace.citations.map(citation => citationWithoutRemovedTarget(citation, nodeIds, removedFactIds)),
  }
}
