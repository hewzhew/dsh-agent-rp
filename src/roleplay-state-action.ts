/** Replayable Agent state-action intents and turn-boundary MVU reduction. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  Session,
  snapshotJsonValue,
  type JsonValue,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  appendMvuState,
  applyMvuOperations,
  MVU_ROLEPLAY_MODULE_ID,
  MVU_ROLEPLAY_STATE_ID,
  type MvuStateOperation,
  type MvuStateSnapshot,
} from './mvu.ts'
import { collectRoleplayStagedStateSettlement } from './roleplay-staged-state-settlement.ts'
import { parseRoleplayStateOperations } from './roleplay-state-operations.ts'
import type { RoleplayTurnPlanReference } from './roleplay-turn-settlement.ts'

/** Model-facing tool that records semantic state work without mutating state mid-turn. */
export const ROLEPLAY_STATE_ACTION_TOOL = 'apply_roleplay_state'

/** Durable tool-result metadata format. */
export const ROLEPLAY_STATE_ACTION_FORMAT = 'agent-rp.state-action' as const

/** Prepared capability contract frozen before one model step. */
export interface RoleplayStateActionPlan {
  readonly engine: 'mvu-v0'
  readonly tool: typeof ROLEPLAY_STATE_ACTION_TOOL
  readonly moduleId: string
  readonly stateId: string
  readonly expectedRevision: number
  readonly operations: readonly MvuStateOperation['op'][]
  /** Adapter rules consulted only by the post-narrative settlement stage. */
  readonly instructions?: string
}

/** Causal action intent stored on one successful top-level tool result. */
export interface RoleplayStateActionIntent {
  readonly format: typeof ROLEPLAY_STATE_ACTION_FORMAT
  readonly version: 0
  readonly sessionId: string
  readonly turn: number
  readonly step: number
  readonly planEventSeq: number
  readonly assistantEventSeq: number
  readonly callEventSeq: number
  readonly callId: string
  readonly moduleId: string
  readonly stateId: string
  readonly expectedRevision: number
  readonly operations: readonly MvuStateOperation[]
}

/** Result of reducing every accepted state action for one closed turn. */
export interface RoleplayStateActionSettlement {
  readonly session: Session
  readonly resultEventSeqs: readonly number[]
  readonly outcome: 'idle' | 'applied' | 'failed'
  readonly error?: string
}

const OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { type: 'string', required: true, enum: ['replace', 'delta', 'insert', 'remove', 'move'] },
    path: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    value: { type: 'json' },
  },
} as const

const ACTION_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    format: { type: 'string', required: true, const: ROLEPLAY_STATE_ACTION_FORMAT },
    version: { type: 'integer', required: true, const: 0 },
    sessionId: { type: 'string', required: true },
    turn: { type: 'integer', required: true },
    step: { type: 'integer', required: true },
    planEventSeq: { type: 'integer', required: true },
    assistantEventSeq: { type: 'integer', required: true },
    callEventSeq: { type: 'integer', required: true },
    callId: { type: 'string', required: true },
    moduleId: { type: 'string', required: true },
    stateId: { type: 'string', required: true },
    expectedRevision: { type: 'integer', required: true },
    operations: { type: 'array', required: true, items: OPERATION_SCHEMA },
  },
} as const

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid`)
  return Number(value)
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${label} is invalid`)
  return value
}

