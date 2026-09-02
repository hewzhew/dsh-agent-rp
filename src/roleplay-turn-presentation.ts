/** Replayable selection of the visible reply and runtime state presented for one Roleplay turn. */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  BoundRoleplayTurnPlan,
  RoleplayTurnPlanReference,
} from './roleplay-turn-settlement.ts'
import { appendAgentRpSessionEvent } from './session-event-append.ts'
import {
  normalizeRoleplayTurnPresentation as importedNormalizePresentation,
} from './roleplay-turn-presentation-state.ts'
import type {
  RoleplayPresentedArtifact,
  RoleplayPresentedState,
  RoleplayPresentationContribution,
  RoleplayPresentModuleOutcome,
  RoleplayTurnPresentation,
} from './roleplay-turn-presentation-types.ts'
import { sessionEvents } from './session-events.ts'

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Informational Roleplay presentation; all selected state remains reconstructable without it. */
    'agent-rp/turn-presentation': RoleplayTurnPresentation
  }
}

export {
  normalizeRoleplayTurnPresentation,
  roleplayPresentedState,
} from './roleplay-turn-presentation-state.ts'
export type {
  RoleplayPresentedArtifact,
  RoleplayPresentedState,
  RoleplayPresentationContribution,
  RoleplayPresentModuleOutcome,
  RoleplayPresentationTrigger,
  RoleplayTurnPresentation,
} from './roleplay-turn-presentation-types.ts'

function eventAt(events: readonly SessionEvent[], seq: number): SessionEvent | undefined {
  return events.find(event => event.seq === seq)
}

function assistantAt(
  events: readonly SessionEvent[],
  seq: number,
): Extract<SessionEvent, { type: 'assistant/message' }> {
  const event = eventAt(events, seq)
  if (event?.type !== 'assistant/message') throw new Error('Roleplay presentation references a missing reply')
  return event
}

function settlementEventAt(
  events: readonly SessionEvent[],
  seq: number,
): Extract<SessionEvent, { type: 'agent-rp/turn-settlement' }> {
  const event = eventAt(events, seq)
  if (event?.type !== 'agent-rp/turn-settlement') {
    throw new Error('Roleplay presentation references a missing settlement')
  }
  return event
}

function latestVisibleAssistantSeq(session: Session): number | undefined {
  for (const seq of [...session.surface.nodes].reverse()) {
    const event = eventAt(sessionEvents(session), seq)
    if (event?.type !== 'assistant/message') continue
    const text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    if (text.trim() !== '') return seq
  }
  return undefined
}

function presentModuleIds(plans: readonly BoundRoleplayTurnPlan[]): readonly string[] {
  const ids = new Set<string>()
  for (const { plan } of plans) {
    for (const module of plan.runtime.modules) {
      if (module.phases.includes('present')) ids.add(module.id)
    }
  }
  return [...ids]
}

/** Resolve present participation from durable receipts, falling back only for older live plans. */
export function resolveRoleplayPresentModuleIds(
  references: readonly RoleplayTurnPlanReference[],
  fallbackPlans: readonly BoundRoleplayTurnPlan[] = [],
): readonly string[] {
  const recorded = references.map(reference => reference.receipt?.runtime.presentModuleIds)
  if (recorded.every((ids): ids is readonly string[] => ids !== undefined)) {
    return [...new Set(recorded.flat())]
  }
  if (fallbackPlans.length > 0) return presentModuleIds(fallbackPlans)
  throw new Error('Roleplay plan receipt cannot recover present participation')
}

function defaultModuleOutcomes(
  moduleIds: readonly string[],
  hasReply: boolean,
): readonly RoleplayPresentModuleOutcome[] {
  return moduleIds.map(moduleId => ({
    moduleId,
    outcome: hasReply ? 'applied' : 'idle',
    changes: hasReply ? 1 : 0,
  }))
}

function settlementStates(
  settlement: Extract<SessionEvent, { type: 'agent-rp/turn-settlement' }>,
): readonly RoleplayPresentedState[] {
  return settlement.data.state.map(state => state.outcome === 'removed'
    ? { id: state.id, status: 'absent' as const }
    : state.outcome === 'failed'
      ? {
          id: state.id,
          status: 'failed' as const,
          eventSeq: settlement.seq,
          ...(state.error === undefined ? {} : { error: state.error }),
        }
      : { id: state.id, status: 'settled' as const, eventSeq: settlement.seq })
}

