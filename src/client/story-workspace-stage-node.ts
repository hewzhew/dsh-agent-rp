/** Native Chat projections for story Workers and executable-world evidence. */

import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AgentRpStoryTurnStage } from '../projection-types.ts'

/** Privacy-safe state for one Worker request in the native timeline. */
export interface StoryWorkspaceStageChatData {
  readonly sessionId: string
  readonly workspaceId: string
  readonly workspaceRevision: number
  readonly turn: number
  readonly step: number
  readonly requestId: string
  readonly stage: AgentRpStoryTurnStage
  readonly subjectId?: string
  readonly startedAt: number
  readonly status: 'running' | 'succeeded' | 'failed'
  readonly finishedAt?: number
  readonly failure?: string
}

/** One public authoritative event shown outside the story prose. */
export interface StoryWorkspaceWorldEvidenceEvent {
  readonly type: string
  readonly title: string
  readonly summary: string
  readonly actorId?: string
}

/** Public executable-world evidence associated with one prepared reply. */
export interface StoryWorkspaceWorldEvidenceChatData {
  readonly sessionId: string
  readonly workspaceId: string
  readonly workspaceRevision: number
  readonly turn: number
  readonly step: number
  readonly events: readonly StoryWorkspaceWorldEvidenceEvent[]
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** One privacy-safe Worker request projected beside native DSH process rows. */
    'agent-rp-story-stage': StoryWorkspaceStageChatData
    /** Folded authoritative rule evidence for one visible story reply. */
    'agent-rp-story-world-evidence': StoryWorkspaceWorldEvidenceChatData
  }
}

const STORY_STAGES = new Set<AgentRpStoryTurnStage>([
  'world-action', 'cast', 'history', 'research', 'character', 'director', 'section', 'voice', 'editor', 'continuity',
])

