/** Durable requests and results for auxiliary model calls owned by the Roleplay act phase. */

import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { RoleplayResponseRepairPlan, RoleplayTurnPlan } from './roleplay-turn-plan.ts'
import { appendAgentRpSessionEvent } from './session-event-append.ts'
import { sessionEvents } from './session-events.ts'

/** Exact credential-free provider request dispatched by an act-phase program. */
export interface RoleplayActModelDispatch {
  readonly provider: string
  readonly model: string
  readonly messages: readonly Message[]
  readonly system?: string
  readonly reasoningEffort?: string
  readonly temperature?: number
  readonly maxTokens?: number
}

/** Current act-phase use of an auxiliary model. */
export interface RoleplayActModelPurpose {
  readonly kind: 'response-repair'
  readonly engine: RoleplayResponseRepairPlan['engine']
  readonly moduleId: string
  readonly stateId: string
}

/** Exact request retained before the auxiliary model dispatch leaves the Host. */
export interface RoleplayActModelRequestRecord {
  readonly format: 0
  readonly requestId: string
  readonly sessionId: string
  readonly turn: number
  readonly step: number
  readonly planSeq: number
  readonly purpose: RoleplayActModelPurpose
  readonly dispatch: RoleplayActModelDispatch
}

export type RoleplayActModelFailureKind = 'aborted' | 'provider' | 'unknown'

/** Exact successful text or stable failure linked to one act-phase request. */
export interface RoleplayActModelResultRecord {
  readonly format: 0
  readonly requestId: string
  readonly requestSeq: number
  readonly result:
    | {
        readonly kind: 'success'
        readonly text: string
        readonly application: 'applied' | 'rejected'
      }
    | {
        readonly kind: 'failure'
        readonly failure: RoleplayActModelFailureKind
      }
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Ignorable exact request for an auxiliary act-phase model call. */
    'agent-rp/act-model-request': RoleplayActModelRequestRecord
    /** Ignorable settlement for an auxiliary act-phase model call. */
    'agent-rp/act-model-result': RoleplayActModelResultRecord
  }
}

export interface RoleplayActModelBoundary {
  readonly turn: number
  readonly step: number
  readonly planSeq: number
}

/** Bind an act-model request to the one currently open prepared step. */
export function resolveRoleplayActModelBoundary(
  session: Session,
  plan: RoleplayTurnPlan,
): RoleplayActModelBoundary | undefined {
  const events = sessionEvents(session)
  const openStarts = events.filter((event): event is SessionEvent<'step/start'> =>
    event.type === 'step/start' && !events.some(candidate => candidate.seq > event.seq
      && candidate.type === 'step/end' && candidate.data.turn === event.data.turn
      && candidate.data.step === event.data.step))
  if (openStarts.length !== 1) return undefined
  const start = openStarts[0]!
  const plans = events.filter((event): event is SessionEvent<'agent-rp/turn-plan'> =>
    event.type === 'agent-rp/turn-plan' && event.seq > start.seq
      && event.data.turn === start.data.turn && event.data.reference.step === start.data.step)
  if (plans.length !== 1) return undefined
  const receipt = plans[0]!
  if (receipt.data.sessionId !== String(session.id)
    || JSON.stringify(receipt.data.reference.input) !== JSON.stringify(plan.input)) return undefined
  return { turn: start.data.turn, step: start.data.step, planSeq: receipt.seq }
}

/** Select the serializable part of the exact request visible to the auxiliary model. */
export function roleplayActModelDispatch(options: GenerateOptions): RoleplayActModelDispatch {
  return {
    provider: options.provider,
    model: options.model,
    messages: options.messages,
    ...(options.system === undefined ? {} : { system: options.system }),
    ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: String(options.reasoningEffort) }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
  }
}

/** Persist one exact act-phase request before dispatch. */
export function appendRoleplayActModelRequest(
  session: Session,
  record: RoleplayActModelRequestRecord,
): SessionEvent<'agent-rp/act-model-request'> {
  return appendAgentRpSessionEvent(session, 'agent-rp/act-model-request', record)
}

/** Persist one terminal result linked to its exact act-phase request. */
export function appendRoleplayActModelResult(
  session: Session,
  record: RoleplayActModelResultRecord,
): SessionEvent<'agent-rp/act-model-result'> {
  return appendAgentRpSessionEvent(session, 'agent-rp/act-model-result', record)
}

/** Reduce thrown provider details to a replay-stable failure class. */
export function roleplayActModelFailure(reason: unknown): RoleplayActModelFailureKind {
  const message = reason instanceof Error ? reason.message : String(reason)
  if (/abort|cancel|取消|中止/iu.test(message)) return 'aborted'
  if (/provider|模型|请求|生成/iu.test(message)) return 'provider'
  return 'unknown'
}
