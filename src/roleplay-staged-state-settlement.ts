/** Post-narrative state settlement driven at DSH's native turn-stopping boundary. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  BlockAssembler,
  createUserMessage,
  ReasoningEffortId,
  type ContentBlock,
  type GenerateOptions,
} from '@deepseek-ai/dsh-llm'
import { foldSurface, type JsonValue, type SessionEvent } from '@deepseek-ai/dsh-session'
import { jsonrepair } from 'jsonrepair'
import {
  roleplayActModelDispatch,
  roleplayActModelFailure,
  type RoleplayActModelDispatch,
  type RoleplayActModelFailureKind,
} from './roleplay-act-model-log.ts'
import {
  type RoleplayStateActionPlan,
} from './roleplay-state-action.ts'
import { parseRoleplayStateOperations } from './roleplay-state-operations.ts'
import type { BoundRoleplayTurnPlan, RoleplayTurnPlanReference } from './roleplay-turn-settlement.ts'
import { appendAgentRpSessionEvent } from './session-event-compat.ts'
import { applyMvuOperations, type MvuStateOperation } from './mvu.ts'
import type { RoleplayTurnWorkerOutcome } from './roleplay-turn-worker.ts'
import type { RoleplayWorkerModelSelection } from './workspace-settings.ts'

interface RoleplayStagedStateRequestBase {
  readonly format: 0
  readonly requestId: string
  readonly sessionId: string
  readonly turn: number
  readonly step: number
  readonly throughEventSeq: number
  readonly planEventSeq: number
  readonly target: Omit<RoleplayStateActionPlan, 'instructions'>
  readonly dispatch: RoleplayActModelDispatch
}

/** Exact provider request dispatched after the visible Roleplay reply has finished. */
export type RoleplayStagedStateRequestRecord = RoleplayStagedStateRequestBase & (
  | { readonly stage: 'proposal'; readonly proposalResultSeq?: never }
  | { readonly stage: 'verification'; readonly proposalResultSeq: number }
  | { readonly stage?: undefined; readonly proposalResultSeq?: undefined }
)

/** Terminal, replayable result of one post-narrative state calculation. */
export interface RoleplayStagedStateResultRecord {
  readonly format: 0
  readonly requestId: string
  readonly requestSeq: number
  readonly result:
    | {
        readonly kind: 'success'
        readonly text: string
        readonly operations: readonly MvuStateOperation[]
      }
    | {
        readonly kind: 'failure'
        readonly failure: RoleplayActModelFailureKind
      }
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Ignorable exact request made by the post-narrative settlement stage. */
    'agent-rp/staged-state-request': RoleplayStagedStateRequestRecord
    /** Ignorable terminal result consumed by turn settlement. */
    'agent-rp/staged-state-result': RoleplayStagedStateResultRecord
  }
}

export interface CollectedRoleplayStagedStateSettlement {
  readonly requestEventSeq: number
  readonly resultEventSeq: number
  readonly throughEventSeq: number
  readonly target: Omit<RoleplayStateActionPlan, 'instructions'>
  readonly outcome: 'success' | 'failed'
  readonly operations: readonly MvuStateOperation[]
  readonly error?: string
}

function targetReceipt(target: RoleplayStateActionPlan): Omit<RoleplayStateActionPlan, 'instructions'> {
  return {
    engine: target.engine,
    tool: target.tool,
    moduleId: target.moduleId,
    stateId: target.stateId,
    expectedRevision: target.expectedRevision,
    operations: [...target.operations],
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function referenceTarget(
  reference: RoleplayTurnPlanReference,
  stateId: string,
): Omit<RoleplayStateActionPlan, 'instructions'> | undefined {
  const action = reference.receipt?.act?.strategy === 'agent'
    ? reference.receipt.act.stateActions?.find(candidate => candidate.stateId === stateId)
    : undefined
  return action === undefined ? undefined : targetReceipt(action)
}

function parseStateSettlementResponse(text: unknown): readonly MvuStateOperation[] {
  if (typeof text !== 'string') throw new Error('Roleplay staged state result text is invalid')
  if (text.length > 256 * 1024) throw new Error('Roleplay staged state result is too large')
  const unfenced = text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Roleplay staged state result has no JSON object')
  const value = JSON.parse(jsonrepair(unfenced.slice(start, end + 1))) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).some(key => key !== 'operations')) {
    throw new Error('Roleplay staged state result fields are invalid')
  }
  const operations = (value as { operations?: unknown }).operations
  const normalized = Array.isArray(operations) ? operations.map((operation) => {
    if (typeof operation !== 'object' || operation === null || Array.isArray(operation)) return operation
    const record = operation as Record<string, unknown>
    if (!Object.hasOwn(record, 'operation') || Object.hasOwn(record, 'op')) return operation
    const { operation: op, ...rest } = record
    return { ...rest, op }
  }) : operations
  return parseRoleplayStateOperations(normalized, { allowEmpty: true })
}

