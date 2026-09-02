/** Durable, source-neutral result compiled when one Roleplay turn closes. */

import { createHash } from 'node:crypto'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { readAgentRpMemoryHistory } from './memory.ts'
import { MVU_ROLEPLAY_MODULE_ID, MVU_ROLEPLAY_STATE_ID } from './mvu.ts'
import {
  ROLEPLAY_MEMORY_MODULE_ID,
  ROLEPLAY_PROMPT_ADAPTER_MODULE_ID,
  ROLEPLAY_PROMPT_MODULE_ID,
  type RoleplayRuntimeSnapshot,
  type RoleplayStateBinding,
  type RoleplayTurnSettlementContribution,
} from './roleplay-runtime.ts'
import type { RoleplayTurnInputKey, RoleplayTurnPlan } from './roleplay-turn-plan.ts'
import { appendAgentRpSessionEvent } from './session-event-append.ts'
import {
  readRoleplayStateActionIntent,
  renderLegacyRoleplayStateActionGuidance,
  renderRoleplayStateActionGuidance,
} from './roleplay-state-action.ts'
import { sessionEvents } from './session-events.ts'

/** Exact prepared input consumed by one model step in the settled turn. */
export interface RoleplayTurnPlanReference {
  readonly step: number
  readonly input: RoleplayTurnInputKey
  /** Content-free receipt for replaying and diagnosing the exact prepared plan. */
  readonly receipt?: RoleplayTurnPlanReceipt
}

/** Durable resource and decision references retained without duplicating model-visible prose. */
export interface RoleplayTurnPlanReceipt {
  /** Structural projection used to compute the prepared-plan proofs. */
  readonly preparedPlanSchema?: RoleplayTurnPlanSchema
  /** Content-free proof that replay rebuilt the complete provider-neutral plan byte-for-byte. */
  readonly preparedPlanSha256?: string
  /** Per-section proofs used to diagnose drift without retaining model-visible prose twice. */
  readonly preparedPlanSectionsSha256?: Readonly<Partial<Record<keyof RoleplayTurnPlan, string>>>
  readonly runtime: {
    readonly experienceId: string
    readonly actorId?: string
    readonly participantId?: string
    readonly worldIds: readonly string[]
    readonly promptId?: string
    readonly stateIds: readonly string[]
    readonly moduleIds: readonly string[]
    /** Settle ownership retained so a cold restart can close the turn without volatile plans. */
    readonly settleModules?: readonly {
      readonly moduleId: string
      readonly stateIds: readonly string[]
    }[]
    /** Present participation retained so a cold restart can rebuild the selected surface. */
    readonly presentModuleIds?: readonly string[]
  }
  readonly world: {
    readonly activeEntries: readonly { readonly resourceId: string; readonly entryIds: readonly string[] }[]
    readonly approximateTokens: number
    readonly tokenBudget?: number
  }
  readonly promptDiagnostics: RoleplayTurnPlan['prompt']['diagnostics']
  readonly act?: {
    readonly strategy?: RoleplayTurnPlan['act']['strategy']
    readonly responseRepairs: readonly {
      readonly engine: RoleplayTurnPlan['act']['responseRepairs'][number]['engine']
      readonly moduleId: string
      readonly stateId: string
    }[]
    readonly stateActions?: RoleplayTurnPlan['act']['stateActions']
  }
  readonly stateReads: readonly {
    readonly id: string
    readonly revision?: number
    readonly eventSeq?: number
  }[]
  readonly memoryReads: RoleplayTurnPlan['memory']['reads']
  readonly memoryWriteAvailable?: boolean
  readonly generation: RoleplayTurnPlan['generation']
  readonly prepare: RoleplayTurnPlan['prepare']
  readonly recall?: RoleplayTurnPlan['recall']
}

/**
 * Published structural projections of the provider-neutral turn plan:
 * 0 predates prompt transforms, 1 adds transforms, 2 adds response repair programs,
 * 3 adds the independent turn strategy plus semantic state actions, 4 adds
 * the exact tool policy prepared for the model request and runtime gates, and
 * 5 moves imported state rules into the post-narrative settlement program.
 */
export type RoleplayTurnPlanSchema = 0 | 1 | 2 | 3 | 4 | 5

/** Current structural projection written into every new plan receipt. */
export const CURRENT_ROLEPLAY_TURN_PLAN_SCHEMA: RoleplayTurnPlanSchema = 5

function legacyPromptPreparation(plan: RoleplayTurnPlan): {
  readonly prompt: Omit<RoleplayTurnPlan['prompt'], 'transforms'>
  readonly prepare: RoleplayTurnPlan['prepare']
} {
  const { transforms, ...prompt } = plan.prompt
  const actorTransforms = transforms.operations.filter(operation => operation.owner === 'actor').length
  const policyTransforms = transforms.operations.filter(operation => operation.owner === 'prompt-policy').length
  const modules = plan.prepare.modules.map((module) => {
    const removed = module.moduleId === ROLEPLAY_PROMPT_MODULE_ID
      ? actorTransforms
      : module.moduleId === ROLEPLAY_PROMPT_ADAPTER_MODULE_ID ? policyTransforms : 0
    if (removed === 0) return module
    const contributions = Math.max(0, module.contributions - removed)
    return { ...module, outcome: contributions === 0 ? 'idle' as const : 'applied' as const, contributions }
  })
  return { prompt, prepare: { modules } }
}