/** Parse one tool-result payload while declining unrelated metadata. */
export function readRoleplayStateActionIntent(value: unknown): RoleplayStateActionIntent | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.format !== ROLEPLAY_STATE_ACTION_FORMAT) return undefined
  if (record.version !== 0 || Object.keys(record).some(key => ![
    'format', 'version', 'sessionId', 'turn', 'step', 'planEventSeq', 'assistantEventSeq',
    'callEventSeq', 'callId', 'moduleId', 'stateId', 'expectedRevision', 'operations',
  ].includes(key))) throw new Error('Roleplay state action fields are invalid')
  return {
    format: ROLEPLAY_STATE_ACTION_FORMAT,
    version: 0,
    sessionId: text(record.sessionId, 'Roleplay state action Session'),
    turn: integer(record.turn, 'Roleplay state action turn'),
    step: integer(record.step, 'Roleplay state action step'),
    planEventSeq: integer(record.planEventSeq, 'Roleplay state action plan event'),
    assistantEventSeq: integer(record.assistantEventSeq, 'Roleplay state action assistant event'),
    callEventSeq: integer(record.callEventSeq, 'Roleplay state action call event'),
    callId: text(record.callId, 'Roleplay state action call id'),
    moduleId: text(record.moduleId, 'Roleplay state action module'),
    stateId: text(record.stateId, 'Roleplay state action state'),
    expectedRevision: integer(record.expectedRevision, 'Roleplay state action revision'),
    operations: parseRoleplayStateOperations(record.operations),
  }
}

function actionTarget(
  reference: RoleplayTurnPlanReference,
  stateId: string,
): RoleplayStateActionPlan | undefined {
  return reference.receipt?.act?.strategy === 'agent'
    ? reference.receipt.act.stateActions?.find(action => action.stateId === stateId)
    : undefined
}

function matchingPlanEvent(
  events: readonly SessionEvent[],
  turn: number,
  step: number,
  beforeSeq: number,
): SessionEvent<'agent-rp/turn-plan'> {
  const matches = events.filter((event): event is SessionEvent<'agent-rp/turn-plan'> =>
    event.type === 'agent-rp/turn-plan' && event.seq < beforeSeq
      && event.data.turn === turn && event.data.reference.step === step)
  if (matches.length !== 1) throw new Error('Roleplay state action has no unique prepared plan')
  return matches[0]!
}

function toolCallForExecution(agent: Agent, callId: string): {
  readonly call: SessionEvent<'tool/call'>
  readonly assistant: SessionEvent<'assistant/message'>
  readonly plan: SessionEvent<'agent-rp/turn-plan'>
} {
  const events = agent.session.events
  const calls = events.filter((event): event is SessionEvent<'tool/call'> => event.type === 'tool/call'
    && String(event.data.callId) === callId && event.data.name === ROLEPLAY_STATE_ACTION_TOOL)
  const call = calls.at(-1)
  if (call === undefined) throw new Error('Roleplay state action call is not recorded in this Session')
  if (events.some(event => event.type === 'turn/end' && event.data.turn === call.data.turn
    && event.seq > call.seq)) throw new Error('Roleplay state action turn is already closed')
  const assistant = events.findLast((event): event is SessionEvent<'assistant/message'> =>
    event.type === 'assistant/message' && event.seq < call.seq
      && event.data.turn === call.data.turn && event.data.step === call.data.step
      && event.data.message.content.some(block => block.type === 'tool-call'
        && String(block.id) === callId && block.name === ROLEPLAY_STATE_ACTION_TOOL))
  if (assistant === undefined) throw new Error('Roleplay state action has no matching assistant message')
  return {
    call,
    assistant,
    plan: matchingPlanEvent(events, call.data.turn, call.data.step, call.seq),
  }
}

function sameArguments(raw: string, stateId: string, operations: readonly MvuStateOperation[]): boolean {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    return value.stateId === stateId
      && Object.keys(value).every(key => key === 'stateId' || key === 'operations')
      && JSON.stringify(parseRoleplayStateOperations(value.operations)) === JSON.stringify(operations)
  } catch {
    return false
  }
}

