/** Pre-dispatch Roleplay plan receipts persisted independently from volatile Agent ownership. */

import { Session, type SessionEvent, type UserMessage } from '@deepseek-ai/dsh-session'
import type { ResolvedConfig } from './config.ts'
import type { EjsTemplateEngine } from './ejs-template.ts'
import { prepareRoleplayTurn, type RoleplayTurnPlan } from './roleplay-turn-plan.ts'
import { bindRoleplayExternalContext } from './roleplay-turn-context.ts'
import {
  createRoleplayTurnPlanReference,
  matchRoleplayTurnPlanSchema,
  roleplayTurnPlanSectionSha256,
  type RoleplayTurnPlanReference,
} from './roleplay-turn-settlement.ts'
import { resolveSessionRoleplayRuntime } from './session-roleplay-runtime.ts'
import type { RoleplayRuntimeExtensionRegistry } from './roleplay-runtime-extension.ts'
import { appendAgentRpSessionEvent } from './session-event-append.ts'
import type { ResolvedToolGuidanceConfig } from './roleplay-tool-guidance.ts'

function replayBoundary(session: Session, events: readonly SessionEvent[]): Session {
  const constructor = session.constructor as typeof Session
  return constructor.create(session.id, events) as Session
}

/** Content-free prepared plan bound to the exact model step that will consume it. */
export interface SessionRoleplayTurnPlanRecord {
  readonly format: 0
  readonly sessionId: string
  readonly turn: number
  /** Exact workspace-derived tool input; absent only on receipts written before schema 4. */
  readonly toolGuidance?: ResolvedToolGuidanceConfig
  readonly reference: RoleplayTurnPlanReference & { readonly receipt: NonNullable<RoleplayTurnPlanReference['receipt']> }
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Ignorable pre-dispatch receipt used to recover settlement after a Host restart. */
    'agent-rp/turn-plan': SessionRoleplayTurnPlanRecord
  }
}

