/** Durable audit records for auxiliary model calls made by isolated Tavern scripts. */

import type { Message } from '@deepseek-ai/dsh-llm'
import type { JsonValue, Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { appendAgentRpSessionEvent } from './session-event-append.ts'

/** Exact dispatchable request recorded before a Host-routed auxiliary model call. */
export interface TavernHostGenerationDispatch {
  readonly kind: 'host-model'
  readonly provider: string
  readonly model: string
  readonly messages: readonly Message[]
  readonly system?: string
  readonly temperature?: number
  readonly maxTokens?: number
}

/** Exact credential-free request recorded before an external OpenAI-compatible call. */
export interface TavernExternalGenerationDispatch {
  readonly kind: 'external-openai'
  readonly endpoint: {
    readonly origin: string
    readonly pathname: string
  }
  readonly body: Readonly<Record<string, JsonValue>>
}

/** One model request that can be reconstructed without card or runtime state. */
export interface TavernAuxiliaryGenerationRequestRecord {
  readonly format: 0
  readonly requestId: string
  readonly mode: 'preset' | 'raw'
  readonly dispatch: TavernHostGenerationDispatch | TavernExternalGenerationDispatch
}

/** Stable failure classes retained without provider response bodies or credentials. */
export type TavernAuxiliaryGenerationFailureKind =
  | 'aborted'
  | 'host-unavailable'
  | 'invalid-response'
  | 'provider'
  | 'transport'
  | 'unknown'

/** Settlement of one logged auxiliary generation request. */
export interface TavernAuxiliaryGenerationResultRecord {
  readonly format: 0
  readonly requestId: string
  readonly requestSeq: number
  readonly result:
  | { readonly kind: 'success'; readonly text: string }
  | { readonly kind: 'failure'; readonly failure: TavernAuxiliaryGenerationFailureKind }
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Skippable exact request for an auxiliary Tavern script model call. */
    'agent-rp/tavern-generation-request': TavernAuxiliaryGenerationRequestRecord
    /** Skippable credential-free settlement for an auxiliary Tavern script model call. */
    'agent-rp/tavern-generation-result': TavernAuxiliaryGenerationResultRecord
  }
}

/** Content-free replay summary for auxiliary Tavern model calls. */
export interface TavernAuxiliaryGenerationSummary {
  readonly requests: number
  readonly succeeded: number
  readonly failed: number
  readonly pending: number
  readonly malformed: number
}

/** JSON-safe accumulator retained by the Session projection while events replay. */
export interface TavernAuxiliaryGenerationReplay {
  readonly format: 0
  readonly requests: Readonly<Record<string, {
    readonly seq: number
    readonly settlement?: 'success' | 'failure'
  }>>
  readonly malformed: number
}

/** Empty auxiliary-generation replay state. */
export const EMPTY_TAVERN_AUXILIARY_GENERATION_REPLAY: TavernAuxiliaryGenerationReplay = {
  format: 0,
  requests: {},
  malformed: 0,
}

/** Append one exact credential-free request before model dispatch. */
export function appendTavernAuxiliaryGenerationRequest(
  session: Session,
  record: TavernAuxiliaryGenerationRequestRecord,
): SessionEvent<'agent-rp/tavern-generation-request'> {
  return appendAgentRpSessionEvent(session, 'agent-rp/tavern-generation-request', record)
}

/** Append one bounded settlement linked to its exact request event. */
export function appendTavernAuxiliaryGenerationResult(
  session: Session,
  record: TavernAuxiliaryGenerationResultRecord,
): SessionEvent<'agent-rp/tavern-generation-result'> {
  return appendAgentRpSessionEvent(session, 'agent-rp/tavern-generation-result', record)
}

/** Classify one auxiliary failure without retaining remote response text. */
export function tavernAuxiliaryGenerationFailure(reason: unknown): TavernAuxiliaryGenerationFailureKind {
  const message = reason instanceof Error ? reason.message : String(reason)
  if (/取消|超时|abort|timeout/iu.test(message)) return 'aborted'
  if (/Host|没有可用模型|不可用|不支持可审计/iu.test(message)) return 'host-unavailable'
  if (/无法识别|没有返回文本|过大|过长|empty|invalid/iu.test(message)) return 'invalid-response'
  if (/连接|transport|network|fetch/iu.test(message)) return 'transport'
  if (/模型请求失败|生成失败|provider|状态/u.test(message)) return 'provider'
  return 'unknown'
}