function planWithoutPreparedAct(plan: RoleplayTurnPlan): Omit<RoleplayTurnPlan, 'act'> {
  const { act: _act, ...withoutAct } = plan
  return {
    ...withoutAct,
    runtime: {
      ...plan.runtime,
      modules: plan.runtime.modules.map(module => module.id !== MVU_ROLEPLAY_MODULE_ID ? module : {
        ...module,
        phases: module.phases.filter(phase => phase !== 'act'),
      }),
    },
    stateReads: plan.stateReads.map((read) => {
      if (read.id !== MVU_ROLEPLAY_STATE_ID) return read
      const { writerModuleId: _writerModuleId, value: _value, ...legacy } = read
      return legacy
    }),
  }
}

function planWithoutNativeActions(plan: RoleplayTurnPlan): Omit<RoleplayTurnPlan, 'act'> & {
  readonly act: Pick<RoleplayTurnPlan['act'], 'responseRepairs'>
} {
  return { ...plan, act: { responseRepairs: plan.act.responseRepairs } }
}

function planWithoutToolPolicy<T extends { readonly tools: RoleplayTurnPlan['tools'] }>(
  plan: T,
): Omit<T, 'tools'> {
  const { tools: _tools, ...legacy } = plan
  return legacy
}

function planWithoutStagedStateInstructions(plan: RoleplayTurnPlan): RoleplayTurnPlan {
  const replacements = plan.act.stateActions.flatMap((action) => action.instructions === undefined
    ? []
    : [{
        current: renderRoleplayStateActionGuidance(action, action.instructions),
        legacy: renderLegacyRoleplayStateActionGuidance(action, action.instructions),
      }])
  const legacyText = (text: string): string => replacements.reduce(
    (value, replacement) => value.replace(replacement.current, replacement.legacy),
    text,
  )
  return {
    ...plan,
    prompt: {
      ...plan.prompt,
      systemPromptText: legacyText(plan.prompt.systemPromptText),
      beforeHistory: plan.prompt.beforeHistory.map(message => ({ ...message, content: legacyText(message.content) })),
      afterHistory: plan.prompt.afterHistory.map(message => ({ ...message, content: legacyText(message.content) })),
      inChat: plan.prompt.inChat.map(message => ({ ...message, content: legacyText(message.content) })),
    },
    act: {
      ...plan.act,
      stateActions: plan.act.stateActions.map((action) => {
        const { instructions: _instructions, ...legacy } = action
        return legacy
      }),
    },
  }
}

/** Project a current plan into one historically published structural schema. */
export function projectRoleplayTurnPlan(plan: RoleplayTurnPlan, schema: RoleplayTurnPlanSchema): unknown {
  if (schema === 5) return plan
  const beforeStagedSettlement = planWithoutStagedStateInstructions(plan)
  if (schema === 4) return beforeStagedSettlement
  if (schema === 3) return planWithoutToolPolicy(beforeStagedSettlement)
  if (schema === 2) return planWithoutToolPolicy(planWithoutNativeActions(beforeStagedSettlement))
  const withoutAct = planWithoutToolPolicy(planWithoutPreparedAct(beforeStagedSettlement))
  if (schema === 1) return withoutAct
  const legacy = legacyPromptPreparation(beforeStagedSettlement)
  return { ...withoutAct, prompt: legacy.prompt, prepare: legacy.prepare }
}

/** Stable content digest for one versioned JSON-only prepared-plan projection. */
export function roleplayTurnPlanSha256(
  plan: RoleplayTurnPlan,
  schema: RoleplayTurnPlanSchema = CURRENT_ROLEPLAY_TURN_PLAN_SCHEMA,
): string {
  return createHash('sha256').update(JSON.stringify(projectRoleplayTurnPlan(plan, schema))).digest('hex')
}

/** Stable content digests for the named top-level sections of one versioned projection. */
export function roleplayTurnPlanSectionSha256(
  plan: RoleplayTurnPlan,
  schema: RoleplayTurnPlanSchema = CURRENT_ROLEPLAY_TURN_PLAN_SCHEMA,
): Readonly<Partial<Record<keyof RoleplayTurnPlan, string>>> {
  return Object.fromEntries(Object.entries(projectRoleplayTurnPlan(plan, schema) as object).map(([key, value]) => [
    key,
    createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  ])) as Readonly<Partial<Record<keyof RoleplayTurnPlan, string>>>
}

/** Resolve either an explicit schema or one of the finite pre-version projections by exact digest. */
export function matchRoleplayTurnPlanSchema(
  plan: RoleplayTurnPlan,
  expectedDigest: string,
  declaredSchema: unknown,
): RoleplayTurnPlanSchema | undefined {
  const schemas: readonly RoleplayTurnPlanSchema[] = declaredSchema === undefined
    ? [5, 4, 3, 2, 1, 0]
    : declaredSchema === 0 || declaredSchema === 1 || declaredSchema === 2
      || declaredSchema === 3 || declaredSchema === 4 || declaredSchema === 5
      ? [declaredSchema] : []
  return schemas.find(schema => roleplayTurnPlanSha256(plan, schema) === expectedDigest)
}

