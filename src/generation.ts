/** Persistent Roleplay reply versions and direct generation commands. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  createAssistantMessage,
  createUserMessage,
  type AssistantMessage,
  type ContentBlock,
  type MessageSource,
} from '@deepseek-ai/dsh-llm'
import type { JsonValue, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  decodeGenerationCommandResult,
  encodeGenerationCommandResult,
} from './generation-command-result.ts'
import {
  appendMvuState,
  applyMvuReply,
  MVU_ROLEPLAY_STATE_ID,
  readCurrentMvuStateFromLorebooks,
  readCurrentSessionMvuStateFromLorebooks,
} from './mvu.ts'
import { configuredLorebook, readWorldInfoConfiguration } from './world-info-configuration-core.ts'
import { readActiveSessionLorebookSourcesFromEvents } from './world-info-configuration.ts'
import {
  appendTavernHelperState,
  decodeTavernHelperState,
  encodeTavernHelperState,
  readTavernHelperStateSnapshot,
  readTavernHelperStateSnapshotAt,
  TAVERN_HELPER_ROLEPLAY_STATE_ID,
  type TavernHelperState,
} from './tavern-helper.ts'
import { prepareTavernHelperState } from './tavern-helper-command.ts'
import {
  roleplayPresentedState,
} from './roleplay-turn-presentation-state.ts'
import type {
  RoleplayTurnPresentation,
} from './roleplay-turn-presentation-types.ts'
import { appendAgentRpSessionEvent } from './session-event-append.ts'

/** A complete reply-version group snapshot stored after every mutation. */
export interface GenerationStateRecord {
  readonly format: 0
  readonly groupId: string
  readonly operation: 'regenerate' | 'continue' | 'select' | 'review'
  readonly originSeq: number
  readonly anchorSeq: number
  readonly assistantSeqs: readonly number[]
  readonly versions: readonly {
    readonly seq: number
    readonly text: string
    /** Assistant replies whose tool-stage decisions compose this visible version. */
    readonly artifactReplySeqs?: readonly number[]
    readonly tavernStateSeq?: number
    readonly mvu?: {
      readonly statData: JsonValue
      readonly updateCount: number
      readonly lastError?: string
    }
  }[]
  readonly baseTavernStateSeq?: number
  readonly baseMvu?: {
    readonly statData: JsonValue
    readonly updateCount: number
    readonly lastError?: string
  }
  readonly selectedVersionSeq: number
  readonly surfaceSeq: number
  readonly tavern?: TavernHelperState
  readonly mvu?: {
    readonly statData: JsonValue
    readonly updateCount: number
    readonly lastError?: string
  }
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Ignorable reply-version snapshot written by an automatic post-narrative Worker. */
    'agent-rp/generation-state': GenerationStateRecord
  }
}

/** Browser request sent through the private generation command. */
export type GenerationRequest =
  | { readonly operation: 'regenerate'; readonly replySeq: number }
  | { readonly operation: 'continue'; readonly replySeq: number }
  | { readonly operation: 'select'; readonly replySeq: number; readonly versionIndex: number }

