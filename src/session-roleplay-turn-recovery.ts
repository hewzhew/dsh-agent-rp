/** Session-log finalization for Roleplay turns whose settlement or presentation is missing. */

import { Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ResolvedConfig } from './config.ts'
import {
  appendRoleplayTurnPresentation,
} from './roleplay-turn-presentation.ts'
import {
  appendRoleplayTurnSettlement,
  compileRoleplayTurnSettlementFromReferences,
} from './roleplay-turn-settlement.ts'
import { readRoleplayTurnRecord, readRoleplayTurnRecords } from './roleplay-turn-record.ts'
import { resolveSessionRoleplayRuntime } from './session-roleplay-runtime.ts'
import type { RoleplayRuntimeExtensionRegistry } from './roleplay-runtime-extension.ts'
import {
  compileInitialSessionRoleplayTurnPresentation,
} from './session-roleplay-turn-presentation.ts'
import {
  collectSessionRoleplaySettlementContributionsFromReferences,
} from './session-roleplay-turn-settlement.ts'
import { roleplayTurnRecordFinalizable } from './roleplay-turn-health.ts'
import { settleSessionRoleplayStateActions } from './roleplay-state-action.ts'
import { sessionEvents } from './session-events.ts'

/** Content-free count of records restored from pre-dispatch receipts. */
export interface SessionRoleplayTurnRecoveryResult {
  readonly settlements: number
  readonly presentations: number
  readonly turns: readonly number[]
}

/** Exact immutable Session prefix owned by one closing turn. */
export interface SessionRoleplayTurnBoundary {
  readonly session: Session
  readonly events: readonly SessionEvent[]
}

/** Detach the log through one concrete turn/end, excluding every later write. */
export function createSessionRoleplayTurnBoundary(
  session: Session,
  closing: SessionEvent<'turn/end'>,
): SessionRoleplayTurnBoundary {
  const prefix = sessionEvents(session).slice(0, closing.seq + 1)
  const last = prefix.at(-1)
  if (last?.type !== 'turn/end' || last.seq !== closing.seq
    || last.data.turn !== closing.data.turn) {
    throw new Error('Roleplay turn boundary is unavailable from this Session')
  }
  const boundary = Session.create(session.id, prefix)
  return { session: boundary, events: sessionEvents(boundary).slice(0, prefix.length) }
}

/**
 * Restore missing settlement/presentation records for closed turns on both hot completion and cold restart.
 * Old logs without pre-dispatch receipts remain readable and are deliberately skipped.
 */
export function recoverSessionRoleplayTurns(input: {
  readonly session: Session
  readonly deployment: ResolvedConfig
  readonly templateEngineAvailable?: boolean
  readonly turn?: number
  readonly extensions?: RoleplayRuntimeExtensionRegistry
}): SessionRoleplayTurnRecoveryResult {
  const records = input.turn === undefined
    ? readRoleplayTurnRecords(input.session)
    : [readRoleplayTurnRecord(input.session, input.turn)].filter(record => record !== undefined)
  const recoveredTurns: number[] = []
  let settlements = 0
  let presentations = 0
  for (const record of records) {
    if (record.boundary.endSeq === undefined) continue
    const closing = sessionEvents(input.session)[record.boundary.endSeq]
    if (closing?.type !== 'turn/end' || closing.data.turn !== record.turn) {
      throw new Error('Roleplay recovery record references a missing closing boundary')
    }
    const plans = record.plans.map(value => value.reference)
    if (!roleplayTurnRecordFinalizable(record)) continue
    let settlement = record.settle === undefined
      ? undefined
      : sessionEvents(input.session)[record.settle.eventSeq]
    if (settlement !== undefined && settlement.type !== 'agent-rp/turn-settlement') {
      throw new Error('Roleplay recovery record references a missing settlement')
    }
    if (settlement?.type !== 'agent-rp/turn-settlement') {
      const boundary = createSessionRoleplayTurnBoundary(input.session, closing)
      const memoryWriteAvailable = plans.some(plan => plan.receipt?.memoryWriteAvailable === true)
      const firstInputSeq = Math.min(...plans.map(plan => plan.input.sessionSeq))
      const base = Session.create(input.session.id, boundary.events.slice(0, firstInputSeq))
      const baseRuntime = resolveSessionRoleplayRuntime({
        session: base,
        deployment: input.deployment,
        memoryWriteAvailable,
        ...(input.templateEngineAvailable === undefined
          ? {} : { templateEngineAvailable: input.templateEngineAvailable }),
        ...(input.extensions === undefined ? {} : { extensions: input.extensions }),
      })
      const actionSettlement = settleSessionRoleplayStateActions({
        session: input.session,
        boundary: boundary.events,
        turn: closing.data.turn,
        plans,
        ...(baseRuntime.mvu === undefined ? {} : { base: baseRuntime.mvu }),
      })
      const resolved = resolveSessionRoleplayRuntime({
        session: actionSettlement.session,
        deployment: input.deployment,
        memoryWriteAvailable,
        ...(input.templateEngineAvailable === undefined
          ? {} : { templateEngineAvailable: input.templateEngineAvailable }),
        ...(input.extensions === undefined ? {} : { extensions: input.extensions }),
      })
      const value = compileRoleplayTurnSettlementFromReferences({
        sessionId: String(input.session.id),
        turn: closing.data.turn,
        result: closing.data.reason.kind,
        plans,
        events: boundary.events,
        after: resolved.snapshot,
        contributions: collectSessionRoleplaySettlementContributionsFromReferences({
          session: actionSettlement.session,
          turn: closing.data.turn,
          plans,
          ...(resolved.mvu === undefined ? {} : { mvu: resolved.mvu }),
        }),
      })
      settlement = appendRoleplayTurnSettlement(input.session, value)
      settlements += 1
      recoveredTurns.push(record.turn)
    }
    if (settlement.type === 'agent-rp/turn-settlement' && record.present === undefined) {
      appendRoleplayTurnPresentation(
        input.session,
        compileInitialSessionRoleplayTurnPresentation({
          session: input.session,
          settlementEvent: settlement,
        }),
      )
      presentations += 1
    }
  }
  return { settlements, presentations, turns: recoveredTurns }
}
