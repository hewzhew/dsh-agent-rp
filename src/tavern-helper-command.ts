/** Host adapter for isolated Tavern Helper variable writes. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  roleplayPresentedState,
} from './roleplay-turn-presentation-state.ts'
import type {
  RoleplayTurnPresentation,
} from './roleplay-turn-presentation-types.ts'
import { cardFromImportMeta, readActiveSessionCharacter } from './import/session-character.ts'
import { readActiveSessionPreset } from './import/session-preset.ts'
import { presetTavernHelperScripts } from './import/sillytavern-preset.ts'
import { executeTavernChatMutation } from './tavern-chat.ts'
import { tavernChatMessageSeqs } from './tavern-chat.ts'
import {
  applyTavernHelperMutation,
  appendTavernHelperStateAttachment,
  encodeTavernHelperState,
  initializeTavernHelperPresetState,
  initializeTavernHelperState,
  parseTavernHelperMutationRequest,
  readTavernHelperState,
  readTavernHelperStateSnapshotAt,
  TAVERN_HELPER_ROLEPLAY_STATE_ID,
  type TavernMutationCause,
} from './tavern-helper.ts'
import {
  appendTavernMessageAnnotationRecords,
  applyTavernMessageAnnotationRecords,
  logicalTavernMessageSeq,
  readTavernMessageAnnotations,
  validateTavernMessageAnnotationState,
  type TavernMessageAnnotationRecord,
} from './tavern-message-annotation.ts'
import { tavernScriptIdentity } from './tavern-script-identity.ts'

function latestCausalPresentation(agent: Agent, replySeq: number): RoleplayTurnPresentation | undefined {
  for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
    const event = agent.session.events[index]
    if (event?.type !== 'agent-rp/turn-presentation') continue
    if (event.data.selectedReply?.sourceSeq === replySeq || event.data.selectedReply?.surfaceSeq === replySeq) {
      return event.data
    }
  }
  return undefined
}

function latestVisibleAssistantSeq(agent: Agent): number | undefined {
  for (const seq of [...agent.session.surface.nodes].reverse()) {
    const event = agent.session.events.find(candidate => candidate.seq === seq)
    if (event?.type === 'assistant/message') return event.seq
  }
  return undefined
}

/** Reject forged or stale cross-Session mutation attribution before applying any write. */
export function validateTavernMutationCause(agent: Agent, cause: TavernMutationCause | undefined): void {
  if (cause === undefined) return
  if (cause.sessionId !== String(agent.session.id)) {
    throw new Error('Tavern Helper mutation cause belongs to another Session')
  }
  const reply = agent.session.events.find(event => event.seq === cause.replySeq)
  if (reply?.type !== 'assistant/message') {
    throw new Error('Tavern Helper mutation cause does not reference an assistant reply')
  }
}

/** Rebuild the active card and preset script namespaces around an optional prior snapshot. */
export function prepareTavernHelperState(agent: Agent, previous = readTavernHelperState(agent.session.events)) {
  const events = agent.session.events
  const active = readActiveSessionCharacter(events)
  if (active === undefined) throw new Error('this roleplay Session has no imported Character Card')
  const card = cardFromImportMeta(active.meta)
  const characterState = initializeTavernHelperState(card.frontend, active.result.sourceAttachmentId, previous)
  const preset = readActiveSessionPreset(events)
  return preset === undefined
    ? characterState
    : initializeTavernHelperPresetState(
        characterState,
        presetTavernHelperScripts(preset.preset),
        preset.preset.tavernHelperVariables ?? {},
        preset.result.sourceAttachmentId,
      )
}

/** Validate and persist one script-authored variable replacement. */
export function executeTavernHelperMutation(invocation: {
  readonly agent: Agent
  readonly rawInput: string
}): { readonly kind: 'success'; readonly text?: string; readonly sourceEventSeq?: number } {
  const request = parseTavernHelperMutationRequest(invocation.rawInput)
  validateTavernMutationCause(invocation.agent, request.cause)
  const presentation = request.cause === undefined
    ? undefined
    : latestCausalPresentation(invocation.agent, request.cause.replySeq)
  const presentedTavern = roleplayPresentedState(presentation, TAVERN_HELPER_ROLEPLAY_STATE_ID)
  const previous = presentedTavern?.eventSeq === undefined
    ? readTavernHelperState(invocation.agent.session.events)
    : readTavernHelperStateSnapshotAt(
        invocation.agent.session.events,
        presentedTavern.eventSeq,
      ).state
  const initialized = prepareTavernHelperState(invocation.agent, previous)
  const active = request.cause === undefined || latestVisibleAssistantSeq(invocation.agent)
    === (presentation?.selectedReply?.surfaceSeq ?? request.cause.replySeq)
  if ('operation' in request && request.operation === 'replace-message-annotations') {
    if (request.cause !== undefined && !active) {
      throw new Error('Tavern message annotation mutation belongs to a reply that is no longer selected')
    }
    const owner = tavernScriptIdentity(request.owner.scriptScope, request.owner.scriptId)
    if (!(owner in initialized.scripts)) throw new Error('Tavern message annotations have an unknown scriptId')
    const messageSeqs = tavernChatMessageSeqs(invocation.agent, initialized.hiddenPrefix)
    const records: TavernMessageAnnotationRecord[] = request.messages.map(replacement => {
      const surfaceSeq = messageSeqs[replacement.message_id]
      if (surfaceSeq === undefined) throw new Error('Tavern message annotation references an unknown message_id')
      const messageSeq = logicalTavernMessageSeq(invocation.agent.session.events, surfaceSeq)
      const message = invocation.agent.session.events[messageSeq]
      if (message?.type !== 'user/message' && message?.type !== 'assistant/message') {
        throw new Error('Tavern message annotation does not reference a durable transcript message')
      }
      return { format: 0, messageSeq, owner: request.owner, value: replacement.value }
    })
    const current = readTavernMessageAnnotations(invocation.agent.session.events)
    validateTavernMessageAnnotationState(applyTavernMessageAnnotationRecords(current, records))
    const seqs = appendTavernMessageAnnotationRecords(invocation.agent.session, records)
    const sourceEventSeq = seqs.at(-1)
    return { kind: 'success', ...(sourceEventSeq === undefined ? {} : { sourceEventSeq }) }
  }
  const isChatMutation = 'operation' in request && (request.operation === 'set-chat-messages'
    || request.operation === 'create-chat-messages' || request.operation === 'delete-chat-messages'
    || request.operation === 'rotate-chat-messages' || request.operation === 'set-chat-hidden')
  if (isChatMutation && request.cause !== undefined && !active) {
    throw new Error('Tavern Helper chat mutation belongs to a reply that is no longer selected')
  }
  const chat = isChatMutation
    ? executeTavernChatMutation(invocation.agent, request, initialized.hiddenPrefix)
    : undefined
  const mutated = applyTavernHelperMutation(initialized, request)
  const next = chat === undefined ? mutated : {
    ...mutated,
    hiddenPrefix: chat.hiddenPrefix,
    ...(chat.messageVariables === undefined
      ? {}
      : { scopes: { ...mutated.scopes, message: chat.messageVariables } }),
  }
  if (request.cause !== undefined) {
    const attached = appendTavernHelperStateAttachment(invocation.agent.session, next, request.cause, active)
    return { kind: 'success', sourceEventSeq: attached.eventSeq }
  }
  return { kind: 'success', text: encodeTavernHelperState(next) }
}