/** Revision change observed at the turn boundary for one runtime state namespace. */
export interface RoleplayStateSettlement {
  readonly id: string
  readonly beforeRevision?: number
  readonly afterRevision?: number
  readonly outcome: 'created' | 'updated' | 'unchanged' | 'removed' | 'unversioned' | 'failed'
  readonly error?: string
}

/** Explainable result of one module that participates in the settle phase. */
export interface RoleplaySettleModuleOutcome {
  readonly moduleId: string
  readonly outcome: 'applied' | 'idle' | 'deferred' | 'failed'
  readonly changes: number
  readonly error?: string
}

/** One model message emitted while the Agent acted, without retaining its content twice. */
export interface RoleplayActAssistantMessageReference {
  readonly eventSeq: number
  readonly messageId: string
  readonly interrupted?: true
}

/** One tool invocation emitted while the Agent acted, without retaining its arguments twice. */
export interface RoleplayActToolCallReference {
  readonly eventSeq: number
  readonly callId: string
  readonly name: string
}

/** One tool result emitted while the Agent acted, without retaining its result content twice. */
export interface RoleplayActToolResultReference {
  readonly eventSeq: number
  readonly callId: string
  readonly outcome: 'succeeded' | 'failed'
}

/** One auxiliary model call dispatched by a prepared act-phase program. */
export interface RoleplayActModelCallReference {
  readonly requestEventSeq: number
  readonly resultEventSeq: number
  readonly requestId: string
  readonly purpose: 'response-repair'
  readonly engine: RoleplayTurnPlan['act']['responseRepairs'][number]['engine']
  readonly moduleId: string
  readonly stateId: string
  readonly outcome: 'applied' | 'rejected' | 'failed'
}

/** Ordered Session-log evidence for one prepared model step. */
export interface RoleplayActStepReceipt {
  readonly step: number
  readonly assistantMessages: readonly RoleplayActAssistantMessageReference[]
  readonly modelCalls: readonly RoleplayActModelCallReference[]
  readonly toolCalls: readonly RoleplayActToolCallReference[]
  readonly toolResults: readonly RoleplayActToolResultReference[]
}

/** Replayable summary of state and memory after one complete Roleplay turn. */
export interface RoleplayTurnSettlement {
  readonly format: 0
  readonly sessionId: string
  readonly turn: number
  readonly result: string
  readonly plans: readonly RoleplayTurnPlanReference[]
  readonly reply?: {
    readonly eventSeq: number
    readonly messageId: string
  }
  /**
   * Content-free evidence for the act phase. Optional only for settlements
   * written before this receipt was introduced; every current compiler writes it.
   */
  readonly act?: {
    readonly steps: readonly RoleplayActStepReceipt[]
  }
  readonly state: readonly RoleplayStateSettlement[]
  readonly memory: {
    readonly writeAvailable: boolean
    readonly createdIds: readonly string[]
    /** Memory records active before this turn that are no longer active afterward. */
    readonly supersededIds: readonly string[]
    readonly activeCount: number
  }
  readonly settle: {
    readonly modules: readonly RoleplaySettleModuleOutcome[]
  }
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Informational Roleplay settlement; losing it does not change Session reconstruction. */
    'agent-rp/turn-settlement': RoleplayTurnSettlement
  }
}

/** A plan bound to the concrete model step that consumed it. */
export interface BoundRoleplayTurnPlan {
  readonly step: number
  readonly plan: RoleplayTurnPlan
}

export interface CompileRoleplayTurnSettlementInput {
  readonly sessionId: string
  readonly turn: number
  readonly result: string
  readonly plans: readonly BoundRoleplayTurnPlan[]
  readonly events: readonly SessionEvent[]
  readonly after: RoleplayRuntimeSnapshot
  readonly contributions?: readonly RoleplayTurnSettlementContribution[]
}

function stateById(
  bindings: readonly Pick<RoleplayStateBinding, 'id' | 'revision'>[],
): ReadonlyMap<string, Pick<RoleplayStateBinding, 'id' | 'revision'>> {
  return new Map(bindings.map(binding => [binding.id, binding]))
}

function stateSettlement(
  id: string,
  before: Pick<RoleplayStateBinding, 'id' | 'revision'> | undefined,
  after: Pick<RoleplayStateBinding, 'id' | 'revision'> | undefined,
  error: string | undefined,
): RoleplayStateSettlement {
  const revisions = {
    ...(before?.revision === undefined ? {} : { beforeRevision: before.revision }),
    ...(after?.revision === undefined ? {} : { afterRevision: after.revision }),
  }
  if (error !== undefined) return { id, ...revisions, outcome: 'failed', error }
  if (before === undefined && after !== undefined) {
    return { id, ...revisions, outcome: after.revision === undefined ? 'unversioned' : 'created' }
  }
  if (before !== undefined && after === undefined) return { id, ...revisions, outcome: 'removed' }
  if (before?.revision === undefined || after?.revision === undefined) {
    return { id, ...revisions, outcome: 'unversioned' }
  }
  return { id, ...revisions, outcome: before.revision === after.revision ? 'unchanged' : 'updated' }
}