function updatedModules(
  modules: readonly RoleplayPresentModuleOutcome[],
  module: RoleplayPresentModuleOutcome,
): readonly RoleplayPresentModuleOutcome[] {
  return modules.some(candidate => candidate.moduleId === module.moduleId)
    ? modules.map(candidate => candidate.moduleId === module.moduleId ? module : candidate)
    : [...modules, module]
}

function updatedStates(
  states: readonly RoleplayPresentedState[],
  state: RoleplayPresentedState,
): readonly RoleplayPresentedState[] {
  return states.some(candidate => candidate.id === state.id)
    ? states.map(candidate => candidate.id === state.id ? state : candidate)
    : [...states, state]
}

function applyContributions(
  modules: readonly RoleplayPresentModuleOutcome[],
  states: readonly RoleplayPresentedState[],
  contributions: readonly RoleplayPresentationContribution[],
): { readonly modules: readonly RoleplayPresentModuleOutcome[]; readonly states: readonly RoleplayPresentedState[] } {
  let nextModules = modules
  let nextStates = states
  for (const contribution of contributions) {
    if (contribution.module !== undefined) nextModules = updatedModules(nextModules, contribution.module)
    for (const state of contribution.states ?? []) nextStates = updatedStates(nextStates, state)
  }
  return { modules: nextModules, states: nextStates }
}

/** Compile the source-neutral present snapshot at one completed turn boundary. */
export function compileInitialRoleplayTurnPresentation(input: {
  readonly session: Session
  readonly settlementEvent: Extract<SessionEvent, { type: 'agent-rp/turn-settlement' }>
  readonly plans?: readonly BoundRoleplayTurnPlan[]
  readonly contributions?: readonly RoleplayPresentationContribution[]
  readonly artifacts?: readonly RoleplayPresentedArtifact[]
}): RoleplayTurnPresentation {
  const { session, settlementEvent } = input
  const settlement = settlementEvent.data
  if (settlement.sessionId !== String(session.id)) throw new Error('Roleplay settlement belongs to another Session')
  const reply = settlement.reply === undefined ? undefined : assistantAt(sessionEvents(session), settlement.reply.eventSeq)
  if (reply !== undefined && String(reply.data.message.id) !== settlement.reply?.messageId) {
    throw new Error('Roleplay settlement reply identity changed')
  }
  const presented = applyContributions(
    defaultModuleOutcomes(
      resolveRoleplayPresentModuleIds(settlement.plans, input.plans ?? []),
      reply !== undefined,
    ),
    settlementStates(settlementEvent),
    input.contributions ?? [],
  )
  return {
    format: 0,
    sessionId: String(session.id),
    turn: settlement.turn,
    settlementSeq: settlementEvent.seq,
    trigger: { kind: 'settlement', eventSeq: settlementEvent.seq },
    current: reply !== undefined && latestVisibleAssistantSeq(session) === reply.seq,
    ...(reply === undefined ? {} : {
      selectedReply: {
        sourceSeq: reply.seq,
        surfaceSeq: reply.seq,
        messageId: String(reply.data.message.id),
      },
    }),
    state: presented.states,
    present: {
      modules: presented.modules,
      ...(input.artifacts === undefined || input.artifacts.length === 0
        ? {}
        : { artifacts: input.artifacts }),
    },
  }
}

/** Fold every presentation snapshot in chronological order. */
export function readRoleplayTurnPresentations(
  events: readonly SessionEvent[],
): readonly RoleplayTurnPresentation[] {
  return events.flatMap(event => event.type === 'agent-rp/turn-presentation'
    ? [normalizePresentation(event.data)]
    : [])
}

function normalizePresentation(presentation: RoleplayTurnPresentation): RoleplayTurnPresentation {
  const state: unknown = presentation.state
  if (Array.isArray(state)) return presentation
  // Local indirection keeps this Host module free of legacy adapter branches.
  return importedNormalizePresentation(presentation)
}

/** Latest snapshot that selected the then-current visible assistant reply. */
export function readCurrentRoleplayTurnPresentation(
  events: readonly SessionEvent[],
): RoleplayTurnPresentation | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'agent-rp/turn-presentation') continue
    const presentation = normalizePresentation(event.data)
    if (presentation.current) return presentation
  }
  return undefined
}

