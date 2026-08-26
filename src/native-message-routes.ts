/** Immutable selector routing between Host chat identities and Agent RP display plans. */

import type { RoleplayDisplayMessage, RoleplayDisplayPlanner } from './roleplay-display-plan.ts'
import { nativeMessageDisplay, type NativeMessageDisplay } from './native-message-display.ts'

/** Owner fields supplied by the Host user-text chain. */
export interface NativeUserMessageOwner {
  readonly nodeKey: string
  readonly text: string
}

/** Owner fields supplied by the Host Assistant-text chain. */
export interface NativeAssistantMessageOwner {
  readonly nodeKey: string
  readonly blockIndex: number
  readonly text: string
  readonly streaming: boolean
}

/** Optional runtime form keeps the plugin source-compatible with Hosts predating selector scope. */
export interface NativeMessageSelectorScope {
  readonly sessionId: string
}

/** One elected native message replacement and the exact Host text revision it represents. */
export interface NativeMessageActivation {
  readonly display: NativeMessageDisplay
  readonly sourceText: string
}

/** One immutable Session-local selector table. */
export interface NativeMessageActivationTable {
  readonly sessionId: string
  readonly users: ReadonlyMap<string, NativeMessageActivation>
  readonly assistants: ReadonlyMap<string, ReadonlyMap<number, NativeMessageActivation>>
}

/** Minimal Chat projection needed to bind stable Host Node identities. */
export interface NativeMessageChatNode {
  readonly kind: string
  readonly data: unknown
}

/** Minimal Chat projection needed to bind stable Host Node identities. */
export interface NativeMessageChatSnapshot {
  readonly order: readonly string[]
  readonly nodes: { get(key: string): NativeMessageChatNode | undefined }
}

interface FlowNode {
  readonly key: string
  readonly role: 'user' | 'assistant'
  readonly node: NativeMessageChatNode
}

const runningAssistantRevision = Symbol('running Assistant')

interface NativeMessageChatRevisionCache {
  readonly inputs: readonly unknown[]
  readonly revision: NativeMessageChatRevision
}

const nativeMessageChatRevisions = new WeakMap<object, NativeMessageChatRevisionCache>()

/** Opaque dependency plus the matching Chat snapshot used to rebuild native routes. */
export interface NativeMessageChatRevision {
  readonly chat: NativeMessageChatSnapshot
}

function sameReferences(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null ? value as Readonly<Record<string, unknown>> : undefined
}

function userData(value: unknown): { readonly seq: number; readonly text: string } | undefined {
  const data = record(value)
  if (data === undefined || typeof data.seq !== 'number' || !Array.isArray(data.content)) return undefined
  const text = data.content.flatMap(value => {
    const block = record(value)
    return block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []
  }).join('')
  return { seq: data.seq, text }
}

function assistantData(value: unknown): {
  readonly finalSeq?: number
  readonly status: string
  readonly textBlocks: readonly { readonly index: number; readonly text: string }[]
} | undefined {
  const data = record(value)
  if (data === undefined || !Array.isArray(data.blocks) || typeof data.status !== 'string') return undefined
  const textBlocks = data.blocks.flatMap((value, index) => {
    const block = record(value)
    return block?.kind === 'text' && typeof block.text === 'string' ? [{ index, text: block.text }] : []
  })
  const finalNode = record(data.finalNode)
  const finalSeq = typeof finalNode?.seq === 'number' ? finalNode.seq : undefined
  return { ...(finalSeq === undefined ? {} : { finalSeq }), status: data.status, textBlocks }
}

function alignedMessages(
  flow: readonly FlowNode[],
  messages: readonly RoleplayDisplayMessage[] | undefined,
): ReadonlyMap<string, RoleplayDisplayMessage> {
  const visible = messages?.filter(message => !message.isHidden) ?? []
  if (flow.length !== visible.length || !flow.every((entry, index) => entry.role === visible[index]?.role)) return new Map()
  return new Map(flow.map((entry, index) => [entry.key, visible[index]!] as const))
}

/**
 * Return a referential revision that ignores token updates to a running Assistant.
 *
 * @param chat - incremental Host Chat snapshot.
 * @returns stable opaque identity until a user message, settled Assistant, or their visible order changes.
 */