function latestTurnReply(
  events: readonly SessionEvent[],
  turn: number,
): RoleplayTurnSettlement['reply'] | undefined {
  const hasVisibleText = (event: Extract<SessionEvent, { readonly type: 'assistant/message' }>): boolean =>
    event.data.message.content.some(block => block.type === 'text' && block.text.trim() !== '')
  const surface = new Set<number>()
  for (const event of events) {
    if (event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/result') {
      if (event.surfaceOp === 'append') surface.add(event.seq)
      else if (event.surfaceOp !== undefined) {
        for (const seq of [...surface]) {
          if (seq >= event.surfaceOp.start && seq <= event.surfaceOp.end) surface.delete(seq)
        }
        surface.add(event.seq)
      }
    }
  }
  const actionReplies = events.flatMap(event => {
    if (event.type !== 'tool/result' || event.data.turn !== turn
      || event.data.message.content[0]?.type !== 'tool-result'
      || event.data.message.content[0].isError === true || event.data.error !== undefined) return []
    const intent = readRoleplayStateActionIntent(event.data.meta)
    if (intent === undefined || intent.turn !== turn) return []
    const assistant = events[intent.assistantEventSeq]
    if (assistant?.type !== 'assistant/message' || !surface.has(assistant.seq)) return []
    return hasVisibleText(assistant) ? [assistant] : []
  })
  const reply = actionReplies.at(-1) ?? events.findLast(event => event.type === 'assistant/message'
    && event.data.turn === turn && surface.has(event.seq) && hasVisibleText(event))
  return reply?.type === 'assistant/message'
    ? { eventSeq: reply.seq, messageId: String(reply.data.message.id) }
    : undefined
}

type RoleplayActEvent = SessionEvent<'assistant/message' | 'tool/call' | 'tool/result'>

function isRoleplayActEvent(event: SessionEvent): event is RoleplayActEvent {
  return event.type === 'assistant/message' || event.type === 'tool/call' || event.type === 'tool/result'
}

function roleplayActCallKey(step: number, callId: string): string {
  return JSON.stringify([step, callId])
}

function exactTurnEvents(
  events: readonly SessionEvent[],
  turn: number,
  result: string,
): readonly SessionEvent[] {
  const eventsBySeq = new Map<number, SessionEvent>(events.map(event => [event.seq, event]))
  const starts = events.filter((event): event is SessionEvent<'turn/start'> =>
    event.type === 'turn/start' && event.data.turn === turn)
  const ends = events.filter((event): event is SessionEvent<'turn/end'> =>
    event.type === 'turn/end' && event.data.turn === turn)
  if (starts.length > 1 || ends.length > 1) {
    throw new Error(`Roleplay act phase has ambiguous boundaries for turn ${String(turn)}`)
  }
  const start = starts[0]
  const end = ends[0]
  if (start === undefined && end === undefined) {
    return events.filter((event) => {
      if (event.type === 'step/start' || event.type === 'step/end'
        || event.type === 'assistant/message' || event.type === 'tool/call'
        || event.type === 'tool/result' || event.type === 'agent-rp/act-model-request') {
        return event.data.turn === turn
      }
      if (event.type === 'agent-rp/act-model-result') {
        const request = eventsBySeq.get(event.data.requestSeq)
        return request?.type === 'agent-rp/act-model-request' && request.data.turn === turn
      }
      return false
    })
  }
  if (start === undefined || end === undefined || start.seq >= end.seq) {
    throw new Error(`Roleplay act phase has an incomplete boundary for turn ${String(turn)}`)
  }
  if (end.data.reason.kind !== result) {
    throw new Error('Roleplay settlement result does not match its turn boundary')
  }
  return events.filter(event => event.seq > start.seq && event.seq < end.seq)
}

