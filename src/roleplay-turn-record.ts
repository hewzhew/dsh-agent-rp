/** Pure Session-log projection that joins every phase of one Roleplay turn. */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  ROLEPLAY_TURN_PHASES,
} from './roleplay-runtime.ts'
import type {
  RoleplayExternalContextRead,
  RoleplayPrepareModuleOutcome,
  RoleplayRecallModuleOutcome,
  RoleplayTurnInputKey,
} from './roleplay-turn-plan.ts'
import {
  normalizeRoleplayTurnPresentation,
} from './roleplay-turn-presentation-state.ts'
import type {
  RoleplayTurnPresentation,
} from './roleplay-turn-presentation-types.ts'
import {
  compileRoleplayActReceipt,
  type RoleplayTurnPlanReference,
  type RoleplayTurnSettlement,
} from './roleplay-turn-settlement.ts'
import { readToolArtifactPresentationMeta } from './roleplay-artifact.ts'
import { sessionEvents } from './session-events.ts'

/** Durable pre-dispatch reference associated with its exact Session event when available. */
export interface RoleplayTurnPlanEvidence {
  readonly step: number
  readonly eventSeq?: number
  readonly reference: RoleplayTurnPlanReference
}

/** Prepare-phase outcome for one model step. */
export interface RoleplayTurnPrepareStepRecord {
  readonly step: number
  readonly eventSeq?: number
  readonly input: RoleplayTurnInputKey
  readonly modules?: readonly RoleplayPrepareModuleOutcome[]
}

/** Recall-phase outcome for one model step. */
export interface RoleplayTurnRecallStepRecord {
  readonly step: number
  readonly eventSeq?: number
  readonly modules?: readonly RoleplayRecallModuleOutcome[]
  readonly contextReads?: readonly RoleplayExternalContextRead[]
}

/** Settle-phase evidence joined to the Session event that persisted it. */
export interface RoleplayTurnSettleRecord {
  readonly eventSeq: number
  readonly result: string
  readonly reply?: RoleplayTurnSettlement['reply']
  readonly state: RoleplayTurnSettlement['state']
  readonly memory: RoleplayTurnSettlement['memory']
  readonly modules: RoleplayTurnSettlement['settle']['modules']
}

/** Latest present-phase snapshot causally attached to this settlement. */
export interface RoleplayTurnPresentRecord {
  readonly eventSeq: number
  readonly trigger: RoleplayTurnPresentation['trigger']
  readonly current: boolean
  readonly selectedReply?: RoleplayTurnPresentation['selectedReply']
  readonly state: RoleplayTurnPresentation['state']
  readonly version?: RoleplayTurnPresentation['version']
  readonly modules: RoleplayTurnPresentation['present']['modules']
  readonly artifacts?: RoleplayTurnPresentation['present']['artifacts']
}

/**
 * Source-neutral five-phase view derived from existing Session events.
 * It is never persisted, so model-visible prose and tool payloads remain single-copy.
 */
export interface RoleplayTurnRecord {
  readonly format: 0
  readonly sessionId: string
  readonly turn: number
  readonly lifecycle: typeof ROLEPLAY_TURN_PHASES
  readonly boundary: {
    readonly startSeq?: number
    readonly endSeq?: number
    readonly result?: string
  }
  readonly plans: readonly RoleplayTurnPlanEvidence[]
  readonly prepare: {
    readonly steps: readonly RoleplayTurnPrepareStepRecord[]
  }
  readonly recall: {
    readonly steps: readonly RoleplayTurnRecallStepRecord[]
  }
  readonly act?: NonNullable<RoleplayTurnSettlement['act']>
  readonly settle?: RoleplayTurnSettleRecord
  readonly present?: RoleplayTurnPresentRecord
}

type TurnPlanEvent = SessionEvent<'agent-rp/turn-plan'>
type TurnSettlementEvent = SessionEvent<'agent-rp/turn-settlement'>
type TurnPresentationEvent = SessionEvent<'agent-rp/turn-presentation'>

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function normalizePersistedActReceipt(
  act: NonNullable<RoleplayTurnSettlement['act']>,
): NonNullable<RoleplayTurnSettlement['act']> {
  return {
    steps: act.steps.map(step => ({
      step: step.step,
      assistantMessages: step.assistantMessages,
      modelCalls: step.modelCalls ?? [],
      toolCalls: step.toolCalls,
      toolResults: step.toolResults,
    })),
  }
}