/** Latest snapshot associated with one source or surface reply event. */
export function readLatestRoleplayPresentationForReply(
  events: readonly SessionEvent[],
  replySeq: number,
): RoleplayTurnPresentation | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'agent-rp/turn-presentation') continue
    const presentation = normalizePresentation(event.data)
    if (presentation.selectedReply?.sourceSeq === replySeq
      || presentation.selectedReply?.surfaceSeq === replySeq) return presentation
  }
  return undefined
}

/** Apply one reply-version selection without knowing which adapters supplied its state. */
export function compileRoleplayReplyVersionPresentation(input: {
  readonly session: Session
  readonly eventSeq: number
  readonly groupId: string
  readonly anchorSeq: number
  readonly selectedVersionSeq: number
  readonly surfaceSeq: number
  readonly contributions?: readonly RoleplayPresentationContribution[]
  readonly artifacts?: readonly RoleplayPresentedArtifact[]
}): RoleplayTurnPresentation | undefined {
  const baseline = readLatestRoleplayPresentationForReply(sessionEvents(input.session), input.anchorSeq)
  if (baseline === undefined) return undefined
  settlementEventAt(sessionEvents(input.session), baseline.settlementSeq)
  const source = assistantAt(sessionEvents(input.session), input.selectedVersionSeq)
  const surface = assistantAt(sessionEvents(input.session), input.surfaceSeq)
  const presented = applyContributions(
    updatedModules(baseline.present.modules, {
      moduleId: 'roleplay:reply-versions', outcome: 'applied', changes: 1,
    }),
    baseline.state,
    input.contributions ?? [],
  )
  const artifacts = input.artifacts ?? baseline.present.artifacts
  return {
    format: 0,
    sessionId: String(input.session.id),
    turn: baseline.turn,
    settlementSeq: baseline.settlementSeq,
    trigger: { kind: 'reply-version', eventSeq: input.eventSeq },
    current: latestVisibleAssistantSeq(input.session) === surface.seq,
    selectedReply: {
      sourceSeq: source.seq,
      surfaceSeq: surface.seq,
      messageId: String(surface.data.message.id),
    },
    state: presented.states,
    version: {
      groupId: input.groupId,
      anchorSeq: input.anchorSeq,
      selectedVersionSeq: input.selectedVersionSeq,
    },
    present: {
      modules: presented.modules,
      ...(artifacts === undefined || artifacts.length === 0 ? {} : { artifacts }),
    },
  }
}

/** Apply one causal module update to the presentation associated with its reply. */
export function compileRoleplayModulePresentationUpdate(input: {
  readonly session: Session
  readonly eventSeq: number
  readonly moduleId: string
  readonly replySeq: number
  readonly contributions: readonly RoleplayPresentationContribution[]
}): RoleplayTurnPresentation | undefined {
  assistantAt(sessionEvents(input.session), input.replySeq)
  const baseline = readLatestRoleplayPresentationForReply(sessionEvents(input.session), input.replySeq)
  if (baseline?.selectedReply === undefined) return undefined
  settlementEventAt(sessionEvents(input.session), baseline.settlementSeq)
  const presented = applyContributions(baseline.present.modules, baseline.state, input.contributions)
  return {
    ...baseline,
    trigger: { kind: 'module-update', eventSeq: input.eventSeq, moduleId: input.moduleId },
    current: latestVisibleAssistantSeq(input.session) === baseline.selectedReply.surfaceSeq,
    state: presented.states,
    present: {
      modules: presented.modules,
      ...(baseline.present.artifacts === undefined ? {} : { artifacts: baseline.present.artifacts }),
    },
  }
}

/** Append one idempotent presentation snapshot through the Host's ignorable-event seam. */
export function appendRoleplayTurnPresentation(
  session: Session,
  presentation: RoleplayTurnPresentation,
): SessionEvent<'agent-rp/turn-presentation'> {
  if (presentation.sessionId !== String(session.id)) throw new Error('Roleplay presentation belongs to another Session')
  const existing = sessionEvents(session).find(event => event.type === 'agent-rp/turn-presentation'
    && event.data.trigger.kind === presentation.trigger.kind
    && event.data.trigger.eventSeq === presentation.trigger.eventSeq)
  if (existing?.type === 'agent-rp/turn-presentation') return existing
  return appendAgentRpSessionEvent(session, 'agent-rp/turn-presentation', presentation)
}