const MAX_SETTLEMENT_TEXT_LENGTH = 128 * 1024
const STATE_SETTLEMENT_MAX_TOKENS = 4_096

function boundedSettlementText(text: string): string {
  return text.length <= MAX_SETTLEMENT_TEXT_LENGTH
    ? text
    : text.slice(text.length - MAX_SETTLEMENT_TEXT_LENGTH)
}

function textContent(content: readonly ContentBlock[]): string {
  return content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

function playerInputText(
  events: readonly SessionEvent[],
  planEvent: SessionEvent<'agent-rp/turn-plan'>,
): string {
  const input = planEvent.data.reference.input
  if (new Set(input.pendingMessageIds).size !== input.pendingMessageIds.length) {
    throw new Error('Roleplay staged settlement plan contains duplicate pending message ids')
  }
  const candidates = events.slice(input.sessionSeq, planEvent.seq).flatMap(event =>
    event.type === 'user/message' ? [event] : [])
  const text = input.pendingMessageIds.map((id) => {
    const matches = candidates.filter(event => String(event.data.id) === id)
    if (matches.length !== 1) {
      throw new Error(`Roleplay staged settlement player input ${JSON.stringify(id)} is unavailable or ambiguous`)
    }
    return textContent(matches[0]!.data.content)
  }).join('\n\n')
  return boundedSettlementText(text)
}

function visibleReplyText(
  events: readonly SessionEvent[],
  turn: number,
  step: number,
  planEventSeq: number,
  throughEventSeq: number,
): string {
  const prefix = events.slice(0, throughEventSeq + 1)
  for (const seq of [...foldSurface(prefix).nodes].reverse()) {
    const event = prefix[seq]
    if (event?.type !== 'assistant/message' || event.seq <= planEventSeq
      || event.data.turn !== turn || event.data.step !== step) continue
    const text = textContent(event.data.message.content)
    if (text.trim() !== '') return boundedSettlementText(text)
  }
  return ''
}

function stateOperationContract(target: RoleplayStateActionPlan): readonly string[] {
  const operations = target.operations.join('、')
  return [
    `只允许这些操作：${operations}。数值增减优先使用 delta；不要返回完整状态。`,
    '每项必须使用字段名 op（不要写 operation）：replace、delta、insert 使用 op、path、value；remove 使用 op、path；move 使用 op、from、to。path、from、to 必须是从 <current_state> JSON 根开始的完整绝对 JSON Pointer，保留所有父级；例如 {"游戏":{"当前回合":"红方"}} 对应 /游戏/当前回合，不能写成 /当前回合。',
    '只返回一个 JSON 对象：{"operations":[...]}。没有变化时返回 {"operations":[]}。不要使用 Markdown。',
  ]
}

function settlementEvidence(
  agent: Agent,
  turn: number,
  step: number,
  planEvent: SessionEvent<'agent-rp/turn-plan'>,
  surfaceThroughEventSeq: number,
  target: RoleplayStateActionPlan,
  current: JsonValue,
): string {
  return [
    '<imported_state_rules>',
    target.instructions ?? '只更新剧情中明确发生变化的状态。',
    '</imported_state_rules>',
    '<current_state>',
    JSON.stringify(current),
    '</current_state>',
    '<player_input>',
    playerInputText(agent.session.events, planEvent),
    '</player_input>',
    '<roleplay_reply>',
    visibleReplyText(agent.session.events, turn, step, planEvent.seq, surfaceThroughEventSeq),
    '</roleplay_reply>',
  ].join('\n')
}

function settlementRequest(
  agent: Agent,
  evidence: string,
  target: RoleplayStateActionPlan,
  signal: AbortSignal,
): GenerateOptions {
  const header = agent.session.requestHeader()
  if (header === undefined) throw new Error('Roleplay staged settlement has no provider request header')
  return {
    ...header.config,
    reasoningEffort: ReasoningEffortId('off'),
    temperature: 0,
    maxTokens: STATE_SETTLEMENT_MAX_TOKENS,
    system: [
      '你是角色扮演运行时的后台状态结算器。剧情正文已经完成；不要续写、改写、评价或解释剧情。',
      '比较本轮玩家输入、角色正文与当前状态，只计算正文已经造成的状态变化。',
      '正文明确发生的事件可以按状态规则产生联动更新；逐项检查同一事件影响的回合、计数器、阶段和关联实体，不得因正文未逐字点名内部字段而漏掉规则规定的变化。',
      ...stateOperationContract(target),
    ].join('\n'),
    messages: [createUserMessage({
      source: { kind: 'plugin', plugin: 'dsh-agent-rp' },
      content: [{
        type: 'text',
        text: evidence,
      }],
    })],
    signal,
  }
}

function settlementVerificationRequest(
  agent: Agent,
  evidence: string,
  target: RoleplayStateActionPlan,
  modelSelection: RoleplayWorkerModelSelection | null | undefined,
  signal: AbortSignal,
): GenerateOptions {
  const header = agent.session.requestHeader()
  if (header === undefined) throw new Error('Roleplay staged settlement has no provider request header')
  const model = resolveRoleplayStateVerificationModel(header.config, modelSelection)
  return {
    ...header.config,
    ...model,
    reasoningEffort: ReasoningEffortId('low'),
    temperature: 0,
    maxTokens: STATE_SETTLEMENT_MAX_TOKENS,
    system: [
      '你是角色扮演运行时的独立状态核验器。另一个 Worker 已生成候选结算，但它的输出不会提供给你，避免其遗漏或错误影响核验。',
      '以 current_state 为唯一基线，重新根据状态规则、玩家输入和最终正文计算本轮后的完整状态。',
      '先在内部逐字段比较重新计算的状态与 current_state，检查回合、计数器、阶段、碰撞对象和关联实体。返回从 current_state 直接到核验后状态的完整 operations。',
      ...stateOperationContract(target),
    ].join('\n'),
    messages: [createUserMessage({
      source: { kind: 'plugin', plugin: 'dsh-agent-rp' },
      content: [{
        type: 'text',
        text: evidence,
      }],
    })],
    signal,
  }
}

/** Resolve the verification route without changing the proposal or visible Roleplay request. */
export function resolveRoleplayStateVerificationModel(
  sessionModel: Pick<GenerateOptions, 'provider' | 'model'>,
  selection: RoleplayWorkerModelSelection | null | undefined,
): Pick<GenerateOptions, 'provider' | 'model'> {
  return selection === null || selection === undefined
    ? { provider: sessionModel.provider, model: sessionModel.model }
    : { provider: selection.provider, model: selection.model }
}

function matchingPlanEvent(
  events: readonly SessionEvent[],
  turn: number,
  plan: BoundRoleplayTurnPlan,
): SessionEvent<'agent-rp/turn-plan'> {
  const matches = events.filter((event): event is SessionEvent<'agent-rp/turn-plan'> =>
    event.type === 'agent-rp/turn-plan' && event.data.turn === turn
      && event.data.reference.step === plan.step)
  if (matches.length !== 1 || !sameJson(matches[0]!.data.reference.input, plan.plan.input)) {
    throw new Error('Roleplay staged settlement has no unique prepared plan')
  }
  return matches[0]!
}

function stepEnd(
  events: readonly SessionEvent[],
  turn: number,
  step: number,
): SessionEvent<'step/end'> {
  const event = events.findLast((candidate): candidate is SessionEvent<'step/end'> =>
    candidate.type === 'step/end' && candidate.data.turn === turn && candidate.data.step === step)
  if (event === undefined) throw new Error('Roleplay staged settlement requires a closed Agent step')
  return event
}

function terminalForCoverage(
  events: readonly SessionEvent[],
  turn: number,
  throughEventSeq: number,
): boolean {
  const requests = events.filter((event): event is SessionEvent<'agent-rp/staged-state-request'> =>
    event.type === 'agent-rp/staged-state-request' && event.data.turn === turn
      && event.data.throughEventSeq === throughEventSeq)
  return requests.some((request) => {
    const result = events.find((event): event is SessionEvent<'agent-rp/staged-state-result'> =>
      event.type === 'agent-rp/staged-state-result' && event.data.requestSeq === request.seq)
    return result !== undefined && (request.data.stage !== 'proposal' || result.data.result.kind === 'failure')
  })
}

type StateSettlementDispatchOutcome =
  | {
      readonly outcome: 'success'
      readonly requestEvent: SessionEvent<'agent-rp/staged-state-request'>
      readonly resultEvent: SessionEvent<'agent-rp/staged-state-result'>
      readonly text: string
      readonly operations: readonly MvuStateOperation[]
    }
  | {
      readonly outcome: 'failed'
      readonly requestEvent: SessionEvent<'agent-rp/staged-state-request'>
      readonly resultEvent: SessionEvent<'agent-rp/staged-state-result'>
    }

interface StateSettlementDispatchInputBase {
  readonly ctx: Context
  readonly agent: Agent
  readonly turn: number
  readonly step: number
  readonly throughEventSeq: number
  readonly planEventSeq: number
  readonly target: RoleplayStateActionPlan
  readonly current: JsonValue
  readonly request: GenerateOptions
}

type StateSettlementDispatchInput = StateSettlementDispatchInputBase & (
  | { readonly stage: 'proposal'; readonly proposalResultSeq?: never }
  | { readonly stage: 'verification'; readonly proposalResultSeq: number }
)

async function dispatchStateSettlement(
  input: StateSettlementDispatchInput,
): Promise<StateSettlementDispatchOutcome> {
  const requestId = crypto.randomUUID()
  const stage = input.stage === 'proposal'
    ? { stage: 'proposal' as const }
    : { stage: 'verification' as const, proposalResultSeq: input.proposalResultSeq }
  const requestEvent = appendAgentRpSessionEvent(input.agent.session, 'agent-rp/staged-state-request', {
    format: 0,
    requestId,
    sessionId: String(input.agent.session.id),
    turn: input.turn,
    step: input.step,
    throughEventSeq: input.throughEventSeq,
    planEventSeq: input.planEventSeq,
    target: targetReceipt(input.target),
    dispatch: roleplayActModelDispatch(input.request),
    ...stage,
  })
  try {
    await input.ctx.sessions.flush(input.agent.session)
    const assembler = new BlockAssembler()
    for await (const chunk of input.ctx.llm.stream(input.request)) assembler.push(chunk)
    if (assembler.finish.kind === 'error' || assembler.finish.kind === 'aborted') {
      const resultEvent = appendAgentRpSessionEvent(input.agent.session, 'agent-rp/staged-state-result', {
        format: 0,
        requestId,
        requestSeq: requestEvent.seq,
        result: {
          kind: 'failure',
          failure: assembler.finish.kind === 'aborted' ? 'aborted' : 'provider',
        },
      })
      return { outcome: 'failed', requestEvent, resultEvent }
    }
    const text = assembler.blocks().flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    const operations = parseStateSettlementResponse(text)
    if (operations.some(operation => !input.target.operations.includes(operation.op))) {
      throw new Error('Roleplay staged state result uses an operation outside its prepared plan')
    }
    applyMvuOperations(input.current, operations)
    const resultEvent = appendAgentRpSessionEvent(input.agent.session, 'agent-rp/staged-state-result', {
      format: 0,
      requestId,
      requestSeq: requestEvent.seq,
      result: { kind: 'success', text, operations },
    })
    return { outcome: 'success', requestEvent, resultEvent, text, operations }
  } catch (error: unknown) {
    let resultEvent = input.agent.session.events.find(
      (event): event is SessionEvent<'agent-rp/staged-state-result'> =>
        event.type === 'agent-rp/staged-state-result' && event.data.requestSeq === requestEvent.seq,
    )
    if (resultEvent === undefined) {
      resultEvent = appendAgentRpSessionEvent(input.agent.session, 'agent-rp/staged-state-result', {
        format: 0,
        requestId,
        requestSeq: requestEvent.seq,
        result: { kind: 'failure', failure: roleplayActModelFailure(error) },
      })
    }
    return { outcome: 'failed', requestEvent, resultEvent }
  }
}

/** Run the state calculation once for the latest completed Agent step. */
export async function runRoleplayStagedStateSettlement(input: {
  readonly ctx: Context
  readonly agent: Agent
  readonly turn: number
  readonly plan: BoundRoleplayTurnPlan
  readonly verificationModel?: RoleplayWorkerModelSelection | null
  readonly signal: AbortSignal
}): Promise<RoleplayTurnWorkerOutcome> {
  const target = input.plan.plan.act.stateActions[0]
  if (target === undefined) return { outcome: 'skipped' }
  const state = input.plan.plan.stateReads.find(read => read.id === target.stateId)
  if (state?.value === undefined) return { outcome: 'skipped' }
  const planEvent = matchingPlanEvent(input.agent.session.events, input.turn, input.plan)
  const through = stepEnd(input.agent.session.events, input.turn, input.plan.step)
  if (terminalForCoverage(input.agent.session.events, input.turn, through.seq)) return { outcome: 'skipped' }
  const evidence = settlementEvidence(
    input.agent,
    input.turn,
    input.plan.step,
    planEvent,
    input.agent.session.seq - 1,
    target,
    state.value,
  )
  const proposal = await dispatchStateSettlement({
    ctx: input.ctx,
    agent: input.agent,
    turn: input.turn,
    step: input.plan.step,
    throughEventSeq: through.seq,
    planEventSeq: planEvent.seq,
    target,
    current: state.value,
    request: settlementRequest(input.agent, evidence, target, input.signal),
    stage: 'proposal',
  })
  if (proposal.outcome === 'failed') {
    return {
      outcome: 'failed',
      requestEventSeq: proposal.requestEvent.seq,
      resultEventSeq: proposal.resultEvent.seq,
    }
  }
  const verification = await dispatchStateSettlement({
    ctx: input.ctx,
    agent: input.agent,
    turn: input.turn,
    step: input.plan.step,
    throughEventSeq: through.seq,
    planEventSeq: planEvent.seq,
    target,
    current: state.value,
    request: settlementVerificationRequest(
      input.agent,
      evidence,
      target,
      input.verificationModel,
      input.signal,
    ),
    stage: 'verification',
    proposalResultSeq: proposal.resultEvent.seq,
  })
  return verification.outcome === 'failed'
    ? {
        outcome: 'failed',
        requestEventSeq: verification.requestEvent.seq,
        resultEventSeq: verification.resultEvent.seq,
      }
    : {
        outcome: verification.operations.length === 0 ? 'unchanged' : 'applied',
        requestEventSeq: verification.requestEvent.seq,
        resultEventSeq: verification.resultEvent.seq,
      }
}

/** Validate and select the calculation covering the final completed step of a closed turn. */
export function collectRoleplayStagedStateSettlement(input: {
  readonly events: readonly SessionEvent[]
  readonly sessionId: string
  readonly turn: number
  readonly plans: readonly RoleplayTurnPlanReference[]
}): CollectedRoleplayStagedStateSettlement | undefined {
  const requests = new Map<number, SessionEvent<'agent-rp/staged-state-request'>>()
  const results = new Map<number, SessionEvent<'agent-rp/staged-state-result'>>()
  const requestIds = new Set<string>()
  for (const event of input.events) {
    if (event.type === 'agent-rp/staged-state-request' && event.data.turn === input.turn) {
      const data = event.data
      const target = typeof data.target === 'object' && data.target !== null && !Array.isArray(data.target)
        ? data.target : undefined
      const stateId = target === undefined ? undefined : (target as { readonly stateId?: unknown }).stateId
      const planEvent = Number.isSafeInteger(data.planEventSeq) ? input.events[data.planEventSeq] : undefined
      const through = Number.isSafeInteger(data.throughEventSeq) ? input.events[data.throughEventSeq] : undefined
      const reference = input.plans.find(plan => plan.step === data.step)
      const expectedTarget = reference === undefined || typeof stateId !== 'string'
        ? undefined : referenceTarget(reference, stateId)
      const dispatch = typeof data.dispatch === 'object' && data.dispatch !== null && !Array.isArray(data.dispatch)
        ? data.dispatch : undefined
      const proposalResultSeq = data.proposalResultSeq
      const proposalResult = proposalResultSeq !== undefined && Number.isSafeInteger(proposalResultSeq)
        ? input.events[proposalResultSeq] : undefined
      const proposalRequest = proposalResult?.type === 'agent-rp/staged-state-result'
        && Number.isSafeInteger(proposalResult.data.requestSeq)
        ? requests.get(proposalResult.data.requestSeq) : undefined
      const stageValid = data.stage === undefined
        ? data.proposalResultSeq === undefined
        : data.stage === 'proposal'
          ? data.proposalResultSeq === undefined
          : data.stage === 'verification'
            && proposalResult?.type === 'agent-rp/staged-state-result'
            && proposalResult.seq < event.seq
            && proposalResult.data.result.kind === 'success'
            && proposalRequest?.data.stage === 'proposal'
            && results.get(proposalRequest.seq)?.seq === proposalResult.seq
            && proposalRequest.data.sessionId === data.sessionId
            && proposalRequest.data.turn === data.turn
            && proposalRequest.data.step === data.step
            && proposalRequest.data.throughEventSeq === data.throughEventSeq
            && proposalRequest.data.planEventSeq === data.planEventSeq
            && sameJson(proposalRequest.data.target, data.target)
      if (data.format !== 0 || data.sessionId !== input.sessionId
        || typeof data.requestId !== 'string' || data.requestId === '' || requestIds.has(data.requestId)
        || !Number.isSafeInteger(data.step) || data.step <= 0
        || planEvent?.type !== 'agent-rp/turn-plan' || planEvent.seq >= event.seq
        || planEvent.data.turn !== input.turn || !sameJson(planEvent.data.reference, reference)
        || through?.type !== 'step/end' || through.seq >= event.seq
        || through.data.turn !== input.turn || through.data.step !== data.step
        || expectedTarget === undefined || !sameJson(expectedTarget, data.target)
        || !stageValid
        || dispatch === undefined || typeof dispatch.provider !== 'string' || dispatch.provider === ''
        || typeof dispatch.model !== 'string' || dispatch.model === '' || !Array.isArray(dispatch.messages)
        || (dispatch.system !== undefined && typeof dispatch.system !== 'string')
        || (dispatch.reasoningEffort !== undefined && typeof dispatch.reasoningEffort !== 'string')
        || (dispatch.temperature !== undefined
          && (typeof dispatch.temperature !== 'number' || !Number.isFinite(dispatch.temperature)))
        || (dispatch.maxTokens !== undefined
          && (!Number.isSafeInteger(dispatch.maxTokens) || dispatch.maxTokens <= 0))) {
        throw new Error('Roleplay staged state request is invalid')
      }
      requestIds.add(data.requestId)
      requests.set(event.seq, event)
    } else if (event.type === 'agent-rp/staged-state-result') {
      const recordedRequest = Number.isSafeInteger(event.data.requestSeq)
        ? input.events[event.data.requestSeq] : undefined
      if (recordedRequest?.type !== 'agent-rp/staged-state-request'
        || recordedRequest.data.turn !== input.turn) continue
      const request = requests.get(event.data.requestSeq)
      if (event.data.format !== 0 || request === undefined || request.seq >= event.seq
        || typeof event.data.requestId !== 'string' || event.data.requestId !== request.data.requestId
        || typeof event.data.result !== 'object' || event.data.result === null
        || Array.isArray(event.data.result) || results.has(request.seq)) {
        throw new Error('Roleplay staged state result is invalid')
      }
      if (event.data.result.kind === 'success') {
        const parsed = parseStateSettlementResponse(event.data.result.text)
        if (!Array.isArray(event.data.result.operations) || !sameJson(parsed, event.data.result.operations)
          || parsed.some(operation => !request.data.target.operations.includes(operation.op))) {
          throw new Error('Roleplay staged state operations do not match their request')
        }
      } else if (event.data.result.kind !== 'failure'
        || (event.data.result.failure !== 'aborted' && event.data.result.failure !== 'provider'
          && event.data.result.failure !== 'unknown')) {
        throw new Error('Roleplay staged state result is invalid')
      }
      results.set(request.seq, event)
    }
  }
  const latest = [...requests.values()].sort((left, right) =>
    right.data.throughEventSeq - left.data.throughEventSeq || right.seq - left.seq)[0]
  if (latest === undefined) return undefined
  const finalStep = input.events.findLast((event): event is SessionEvent<'step/end'> =>
    event.type === 'step/end' && event.data.turn === input.turn)
  if (finalStep === undefined || latest.data.throughEventSeq !== finalStep.seq) return undefined
  const result = results.get(latest.seq)
  if (result === undefined) throw new Error('Roleplay staged state request has no terminal result')
  if (latest.data.stage === 'proposal' && result.data.result.kind === 'success') {
    throw new Error('Roleplay staged state proposal has no independent verification')
  }
  return result.data.result.kind === 'success'
    ? {
        requestEventSeq: latest.seq,
        resultEventSeq: result.seq,
        throughEventSeq: latest.data.throughEventSeq,
        target: latest.data.target,
        outcome: 'success',
        operations: result.data.result.operations,
      }
    : {
        requestEventSeq: latest.seq,
        resultEventSeq: result.seq,
        throughEventSeq: latest.data.throughEventSeq,
        target: latest.data.target,
        outcome: 'failed',
        operations: [],
        error: `后台状态结算失败（${result.data.result.failure}）`,
      }
}