function eventMap(events: readonly SessionEvent[]): ReadonlyMap<number, SessionEvent> {
  const result = new Map<number, SessionEvent>()
  for (const [index, event] of events.entries()) {
    if (event.seq !== index) {
      throw new Error(`Roleplay turn records require contiguous Session seqs (expected ${String(index)})`)
    }
    if (result.has(event.seq)) throw new Error(`Roleplay turn records found duplicate Session seq ${String(event.seq)}`)
    result.set(event.seq, event)
  }
  return result
}

function appendGrouped<T>(groups: Map<number, T[]>, turn: number, value: T): void {
  const group = groups.get(turn)
  if (group === undefined) groups.set(turn, [value])
  else group.push(value)
}

function exactlyOneBoundary<T extends SessionEvent<'turn/start' | 'turn/end'>>(
  events: readonly T[],
  turn: number,
  kind: T['type'],
): T | undefined {
  if (events.length > 1) throw new Error(`Roleplay turn ${String(turn)} has duplicate ${kind} boundaries`)
  return events[0]
}

function validatePlanReference(
  reference: RoleplayTurnPlanReference,
  sessionId: string,
): void {
  if (!Number.isSafeInteger(reference.step) || reference.step < 1) {
    throw new Error('Roleplay turn record contains an invalid plan step')
  }
  if (reference.input.sessionId !== sessionId) {
    throw new Error('Roleplay turn record contains a plan from another Session')
  }
  if (!Number.isSafeInteger(reference.input.sessionSeq) || reference.input.sessionSeq < 0) {
    throw new Error('Roleplay turn record contains an invalid preparation boundary')
  }
}

function validateExternalContextReads(
  reference: RoleplayTurnPlanReference,
  eventsBySeq: ReadonlyMap<number, SessionEvent>,
  beforeSeq: number,
): void {
  const reads = reference.receipt?.recall?.contextReads ?? []
  if (new Set(reads.map(read => read.eventSeq)).size !== reads.length
    || new Set(reads.map(read => read.messageId)).size !== reads.length) {
    throw new Error('Roleplay turn record contains duplicate external context references')
  }
  for (const read of reads) {
    const event = eventsBySeq.get(read.eventSeq)
    if (event?.type !== 'user/message' || event.data.source.kind !== 'plugin'
      || String(event.data.id) !== read.messageId
      || event.seq >= beforeSeq) {
      throw new Error('Roleplay turn record references unavailable external plugin context')
    }
  }
}

function planEvidence(input: {
  readonly sessionId: string
  readonly turn: number
  readonly planEvents: readonly TurnPlanEvent[]
  readonly settlement?: TurnSettlementEvent
  readonly start?: SessionEvent<'turn/start'>
  readonly end?: SessionEvent<'turn/end'>
  readonly eventsBySeq: ReadonlyMap<number, SessionEvent>
}): readonly RoleplayTurnPlanEvidence[] {
  const eventEvidence = [...input.planEvents].sort((left, right) =>
    left.data.reference.step - right.data.reference.step).map((event): RoleplayTurnPlanEvidence => {
    if (event.data.format !== 0 || event.data.sessionId !== input.sessionId) {
      throw new Error('Roleplay turn plan record belongs to another Session or format')
    }
    validatePlanReference(event.data.reference, input.sessionId)
    validateExternalContextReads(event.data.reference, input.eventsBySeq, event.seq)
    if (input.start !== undefined && event.seq <= input.start.seq) {
      throw new Error('Roleplay turn plan precedes its turn boundary')
    }
    if (input.end !== undefined && event.seq >= input.end.seq) {
      throw new Error('Roleplay turn plan follows its closing boundary')
    }
    if (event.data.reference.input.sessionSeq >= event.seq) {
      throw new Error('Roleplay turn plan preparation boundary does not precede its receipt')
    }
    return { step: event.data.reference.step, eventSeq: event.seq, reference: event.data.reference }
  })
  if (new Set(eventEvidence.map(value => value.step)).size !== eventEvidence.length) {
    throw new Error(`Roleplay turn ${String(input.turn)} contains duplicate plan steps`)
  }

  const settledReferences = input.settlement?.data.plans ?? []
  for (const reference of settledReferences) {
    validatePlanReference(reference, input.sessionId)
    validateExternalContextReads(reference, input.eventsBySeq, input.settlement?.seq ?? Number.POSITIVE_INFINITY)
  }
  if (new Set(settledReferences.map(value => value.step)).size !== settledReferences.length) {
    throw new Error(`Roleplay turn ${String(input.turn)} settlement contains duplicate plan steps`)
  }
  const sortedSettled = [...settledReferences].sort((left, right) => left.step - right.step)
  if (eventEvidence.length > 0 && sortedSettled.length > 0
    && !sameJson(eventEvidence.map(value => value.reference), sortedSettled)) {
    throw new Error(`Roleplay turn ${String(input.turn)} plan receipts drifted before settlement`)
  }
  return eventEvidence.length > 0
    ? eventEvidence
    : sortedSettled.map(reference => ({ step: reference.step, reference }))
}

