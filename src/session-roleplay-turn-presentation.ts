/** Session adapters that contribute compatibility state to the source-neutral present phase. */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { decodeGenerationState, type GenerationStateRecord } from './generation.ts'
import {
  MVU_ROLEPLAY_STATE_ID,
} from './mvu.ts'
import {
  compileInitialRoleplayTurnPresentation,
  compileRoleplayModulePresentationUpdate,
  compileRoleplayReplyVersionPresentation,
  readLatestRoleplayPresentationForReply,
  resolveRoleplayPresentModuleIds,
} from './roleplay-turn-presentation.ts'
import {
  roleplayPresentedState,
} from './roleplay-turn-presentation-state.ts'
import type {
  RoleplayPresentedArtifact,
  RoleplayPresentationContribution,
  RoleplayTurnPresentation,
} from './roleplay-turn-presentation-types.ts'
import type { BoundRoleplayTurnPlan } from './roleplay-turn-settlement.ts'
import { readPresentedRoleplayArtifacts } from './roleplay-artifact.ts'
import {
  decodeTavernHelperStateAttachment,
  decodeTavernHelperState,
  readTavernHelperStateSnapshot,
  TAVERN_HELPER_ROLEPLAY_MODULE_ID,
  TAVERN_HELPER_ROLEPLAY_STATE_ID,
  type TavernHelperStateSnapshot,
} from './tavern-helper.ts'
import { sessionEvents } from './session-events.ts'

function eventAt(events: readonly SessionEvent[], seq: number): SessionEvent | undefined {
  return events.find(event => event.seq === seq)
}

function causalTavernState(
  events: readonly SessionEvent[],
  replySeq: number,
  beforeSeq = Number.POSITIVE_INFINITY,
): TavernHelperStateSnapshot | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || event.seq >= beforeSeq) continue
    if (event.type === 'agent-rp/tavern-state-attachment') {
      if (event.data.cause.replySeq === replySeq) return { eventSeq: event.seq, state: event.data.state }
      continue
    }
    if (event.type !== 'command/done' || event.data.kind !== 'success') continue
    const attachment = decodeTavernHelperStateAttachment(event.data.text)
    const state = attachment?.state ?? decodeTavernHelperState(event.data.text)
    const cause = attachment?.cause ?? state?.lastMutation?.cause
    if (cause?.replySeq === replySeq && state !== undefined) return { eventSeq: event.seq, state }
  }
  return undefined
}

function initialTavernContribution(input: {
  readonly session: Session
  readonly settlementEvent: Extract<SessionEvent, { type: 'agent-rp/turn-settlement' }>
  readonly plans?: readonly BoundRoleplayTurnPlan[]
}): RoleplayPresentationContribution | undefined {
  const presentModules = resolveRoleplayPresentModuleIds(
    input.settlementEvent.data.plans,
    input.plans ?? [],
  )
  if (!presentModules.includes(TAVERN_HELPER_ROLEPLAY_MODULE_ID)) return undefined
  const replySeq = input.settlementEvent.data.reply?.eventSeq
  const causal = replySeq === undefined
    ? undefined
    : causalTavernState(sessionEvents(input.session), replySeq, input.settlementEvent.seq)
  const baseline = causal ?? readTavernHelperStateSnapshot(sessionEvents(input.session), input.settlementEvent.seq)
  const deferred = input.settlementEvent.data.settle.modules.some(module =>
    module.moduleId === TAVERN_HELPER_ROLEPLAY_MODULE_ID && module.outcome === 'deferred')
  const status = causal !== undefined ? 'attached' as const
    : deferred && replySeq !== undefined ? 'pending' as const
      : baseline === undefined ? 'absent' as const : 'settled' as const
  const outcome = replySeq === undefined ? 'idle' as const
    : status === 'pending' ? 'pending' as const
      : status === 'attached' ? 'attached' as const
        : status === 'settled' ? 'applied' as const : 'idle' as const
  return {
    module: {
      moduleId: TAVERN_HELPER_ROLEPLAY_MODULE_ID,
      outcome,
      changes: status === 'attached' ? 1 : 0,
    },
    states: [{
      id: TAVERN_HELPER_ROLEPLAY_STATE_ID,
      status,
      ...(baseline === undefined ? {} : { eventSeq: baseline.eventSeq }),
    }],
  }
}

