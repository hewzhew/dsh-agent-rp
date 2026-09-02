/** Durable Tavern Helper chat message mutations over the DSH Session surface. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { isSurfaceEvent, type SessionEvent, type SurfaceEvent, type SurfaceIntent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { TavernChatMessageInput, TavernChatMutationRequest, TavernHiddenMessage } from './tavern-helper.ts'
import { sessionEvents } from './session-events.ts'

type JsonRecord = Readonly<Record<string, JsonValue>>

type SurfaceEntry =
  | { readonly kind: 'existing'; readonly event: SurfaceEvent }
  | { readonly kind: 'synthetic'; readonly role: 'assistant' | 'user'; readonly text: string }

interface VisibleMessage {
  readonly messageId: number
  readonly rawIndex: number
  readonly event: SurfaceEvent
  readonly role: 'assistant' | 'user'
  readonly text: string
}

/** State changes that accompany one transcript mutation. */
export interface TavernChatMutationResult {
  readonly messageVariables?: JsonRecord
  readonly hiddenPrefix: readonly TavernHiddenMessage[]
}

function textContent(event: SurfaceEvent): string | undefined {
  if (event.type === 'user/message') {
    if (event.data.source.kind !== 'user' && event.data.source.kind !== 'model') return undefined
    return event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  }
  if (event.type === 'assistant/message') {
    if (event.data.message.source.kind !== 'model') return undefined
    return event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  }
  return undefined
}

function surfaceEntries(agent: Agent): readonly SurfaceEntry[] {
  return agent.session.surface.nodes.map(seq => {
    const event = sessionEvents(agent.session)[seq]
    if (event === undefined || !isSurfaceEvent(event)) throw new Error('current Session surface contains an invalid node')
    return { kind: 'existing' as const, event }
  })
}

function visibleMessages(entries: readonly SurfaceEntry[]): readonly VisibleMessage[] {
  return entries.flatMap((entry, rawIndex) => {
    if (entry.kind !== 'existing') return []
    const text = textContent(entry.event)
    if (text === undefined) return []
    const role = entry.event.type === 'assistant/message' ? 'assistant' as const : 'user' as const
    return [{ messageId: 0, rawIndex, event: entry.event, role, text }]
  }).map((message, messageId) => ({ ...message, messageId }))
}

/** Resolve current Tavern message ids to the durable Session events they display. */
export function tavernChatMessageSeqs(
  agent: Agent,
  hiddenPrefix: readonly TavernHiddenMessage[] = [],
): readonly number[] {
  return [
    ...hiddenPrefix.map(message => message.seq),
    ...visibleMessages(surfaceEntries(agent)).map(message => message.event.seq),
  ]
}

function assistantCoordinates(events: readonly SessionEvent[]): { readonly turn: number; readonly step: number } {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'assistant/message') return { turn: event.data.turn, step: event.data.step }
  }
  return { turn: 1, step: 1 }
}

function requireSurfaceEvent(event: SessionEvent): SurfaceEvent {
  if (!isSurfaceEvent(event)) throw new Error('Session did not append the requested surface event')
  return event
}

function appendEntry(agent: Agent, entry: SurfaceEntry, intent: SurfaceIntent): SurfaceEvent {
  if (entry.kind === 'existing') {
    const event = entry.event
    if (event.type === 'user/message') return requireSurfaceEvent(agent.session.append(event.type, event.data, intent))
    if (event.type === 'assistant/message') return requireSurfaceEvent(agent.session.append(event.type, event.data, intent))
    return requireSurfaceEvent(agent.session.append(event.type, event.data, intent))
  }
  if (entry.role === 'user') {
    return requireSurfaceEvent(agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: entry.text }],
      source: { kind: 'user' },
    }), intent))
  }
  const coordinates = assistantCoordinates(sessionEvents(agent.session))
  return requireSurfaceEvent(agent.session.append('assistant/message', {
    ...coordinates,
    message: createAssistantMessage({
      content: [{ type: 'text', text: entry.text }],
      source: { provider: 'dsh-agent-rp', model: 'tavern-script' },
    }),
  }, intent))
}