function validatePresentation(input: {
  readonly sessionId: string
  readonly settlement: TurnSettlementEvent
  readonly event: TurnPresentationEvent
  readonly eventsBySeq: ReadonlyMap<number, SessionEvent>
}): RoleplayTurnPresentation {
  const presentation = normalizeRoleplayTurnPresentation(input.event.data)
  if (presentation.format !== 0 || presentation.sessionId !== input.sessionId
    || presentation.turn !== input.settlement.data.turn
    || presentation.settlementSeq !== input.settlement.seq) {
    throw new Error('Roleplay presentation does not match its settlement')
  }
  if (input.event.seq <= input.settlement.seq) {
    throw new Error('Roleplay presentation precedes its settlement')
  }
  const trigger = input.eventsBySeq.get(presentation.trigger.eventSeq)
  if (trigger === undefined || trigger.seq >= input.event.seq) {
    throw new Error('Roleplay presentation trigger is unavailable at its boundary')
  }
  if (presentation.trigger.kind === 'settlement' && trigger.seq !== input.settlement.seq) {
    throw new Error('Roleplay settlement presentation references another trigger')
  }
  const selected = presentation.selectedReply
  if (selected !== undefined) {
    const source = input.eventsBySeq.get(selected.sourceSeq)
    const surface = input.eventsBySeq.get(selected.surfaceSeq)
    if (source?.type !== 'assistant/message' || surface?.type !== 'assistant/message'
      || source.seq >= input.event.seq || surface.seq >= input.event.seq
      || String(surface.data.message.id) !== selected.messageId) {
      throw new Error('Roleplay presentation references an invalid selected reply')
    }
  }
  for (const state of presentation.state) {
    if (state.eventSeq === undefined) continue
    const event = input.eventsBySeq.get(state.eventSeq)
    if (event === undefined || event.seq >= input.event.seq) {
      throw new Error(`Roleplay presentation state ${state.id} references an unavailable event`)
    }
  }
  for (const artifact of presentation.present.artifacts ?? []) {
    const source = input.eventsBySeq.get(artifact.sourceResultSeq)
    const sourceArtifacts = source?.type === 'tool/result'
      ? readToolArtifactPresentationMeta(source.data.meta)?.artifacts
      : undefined
    if (source?.type !== 'tool/result' || source.seq >= input.event.seq
      || !sourceArtifacts?.some(candidate =>
        String(candidate.attachment.attachmentId) === artifact.artifactId)) {
      throw new Error(`Roleplay presentation artifact ${artifact.artifactId} references an unavailable result`)
    }
  }
  return presentation
}

function selectedTurn(turns: ReadonlySet<number> | undefined, turn: number): boolean {
  return turns === undefined || turns.has(turn)
}

