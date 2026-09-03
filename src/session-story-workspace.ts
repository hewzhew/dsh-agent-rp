/** Durable selection of one editable story workspace for a Roleplay Session. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandId } from '@deepseek-ai/dsh-commands'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { appendAgentRpSessionEvent } from './session-event-append.ts'
import type {
  StoryWorkspaceSessionContinuity,
  StoryWorkspaceSnapshot,
} from './story-workspace-protocol.ts'
import { StoryWorkspaceStore } from './story-workspace.ts'
import { sessionEvents } from './session-events.ts'

/** User-authored selection event applied before later story turns. */
export interface SessionStoryWorkspaceSelectionRecord {
  readonly format: 0
  readonly workspaceId?: string
  /** Command source for interactive changes; absent only on a launch seed at seq 0. */
  readonly sourceEventSeq?: number
  readonly source?: 'launch'
  /** Public context shown before the first player input in a newly launched Session. */
  readonly continuity?: StoryWorkspaceSessionContinuity
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Ignorable user selection of the story workspace that prepares future turns. */
    'agent-rp/story-workspace-selection': SessionStoryWorkspaceSelectionRecord
  }
}

interface StoryWorkspaceCommandRequest {
  readonly format: 0
  readonly workspaceId: string | null
}

function parseRequest(rawInput: string): StoryWorkspaceCommandRequest {
  let value: unknown
  try {
    value = JSON.parse(rawInput) as unknown
  } catch (error: unknown) {
    throw new Error('故事工作区命令不是有效 JSON', { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('故事工作区命令不是对象')
  const record = value as Record<string, unknown>
  if (record.format !== 0 || !(record.workspaceId === null || typeof record.workspaceId === 'string')
    || Object.keys(record).some(key => key !== 'format' && key !== 'workspaceId')) {
    throw new Error('故事工作区命令字段无效')
  }
  return record as unknown as StoryWorkspaceCommandRequest
}

function assertStoryWorkspaceOutputReady(workspace: StoryWorkspaceSnapshot): void {
  if (!workspace.outputs.some(output => output.enabled && output.kind === 'prose')) {
    throw new Error('请先在输出布局中启用至少一个正文分区')
  }
}

const STORY_SESSION_CONTINUITY_LIMIT = 6_000

function validContinuity(value: unknown): value is StoryWorkspaceSessionContinuity | undefined {
  if (value === undefined) return true
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Number.isSafeInteger(record.turn) && Number(record.turn) > 0
    && typeof record.title === 'string' && record.title.trim() !== ''
    && typeof record.text === 'string' && record.text.trim() !== ''
    && record.text.length <= STORY_SESSION_CONTINUITY_LIMIT
    && (record.truncatedStart === undefined || record.truncatedStart === true)
    && Object.keys(record).every(key => ['turn', 'title', 'text', 'truncatedStart'].includes(key))
}

function storySessionContinuity(workspace: StoryWorkspaceSnapshot): StoryWorkspaceSessionContinuity | undefined {
  const event = workspace.events.findLast(candidate => candidate.turn > 0 && candidate.evidence.trim() !== '')
  if (event === undefined) return undefined
  const evidence = event.evidence.trim()
  const truncatedStart = evidence.length > STORY_SESSION_CONTINUITY_LIMIT
  return {
    turn: event.turn,
    title: event.title,
    text: truncatedStart ? evidence.slice(-STORY_SESSION_CONTINUITY_LIMIT) : evidence,
    ...(truncatedStart ? { truncatedStart: true as const } : {}),
  }
}

/** Return the latest explicitly selected story workspace, including a later clear. */
export function readSessionStoryWorkspaceId(events: readonly SessionEvent[]): string | undefined {
  let active: string | undefined
  for (const event of events) {
    if (event.type !== 'agent-rp/story-workspace-selection') continue
    if (event.data.format !== 0) {
      throw new Error('故事工作区 Session 事件无效')
    }
    if (event.data.source === 'launch') {
      if (event.seq !== 0 || event.data.sourceEventSeq !== undefined || event.data.workspaceId === undefined) {
        throw new Error('游玩场地启动事件无效')
      }
      if (!validContinuity(event.data.continuity)) throw new Error('游玩场地接续前情无效')
      active = event.data.workspaceId
      continue
    }
    if (event.data.continuity !== undefined) throw new Error('交互式游玩场地选择不能携带接续前情')
    const sourceEventSeq = event.data.sourceEventSeq
    if (!Number.isSafeInteger(sourceEventSeq)
      || sourceEventSeq! < 0 || sourceEventSeq! >= event.seq) {
      throw new Error('故事工作区 Session 事件无效')
    }
    const source = events[sourceEventSeq!]
    if (source?.type !== 'command/run' || source.data.name !== 'rp-story-workspace'
      || source.data.source.kind !== 'user') {
      throw new Error('故事工作区选择没有对应的用户命令')
    }
    active = event.data.workspaceId
  }
  return active
}

/** Create the model-free seed that connects a new Session to one executable play space. */
export function createStoryWorkspaceSessionSeed(
  store: StoryWorkspaceStore,
  workspaceId: string,
): { readonly title: string; readonly seed: readonly SessionEvent[] } {
  const workspace = store.get(workspaceId)
  if (workspace.world === undefined) throw new Error('请先给游玩场地装入一个世界模块')
  if (workspace.characters.length === 0) throw new Error('游玩场地至少需要一位人物')
  assertStoryWorkspaceOutputReady(workspace)
  const time = Date.now()
  const continuity = storySessionContinuity(workspace)
  return {
    title: workspace.name,
    seed: [
      {
        type: 'agent-rp/story-workspace-selection',
        seq: SessionSeq(0),
        time,
        ignorable: true,
        data: {
          format: 0,
          workspaceId: workspace.id,
          source: 'launch',
          ...(continuity === undefined ? {} : { continuity }),
        },
      },
      { type: 'turn/start', seq: SessionSeq(1), time, data: { turn: 1 } },
      { type: 'turn/end', seq: SessionSeq(2), time, data: { turn: 1, reason: { kind: 'completed' } } },
    ],
  }
}

/** Apply or clear one Session-owned story workspace without invoking a model. */
export function executeStoryWorkspaceCommand(
  store: StoryWorkspaceStore,
  invocation: {
    readonly commandId: CommandId
    readonly agent: Agent
    readonly rawInput: string
  },
): { readonly kind: 'success'; readonly sourceEventSeq: SessionSeq } {
  const request = parseRequest(invocation.rawInput)
  if (request.workspaceId !== null) assertStoryWorkspaceOutputReady(store.get(request.workspaceId))
  const source = sessionEvents(invocation.agent.session).findLast(event => event.type === 'command/run'
    && String(event.data.commandId) === String(invocation.commandId))
  if (source?.type !== 'command/run' || source.data.name !== 'rp-story-workspace'
    || source.data.source.kind !== 'user') {
    throw new Error('故事工作区命令不是当前 Session 事件')
  }
  appendAgentRpSessionEvent(invocation.agent.session, 'agent-rp/story-workspace-selection', {
    format: 0,
    ...(request.workspaceId === null ? {} : { workspaceId: request.workspaceId }),
    sourceEventSeq: source.seq,
  })
  return { kind: 'success', sourceEventSeq: source.seq }
}