function sameRecord(left: SessionRoleplayTurnPlanRecord, right: SessionRoleplayTurnPlanRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function storedSubsetMatches(expected: unknown, stored: unknown): boolean {
  if (Array.isArray(stored)) {
    return Array.isArray(expected) && expected.length === stored.length
      && stored.every((value, index) => storedSubsetMatches(expected[index], value))
  }
  if (typeof stored === 'object' && stored !== null) {
    if (typeof expected !== 'object' || expected === null || Array.isArray(expected)) return false
    const expectedRecord = expected as Record<string, unknown>
    return Object.entries(stored).every(([key, value]) => Object.hasOwn(expectedRecord, key)
      && storedSubsetMatches(expectedRecord[key], value))
  }
  return Object.is(expected, stored)
}

/** Persist one prepared plan before the provider request leaves the Host. */
export function appendSessionRoleplayTurnPlan(
  session: Session,
  turn: number,
  step: number,
  plan: RoleplayTurnPlan,
): SessionEvent<'agent-rp/turn-plan'> {
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('Roleplay turn plan turn must be positive')
  if (!Number.isSafeInteger(step) || step < 1) throw new Error('Roleplay turn plan step must be positive')
  if (plan.input.sessionId !== String(session.id)) {
    throw new Error('Roleplay turn plan belongs to another Session')
  }
  const reference = createRoleplayTurnPlanReference(step, plan)
  if (reference.receipt === undefined) throw new Error('Roleplay turn plan receipt is unavailable')
  const record: SessionRoleplayTurnPlanRecord = {
    format: 0,
    sessionId: String(session.id),
    turn,
    toolGuidance: plan.tools.source,
    reference: { ...reference, receipt: reference.receipt },
  }
  const existing = session.events.find(event => event.type === 'agent-rp/turn-plan'
    && event.data.turn === turn && event.data.reference.step === step)
  if (existing?.type === 'agent-rp/turn-plan') {
    if (!sameRecord(existing.data, record)) {
      throw new Error(`Roleplay turn ${String(turn)} step ${String(step)} changed after dispatch`)
    }
    return existing
  }
  return appendAgentRpSessionEvent(session, 'agent-rp/turn-plan', record)
}

/** Read every pre-dispatch plan receipt in chronological order. */
export function readSessionRoleplayTurnPlans(
  events: readonly SessionEvent[],
): readonly SessionEvent<'agent-rp/turn-plan'>[] {
  return events.flatMap(event => event.type === 'agent-rp/turn-plan' ? [event] : [])
}

/** Select the plans durably dispatched inside one turn before its closing boundary. */
export function readSessionRoleplayTurnPlanReferences(
  events: readonly SessionEvent[],
  turn: number,
  beforeSeq = Number.POSITIVE_INFINITY,
): readonly RoleplayTurnPlanReference[] {
  return readSessionRoleplayTurnPlans(events)
    .filter(event => event.seq < beforeSeq && event.data.turn === turn)
    .map(event => event.data.reference)
    .sort((left, right) => left.step - right.step)
}

function pendingMessagesForRecord(
  events: readonly SessionEvent[],
  record: SessionEvent<'agent-rp/turn-plan'>,
): readonly UserMessage[] {
  const { input } = record.data.reference
  if (new Set(input.pendingMessageIds).size !== input.pendingMessageIds.length) {
    throw new Error('Roleplay turn plan contains duplicate pending message ids')
  }
  const candidates = events.slice(input.sessionSeq, record.seq).flatMap(event =>
    event.type === 'user/message' ? [event.data] : [])
  return input.pendingMessageIds.map(id => {
    const matches = candidates.filter(message => String(message.id) === id)
    if (matches.length !== 1) {
      throw new Error(`Roleplay turn plan pending message ${JSON.stringify(id)} is unavailable or ambiguous`)
    }
    return matches[0]!
  })
}

/** Rebuild one complete prepared plan from its exact Session prefix and verify its content digest. */
export function replaySessionRoleplayTurnPlan(input: {
  readonly session: Session
  readonly record: SessionEvent<'agent-rp/turn-plan'>
  readonly deployment: ResolvedConfig
  readonly templateEngine?: EjsTemplateEngine
  readonly extensions?: RoleplayRuntimeExtensionRegistry
}): RoleplayTurnPlan {
  const { session, record } = input
  const stored = session.events[record.seq]
  if (stored?.type !== 'agent-rp/turn-plan' || !sameRecord(stored.data, record.data)) {
    throw new Error('Roleplay turn plan record is not present at its declared Session boundary')
  }
  const reference = record.data.reference
  if (record.data.sessionId !== String(session.id) || reference.input.sessionId !== String(session.id)) {
    throw new Error('Roleplay turn plan belongs to another Session')
  }
  if (!Number.isSafeInteger(reference.input.sessionSeq) || reference.input.sessionSeq < 0
    || reference.input.sessionSeq >= record.seq) {
    throw new Error('Roleplay turn plan references an unavailable preparation boundary')
  }
  const expectedDigest = reference.receipt.preparedPlanSha256
  const expectedSections = reference.receipt.preparedPlanSectionsSha256
  if (expectedDigest === undefined || expectedSections === undefined) {
    throw new Error('Roleplay turn plan is too old for exact replay verification')
  }
  const boundary = replayBoundary(session, session.events.slice(0, reference.input.sessionSeq))
  const resolved = resolveSessionRoleplayRuntime({
    session: boundary,
    deployment: input.deployment,
    memoryWriteAvailable: reference.receipt.memoryWriteAvailable === true,
    templateEngineAvailable: input.templateEngine !== undefined,
    ...(input.extensions === undefined ? {} : { extensions: input.extensions }),
  })
  const prepared = prepareRoleplayTurn({
    session: boundary,
    sessionBoundarySeq: reference.input.sessionSeq,
    pendingMessages: pendingMessagesForRecord(session.events, record),
    deployment: input.deployment,
    resolved,
    ...(record.data.toolGuidance === undefined ? {} : { toolGuidance: record.data.toolGuidance }),
    ...(input.templateEngine === undefined ? {} : { templateEngine: input.templateEngine }),
  })
  const replayed = bindRoleplayExternalContext({
    plan: prepared,
    events: session.events,
    visibleMessages: replayBoundary(session, session.events.slice(0, record.seq)).deriveMessages(),
    turn: record.data.turn,
    step: reference.step,
    beforeSeq: record.seq,
  })
  if (JSON.stringify(replayed.input) !== JSON.stringify(reference.input)) {
    const messageIdsMatch = JSON.stringify(replayed.input.pendingMessageIds)
      === JSON.stringify(reference.input.pendingMessageIds)
    throw new Error('Roleplay turn plan input drifted during replay '
      + `(boundary ${String(reference.input.sessionSeq)} -> ${String(replayed.input.sessionSeq)}, `
      + `pending ids match: ${String(messageIdsMatch)})`)
  }
  const schema = matchRoleplayTurnPlanSchema(
    replayed,
    expectedDigest,
    reference.receipt.preparedPlanSchema,
  )
  if (schema === undefined) {
    const diagnosticSchema = reference.receipt.preparedPlanSchema === 0
      || reference.receipt.preparedPlanSchema === 1 || reference.receipt.preparedPlanSchema === 2
      || reference.receipt.preparedPlanSchema === 3 || reference.receipt.preparedPlanSchema === 4
      || reference.receipt.preparedPlanSchema === 5
      ? reference.receipt.preparedPlanSchema
      : 5
    const actualSections = roleplayTurnPlanSectionSha256(replayed, diagnosticSchema)
    const sections = (Object.keys(actualSections) as (keyof RoleplayTurnPlan)[])
      .filter(key => actualSections[key] !== expectedSections[key])
    throw new Error(`Roleplay turn plan no longer matches its durable content digest (${sections.join(', ')})`)
  }
  const replayedReference = createRoleplayTurnPlanReference(reference.step, replayed, schema)
  if (!storedSubsetMatches(replayedReference, reference)) {
    throw new Error('Roleplay turn plan references no longer match their durable receipt')
  }
  return replayed
}