function malformedReplay(state: TavernAuxiliaryGenerationReplay): TavernAuxiliaryGenerationReplay {
  return { ...state, malformed: state.malformed + 1 }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function validFailure(value: unknown): value is TavernAuxiliaryGenerationFailureKind {
  return value === 'aborted' || value === 'host-unavailable' || value === 'invalid-response'
    || value === 'provider' || value === 'transport' || value === 'unknown'
}

function validDispatch(value: unknown): boolean {
  const dispatch = record(value)
  if (dispatch?.kind === 'host-model') {
    return typeof dispatch.provider === 'string' && dispatch.provider !== ''
      && typeof dispatch.model === 'string' && dispatch.model !== '' && Array.isArray(dispatch.messages)
  }
  if (dispatch?.kind !== 'external-openai') return false
  const endpoint = record(dispatch.endpoint)
  return typeof endpoint?.origin === 'string' && endpoint.origin !== ''
    && typeof endpoint.pathname === 'string' && endpoint.pathname !== ''
    && record(dispatch.body) !== undefined
}

/** Fold one Session event while rejecting broken request/result relationships. */
export function applyTavernAuxiliaryGenerationEvent(
  state: TavernAuxiliaryGenerationReplay,
  event: SessionEvent,
): TavernAuxiliaryGenerationReplay {
  if (event.type === 'agent-rp/tavern-generation-request') {
    const data = record((event as { readonly data: unknown }).data)
    const requestId = data?.requestId
    if (data?.format !== 0 || typeof requestId !== 'string' || requestId === ''
      || (data.mode !== 'preset' && data.mode !== 'raw') || !validDispatch(data.dispatch)
      || !Number.isSafeInteger(event.seq) || event.seq < 0 || Object.hasOwn(state.requests, requestId)) {
      return malformedReplay(state)
    }
    return {
      ...state,
      requests: { ...state.requests, [requestId]: { seq: event.seq } },
    }
  }
  if (event.type !== 'agent-rp/tavern-generation-result') return state
  const data = record((event as { readonly data: unknown }).data)
  const requestId = data?.requestId
  const result = record(data?.result)
  const settlement = result?.kind === 'success' && typeof result.text === 'string'
    ? 'success' as const
    : result?.kind === 'failure' && validFailure(result.failure)
      ? 'failure' as const
      : undefined
  const request = typeof requestId === 'string' ? state.requests[requestId] : undefined
  if (data?.format !== 0 || typeof requestId !== 'string' || requestId === ''
    || !Number.isSafeInteger(data.requestSeq) || request === undefined || data.requestSeq !== request.seq
    || event.seq <= request.seq || request.settlement !== undefined || settlement === undefined) {
    return malformedReplay(state)
  }
  return {
    ...state,
    requests: { ...state.requests, [requestId]: { ...request, settlement } },
  }
}

/** Reduce validated replay state to counts that contain no request or response text. */
export function summarizeTavernAuxiliaryGenerationReplay(
  replay: TavernAuxiliaryGenerationReplay,
): TavernAuxiliaryGenerationSummary {
  const requests = Object.values(replay.requests)
  return {
    requests: requests.length,
    succeeded: requests.filter(request => request.settlement === 'success').length,
    failed: requests.filter(request => request.settlement === 'failure').length,
    pending: requests.filter(request => request.settlement === undefined).length,
    malformed: replay.malformed,
  }
}

/** Replay auxiliary-generation events into content-free local compatibility diagnostics. */
export function summarizeTavernAuxiliaryGenerations(
  events: readonly SessionEvent[],
): TavernAuxiliaryGenerationSummary {
  return summarizeTavernAuxiliaryGenerationReplay(events.reduce(
    applyTavernAuxiliaryGenerationEvent,
    EMPTY_TAVERN_AUXILIARY_GENERATION_REPLAY,
  ))
}