/** Compile a content-free, source-neutral receipt from the exact closed-turn Session events. */
export function compileRoleplayActReceipt(
  events: readonly SessionEvent[],
  turn: number,
  result: string,
  plans: readonly RoleplayTurnPlanReference[],
): NonNullable<RoleplayTurnSettlement['act']> {
  const bounded = exactTurnEvents(events, turn, result)
  const eventsBySeq = new Map<number, SessionEvent>(events.map(event => [event.seq, event]))
  const plannedSteps = new Set(plans.map(plan => plan.step))
  const byStep = new Map(plans.map(plan => [plan.step, {
    step: plan.step,
    assistantMessages: [] as RoleplayActAssistantMessageReference[],
    modelCalls: [] as RoleplayActModelCallReference[],
    toolCalls: [] as RoleplayActToolCallReference[],
    toolResults: [] as RoleplayActToolResultReference[],
  }]))
  const starts = new Map<number, SessionEvent<'step/start'>>()
  const ends = new Map<number, SessionEvent<'step/end'>>()
  for (const event of bounded) {
    if (event.type !== 'step/start' && event.type !== 'step/end') continue
    if (event.data.turn !== turn) {
      throw new Error('Roleplay act boundary contains a step from another turn')
    }
    if (!plannedSteps.has(event.data.step)) {
      throw new Error(`Roleplay act phase contains unprepared step ${String(event.data.step)}`)
    }
    const duplicate = event.type === 'step/start'
      ? starts.has(event.data.step)
      : ends.has(event.data.step)
    if (duplicate) {
      throw new Error(`Roleplay act phase contains duplicate ${event.type} for step ${String(event.data.step)}`)
    }
    if (event.type === 'step/start') starts.set(event.data.step, event)
    else ends.set(event.data.step, event)
  }
  if (starts.size > 0 || ends.size > 0) {
    for (const step of plannedSteps) {
      const start = starts.get(step)
      const end = ends.get(step)
      if (start === undefined || end === undefined || start.seq >= end.seq) {
        throw new Error(`Roleplay act phase has an incomplete boundary for step ${String(step)}`)
      }
    }
  }

  const actModelRequests = new Map<string, SessionEvent<'agent-rp/act-model-request'>>()
  const actModelResults = new Set<string>()
  for (const event of [...bounded].sort((left, right) => left.seq - right.seq)) {
    if (event.type === 'agent-rp/act-model-request') {
      const data = event.data
      const step = byStep.get(data.step)
      const reference = plans.find(plan => plan.step === data.step)
      const start = starts.get(data.step)
      const end = ends.get(data.step)
      const planEvent = eventsBySeq.get(data.planSeq)
      const expected = reference?.receipt?.act?.responseRepairs.some(program =>
        program.engine === data.purpose.engine && program.moduleId === data.purpose.moduleId
          && program.stateId === data.purpose.stateId) === true
      if (data.format !== 0 || data.sessionId !== reference?.input.sessionId || data.turn !== turn
        || data.purpose.kind !== 'response-repair' || data.requestId === ''
        || step === undefined || reference === undefined || !expected
        || planEvent?.type !== 'agent-rp/turn-plan' || planEvent.seq >= event.seq
        || planEvent.data.turn !== turn || planEvent.data.reference.step !== data.step
        || JSON.stringify(planEvent.data.reference) !== JSON.stringify(reference)
        || typeof data.dispatch.provider !== 'string' || data.dispatch.provider === ''
        || typeof data.dispatch.model !== 'string' || data.dispatch.model === ''
        || !Array.isArray(data.dispatch.messages)
        || (start !== undefined && event.seq <= start.seq) || (end !== undefined && event.seq >= end.seq)) {
        throw new Error(`Roleplay act model request ${JSON.stringify(data.requestId)} is invalid`)
      }
      if (actModelRequests.has(data.requestId)) {
        throw new Error(`Roleplay act phase contains duplicate model request ${data.requestId}`)
      }
      actModelRequests.set(data.requestId, event)
      continue
    }
    if (event.type !== 'agent-rp/act-model-result') continue
    const data = event.data
    const request = actModelRequests.get(data.requestId)
    if (data.format !== 0 || request === undefined || request.seq !== data.requestSeq
      || request.seq >= event.seq || actModelResults.has(data.requestId)) {
      throw new Error(`Roleplay act model result ${JSON.stringify(data.requestId)} is invalid`)
    }
    let outcome: RoleplayActModelCallReference['outcome']
    if (data.result.kind === 'success') {
      if (typeof data.result.text !== 'string'
        || (data.result.application !== 'applied' && data.result.application !== 'rejected')) {
        throw new Error(`Roleplay act model result ${JSON.stringify(data.requestId)} is malformed`)
      }
      outcome = data.result.application
    } else {
      if (data.result.failure !== 'aborted' && data.result.failure !== 'provider'
        && data.result.failure !== 'unknown') {
        throw new Error(`Roleplay act model failure ${JSON.stringify(data.requestId)} is malformed`)
      }
      outcome = 'failed'
    }
    actModelResults.add(data.requestId)
    byStep.get(request.data.step)!.modelCalls.push({
      requestEventSeq: request.seq,
      resultEventSeq: event.seq,
      requestId: data.requestId,
      purpose: request.data.purpose.kind,
      engine: request.data.purpose.engine,
      moduleId: request.data.purpose.moduleId,
      stateId: request.data.purpose.stateId,
      outcome,
    })
  }
  for (const [requestId] of actModelRequests) {
    if (!actModelResults.has(requestId)) {
      throw new Error(`Roleplay act model request ${requestId} has no result`)
    }
  }

  const assistantToolCalls = new Map<string, {
    readonly eventSeq: number
    readonly step: number
    readonly name: string
    readonly arguments: string
  }>()
  const calls = new Map<string, SessionEvent<'tool/call'>>()
  const results = new Set<string>()
  const actEvents = bounded.filter(isRoleplayActEvent).sort((left, right) => left.seq - right.seq)
  for (const event of actEvents) {
    if (event.data.turn !== turn) {
      throw new Error('Roleplay act boundary contains an action from another turn')
    }
    const step = byStep.get(event.data.step)
    if (step === undefined) {
      throw new Error(`Roleplay act phase references unprepared step ${String(event.data.step)}`)
    }
    const start = starts.get(event.data.step)
    const end = ends.get(event.data.step)
    if ((start !== undefined && event.seq <= start.seq) || (end !== undefined && event.seq >= end.seq)) {
      if (event.type === 'assistant/message' && event.surfaceOp !== 'append'
        && end !== undefined && event.seq > end.seq) {
        continue
      }
      throw new Error(`Roleplay act event ${String(event.seq)} falls outside step ${String(event.data.step)}`)
    }
    if (event.type === 'assistant/message') {
      step.assistantMessages.push({
        eventSeq: event.seq,
        messageId: String(event.data.message.id),
        ...(event.data.interrupted === true ? { interrupted: true as const } : {}),
      })
      for (const block of event.data.message.content) {
        if (block.type !== 'tool-call') continue
        const callId = String(block.id)
        const callKey = roleplayActCallKey(event.data.step, callId)
        if (assistantToolCalls.has(callKey)) {
          throw new Error(`Roleplay act phase contains duplicate model tool call ${callId}`)
        }
        assistantToolCalls.set(callKey, {
          eventSeq: event.seq,
          step: event.data.step,
          name: block.name,
          arguments: block.arguments,
        })
      }
      continue
    }
    if (event.type === 'tool/call') {
      const callId = String(event.data.callId)
      const callKey = roleplayActCallKey(event.data.step, callId)
      if (calls.has(callKey)) throw new Error(`Roleplay act phase contains duplicate tool call ${callId}`)
      const modelCall = assistantToolCalls.get(callKey)
      if (modelCall === undefined || modelCall.eventSeq >= event.seq
        || modelCall.step !== event.data.step || modelCall.name !== event.data.name
        || modelCall.arguments !== event.data.arguments) {
        throw new Error(`Roleplay tool call ${callId} does not match its assistant message`)
      }
      calls.set(callKey, event)
      step.toolCalls.push({ eventSeq: event.seq, callId, name: event.data.name })
      continue
    }
    const block = event.data.message.content[0]
    const callId = String(event.data.message.source.callId)
    const callKey = roleplayActCallKey(event.data.step, callId)
    if (block.type !== 'tool-result' || String(block.toolCallId) !== callId) {
      throw new Error(`Roleplay tool result ${String(event.seq)} has inconsistent call identity`)
    }
    const call = calls.get(callKey)
    if (call === undefined || call.seq >= event.seq || call.data.turn !== turn
      || call.data.step !== event.data.step) {
      throw new Error(`Roleplay tool result ${callId} does not reference an earlier call in its step`)
    }
    if (event.sourceEventSeqs !== undefined && !event.sourceEventSeqs.includes(call.seq)) {
      throw new Error(`Roleplay tool result ${callId} does not cite call event ${String(call.seq)}`)
    }
    if (results.has(callKey)) throw new Error(`Roleplay act phase contains duplicate tool result ${callId}`)
    results.add(callKey)
    step.toolResults.push({
      eventSeq: event.seq,
      callId,
      outcome: block.isError === true || event.data.error !== undefined ? 'failed' : 'succeeded',
    })
  }
  for (const [callKey, call] of calls) {
    if (!results.has(callKey)) {
      throw new Error(`Roleplay tool call ${String(call.data.callId)} has no result in the closed turn`)
    }
  }
  return { steps: [...byStep.values()] }
}