function readSelectedRoleplayTurnRecords(
  session: Pick<Session, 'id' | 'snapshotEvents'>,
  selectedTurns?: ReadonlySet<number>,
): readonly RoleplayTurnRecord[] {
  const sessionId = String(session.id)
  const events = sessionEvents(session)
  const eventsBySeq = eventMap(events)
  const starts = new Map<number, SessionEvent<'turn/start'>[]>()
  const ends = new Map<number, SessionEvent<'turn/end'>[]>()
  const plans = new Map<number, TurnPlanEvent[]>()
  const settlements = new Map<number, TurnSettlementEvent[]>()
  const presentations: TurnPresentationEvent[] = []
  for (const event of events) {
    if (event.type === 'turn/start' && selectedTurn(selectedTurns, event.data.turn)) {
      appendGrouped(starts, event.data.turn, event)
    } else if (event.type === 'turn/end' && selectedTurn(selectedTurns, event.data.turn)) {
      appendGrouped(ends, event.data.turn, event)
    } else if (event.type === 'agent-rp/turn-plan' && selectedTurn(selectedTurns, event.data.turn)) {
      appendGrouped(plans, event.data.turn, event)
    } else if (event.type === 'agent-rp/turn-settlement' && selectedTurn(selectedTurns, event.data.turn)) {
      appendGrouped(settlements, event.data.turn, event)
    } else if (event.type === 'agent-rp/turn-presentation' && selectedTurn(selectedTurns, event.data.turn)) {
      presentations.push(event)
    }
  }
  const evidenceTurns = new Set([...plans.keys(), ...settlements.keys()])
  for (const turn of starts.keys()) {
    if ((ends.get(turn)?.length ?? 0) === 0) evidenceTurns.add(turn)
  }
  const presentationBySettlement = new Map<number, TurnPresentationEvent[]>()
  for (const event of presentations) {
    const settlement = eventsBySeq.get(event.data.settlementSeq)
    if (settlement?.type !== 'agent-rp/turn-settlement') {
      throw new Error('Roleplay presentation references a missing settlement event')
    }
    if (settlement.data.turn !== event.data.turn) {
      throw new Error('Roleplay presentation references a settlement from another turn')
    }
    appendGrouped(presentationBySettlement, settlement.seq, event)
    evidenceTurns.add(settlement.data.turn)
  }

  return [...evidenceTurns].sort((left, right) => left - right).map((turn): RoleplayTurnRecord => {
    const start = exactlyOneBoundary(starts.get(turn) ?? [], turn, 'turn/start')
    const end = exactlyOneBoundary(ends.get(turn) ?? [], turn, 'turn/end')
    if (start === undefined && end !== undefined) {
      throw new Error(`Roleplay turn ${String(turn)} closes without a starting boundary`)
    }
    if (start !== undefined && end !== undefined && start.seq >= end.seq) {
      throw new Error(`Roleplay turn ${String(turn)} has an inverted Session boundary`)
    }
    const settlementEvents = settlements.get(turn) ?? []
    if (settlementEvents.length > 1) throw new Error(`Roleplay turn ${String(turn)} has duplicate settlements`)
    const settlement = settlementEvents[0]
    if (settlement !== undefined) {
      if (settlement.data.format !== 0 || settlement.data.sessionId !== sessionId
        || settlement.data.turn !== turn) {
        throw new Error('Roleplay settlement belongs to another Session, turn, or format')
      }
      if (end !== undefined && (settlement.seq <= end.seq || settlement.data.result !== end.data.reason.kind)) {
        throw new Error('Roleplay settlement does not match its closing boundary')
      }
      if (start !== undefined && end === undefined) {
        throw new Error('Roleplay settlement belongs to a turn that is still open')
      }
    }
    const planValues = planEvidence({
      sessionId,
      turn,
      planEvents: plans.get(turn) ?? [],
      ...(settlement === undefined ? {} : { settlement }),
      ...(start === undefined ? {} : { start }),
      ...(end === undefined ? {} : { end }),
      eventsBySeq,
    })
    const actEvents = start === undefined || end === undefined
      ? events
      : events.slice(start.seq, end.seq + 1)
    const act = settlement === undefined ? undefined : compileRoleplayActReceipt(
      actEvents,
      turn,
      settlement.data.result,
      settlement.data.plans,
    )
    if (settlement?.data.act !== undefined
      && !sameJson(normalizePersistedActReceipt(settlement.data.act), act)) {
      throw new Error(`Roleplay turn ${String(turn)} act receipt drifted from its Session events`)
    }
    const presentationEvents = settlement === undefined
      ? []
      : [...(presentationBySettlement.get(settlement.seq) ?? [])].sort((left, right) => left.seq - right.seq)
    const validatedPresentations = settlement === undefined ? [] : presentationEvents.map(event =>
      validatePresentation({ sessionId, settlement, event, eventsBySeq }))
    const latestPresentationEvent = presentationEvents.at(-1)
    const latestPresentation = validatedPresentations.at(-1)
    const settle = settlement === undefined ? undefined : {
      eventSeq: settlement.seq,
      result: settlement.data.result,
      ...(settlement.data.reply === undefined ? {} : { reply: settlement.data.reply }),
      state: settlement.data.state,
      memory: settlement.data.memory,
      modules: settlement.data.settle.modules,
    }
    const present = latestPresentation === undefined || latestPresentationEvent === undefined ? undefined : {
      eventSeq: latestPresentationEvent.seq,
      trigger: latestPresentation.trigger,
      current: latestPresentation.current,
      ...(latestPresentation.selectedReply === undefined
        ? {} : { selectedReply: latestPresentation.selectedReply }),
      state: latestPresentation.state,
      ...(latestPresentation.version === undefined ? {} : { version: latestPresentation.version }),
      modules: latestPresentation.present.modules,
      ...(latestPresentation.present.artifacts === undefined
        ? {}
        : { artifacts: latestPresentation.present.artifacts }),
    }
    return {
      format: 0,
      sessionId,
      turn,
      lifecycle: ROLEPLAY_TURN_PHASES,
      boundary: {
        ...(start === undefined ? {} : { startSeq: start.seq }),
        ...(end === undefined ? {} : { endSeq: end.seq, result: end.data.reason.kind }),
        ...(end === undefined && settlement !== undefined ? { result: settlement.data.result } : {}),
      },
      plans: planValues,
      prepare: {
        steps: planValues.map(value => ({
          step: value.step,
          ...(value.eventSeq === undefined ? {} : { eventSeq: value.eventSeq }),
          input: value.reference.input,
          ...(value.reference.receipt === undefined
            ? {} : { modules: value.reference.receipt.prepare.modules }),
        })),
      },
      recall: {
        steps: planValues.map(value => ({
          step: value.step,
          ...(value.eventSeq === undefined ? {} : { eventSeq: value.eventSeq }),
          ...(value.reference.receipt?.recall === undefined
            ? {} : {
              modules: value.reference.receipt.recall.modules,
              ...(value.reference.receipt.recall.contextReads === undefined ? {} : {
                contextReads: value.reference.receipt.recall.contextReads,
              }),
            }),
        })),
      },
      ...(act === undefined ? {} : { act }),
      ...(settle === undefined ? {} : { settle }),
      ...(present === undefined ? {} : { present }),
    }
  })
}

/** Derive every Roleplay turn from the canonical Session log and validate their causal joins. */
export function readRoleplayTurnRecords(
  session: Pick<Session, 'id' | 'snapshotEvents'>,
): readonly RoleplayTurnRecord[] {
  return readSelectedRoleplayTurnRecords(session)
}

/** Derive one requested Roleplay turn without validating unrelated historical turns. */
export function readRoleplayTurnRecord(
  session: Pick<Session, 'id' | 'snapshotEvents'>,
  turn: number,
): RoleplayTurnRecord | undefined {
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('Roleplay turn must be a positive integer')
  return readSelectedRoleplayTurnRecords(session, new Set([turn]))[0]
}

/** Latest turn carrying any durable Roleplay phase evidence. */
export function readLatestRoleplayTurnRecord(
  session: Pick<Session, 'id' | 'snapshotEvents'>,
): RoleplayTurnRecord | undefined {
  return readRoleplayTurnRecords(session).at(-1)
}