/** Compile an initial presentation with compatibility modules contributing their own state. */
export function compileInitialSessionRoleplayTurnPresentation(input: {
  readonly session: Session
  readonly settlementEvent: Extract<SessionEvent, { type: 'agent-rp/turn-settlement' }>
  readonly plans?: readonly BoundRoleplayTurnPlan[]
}): RoleplayTurnPresentation {
  const tavern = initialTavernContribution(input)
  const artifacts = readPresentedRoleplayArtifacts(
    sessionEvents(input.session),
    input.settlementEvent.data.turn,
    input.settlementEvent.seq,
  )
  return compileInitialRoleplayTurnPresentation({
    ...input,
    ...(tavern === undefined ? {} : { contributions: [tavern] }),
    ...(artifacts.length === 0 ? {} : { artifacts }),
  })
}

function selectedGenerationVersion(generation: GenerationStateRecord): void {
  if (!generation.versions.some(version => version.seq === generation.selectedVersionSeq)) {
    throw new Error('Roleplay reply version has no selected reply')
  }
}

function generationArtifacts(
  session: Session,
  generation: GenerationStateRecord,
): readonly RoleplayPresentedArtifact[] | undefined {
  const selected = generation.versions.find(version => version.seq === generation.selectedVersionSeq)
  if (selected?.artifactReplySeqs === undefined) {
    return readLatestRoleplayPresentationForReply(sessionEvents(session), generation.selectedVersionSeq)?.present.artifacts
  }
  const artifacts = new Map<string, RoleplayPresentedArtifact>()
  for (const replySeq of selected.artifactReplySeqs) {
    const reply = eventAt(sessionEvents(session), replySeq)
    if (reply?.type !== 'assistant/message') throw new Error('Roleplay artifact source reply is missing')
    const closing = sessionEvents(session).find(event => event.seq > reply.seq
      && event.type === 'turn/end' && event.data.turn === reply.data.turn)
    for (const artifact of readPresentedRoleplayArtifacts(
      sessionEvents(session),
      reply.data.turn,
      closing === undefined ? Number.POSITIVE_INFINITY : closing.seq + 1,
    )) artifacts.set(artifact.artifactId, artifact)
  }
  return [...artifacts.values()]
}

function presentationForGeneration(
  session: Session,
  event: Extract<SessionEvent, { type: 'command/done' }>,
  generation: GenerationStateRecord,
): RoleplayTurnPresentation | undefined {
  selectedGenerationVersion(generation)
  const baseline = readLatestRoleplayPresentationForReply(sessionEvents(session), generation.anchorSeq)
  if (baseline === undefined) return undefined
  const contributions: RoleplayPresentationContribution[] = []
  if (generation.mvu !== undefined || roleplayPresentedState(baseline, MVU_ROLEPLAY_STATE_ID) !== undefined) {
    contributions.push({ states: [{
      id: MVU_ROLEPLAY_STATE_ID,
      status: generation.mvu === undefined ? 'absent' : 'attached',
      ...(generation.mvu === undefined ? {} : { eventSeq: event.seq }),
    }] })
  }
  const replayedTavern = readTavernHelperStateSnapshot(sessionEvents(session), event.seq)
  const tavern = generation.tavern === undefined
    ? replayedTavern
    : { eventSeq: event.seq, state: generation.tavern }
  const baselineTavern = roleplayPresentedState(baseline, TAVERN_HELPER_ROLEPLAY_STATE_ID)
  const hasTavernModule = baseline.present.modules.some(module =>
    module.moduleId === TAVERN_HELPER_ROLEPLAY_MODULE_ID)
  if (tavern !== undefined || baselineTavern !== undefined || hasTavernModule) {
    contributions.push({
      ...(hasTavernModule || tavern !== undefined ? {
        module: {
          moduleId: TAVERN_HELPER_ROLEPLAY_MODULE_ID,
          outcome: tavern === undefined ? 'idle' : 'attached',
          changes: tavern === undefined ? 0 : 1,
        },
      } : {}),
      states: [{
        id: TAVERN_HELPER_ROLEPLAY_STATE_ID,
        status: tavern === undefined ? 'absent' : 'attached',
        ...(tavern === undefined ? {} : { eventSeq: tavern.eventSeq }),
      }],
    })
  }
  const artifacts = generationArtifacts(session, generation)
  return compileRoleplayReplyVersionPresentation({
    session,
    eventSeq: event.seq,
    groupId: generation.groupId,
    anchorSeq: generation.anchorSeq,
    selectedVersionSeq: generation.selectedVersionSeq,
    surfaceSeq: generation.surfaceSeq,
    contributions,
    ...(artifacts === undefined ? {} : { artifacts }),
  })
}