interface StoryTurnIdentity {
  readonly sessionId: string
  readonly workspaceId: string
  readonly workspaceRevision: number
  readonly turn: number
  readonly step: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function identityFromData(value: unknown): StoryTurnIdentity | undefined {
  const data = record(value)
  if (typeof data?.sessionId !== 'string' || data.sessionId === ''
    || typeof data.workspaceId !== 'string' || data.workspaceId === ''
    || !Number.isSafeInteger(data.workspaceRevision) || Number(data.workspaceRevision) < 0
    || !Number.isSafeInteger(data.turn) || Number(data.turn) < 0
    || !Number.isSafeInteger(data.step) || Number(data.step) < 0) return undefined
  return {
    sessionId: data.sessionId,
    workspaceId: data.workspaceId,
    workspaceRevision: Number(data.workspaceRevision),
    turn: Number(data.turn),
    step: Number(data.step),
  }
}

function stageNodeId(data: Pick<StoryWorkspaceStageChatData, 'sessionId' | 'requestId'>): string {
  return `${data.sessionId}:${data.requestId}`
}

function requestFromEvent(event: {
  readonly type: string
  readonly time: number
  readonly data: unknown
}): StoryWorkspaceStageChatData | undefined {
  if (event.type !== 'agent-rp/story-stage-request') return undefined
  const data = record(event.data)
  const identity = identityFromData(data)
  if (data?.format !== 0 || identity === undefined
    || typeof data.requestId !== 'string' || data.requestId === ''
    || typeof data.stage !== 'string' || !STORY_STAGES.has(data.stage as AgentRpStoryTurnStage)
    || !(data.subjectId === undefined || typeof data.subjectId === 'string')) return undefined
  return {
    ...identity,
    requestId: data.requestId,
    stage: data.stage as AgentRpStoryTurnStage,
    ...(typeof data.subjectId === 'string' ? { subjectId: data.subjectId } : {}),
    startedAt: event.time,
    status: 'running',
  }
}

function resultFromEvent(event: {
  readonly type: string
  readonly time: number
  readonly data: unknown
}): (Omit<StoryWorkspaceStageChatData, 'startedAt'> & { readonly finishedAt: number }) | undefined {
  if (event.type !== 'agent-rp/story-stage-result') return undefined
  const data = record(event.data)
  const identity = identityFromData(data)
  const result = record(data?.result)
  if (data?.format !== 0 || identity === undefined
    || typeof data.requestId !== 'string' || data.requestId === ''
    || typeof data.stage !== 'string' || !STORY_STAGES.has(data.stage as AgentRpStoryTurnStage)
    || !(data.subjectId === undefined || typeof data.subjectId === 'string')
    || (result?.kind !== 'success' && result?.kind !== 'failure')) return undefined
  const detail = result.kind === 'failure' ? record(result.detail) : undefined
  const message = typeof detail?.message === 'string' && detail.message.trim() !== ''
    ? detail.message.trim()
    : undefined
  return {
    ...identity,
    requestId: data.requestId,
    stage: data.stage as AgentRpStoryTurnStage,
    ...(typeof data.subjectId === 'string' ? { subjectId: data.subjectId } : {}),
    status: result.kind === 'success' ? 'succeeded' : 'failed',
    finishedAt: event.time,
    ...(message === undefined ? {} : { failure: message }),
  }
}

function worldEvidenceFromEvent(event: {
  readonly type: string
  readonly data: unknown
}): StoryWorkspaceWorldEvidenceChatData | undefined {
  if (event.type !== 'agent-rp/story-turn-brief') return undefined
  const data = record(event.data)
  const identity = identityFromData(data)
  if (data?.format !== 1 || identity === undefined || !Array.isArray(data.publicWorldEvents)) return undefined
  const events = data.publicWorldEvents.flatMap((value): readonly StoryWorkspaceWorldEvidenceEvent[] => {
    const item = record(value)
    if (typeof item?.type !== 'string' || item.type === ''
      || typeof item.title !== 'string' || item.title === ''
      || typeof item.summary !== 'string'
      || !(item.actorId === undefined || typeof item.actorId === 'string')) return []
    return [{
      type: item.type,
      title: item.title,
      summary: item.summary,
      ...(typeof item.actorId === 'string' ? { actorId: item.actorId } : {}),
    }]
  })
  return events.length === 0 ? undefined : { ...identity, events }
}

/** Project every Worker request as an independent native timeline row. */
export const storyWorkspaceStageDefinition: ConversationNodeDefinition<StoryWorkspaceStageChatData> = {
  kind: 'agent-rp-story-stage',
  target: 'chat',
  match: (event) => {
    const request = requestFromEvent(event)
    if (request !== undefined) return { id: stageNodeId(request), role: 'start' }
    const result = resultFromEvent(event)
    return result === undefined ? null : { id: stageNodeId(result), role: 'update' }
  },
  start: (_context, match) => {
    const request = requestFromEvent(match.event)
    if (request === undefined) throw new Error('故事阶段节点无效')
    return request
  },
  update: (context, match) => {
    const result = resultFromEvent(match.event)
    if (result === undefined || result.requestId !== context.state.requestId) return context.state
    return {
      ...context.state,
      status: result.status,
      finishedAt: result.finishedAt,
      ...(result.failure === undefined ? {} : { failure: result.failure }),
    }
  },
  publication: () => 'immediate',
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined || context.state === undefined) return null
    return {
      key: context.key,
      kind: 'agent-rp-story-stage',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data: context.state,
    }
  },
}

/** Project authoritative world events as one folded row beside the prepared prose. */
export const storyWorkspaceWorldEvidenceDefinition: ConversationNodeDefinition<StoryWorkspaceWorldEvidenceChatData> = {
  kind: 'agent-rp-story-world-evidence',
  target: 'chat',
  match: (event) => {
    const evidence = worldEvidenceFromEvent(event)
    return evidence === undefined ? null : {
      id: `${evidence.sessionId}:${evidence.workspaceId}:${String(evidence.turn)}:${String(evidence.step)}`,
      role: 'start',
    }
  },
  start: (_context, match) => {
    const evidence = worldEvidenceFromEvent(match.event)
    if (evidence === undefined) throw new Error('场地结算节点无效')
    return evidence
  },
  update: context => context.state,
  publication: () => 'immediate',
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined || context.state === undefined) return null
    return {
      key: context.key,
      kind: 'agent-rp-story-world-evidence',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data: context.state,
    }
  },
}