function planReceipt(
  plan: RoleplayTurnPlan,
  schema: RoleplayTurnPlanSchema = CURRENT_ROLEPLAY_TURN_PLAN_SCHEMA,
): RoleplayTurnPlanReceipt {
  const projected = projectRoleplayTurnPlan(plan, schema) as Omit<RoleplayTurnPlan, 'act'> & {
    readonly act?: Partial<RoleplayTurnPlan['act']> & Pick<RoleplayTurnPlan['act'], 'responseRepairs'>
  }
  return {
    preparedPlanSchema: schema,
    preparedPlanSha256: roleplayTurnPlanSha256(plan, schema),
    preparedPlanSectionsSha256: roleplayTurnPlanSectionSha256(plan, schema),
    runtime: {
      experienceId: plan.runtime.experience.id,
      ...(plan.runtime.actor === undefined ? {} : { actorId: plan.runtime.actor.id }),
      ...(plan.runtime.participant === undefined ? {} : { participantId: plan.runtime.participant.id }),
      worldIds: plan.runtime.world.bindings.map(binding => binding.id),
      ...(plan.runtime.prompt.resource === undefined ? {} : { promptId: plan.runtime.prompt.resource.id }),
      stateIds: plan.runtime.state.map(binding => binding.id),
      moduleIds: plan.runtime.modules.map(module => module.id),
      settleModules: plan.runtime.modules.filter(module => module.phases.includes('settle')).map(module => ({
        moduleId: module.id,
        stateIds: [...(module.stateIds ?? [])],
      })),
      presentModuleIds: plan.runtime.modules.filter(module => module.phases.includes('present'))
        .map(module => module.id),
    },
    world: {
      activeEntries: plan.world.resources.map(resource => ({
        resourceId: resource.resource.id,
        entryIds: resource.entries.filter(entry => entry.active).map(entry => entry.entryId),
      })),
      approximateTokens: plan.world.approximateTokens,
      ...(plan.world.tokenBudget === undefined ? {} : { tokenBudget: plan.world.tokenBudget }),
    },
    promptDiagnostics: { ...plan.prompt.diagnostics },
    ...(projected.act === undefined ? {} : { act: {
      ...(projected.act.strategy === undefined ? {} : { strategy: projected.act.strategy }),
      responseRepairs: projected.act.responseRepairs.map(program => ({
        engine: program.engine,
        moduleId: program.moduleId,
        stateId: program.stateId,
      })),
      ...(projected.act.stateActions === undefined ? {} : {
        stateActions: projected.act.stateActions.map(action => ({
          engine: action.engine,
          tool: action.tool,
          moduleId: action.moduleId,
          stateId: action.stateId,
          expectedRevision: action.expectedRevision,
          operations: [...action.operations],
        })),
      }),
    } }),
    stateReads: plan.stateReads.map(read => ({
      id: read.id,
      ...(read.revision === undefined ? {} : { revision: read.revision }),
      ...(read.eventSeq === undefined ? {} : { eventSeq: read.eventSeq }),
    })),
    memoryReads: plan.memory.reads.map(read => ({ ...read })),
    memoryWriteAvailable: plan.memory.write,
    generation: { ...plan.generation },
    prepare: { modules: projected.prepare.modules.map(module => ({ ...module })) },
    recall: {
      modules: plan.recall.modules.map(module => ({ ...module })),
      ...(plan.recall.contextReads === undefined ? {} : {
        contextReads: plan.recall.contextReads.map(read => ({ ...read })),
      }),
    },
  }
}