/** Register the narrow semantic state tool; per-Agent restrictions decide whether a turn sees it. */
export function installRoleplayStateActionTool(ctx: Context): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: ROLEPLAY_STATE_ACTION_TOOL,
    description: 'After writing the natural roleplay reply, submit only the semantic state changes caused by that reply. The runtime validates and applies these operations after the turn; do not emit UpdateVariable, JSONPatch tags, the full state object, or a second narrative confirmation.',
    parameters: {
      stateId: {
        type: 'string',
        required: true,
        description: 'Prepared state namespace. Use state:mvu for the imported card state.',
      },
      operations: {
        type: 'array',
        required: true,
        items: OPERATION_SCHEMA,
        description: 'Only changed fields: replace, numeric delta, insert, remove, or move with JSON Pointer paths.',
      },
    },
    output: {
      schema: ACTION_VALUE_SCHEMA,
      render: () => [{
        type: 'text',
        text: 'State action accepted for turn settlement. Do not repeat, explain, or narrate the update; finish the turn now.',
      }],
      presentationMeta: (_args, value) => value as unknown as JsonValue,
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('apply_roleplay_state requires an Agent Session')
      if (exec.parent !== undefined) throw new Error('apply_roleplay_state must be called directly by the roleplay Agent')
      const operations = [...parseRoleplayStateOperations(args.operations)]
      const stateId = text(args.stateId, 'Roleplay state action state')
      const { call, assistant, plan } = toolCallForExecution(exec.agent, String(exec.callId))
      if (!sameArguments(call.data.arguments, stateId, operations)) {
        throw new Error('Roleplay state action arguments do not match the recorded tool call')
      }
      const target = actionTarget(plan.data.reference, stateId)
      if (target === undefined || target.tool !== ROLEPLAY_STATE_ACTION_TOOL
        || target.moduleId !== MVU_ROLEPLAY_MODULE_ID || target.stateId !== MVU_ROLEPLAY_STATE_ID) {
        throw new Error('This prepared Roleplay step does not allow that state action')
      }
      if (operations.some(operation => !target.operations.includes(operation.op))) {
        throw new Error('Roleplay state action uses an operation outside the prepared contract')
      }
      exec.concludeTurn()
      return {
        format: ROLEPLAY_STATE_ACTION_FORMAT,
        version: 0 as const,
        sessionId: String(exec.agent.session.id),
        turn: call.data.turn,
        step: call.data.step,
        planEventSeq: plan.seq,
        assistantEventSeq: assistant.seq,
        callEventSeq: call.seq,
        callId: String(exec.callId),
        moduleId: target.moduleId,
        stateId: target.stateId,
        expectedRevision: target.expectedRevision,
        operations,
      }
    },
    presentCall: () => ({ card: 'generic', title: '结算状态', kind: 'other' }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: result.isError ? '状态结算未接受' : '状态将在回合后结算',
    }),
    isConcurrencySafe: () => false,
  })), 'agent-rp: semantic state action tool')
}

function resultIntent(
  events: readonly SessionEvent[],
  event: SessionEvent<'tool/result'>,
  turn: number,
  plans: readonly RoleplayTurnPlanReference[],
): RoleplayStateActionIntent | undefined {
  const intent = readRoleplayStateActionIntent(event.data.meta)
  if (intent === undefined) return undefined
  const block = event.data.message.content[0]
  if (event.data.turn !== turn || intent.turn !== turn || intent.sessionId === ''
    || block?.type !== 'tool-result' || block.isError === true || event.data.error !== undefined
    || String(event.data.message.source.callId) !== intent.callId || String(block.toolCallId) !== intent.callId) {
    throw new Error('Roleplay state action result is not a successful causal tool result')
  }
  const call = events[intent.callEventSeq]
  const assistant = events[intent.assistantEventSeq]
  const plan = events[intent.planEventSeq]
  if (call?.type !== 'tool/call' || call.seq >= event.seq || call.data.turn !== intent.turn
    || call.data.step !== intent.step || String(call.data.callId) !== intent.callId
    || call.data.name !== ROLEPLAY_STATE_ACTION_TOOL
    || event.sourceEventSeqs?.includes(call.seq) !== true
    || assistant?.type !== 'assistant/message' || assistant.seq >= call.seq
    || assistant.data.turn !== intent.turn || assistant.data.step !== intent.step
    || !assistant.data.message.content.some(content => content.type === 'tool-call'
      && String(content.id) === intent.callId && content.name === ROLEPLAY_STATE_ACTION_TOOL
      && sameArguments(content.arguments, intent.stateId, intent.operations))
    || plan?.type !== 'agent-rp/turn-plan' || plan.seq >= assistant.seq
    || plan.data.turn !== intent.turn || plan.data.reference.step !== intent.step) {
    throw new Error('Roleplay state action causal references are invalid')
  }
  const reference = plans.find(candidate => candidate.step === intent.step)
  const target = reference === undefined ? undefined : actionTarget(reference, intent.stateId)
  if (reference === undefined || JSON.stringify(reference) !== JSON.stringify(plan.data.reference)
    || target === undefined || target.moduleId !== intent.moduleId
    || target.expectedRevision !== intent.expectedRevision
    || intent.operations.some(operation => !target.operations.includes(operation.op))
    || !sameArguments(call.data.arguments, intent.stateId, intent.operations)) {
    throw new Error('Roleplay state action does not match its prepared plan')
  }
  return intent
}