export function nativeMessageChatRevision(chat: NativeMessageChatSnapshot): NativeMessageChatRevision {
  const inputs = chat.order.flatMap<unknown>(key => {
    const node = chat.nodes.get(key)
    if (node?.kind === 'user') return [key, 'user', node.data]
    if (node?.kind !== 'assistant-step') return []
    const data = record(node.data)
    return [key, 'assistant', data?.status === 'running' ? runningAssistantRevision : node.data]
  })
  const owner = chat.nodes as object
  const previous = nativeMessageChatRevisions.get(owner)
  if (previous !== undefined && sameReferences(previous.inputs, inputs)) return previous.revision
  const revision = Object.freeze({ chat })
  nativeMessageChatRevisions.set(owner, { inputs, revision })
  return revision
}

/**
 * Compile one Session revision into exact chain-selector activations.
 *
 * @param input - stable Host Chat snapshot, display planner, and Session identity.
 * @returns immutable activations; unsupported or complex displays remain absent for the DOM/iframe fallback.
 */
export function createNativeMessageActivationTable(input: {
  readonly sessionId: string
  readonly chat: NativeMessageChatSnapshot
  readonly planner: RoleplayDisplayPlanner
  readonly messages?: readonly RoleplayDisplayMessage[]
}): NativeMessageActivationTable {
  const flow = input.chat.order.flatMap<FlowNode>(key => {
    const node = input.chat.nodes.get(key)
    return node?.kind === 'user' ? [{ key, role: 'user' as const, node }]
      : node?.kind === 'assistant-step' ? [{ key, role: 'assistant' as const, node }]
        : []
  })
  const aligned = alignedMessages(flow, input.messages)
  const users = new Map<string, NativeMessageActivation>()
  const assistants = new Map<string, ReadonlyMap<number, NativeMessageActivation>>()
  for (const entry of flow) {
    const alignedMessage = aligned.get(entry.key)
    if (entry.role === 'user') {
      const data = userData(entry.node.data)
      if (data === undefined || data.text === '') continue
      const plan = input.planner.user({
        seq: data.seq,
        ...(alignedMessage === undefined ? {} : { alignedMessage }),
      })
      if (plan.kind !== 'render') continue
      const display = nativeMessageDisplay(plan.compilation)
      if (display !== undefined) users.set(entry.key, Object.freeze({ display, sourceText: data.text }))
      continue
    }
    const data = assistantData(entry.node.data)
    if (data === undefined || data.status === 'running' || data.textBlocks.length !== 1) continue
    const block = data.textBlocks[0]!
    const plan = input.planner.assistant({
      blockText: block.text,
      ...(data.finalSeq === undefined ? {} : { finalSeq: data.finalSeq }),
      ...(alignedMessage === undefined ? {} : { alignedMessage }),
    })
    if (plan.kind !== 'render') continue
    const display = nativeMessageDisplay(plan.compilation)
    if (display === undefined) continue
    assistants.set(entry.key, new Map([[block.index, Object.freeze({ display, sourceText: block.text })]]))
  }
  return Object.freeze({ sessionId: input.sessionId, users, assistants })
}

/** Select one user activation without reading mutable plugin or browser state. */
export function selectNativeUserMessage(
  table: NativeMessageActivationTable,
  owner: NativeUserMessageOwner,
  scope?: NativeMessageSelectorScope,
): NativeMessageActivation | null {
  if (scope === undefined || String(scope.sessionId) !== table.sessionId) return null
  const activation = table.users.get(owner.nodeKey)
  return activation?.sourceText === owner.text ? activation : null
}

/** Select one Assistant activation without reading mutable plugin or browser state. */
export function selectNativeAssistantMessage(
  table: NativeMessageActivationTable,
  owner: NativeAssistantMessageOwner,
  scope?: NativeMessageSelectorScope,
): NativeMessageActivation | null {
  if (scope === undefined || String(scope.sessionId) !== table.sessionId || owner.streaming) return null
  const activation = table.assistants.get(owner.nodeKey)?.get(owner.blockIndex)
  return activation?.sourceText === owner.text ? activation : null
}
