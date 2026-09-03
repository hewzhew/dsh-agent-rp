/** Native Chat projections for story Workers and executable-world evidence. */

import type {
  ConversationLocationData,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AgentRpStoryTurnStage } from '../projection-types.ts'
import type { StoryTurnProcessSummary } from './story-turn-progress.ts'

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

/** Privacy-safe story-pipeline aggregate attached to one native DSH Turn. */
export interface StoryWorkspaceProcessTurnData extends StoryTurnProcessSummary {
  readonly sessionId: string
  readonly workspaceId: string
  readonly workspaceRevision: number
  readonly turn: number
  readonly stepCount: number
  readonly failedStageCount: number
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** One privacy-safe Worker request projected beside native DSH process rows. */
    'agent-rp-story-stage': StoryWorkspaceStageChatData
    /** Folded authoritative rule evidence for one visible story reply. */
    'agent-rp-story-world-evidence': StoryWorkspaceWorldEvidenceChatData
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Story-pipeline summary used by the native Turn-process disclosure. */
    'agent-rp-story-process': StoryWorkspaceProcessTurnData
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

type StoryWorkspaceProcessStatus = StoryWorkspaceProcessTurnData['status']

interface StoryWorkspaceProcessState {
  readonly turn: number
  readonly sessionId?: string
  readonly workspaceId?: string
  readonly workspaceRevision?: number
  readonly steps: ReadonlySet<number>
  readonly stages: ReadonlyMap<string, 'running' | 'succeeded' | 'failed'>
  readonly status: 'idle' | StoryWorkspaceProcessStatus
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

function storyProcessIdentity(event: { readonly type: string; readonly data: unknown }): StoryTurnIdentity | undefined {
  const data = record(event.data)
  const expectedFormat = event.type === 'agent-rp/story-turn-brief' ? 1 : 0
  if (data?.format !== expectedFormat) return undefined
  return identityFromData(data)
}

function sameStoryProcess(
  state: StoryWorkspaceProcessState,
  identity: StoryTurnIdentity,
): boolean {
  return state.turn === identity.turn
    && (state.sessionId === undefined || state.sessionId === identity.sessionId)
    && (state.workspaceId === undefined || state.workspaceId === identity.workspaceId)
}

function beginStoryProcess(
  state: StoryWorkspaceProcessState,
  identity: StoryTurnIdentity,
): StoryWorkspaceProcessState {
  if (!sameStoryProcess(state, identity)) return state
  const steps = new Set(state.steps)
  steps.add(identity.step)
  return {
    ...state,
    sessionId: identity.sessionId,
    workspaceId: identity.workspaceId,
    workspaceRevision: Math.max(state.workspaceRevision ?? 0, identity.workspaceRevision),
    steps,
    status: 'running',
  }
}

function updateStoryProcess(
  state: StoryWorkspaceProcessState,
  event: { readonly type: string; readonly data: unknown },
): StoryWorkspaceProcessState {
  const identity = storyProcessIdentity(event)
  if (identity === undefined || !sameStoryProcess(state, identity)) return state
  let current = state.sessionId === undefined ? beginStoryProcess(state, identity) : state
  if (event.type === 'agent-rp/story-turn-start') return beginStoryProcess(current, identity)
  current = {
    ...current,
    workspaceRevision: Math.max(current.workspaceRevision ?? 0, identity.workspaceRevision),
  }
  if (event.type === 'agent-rp/story-stage-request') {
    const request = requestFromEvent({ ...event, time: 0 })
    if (request === undefined || current.stages.has(request.requestId)) return current
    const stages = new Map(current.stages)
    stages.set(request.requestId, 'running')
    return { ...current, stages }
  }
  if (event.type === 'agent-rp/story-stage-result') {
    const result = resultFromEvent({ ...event, time: 0 })
    if (result === undefined || !current.stages.has(result.requestId)) return current
    const stages = new Map(current.stages)
    stages.set(result.requestId, result.status === 'failed' ? 'failed' : 'succeeded')
    return { ...current, stages }
  }
  if (event.type === 'agent-rp/story-turn-brief') return { ...current, status: 'succeeded' }
  if (event.type === 'agent-rp/story-turn-stopped') {
    const data = record(event.data)
    if (data?.outcome === 'aborted' || data?.outcome === 'failed') {
      return { ...current, status: data.outcome }
    }
  }
  return current
}

function storyProcessData(state: StoryWorkspaceProcessState): StoryWorkspaceProcessTurnData | undefined {
  if (state.status === 'idle' || state.sessionId === undefined || state.workspaceId === undefined
    || state.workspaceRevision === undefined) return undefined
  const statuses = [...state.stages.values()]
  return {
    sessionId: state.sessionId,
    workspaceId: state.workspaceId,
    workspaceRevision: state.workspaceRevision,
    turn: state.turn,
    stepCount: state.steps.size,
    stageCount: statuses.length,
    completedStageCount: statuses.filter(status => status !== 'running').length,
    failedStageCount: statuses.filter(status => status === 'failed').length,
    status: state.status,
  }
}

function sameStoryProcessData(
  left: StoryWorkspaceProcessTurnData,
  right: StoryWorkspaceProcessTurnData,
): boolean {
  return left.sessionId === right.sessionId
    && left.workspaceId === right.workspaceId
    && left.workspaceRevision === right.workspaceRevision
    && left.turn === right.turn
    && left.stepCount === right.stepCount
    && left.stageCount === right.stageCount
    && left.completedStageCount === right.completedStageCount
    && left.failedStageCount === right.failedStageCount
    && left.status === right.status
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

/** Publish one story-pipeline summary onto the enclosing native DSH Turn. */
export const storyWorkspaceProcessDefinition: ConversationNodeDefinition<StoryWorkspaceProcessState> = {
  kind: 'agent-rp-story-process',
  match: (event) => {
    const type: string = event.type
    if (type === 'turn/start') {
      const data = record(event.data)
      return Number.isSafeInteger(data?.turn) && Number(data?.turn) >= 0
        ? { id: String(data?.turn), role: 'start' }
        : null
    }
    if (type !== 'agent-rp/story-turn-start'
      && type !== 'agent-rp/story-stage-request'
      && type !== 'agent-rp/story-stage-result'
      && type !== 'agent-rp/story-turn-brief'
      && type !== 'agent-rp/story-turn-stopped') return null
    const identity = storyProcessIdentity(event)
    return identity === undefined ? null : { id: String(identity.turn), role: 'update' }
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('故事回合过程必须由 turn/start 开始')
    return {
      turn: match.event.data.turn,
      steps: new Set(),
      stages: new Map(),
      status: 'idle',
    }
  },
  update: (context, match) => updateStoryProcess(context.state, match.event),
  publication: () => 'immediate',
  buildLocationData: (context, scope, previous): ConversationLocationData | null => {
    if (scope !== 'turn' || context.state === undefined) return null
    const value = storyProcessData(context.state)
    if (value === undefined) return null
    if (previous?.kind === 'turn' && previous.key === 'agent-rp-story-process'
      && sameStoryProcessData(previous.value, value)) return previous
    return {
      kind: 'turn',
      turn: context.state.turn,
      key: 'agent-rp-story-process',
      value,
    }
  },
}
