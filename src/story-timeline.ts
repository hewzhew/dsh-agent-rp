/** Derived timeline groups backed by the canonical story-node hierarchy. */

import type { StoryEvent, StoryNode, StoryWorkspaceSnapshot } from './story-workspace-protocol.ts'

/** One collapsible timeline section derived without adding another stored taxonomy. */
export interface StoryTimelineGroup {
  readonly key: string
  readonly node?: StoryNode
  readonly title: string
  readonly summary: string
  readonly firstTurn: number
  readonly lastTurn: number
  readonly events: readonly StoryEvent[]
}

function timelineGroupNode(
  event: StoryEvent,
  nodesById: ReadonlyMap<string, StoryNode>,
): StoryNode | undefined {
  if (event.nodeId === undefined) return undefined
  const chain: StoryNode[] = []
  const seen = new Set<string>()
  let node = nodesById.get(event.nodeId)
  while (node !== undefined && !seen.has(node.id)) {
    seen.add(node.id)
    if (node.lifecycle === 'canonical' && node.status !== 'dropped') chain.push(node)
    node = node.parentId === undefined ? undefined : nodesById.get(node.parentId)
  }
  return chain.find(candidate => candidate.kind === 'arc') ?? chain.at(-1)
}

/**
 * Group completed events by their nearest canonical arc or top-level story cluster.
 *
 * @param workspace Story workspace whose node hierarchy owns timeline organization.
 * @returns Groups in first-event order with events sorted by story turn.
 */
export function groupStoryTimeline(workspace: StoryWorkspaceSnapshot): readonly StoryTimelineGroup[] {
  const nodesById = new Map(workspace.graph.nodes.map(node => [node.id, node]))
  const grouped = new Map<string, { readonly node?: StoryNode; readonly events: StoryEvent[] }>()
  const events = [...workspace.events].sort((left, right) => left.turn - right.turn)
  for (const event of events) {
    const node = timelineGroupNode(event, nodesById)
    const key = node?.id ?? 'unassigned'
    const group = grouped.get(key)
    if (group === undefined) grouped.set(key, { ...(node === undefined ? {} : { node }), events: [event] })
    else group.events.push(event)
  }
  return [...grouped.entries()].map(([key, group]) => ({
    key,
    ...(group.node === undefined ? {} : { node: group.node }),
    title: group.node?.title ?? '未归入故事簇',
    summary: group.node?.summary || '这些事件尚未关联到故事地图中的正式篇章或场景。',
    firstTurn: group.events[0]!.turn,
    lastTurn: group.events.at(-1)!.turn,
    events: group.events,
  }))
}