function rewriteSurface(agent: Agent, before: readonly SurfaceEntry[], after: readonly SurfaceEntry[]): void {
  if (after.length === 0) throw new Error('脚本暂时不能删除角色会话的全部聊天楼层')
  if (before.length === 0) {
    for (const entry of after) appendEntry(agent, entry, { surfaceOp: 'append' })
    return
  }
  const sourceEventSeqs = before.flatMap(entry => entry.kind === 'existing' ? [entry.event.seq] : [])
  const start = sourceEventSeqs[0]
  const end = sourceEventSeqs.at(-1)
  if (start === undefined || end === undefined) throw new Error('当前角色会话没有可重写的聊天楼层')
  after.forEach((entry, index) => {
    if (index === 0) {
      appendEntry(agent, entry, { surfaceOp: { op: 'replace', start, end }, sourceEventSeqs })
      return
    }
    appendEntry(agent, entry, {
      surfaceOp: 'append',
      ...(entry.kind === 'existing' ? { sourceEventSeqs: [entry.event.seq] } : {}),
    })
  })
}

function empty(record: JsonRecord | undefined): boolean {
  return record === undefined || Object.keys(record).length === 0
}

function selectedText(message: TavernChatMessageInput, fallback: string): string {
  if (message.swipe_id !== undefined && message.swipe_id !== 0) {
    throw new Error('当前角色会话还没有酒馆式多回复页，swipe_id 只能是 0')
  }
  if (message.swipes !== undefined) {
    if (message.swipes.length !== 1) throw new Error('当前角色会话还不能由脚本创建多个回复页')
    return message.swipes[0] ?? ''
  }
  return message.message ?? fallback
}

function selectedData(message: TavernChatMessageInput): JsonRecord | undefined {
  if (message.swipes_data !== undefined) {
    if (message.swipes_data.length !== 1) throw new Error('当前角色会话还不能保存多个回复页的变量')
    return message.data ?? message.swipes_data[0] ?? {}
  }
  return message.data
}

function validateRepresentable(message: TavernChatMessageInput): void {
  if (message.role === 'system') throw new Error('DSH 会话暂时没有可由卡片脚本创建的 system 聊天楼层')
  if (message.is_hidden === true) throw new Error('DSH 会话暂时不能保留但隐藏一条卡片脚本聊天楼层')
  if (!empty(message.extra) || message.swipes_info?.some(info => !empty(info)) === true) {
    throw new Error('当前角色会话还不能保存聊天楼层的 extra 数据')
  }
  if (message.swipes_info !== undefined && message.swipes_info.length > 1) {
    throw new Error('当前角色会话还不能保存多个回复页的 extra 数据')
  }
}

function mergeUpdates(messages: readonly TavernChatMessageInput[]): readonly TavernChatMessageInput[] {
  const updates = new Map<number, TavernChatMessageInput>()
  for (const message of messages) {
    if (message.message_id === undefined) continue
    updates.set(message.message_id, { ...updates.get(message.message_id), ...message })
  }
  return [...updates.values()]
}

function setMessages(
  agent: Agent,
  request: Extract<TavernChatMutationRequest, { operation: 'set-chat-messages' }>,
  hiddenPrefix: readonly TavernHiddenMessage[],
): TavernChatMutationResult {
  const entries = surfaceEntries(agent)
  const visible = visibleMessages(entries)
  let messageVariables: JsonRecord | undefined
  const planned: {
    readonly target: VisibleMessage
    readonly role: 'assistant' | 'user'
    readonly text: string
  }[] = []
  for (const update of mergeUpdates(request.messages)) {
    validateRepresentable(update)
    if (update.message_id! < hiddenPrefix.length) {
      throw new Error('隐藏楼层恢复后才能修改正文或变量')
    }
    const target = visible[update.message_id! - hiddenPrefix.length]
    if (target === undefined) continue
    const data = selectedData(update)
    if (data !== undefined) {
      if (target.messageId !== visible.length - 1) throw new Error('当前仅支持保存最新楼层的 data 变量')
      messageVariables = data
    }
    const role = update.role ?? target.role
    if (role === 'system') throw new Error('DSH 会话暂时没有可由卡片脚本创建的 system 聊天楼层')
    const text = selectedText(update, target.text)
    if (role !== target.role || text !== target.text) planned.push({ target, role, text })
  }
  for (const update of planned) {
    appendEntry(agent, { kind: 'synthetic', role: update.role, text: update.text }, {
      surfaceOp: { op: 'replace', start: update.target.event.seq, end: update.target.event.seq },
      sourceEventSeqs: [update.target.event.seq],
    })
  }
  return { hiddenPrefix, ...(messageVariables === undefined ? {} : { messageVariables }) }
}