/** Freeze one prepared plan into the content-free reference persisted before provider dispatch. */
export function createRoleplayTurnPlanReference(
  step: number,
  plan: RoleplayTurnPlan,
  schema: RoleplayTurnPlanSchema = CURRENT_ROLEPLAY_TURN_PLAN_SCHEMA,
): RoleplayTurnPlanReference {
  return { step, input: plan.input, receipt: planReceipt(plan, schema) }
}

interface SettleModuleContract {
  readonly moduleId: string
  readonly stateIds: ReadonlySet<string>
}

function settleModuleContractsFromReferences(
  plans: readonly RoleplayTurnPlanReference[],
): readonly SettleModuleContract[] {
  const contracts = new Map<string, Set<string>>()
  const stateOwners = new Map<string, string>()
  for (const reference of plans) {
    const modules = reference.receipt?.runtime.settleModules
    if (modules === undefined) throw new Error('Roleplay plan receipt cannot recover settle ownership')
    for (const module of modules) {
      let stateIds = contracts.get(module.moduleId)
      if (stateIds === undefined) {
        stateIds = new Set()
        contracts.set(module.moduleId, stateIds)
      }
      for (const stateId of module.stateIds) {
        const owner = stateOwners.get(stateId)
        if (owner !== undefined && owner !== module.moduleId) {
          throw new Error(`Roleplay state ${stateId} is owned by both ${owner} and ${module.moduleId}`)
        }
        stateOwners.set(stateId, module.moduleId)
        stateIds.add(stateId)
      }
    }
  }
  return [...contracts].map(([moduleId, stateIds]) => ({ moduleId, stateIds }))
}

function settlementContributions(
  contracts: readonly SettleModuleContract[],
  contributions: readonly RoleplayTurnSettlementContribution[],
): ReadonlyMap<string, RoleplayTurnSettlementContribution> {
  const moduleIds = new Set(contracts.map(contract => contract.moduleId))
  const result = new Map<string, RoleplayTurnSettlementContribution>()
  for (const contribution of contributions) {
    if (!moduleIds.has(contribution.moduleId)) {
      throw new Error(`Roleplay settlement contribution references inactive module ${contribution.moduleId}`)
    }
    if (result.has(contribution.moduleId)) {
      throw new Error(`Roleplay settlement contains duplicate contribution for ${contribution.moduleId}`)
    }
    if (contribution.outcome === 'failed'
      && (contribution.error === undefined || contribution.error.trim() === '')) {
      throw new Error(`Roleplay failed contribution for ${contribution.moduleId} requires an error`)
    }
    if (contribution.outcome === 'deferred' && contribution.error !== undefined) {
      throw new Error(`Roleplay deferred contribution for ${contribution.moduleId} cannot contain an error`)
    }
    result.set(contribution.moduleId, contribution)
  }
  return result
}

function settleModules(
  contracts: readonly SettleModuleContract[],
  state: readonly RoleplayStateSettlement[],
  memory: RoleplayTurnSettlement['memory'],
  contributions: ReadonlyMap<string, RoleplayTurnSettlementContribution>,
): readonly RoleplaySettleModuleOutcome[] {
  const stateFor = (id: string) => state.find(item => item.id === id)
  return contracts.map(({ moduleId, stateIds }): RoleplaySettleModuleOutcome => {
    const relatedStates = [...stateIds].flatMap(id => {
      const related = stateFor(id)
      return related === undefined ? [] : [related]
    })
    const changes = moduleId === ROLEPLAY_MEMORY_MODULE_ID
      ? memory.createdIds.length + memory.supersededIds.length
      : relatedStates.filter(related => related.outcome === 'created' || related.outcome === 'updated'
        || related.outcome === 'removed').length
    const contribution = contributions.get(moduleId)
    const outcome = contribution?.outcome === 'failed' || relatedStates.some(related => related.outcome === 'failed')
      ? 'failed' as const
      : contribution?.outcome === 'deferred' ? 'deferred' as const
        : changes > 0 ? 'applied' as const
          : 'idle' as const
    const error = contribution?.outcome === 'failed' ? contribution.error
      : relatedStates.find(related => related.outcome === 'failed')?.error
    return { moduleId, outcome, changes, ...(error === undefined ? {} : { error }) }
  })
}