function presentationForTavernMutation(
  session: Session,
  event: Extract<SessionEvent, { type: 'command/done' | 'agent-rp/tavern-state-attachment' }>,
): RoleplayTurnPresentation | undefined {
  const commandAttachment = event.type === 'command/done'
    ? decodeTavernHelperStateAttachment(event.data.text)
    : undefined
  const tavern = event.type === 'agent-rp/tavern-state-attachment'
    ? event.data.state
    : commandAttachment?.state ?? decodeTavernHelperState(event.data.text)
  const cause = event.type === 'agent-rp/tavern-state-attachment'
    ? event.data.cause
    : commandAttachment?.cause ?? tavern?.lastMutation?.cause
  if (tavern === undefined || cause === undefined || cause.sessionId !== String(session.id)) return undefined
  const reply = eventAt(sessionEvents(session), cause.replySeq)
  if (reply?.type !== 'assistant/message') throw new Error('Roleplay presentation references a missing reply')
  const mvuChanged = (tavern.lastMutation?.scope === 'message' || tavern.lastMutation?.scope === 'chat')
    && typeof tavern.scopes[tavern.lastMutation.scope].stat_data === 'object'
    && tavern.scopes[tavern.lastMutation.scope].stat_data !== null
    && !Array.isArray(tavern.scopes[tavern.lastMutation.scope].stat_data)
  return compileRoleplayModulePresentationUpdate({
    session,
    eventSeq: event.seq,
    moduleId: TAVERN_HELPER_ROLEPLAY_MODULE_ID,
    replySeq: cause.replySeq,
    contributions: [{
      module: { moduleId: TAVERN_HELPER_ROLEPLAY_MODULE_ID, outcome: 'attached', changes: 1 },
      states: [
        ...(mvuChanged ? [{ id: MVU_ROLEPLAY_STATE_ID, status: 'attached' as const, eventSeq: event.seq }] : []),
        { id: TAVERN_HELPER_ROLEPLAY_STATE_ID, status: 'attached', eventSeq: event.seq },
      ],
    }],
  })
}

/** Compile a follow-up presentation from one reply-version or causal compatibility event. */
export function compileSessionRoleplayTurnPresentationUpdate(
  session: Session,
  event: Extract<SessionEvent, { type: 'command/done' | 'agent-rp/tavern-state-attachment' }>,
): RoleplayTurnPresentation | undefined {
  if (event.type === 'agent-rp/tavern-state-attachment') return presentationForTavernMutation(session, event)
  if (event.data.kind !== 'success') return undefined
  const generation = decodeGenerationState(event.data.text)
  return generation === undefined
    ? presentationForTavernMutation(session, event)
    : presentationForGeneration(session, event, generation)
}