function messageEntry(message: TavernChatMessageInput): SurfaceEntry {
  validateRepresentable(message)
  if (message.role !== 'assistant' && message.role !== 'user') throw new Error('新聊天楼层必须指定 user 或 assistant')
  return { kind: 'synthetic', role: message.role, text: selectedText(message, '') }
}

function blocks(entries: readonly SurfaceEntry[]): { readonly prefix: readonly SurfaceEntry[]; readonly messages: readonly SurfaceEntry[][] } {
  const prefix: SurfaceEntry[] = []
  const messages: SurfaceEntry[][] = []
  for (const entry of entries) {
    const visible = entry.kind === 'synthetic' || textContent(entry.event) !== undefined
    if (visible) messages.push([entry])
    else (messages.at(-1) ?? prefix).push(entry)
  }
  return { prefix, messages }
}

function boundary(value: number | 'end', length: number): number {
  if (value === 'end') return length
  const normalized = value < 0 ? length + value + 1 : value
  return Math.min(length, Math.max(0, normalized))
}

function createMessages(
  agent: Agent,
  request: Extract<TavernChatMutationRequest, { operation: 'create-chat-messages' }>,
  hiddenPrefix: readonly TavernHiddenMessage[],
): TavernChatMutationResult {
  if (request.messages.length === 0) return { hiddenPrefix }
  const entries = surfaceEntries(agent)
  const current = blocks(entries)
  const canonicalLength = hiddenPrefix.length + current.messages.length
  const canonicalInsertAt = boundary(request.insertAt, canonicalLength)
  if (canonicalInsertAt < hiddenPrefix.length) throw new Error('不能在隐藏的聊天前缀中间插入楼层')
  const insertAt = canonicalInsertAt - hiddenPrefix.length
  const created = request.messages.map(message => [messageEntry(message)])
  const messageData = request.messages.map(selectedData)
  if (insertAt !== current.messages.length && messageData.some(data => data !== undefined)) {
    throw new Error('当前仅支持为追加到末尾的脚本聊天楼层保存 data 变量')
  }
  if (insertAt === current.messages.length && messageData.slice(0, -1).some(data => data !== undefined)) {
    throw new Error('当前仅支持为新建的最新楼层保存 data 变量')
  }
  const nextBlocks = [...current.messages.slice(0, insertAt), ...created, ...current.messages.slice(insertAt)]
  const next = [...current.prefix, ...nextBlocks.flat()]
  if (insertAt === current.messages.length && entries.length > 0) {
    for (const entry of created.flat()) appendEntry(agent, entry, { surfaceOp: 'append' })
  } else {
    rewriteSurface(agent, entries, next)
  }
  const data = insertAt === current.messages.length ? messageData.at(-1) ?? {} : undefined
  return { hiddenPrefix, ...(data === undefined ? {} : { messageVariables: data }) }
}

function deleteMessages(
  agent: Agent,
  request: Extract<TavernChatMutationRequest, { operation: 'delete-chat-messages' }>,
  hiddenPrefix: readonly TavernHiddenMessage[],
): TavernChatMutationResult {
  const entries = surfaceEntries(agent)
  const current = blocks(entries)
  if (request.messageIds.some(id => id >= 0 && id < hiddenPrefix.length)) {
    throw new Error('隐藏楼层恢复后才能删除')
  }
  const deleted = new Set(request.messageIds
    .map(id => id - hiddenPrefix.length).filter(id => id >= 0 && id < current.messages.length))
  if (deleted.size === 0) return { hiddenPrefix }
  const remaining = current.messages.filter((_message, index) => !deleted.has(index))
  if (remaining.length === 0) throw new Error('脚本暂时不能删除角色会话的全部聊天楼层')
  rewriteSurface(agent, entries, [...current.prefix, ...remaining.flat()])
  return deleted.has(current.messages.length - 1) ? { hiddenPrefix, messageVariables: {} } : { hiddenPrefix }
}