/** Compile a turn-final settlement from the same plans used for generation. */
export function compileRoleplayTurnSettlement(
  input: CompileRoleplayTurnSettlementInput,
): RoleplayTurnSettlement {
  return compileRoleplayTurnSettlementFromReferences({
    sessionId: input.sessionId,
    turn: input.turn,
    result: input.result,
    plans: input.plans.map(({ step, plan }) => createRoleplayTurnPlanReference(step, plan)),
    events: input.events,
    after: input.after,
    ...(input.contributions === undefined ? {} : { contributions: input.contributions }),
  })
}

export interface CompileRoleplayTurnSettlementFromReferencesInput {
  readonly sessionId: string
  readonly turn: number
  readonly result: string
  readonly plans: readonly RoleplayTurnPlanReference[]
  readonly events: readonly SessionEvent[]
  readonly after: RoleplayRuntimeSnapshot
  readonly contributions?: readonly RoleplayTurnSettlementContribution[]
}

/** Rebuild a missing turn settlement after restart from pre-dispatch plan receipts. */
export function compileRoleplayTurnSettlementFromReferences(
  input: CompileRoleplayTurnSettlementFromReferencesInput,
): RoleplayTurnSettlement {
  if (input.plans.length === 0) throw new Error('Roleplay settlement requires at least one prepared plan')
  const plans = [...input.plans].sort((left, right) => left.step - right.step)
  const steps = new Set<number>()
  for (const plan of plans) {
    if (!Number.isSafeInteger(plan.step) || plan.step < 1) {
      throw new Error('Roleplay settlement step must be positive')
    }
    if (steps.has(plan.step)) {
      throw new Error(`Roleplay settlement contains duplicate step ${String(plan.step)}`)
    }
    steps.add(plan.step)
    if (plan.input.sessionId !== input.sessionId) {
      throw new Error('Roleplay settlement plan belongs to another Session')
    }
    if (!Number.isSafeInteger(plan.input.sessionSeq) || plan.input.sessionSeq < 0
      || plan.input.sessionSeq > input.events.length) {
      throw new Error('Roleplay settlement plan references an unavailable Session boundary')
    }
    if (plan.receipt === undefined || plan.receipt.memoryWriteAvailable === undefined) {
      throw new Error('Roleplay plan receipt is too old for cold settlement recovery')
    }
  }
  const firstReceipt = plans[0]!.receipt!
  const contracts = settleModuleContractsFromReferences(plans)
  const contributions = settlementContributions(contracts, input.contributions ?? [])
  const stateFailures = new Map<string, string>()
  for (const contract of contracts) {
    const contribution = contributions.get(contract.moduleId)
    if (contribution?.outcome !== 'failed' || contribution.error === undefined) continue
    for (const stateId of contract.stateIds) stateFailures.set(stateId, contribution.error)
  }
  const beforeStates = stateById(firstReceipt.stateReads)
  const afterStates = stateById(input.after.state)
  const stateIds = new Set([...beforeStates.keys(), ...afterStates.keys(), ...stateFailures.keys()])
  const state = [...stateIds].map(id => stateSettlement(
    id,
    beforeStates.get(id),
    afterStates.get(id),
    stateFailures.get(id),
  ))
  const firstSeq = plans[0]!.input.sessionSeq
  const beforeMemory = readAgentRpMemoryHistory(input.events.slice(0, firstSeq))
  const afterMemory = readAgentRpMemoryHistory(input.events)
  const beforeAll = new Set(beforeMemory.all.map(memory => String(memory.id)))
  const afterActive = new Set(afterMemory.active.map(memory => String(memory.id)))
  const memory = {
    writeAvailable: plans.some(plan => plan.receipt!.memoryWriteAvailable === true),
    createdIds: afterMemory.all.filter(memoryRecord => !beforeAll.has(String(memoryRecord.id)))
      .map(memoryRecord => String(memoryRecord.id)),
    supersededIds: beforeMemory.active.filter(memoryRecord => !afterActive.has(String(memoryRecord.id)))
      .map(memoryRecord => String(memoryRecord.id)),
    activeCount: afterMemory.active.length,
  }
  const reply = latestTurnReply(input.events, input.turn)
  const act = compileRoleplayActReceipt(input.events, input.turn, input.result, plans)
  return {
    format: 0,
    sessionId: input.sessionId,
    turn: input.turn,
    result: input.result,
    plans,
    ...(reply === undefined ? {} : { reply }),
    act,
    state,
    memory,
    settle: { modules: settleModules(contracts, state, memory, contributions) },
  }
}

/** Append an informational settlement through the Host's replay-safe plugin-event seam. */
export function appendRoleplayTurnSettlement(
  session: Session,
  settlement: RoleplayTurnSettlement,
): SessionEvent<'agent-rp/turn-settlement'> {
  const existing = sessionEvents(session).find(event => event.type === 'agent-rp/turn-settlement'
    && event.data.turn === settlement.turn)
  if (existing?.type === 'agent-rp/turn-settlement') return existing
  return appendAgentRpSessionEvent(session, 'agent-rp/turn-settlement', settlement)
}

/** Fold previously written settlement records in chronological order. */
export function readRoleplayTurnSettlements(events: readonly SessionEvent[]): readonly RoleplayTurnSettlement[] {
  return events.flatMap(event => event.type === 'agent-rp/turn-settlement' ? [event.data] : [])
}