/** A validated reply-version group reconstructed from the latest snapshot event. */
export interface ActiveGenerationGroup extends GenerationStateRecord {
  readonly eventSeq: number
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function eventSeq(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label}无效`)
  return value
}

/** Parse one browser generation request without accepting extra fields. */
export function parseGenerationRequest(source: string): GenerationRequest {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error: unknown) {
    throw new Error('回复操作请求不是有效 JSON', { cause: error })
  }
  const request = object(value, '回复操作请求')
  const replySeq = eventSeq(request.replySeq, '回复序号')
  if (request.operation === 'regenerate' || request.operation === 'continue') {
    if (Object.keys(request).some(key => key !== 'operation' && key !== 'replySeq')) throw new Error('回复操作请求包含未知字段')
    return { operation: request.operation, replySeq }
  }
  if (request.operation === 'select') {
    const versionIndex = eventSeq(request.versionIndex, '版本序号')
    if (Object.keys(request).some(key => key !== 'operation' && key !== 'replySeq' && key !== 'versionIndex')) {
      throw new Error('回复操作请求包含未知字段')
    }
    return { operation: 'select', replySeq, versionIndex }
  }
  throw new Error('未知的回复操作')
}

function uniqueSeqs(value: readonly number[], label: string): readonly number[] {
  if (value.length === 0 || value.some(seq => !Number.isSafeInteger(seq) || seq < 0)
    || new Set(value).size !== value.length) throw new Error(`${label}无效`)
  return value
}

function validMvu(value: GenerationStateRecord['mvu']): boolean {
  return value === undefined || (Number.isSafeInteger(value.updateCount) && value.updateCount >= 0
    && (value.lastError === undefined || typeof value.lastError === 'string'))
}

function validTavern(value: GenerationStateRecord['tavern']): boolean {
  if (value === undefined) return true
  try {
    return decodeTavernHelperState(encodeTavernHelperState(value)) !== undefined
  } catch {
    return false
  }
}

function validArtifactReplySeqs(value: readonly number[] | undefined): boolean {
  return value === undefined || (value.length > 0
    && value.every(seq => Number.isSafeInteger(seq) && seq >= 0)
    && new Set(value).size === value.length)
}

function parseGenerationState(data: GenerationStateRecord, eventSeq: number): ActiveGenerationGroup {
  const assistantSeqs = uniqueSeqs(data.assistantSeqs, '回复来源序号')
  const versionSeqs = uniqueSeqs(data.versions.map(version => version.seq), '回复版本序号')
  if (data.format !== 0 || !/^[0-9a-f-]{36}$/iu.test(data.groupId)
    || (data.operation !== 'regenerate' && data.operation !== 'continue'
      && data.operation !== 'select' && data.operation !== 'review')
    || !Number.isSafeInteger(data.originSeq) || data.originSeq < 0
    || !Number.isSafeInteger(data.anchorSeq) || data.anchorSeq < 0
    || !Number.isSafeInteger(data.selectedVersionSeq) || data.selectedVersionSeq < 0
    || !Number.isSafeInteger(data.surfaceSeq) || data.surfaceSeq < 0
    || (data.baseTavernStateSeq !== undefined
      && (!Number.isSafeInteger(data.baseTavernStateSeq) || data.baseTavernStateSeq < 0))
    || data.versions.some(version => typeof version.text !== 'string' || version.text.trim() === '')
    || data.versions.some(version => version.tavernStateSeq !== undefined
      && (!Number.isSafeInteger(version.tavernStateSeq) || version.tavernStateSeq < 0))
    || data.versions.some(version => !validArtifactReplySeqs(version.artifactReplySeqs))
    || data.versions.some(version => !validMvu(version.mvu))
    || !validMvu(data.baseMvu) || !validMvu(data.mvu) || !validTavern(data.tavern)
    || versionSeqs[0] !== data.originSeq
    || !versionSeqs.includes(data.selectedVersionSeq)
    || !assistantSeqs.includes(data.originSeq)) throw new Error('回复版本事件无效')
  return { ...data, eventSeq }
}

/** Encode one complete reply-version snapshot into a supported command result. */
export function encodeGenerationState(data: GenerationStateRecord): string {
  return encodeGenerationCommandResult(data)
}

/** Decode one reply-version snapshot, declining unrelated command output. */
export function decodeGenerationState(source: string | undefined): GenerationStateRecord | undefined {
  return decodeGenerationCommandResult(source) as unknown as GenerationStateRecord | undefined
}

/** Fold the latest durable snapshot for every reply group. */
export function readGenerationGroups(events: readonly SessionEvent[]): readonly ActiveGenerationGroup[] {
  const groups = new Map<string, ActiveGenerationGroup>()
  for (const event of events) {
    const data = event.type === 'command/done' && event.data.kind === 'success'
      ? decodeGenerationState(event.data.text)
      : event.type === ('agent-rp/generation-state' as SessionEvent['type'])
        ? (event as SessionEvent & { readonly data: GenerationStateRecord }).data
        : undefined
    if (data === undefined) continue
    const group = parseGenerationState(data, event.seq)
    for (const seq of [...group.assistantSeqs, ...group.versions.map(version => version.seq), group.anchorSeq, group.surfaceSeq]) {
      if (seq >= event.seq || events[seq]?.type !== 'assistant/message') throw new Error('回复版本引用了不存在的助手消息')
    }
    for (const seq of group.versions.flatMap(version => version.artifactReplySeqs ?? [])) {
      if (seq >= event.seq || events[seq]?.type !== 'assistant/message') throw new Error('回复版本引用了不存在的产物来源')
    }
    for (const seq of [group.baseTavernStateSeq, ...group.versions.map(version => version.tavernStateSeq)]) {
      if (seq === undefined) continue
      if (seq >= event.seq) throw new Error('回复版本引用了未来的脚本状态')
      readTavernHelperStateSnapshotAt(events, seq)
    }
    groups.set(group.groupId, group)
  }
  return [...groups.values()].sort((left, right) => left.eventSeq - right.eventSeq)
}

function assistantEvent(events: readonly SessionEvent[], seq: number): Extract<SessionEvent, { type: 'assistant/message' }> {
  const event = events[seq]
  if (event?.type !== 'assistant/message') throw new Error('目标回复不存在')
  return event
}

function visibleText(event: Extract<SessionEvent, { type: 'assistant/message' }>): string {
  return event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
}

function replacementMessage(message: AssistantMessage, content: ContentBlock[] = message.content): AssistantMessage {
  const { kind: _kind, ...source } = message.source
  if (JSON.stringify(content) === JSON.stringify(message.content)) {
    return createAssistantMessage({ content, source })
  }
  // Adapter replay metadata describes the exact provider response. Regeneration placeholders and
  // continued replies change that response, so retaining the old state would pair one provider's
  // signatures/block map with different durable content on the next model request.
  const { replayState: _replayState, ...portableSource } = source
  return createAssistantMessage({ content, source: portableSource })
}

function continuedContent(before: readonly ContentBlock[], continuation: readonly ContentBlock[]): ContentBlock[] {
  const result = structuredClone([...before, ...continuation])
  const joinAt = before.length - 1
  const left = result[joinAt]
  const right = result[joinAt + 1]
  if (left?.type === 'text' && right?.type === 'text') {
    result.splice(joinAt, 2, { type: 'text', text: `${left.text}${right.text}` })
  }
  return result
}

function sourceSeqs(nodes: readonly number[], selectedVersionSeq: number): number[] {
  return [...new Set([...nodes, selectedVersionSeq])]
}

function appendCurrentReplySurface(
  agent: Agent,
  currentSurfaceSeq: number,
  selected: Extract<SessionEvent, { type: 'assistant/message' }>,
  content?: ContentBlock[],
): Extract<SessionEvent, { type: 'assistant/message' }> {
  const nodes = [...agent.session.surface.nodes]
  const startIndex = nodes.indexOf(currentSurfaceSeq)
  if (startIndex < 0) throw new Error('回复已不在当前对话末尾')
  const shadowed = nodes.slice(startIndex)
  const start = shadowed[0]
  const end = shadowed.at(-1)
  if (start === undefined || end === undefined) throw new Error('当前回复不可替换')
  return agent.session.append('assistant/message', {
    turn: selected.data.turn,
    step: selected.data.step,
    message: replacementMessage(selected.data.message, content),
    ...(selected.data.usage === undefined || content !== undefined ? {} : { usage: selected.data.usage }),
  }, {
    surfaceOp: { op: 'replace', start, end },
    sourceEventSeqs: sourceSeqs(shadowed, selected.seq),
  })
}

/** Return the final visible non-empty assistant reply produced in one turn. */
export function currentVisibleRoleplayReply(
  agent: Agent,
  turn: number,
): Extract<SessionEvent, { type: 'assistant/message' }> | undefined {
  return [...agent.session.surface.nodes].reverse()
    .map(seq => agent.session.events[seq])
    .find((event): event is Extract<SessionEvent, { type: 'assistant/message' }> =>
      event?.type === 'assistant/message' && event.data.turn === turn && visibleText(event) !== '')
}

/** Register a reviewed current reply as a selectable version without losing the character Agent's original. */
export function appendReviewedReplyVersion(
  agent: Agent,
  turn: number,
  reviewedText: string,
): { readonly originalSeq: number; readonly reviewedSeq: number; readonly stateEventSeq: number } {
  const original = currentVisibleRoleplayReply(agent, turn)
  if (original === undefined) throw new Error('正文 Worker 找不到本轮可见角色回复')
  const originalText = visibleText(original)
  const content: ContentBlock[] = [{ type: 'text', text: reviewedText }]
  const reviewed = appendCurrentReplySurface(agent, original.seq, original, content)
  const tavern = readTavernHelperStateSnapshot(agent.session.events)
  const mvu = mvuSnapshot(agent)
  const shared = {
    ...(tavern === undefined ? {} : { tavernStateSeq: tavern.eventSeq }),
    ...(mvu === undefined ? {} : { mvu }),
  }
  const state = appendState({
    groupId: crypto.randomUUID(),
    operation: 'review',
    originSeq: original.seq,
    anchorSeq: original.seq,
    assistantSeqs: [original.seq, reviewed.seq],
    versions: [
      { seq: original.seq, text: originalText, artifactReplySeqs: [original.seq], ...shared },
      { seq: reviewed.seq, text: reviewedText.trim(), artifactReplySeqs: [original.seq], ...shared },
    ],
    selectedVersionSeq: reviewed.seq,
    surfaceSeq: reviewed.seq,
  }, mvu, tavern?.state)
  const stateEvent = appendAgentRpSessionEvent(agent.session, 'agent-rp/generation-state', state)
  return { originalSeq: original.seq, reviewedSeq: reviewed.seq, stateEventSeq: stateEvent.seq }
}

function latestReply(
  agent: Agent,
  replySeq: number,
): { readonly group?: ActiveGenerationGroup; readonly surfaceSeq: number; readonly selectedSeq: number } {
  const events = agent.session.events
  const surfaceSeq = agent.session.surface.nodes.at(-1)
  if (surfaceSeq === undefined) throw new Error('当前会话还没有角色回复')
  const groups = readGenerationGroups(events)
  const group = groups.findLast(candidate => candidate.anchorSeq === replySeq)
  if (group !== undefined) {
    if (group.surfaceSeq !== surfaceSeq) {
      const currentSurface = assistantEvent(events, surfaceSeq)
      const selected = group.versions.find(version => version.seq === group.selectedVersionSeq)
      if (selected === undefined || visibleText(currentSurface) !== selected.text) {
        throw new Error('只能操作对话末尾的角色回复')
      }
    }
    return { group, surfaceSeq, selectedSeq: group.selectedVersionSeq }
  }
  const reply = assistantEvent(events, replySeq)
  if (reply.surfaceOp !== 'append' || surfaceSeq !== reply.seq || visibleText(reply) === '') {
    throw new Error('只能操作对话末尾的角色回复')
  }
  return { surfaceSeq, selectedSeq: reply.seq }
}

function mvuSnapshot(agent: Agent): GenerationStateRecord['mvu'] {
  const configuration = readWorldInfoConfiguration(agent.session.events)
  const lorebooks = readActiveSessionLorebookSourcesFromEvents(agent.session.events)
    .map(source => configuredLorebook(source, configuration).lorebook)
  return readCurrentSessionMvuStateFromLorebooks(lorebooks, agent.session)
}

function mvuBeforeReply(agent: Agent, replySeq: number): GenerationStateRecord['mvu'] {
  const configuration = readWorldInfoConfiguration(agent.session.events)
  const lorebooks = readActiveSessionLorebookSourcesFromEvents(agent.session.events)
    .map(source => configuredLorebook(source, configuration).lorebook)
  const visiblePrefix = new Set(agent.session.surface.nodes.filter(seq => seq < replySeq))
  return readCurrentMvuStateFromLorebooks(lorebooks, agent.session.events
    .slice(0, replySeq)
    .filter(event => event.type !== 'assistant/message' || visiblePrefix.has(event.seq)))
}

function continuedMvuState(
  current: GenerationStateRecord['mvu'],
  generated: Extract<SessionEvent, { type: 'assistant/message' }>,
): GenerationStateRecord['mvu'] {
  if (current === undefined) return undefined
  try {
    const update = applyMvuReply(current.statData, visibleText(generated))
    return update === undefined
      ? current
      : { statData: update.statData, updateCount: current.updateCount + 1 }
  } catch (error: unknown) {
    return { ...current, lastError: error instanceof Error ? error.message : String(error) }
  }
}

function appendState(
  record: Omit<GenerationStateRecord, 'format' | 'mvu'>,
  mvu: GenerationStateRecord['mvu'],
  tavern: GenerationStateRecord['tavern'],
): GenerationStateRecord {
  return {
    format: 0,
    ...record,
    ...(tavern === undefined ? {} : { tavern }),
    ...(mvu === undefined ? {} : { mvu }),
  }
}

function appendMvuSelection(agent: Agent, mvu: GenerationStateRecord['mvu']): void {
  if (mvu !== undefined) appendMvuState(agent.session, mvu)
}

function selectedTavernState(
  agent: Agent,
  eventSeq: number | undefined,
): TavernHelperState | undefined {
  return eventSeq === undefined
    ? undefined
    : readTavernHelperStateSnapshotAt(agent.session.events, eventSeq).state
}

function latestPresentationForReply(
  events: readonly SessionEvent[],
  replySeq: number,
): RoleplayTurnPresentation | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'agent-rp/turn-presentation') continue
    if (event.data.selectedReply?.sourceSeq === replySeq || event.data.selectedReply?.surfaceSeq === replySeq) {
      return event.data
    }
  }
  return undefined
}

function restoreTavernState(agent: Agent, state: TavernHelperState | undefined): number | undefined {
  if (state === undefined) return undefined
  return appendTavernHelperState(agent.session, state).eventSeq
}

function initialTavernState(agent: Agent): TavernHelperState | undefined {
  return readTavernHelperStateSnapshot(agent.session.events) === undefined
    ? undefined
    : prepareTavernHelperState(agent, undefined)
}

function instruction(operation: 'regenerate' | 'continue'): string {
  return operation === 'regenerate'
    ? 'Write a fresh alternative response to the latest user turn. Stay fully in character and preserve established facts, but do not mention, summarize, revise, or continue the previous response. Output only the replacement roleplay response.'
    : 'Continue the latest in-character response seamlessly from its final sentence. Do not repeat or summarize any existing text. Output only the continuation.'
}

async function generate(agent: Agent, operation: 'regenerate' | 'continue', signal: AbortSignal): Promise<number> {
  if (agent.status !== 'idle' || agent.inbox.hasPending) throw new Error('请等待当前回复完成后再操作')
  const before = agent.session.seq
  const onAbort = (): void => { agent.cancel({ kind: 'user' }) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: instruction(operation) }],
      source: {
        kind: 'plugin',
        plugin: 'dsh-agent-rp-generation',
        operation,
        form: 'notice',
        summary: operation === 'regenerate' ? '正在重写角色回复' : '正在续写角色回复',
      } as MessageSource,
    }))
    await agent.whenIdle()
    signal.throwIfAborted()
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  const generated = agent.session.events.slice(before)
    .findLast((event): event is Extract<SessionEvent, { type: 'assistant/message' }> =>
      event.type === 'assistant/message' && event.surfaceOp === 'append')
  if (generated === undefined || visibleText(generated) === '') throw new Error('模型没有生成可用的角色回复')
  return generated.seq
}

/** Execute Regenerate, Swipe selection, or Continue against the current Roleplay reply. */
export async function executeGenerationCommand(invocation: {
  readonly agent: Agent
  readonly rawInput: string
  readonly signal: AbortSignal
}): Promise<{ readonly kind: 'success'; readonly text: string; readonly sourceEventSeq: number }> {
  const request = parseGenerationRequest(invocation.rawInput)
  const current = latestReply(invocation.agent, request.replySeq)
  const events = invocation.agent.session.events
  const existing = current.group
  const groupId = existing?.groupId ?? crypto.randomUUID()
  const originSeq = existing?.originSeq ?? current.selectedSeq
  const assistantSeqs = [...(existing?.assistantSeqs ?? [originSeq])]
  const currentTavern = readTavernHelperStateSnapshot(events)
  const currentMvu = mvuSnapshot(invocation.agent)
  const versions = [...(existing?.versions ?? [{
    seq: originSeq,
    text: visibleText(assistantEvent(events, originSeq)),
    artifactReplySeqs: [originSeq],
  }])].map(version => version.seq !== current.selectedSeq ? version : {
    ...version,
    ...(currentTavern === undefined ? {} : { tavernStateSeq: currentTavern.eventSeq }),
    ...(currentMvu === undefined ? {} : { mvu: currentMvu }),
  })

  if (request.operation === 'select') {
    let selectedVersion = versions[request.versionIndex]
    if (selectedVersion === undefined) throw new Error('所选回复版本不存在')
    const selectedSeq = selectedVersion.seq
    if (selectedSeq === current.selectedSeq) {
      if (existing === undefined) throw new Error('当前回复还没有其他版本')
      return { kind: 'success', text: encodeGenerationState(existing), sourceEventSeq: existing.surfaceSeq }
    }
    const selected = assistantEvent(events, selectedSeq)
    const surface = appendCurrentReplySurface(invocation.agent, current.surfaceSeq, selected)
    const presented = latestPresentationForReply(invocation.agent.session.events, selectedSeq)
    const presentedTavern = roleplayPresentedState(presented, TAVERN_HELPER_ROLEPLAY_STATE_ID)
    const presentedTavernStateSeq = presentedTavern?.eventSeq
    if (presentedTavernStateSeq !== undefined && presentedTavernStateSeq !== selectedVersion.tavernStateSeq) {
      selectedVersion = { ...selectedVersion, tavernStateSeq: presentedTavernStateSeq }
      versions[request.versionIndex] = selectedVersion
    }
    const selectedVersionState = selectedTavernState(invocation.agent, selectedVersion.tavernStateSeq)
      ?? (currentTavern === undefined ? undefined : initialTavernState(invocation.agent))
    restoreTavernState(invocation.agent, selectedVersionState)
    const presentedMvu = roleplayPresentedState(presented, MVU_ROLEPLAY_STATE_ID)
    const mvuOwnedByPresentedTavern = presentedMvu?.eventSeq !== undefined
      && presentedMvu.eventSeq === presentedTavern?.eventSeq
    if (selectedVersion.mvu !== undefined && !mvuOwnedByPresentedTavern) {
      appendMvuSelection(invocation.agent, selectedVersion.mvu)
    }
    const state = appendState({
      groupId, operation: 'select', originSeq,
      anchorSeq: existing?.anchorSeq ?? originSeq,
      assistantSeqs, versions, selectedVersionSeq: selectedSeq, surfaceSeq: surface.seq,
      ...(existing?.baseTavernStateSeq === undefined ? {} : { baseTavernStateSeq: existing.baseTavernStateSeq }),
      ...(existing?.baseMvu === undefined ? {} : { baseMvu: existing.baseMvu }),
    }, selectedVersion.mvu, selectedVersionState)
    return { kind: 'success', text: encodeGenerationState(state), sourceEventSeq: state.surfaceSeq }
  }

  let generatedSeq: number | undefined
  let replacementStartSeq = current.surfaceSeq
  let baseTavernStateSeq = existing?.baseTavernStateSeq
  const baseMvu = existing?.baseMvu ?? mvuBeforeReply(invocation.agent, originSeq)
  try {
    if (request.operation === 'regenerate') {
      const candidateBaseTavern = baseTavernStateSeq === undefined
        ? readTavernHelperStateSnapshot(events, originSeq)?.state
        : readTavernHelperStateSnapshotAt(events, baseTavernStateSeq).state
      const selected = assistantEvent(invocation.agent.session.events, current.selectedSeq)
      replacementStartSeq = appendCurrentReplySurface(
        invocation.agent,
        current.surfaceSeq,
        selected,
        [],
      ).seq
      let baseTavern = candidateBaseTavern
      baseTavern ??= currentTavern === undefined ? undefined : initialTavernState(invocation.agent)
      baseTavernStateSeq = restoreTavernState(invocation.agent, baseTavern) ?? baseTavernStateSeq
      appendMvuSelection(invocation.agent, baseMvu)
    }
    generatedSeq = await generate(invocation.agent, request.operation, invocation.signal)
    const generated = assistantEvent(invocation.agent.session.events, generatedSeq)
    assistantSeqs.push(generatedSeq)
    let selectedSeq = generatedSeq
    let surface
    if (request.operation === 'continue') {
      const selected = assistantEvent(invocation.agent.session.events, current.selectedSeq)
      const content = continuedContent(selected.data.message.content, generated.data.message.content)
      surface = appendCurrentReplySurface(invocation.agent, replacementStartSeq, generated, content)
      selectedSeq = surface.seq
      const continuedMvu = continuedMvuState(currentMvu, generated) ?? mvuSnapshot(invocation.agent)
      appendMvuSelection(invocation.agent, continuedMvu)
      versions.push({
        seq: selectedSeq,
        text: content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim(),
        artifactReplySeqs: [...new Set([
          ...(versions.find(version => version.seq === current.selectedSeq)?.artifactReplySeqs
            ?? [current.selectedSeq]),
          generatedSeq,
        ])],
        ...(currentTavern === undefined ? {} : { tavernStateSeq: currentTavern.eventSeq }),
        ...(continuedMvu === undefined ? {} : { mvu: continuedMvu }),
      })
    } else {
      surface = appendCurrentReplySurface(invocation.agent, replacementStartSeq, generated)
      const generatedTavern = readTavernHelperStateSnapshot(invocation.agent.session.events)
      const generatedMvu = mvuSnapshot(invocation.agent)
      versions.push({
        seq: selectedSeq,
        text: visibleText(generated),
        artifactReplySeqs: [generatedSeq],
        ...(generatedTavern === undefined ? {} : { tavernStateSeq: generatedTavern.eventSeq }),
        ...(generatedMvu === undefined ? {} : { mvu: generatedMvu }),
      })
    }
    const selectedVersion = versions.find(version => version.seq === selectedSeq)
    const state = appendState({
      groupId, operation: request.operation, originSeq,
      anchorSeq: existing?.anchorSeq ?? request.replySeq,
      assistantSeqs, versions, selectedVersionSeq: selectedSeq, surfaceSeq: surface.seq,
      ...(baseTavernStateSeq === undefined ? {} : { baseTavernStateSeq }),
      ...(baseMvu === undefined ? {} : { baseMvu }),
    }, selectedVersion?.mvu, selectedVersion === undefined
      ? undefined
      : selectedTavernState(invocation.agent, selectedVersion.tavernStateSeq))
    return { kind: 'success', text: encodeGenerationState(state), sourceEventSeq: state.surfaceSeq }
  } catch (error: unknown) {
    const surfaceNodes = invocation.agent.session.surface.nodes
    const restoreRequired = replacementStartSeq !== current.surfaceSeq
      || surfaceNodes.at(-1) !== replacementStartSeq
    if (restoreRequired && surfaceNodes.includes(replacementStartSeq)) {
      const selected = assistantEvent(invocation.agent.session.events, current.selectedSeq)
      appendCurrentReplySurface(invocation.agent, replacementStartSeq, selected)
    }
    restoreTavernState(invocation.agent, currentTavern?.state)
    appendMvuSelection(invocation.agent, currentMvu)
    throw error
  }
}