function rotateMessages(
  agent: Agent,
  request: Extract<TavernChatMutationRequest, { operation: 'rotate-chat-messages' }>,
  hiddenPrefix: readonly TavernHiddenMessage[],
): TavernChatMutationResult {
  if (hiddenPrefix.length > 0) throw new Error('隐藏楼层恢复后才能调整楼层顺序')
  const entries = surfaceEntries(agent)
  const current = blocks(entries)
  const begin = boundary(request.begin, current.messages.length)
  const end = boundary(request.end, current.messages.length)
  const middle = Math.min(end, Math.max(begin, boundary(request.middle, current.messages.length)))
  if (begin === middle || middle === end) return { hiddenPrefix }
  const rotated = [
    ...current.messages.slice(0, begin),
    ...current.messages.slice(middle, end),
    ...current.messages.slice(begin, middle),
    ...current.messages.slice(end),
  ]
  rewriteSurface(agent, entries, [...current.prefix, ...rotated.flat()])
  return { hiddenPrefix, messageVariables: {} }
}

function setHidden(
  agent: Agent,
  request: Extract<TavernChatMutationRequest, { operation: 'set-chat-hidden' }>,
  hiddenPrefix: readonly TavernHiddenMessage[],
): TavernChatMutationResult {
  const entries = surfaceEntries(agent)
  const current = blocks(entries)
  const visible = visibleMessages(entries)
  const total = hiddenPrefix.length + visible.length
  if (request.start !== 0 || request.end >= total) throw new Error('当前仅支持从第 0 楼开始隐藏或恢复')
  if (request.hidden) {
    const targetLength = request.end + 1
    if (targetLength <= hiddenPrefix.length) return { hiddenPrefix }
    const added = targetLength - hiddenPrefix.length
    if (added >= current.messages.length) throw new Error('至少需要保留一条未隐藏楼层供角色继续对话')
    const nextHidden = [
      ...hiddenPrefix,
      ...visible.slice(0, added).map(message => ({ seq: message.event.seq, role: message.role, text: message.text })),
    ]
    rewriteSurface(agent, entries, [...current.prefix, ...current.messages.slice(added).flat()])
    return { hiddenPrefix: nextHidden }
  }
  if (hiddenPrefix.length === 0) return { hiddenPrefix }
  if (request.end < hiddenPrefix.length - 1) throw new Error('当前需要一次恢复全部隐藏前缀')
  const restored: SurfaceEntry[] = hiddenPrefix.map(message => ({
    kind: 'synthetic', role: message.role, text: message.text,
  }))
  rewriteSurface(agent, entries, [...current.prefix, ...restored, ...current.messages.flat()])
  return { hiddenPrefix: [] }
}

/** Apply one validated Tavern Helper transcript operation to the current Session surface. */
export function executeTavernChatMutation(
  agent: Agent,
  request: TavernChatMutationRequest,
  hiddenPrefix: readonly TavernHiddenMessage[] = [],
): TavernChatMutationResult {
  if (request.operation === 'set-chat-messages') return setMessages(agent, request, hiddenPrefix)
  if (request.operation === 'create-chat-messages') return createMessages(agent, request, hiddenPrefix)
  if (request.operation === 'delete-chat-messages') return deleteMessages(agent, request, hiddenPrefix)
  if (request.operation === 'rotate-chat-messages') return rotateMessages(agent, request, hiddenPrefix)
  if (request.operation === 'replace-message-annotations') {
    throw new Error('Tavern message annotations must use the Session annotation adapter')
  }
  return setHidden(agent, request, hiddenPrefix)
}