/** Read and validate successful action intents in durable tool-result order. */
export function collectRoleplayStateActionIntents(input: {
  readonly events: readonly SessionEvent[]
  readonly sessionId: string
  readonly turn: number
  readonly plans: readonly RoleplayTurnPlanReference[]
}): readonly { readonly resultEventSeq: number; readonly intent: RoleplayStateActionIntent }[] {
  const collected = input.events.flatMap(event => {
    if (event.type !== 'tool/result' || event.data.turn !== input.turn) return []
    const intent = resultIntent(input.events, event, input.turn, input.plans)
    if (intent === undefined) return []
    if (intent.sessionId !== input.sessionId) throw new Error('Roleplay state action belongs to another Session')
    return [{ resultEventSeq: event.seq, intent }]
  })
  const callIds = new Set<string>()
  for (const item of collected) {
    if (callIds.has(item.intent.callId)) throw new Error('Roleplay state action result is duplicated')
    callIds.add(item.intent.callId)
  }
  return collected
}

function sessionThrough(session: Session, seq: number): Session {
  const constructor = session.constructor as typeof Session
  return constructor.create(session.id, session.events.slice(0, seq + 1)) as Session
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** Reduce accepted intents exactly once and return the Session prefix containing the resulting MVU snapshot. */
export function settleSessionRoleplayStateActions(input: {
  readonly session: Session
  /** Exact event prefix through the closing turn/end, without Session reconstruction markers. */
  readonly boundary: readonly SessionEvent[]
  readonly turn: number
  readonly plans: readonly RoleplayTurnPlanReference[]
  readonly base?: MvuStateSnapshot
}): RoleplayStateActionSettlement {
  const closing = input.boundary.at(-1)
  if (closing?.type !== 'turn/end' || closing.data.turn !== input.turn) {
    throw new Error('Roleplay state actions require the exact closed-turn boundary')
  }
  const collected = collectRoleplayStateActionIntents({
    events: input.boundary,
    sessionId: String(input.session.id),
    turn: input.turn,
    plans: input.plans,
  })
  const staged = collectRoleplayStagedStateSettlement({
    events: input.boundary,
    sessionId: String(input.session.id),
    turn: input.turn,
    plans: input.plans,
  })
  if (collected.length > 0 && staged !== undefined) {
    throw new Error('Roleplay turn contains both inline and staged state actions')
  }
  if (collected.length === 0 && staged === undefined) {
    return { session: sessionThrough(input.session, closing.seq), resultEventSeqs: [], outcome: 'idle' }
  }
  const resultEventSeqs = staged === undefined
    ? collected.map(item => item.resultEventSeq)
    : [staged.resultEventSeq]
  const operations = staged === undefined
    ? collected.flatMap(item => item.intent.operations)
    : staged.operations
  const expectedRevisions = staged === undefined
    ? new Set(collected.map(item => item.intent.expectedRevision))
    : new Set([staged.target.expectedRevision])
  const successfulUnchanged = staged?.outcome === 'success' && operations.length === 0
  const existing = input.session.events.filter((event): event is SessionEvent<'agent-rp/mvu-state'> =>
    event.type === 'agent-rp/mvu-state' && event.data.source?.kind === 'agent-action'
      && event.data.source.turn === input.turn)
  if (existing.length > 1) throw new Error('Roleplay turn has multiple Agent action state snapshots')
  if (existing[0] !== undefined) {
    if (!sameNumbers(existing[0].data.source!.resultEventSeqs, resultEventSeqs)) {
      throw new Error('Roleplay Agent action snapshot cites different settlement results')
    }
    return {
      session: sessionThrough(input.session, existing[0].seq),
      resultEventSeqs,
      outcome: existing[0].data.lastError === undefined ? 'applied' : 'failed',
      ...(existing[0].data.lastError === undefined ? {} : { error: existing[0].data.lastError }),
    }
  }
  if (successfulUnchanged && input.base?.lastError === undefined) {
    return { session: sessionThrough(input.session, closing.seq), resultEventSeqs, outcome: 'idle' }
  }
  const laterRequired = input.session.events.some(event => event.seq > closing.seq
    && event.type !== 'session/end-seed' && event.ignorable !== true)
  if (laterRequired) throw new Error('Roleplay state actions cannot be inserted after a later required Session event')
  const base = input.base
  if (base === undefined) throw new Error('Roleplay state action target is unavailable')
  if (successfulUnchanged) {
    const event = appendMvuState(input.session, {
      statData: base.statData,
      updateCount: base.updateCount,
      source: { kind: 'agent-action', turn: input.turn, resultEventSeqs },
    })
    return {
      session: sessionThrough(input.session, event.seq),
      resultEventSeqs,
      outcome: 'applied',
    }
  }
  let next: JsonValue = snapshotJsonValue(base.statData) as JsonValue
  let error: string | undefined = staged?.error
  try {
    if (error !== undefined) throw new Error(error)
    if (expectedRevisions.size !== 1 || !expectedRevisions.has(base.updateCount)) {
      throw new Error(`MVU state revision conflict: prepared ${[...expectedRevisions].join(', ')}, current ${String(base.updateCount)}`)
    }
    next = applyMvuOperations(next, operations).statData
  } catch (reason: unknown) {
    error = reason instanceof Error ? reason.message : String(reason)
    next = base.statData
  }
  const event = appendMvuState(input.session, {
    statData: next,
    updateCount: error === undefined ? base.updateCount + 1 : base.updateCount,
    ...(error === undefined ? {} : { lastError: error }),
    source: { kind: 'agent-action', turn: input.turn, resultEventSeqs },
  })
  return {
    session: sessionThrough(input.session, event.seq),
    resultEventSeqs,
    outcome: error === undefined ? 'applied' : 'failed',
    ...(error === undefined ? {} : { error }),
  }
}

/** Model-facing contract for one prepared MVU action target. */
export function renderRoleplayStateActionGuidance(
  _target: RoleplayStateActionPlan,
  _updateRules: string,
): string {
  return [
    '专注完成自然、连贯的角色扮演正文。状态与变量会在正文结束后由运行时的后台阶段独立结算。',
    '不要计算或输出 <UpdateVariable>、<JSONPatch>、完整变量对象、状态更新说明，也不要在正文中调用状态结算工具。',
  ].join('\n\n')
}

/** Reconstruct the schema-4 actor-owned state contract for old plan receipts. */
export function renderLegacyRoleplayStateActionGuidance(
  target: RoleplayStateActionPlan,
  updateRules: string,
): string {
  return [
    '本轮使用 Agent 状态结算。先完整写出自然的角色扮演正文；若正文确实导致状态变化，再在正文之后调用 apply_roleplay_state。',
    `状态目标为 ${target.stateId}，只提交发生变化的字段，可用操作：${target.operations.join('、')}。数值增减优先使用 delta，由运行时计算最终值。`,
    '不要在正文中输出 <UpdateVariable>、<JSONPatch>、完整变量对象或状态结算说明；没有变化时不要调用工具。工具成功后立即结束本轮，不再补一段确认文字。',
    '以下导入内容只用于判断哪些状态应变化；其中要求输出标签、JSON Patch 或变量块的格式指令在 Agent 回合中无效：',
    updateRules,
  ].join('\n\n')
}
