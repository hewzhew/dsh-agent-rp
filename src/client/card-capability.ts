/** Typed, fail-closed capability requests emitted by isolated Character Card frontends. */

import {
  characterRemoteResourceOrigin,
  isCharacterRemoteResourceType,
} from '../card-remote-resource.ts'
import type { CharacterRemoteResourceApproval } from '../character-library-protocol.ts'
import { AGENT_RP_CAPABILITIES } from '../extension-capability.ts'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import {
  normalizeNativeIdentityAudience,
  normalizeNativeIdentityNonce,
} from '../native-identity-protocol.ts'
import {
  parseExternalWindowRequestPayload,
  type ExternalWindowRequestPayload,
} from './external-window.ts'

/** Session-owned variable namespaces visible to a light frontend. */
export type CardVariableScope = 'global' | 'preset' | 'character' | 'chat' | 'message'

/** Content-free lifecycle states emitted by an isolated light frontend. */
export const CARD_RUNTIME_PHASES = [
  'bootstrap-installed', 'content-empty', 'content-present', 'document-open', 'document-restored',
  'dom-ready', 'load-complete', 'runtime-error', 'runtime-rejection',
] as const

/** One fixed lifecycle state from a registered light frontend. */
export type CardRuntimePhase = typeof CARD_RUNTIME_PHASES[number]

/** One registered light-frontend capability and its fixed security policy. */
export const CARD_CAPABILITIES = {
  'chat.send': AGENT_RP_CAPABILITIES['chat.send'],
  'chat.session.mutate': AGENT_RP_CAPABILITIES['chat.session.mutate'],
  'greeting.select': AGENT_RP_CAPABILITIES['greeting.select'],
  'ui.external-window.open': AGENT_RP_CAPABILITIES['ui.external-window.open'],
  'identity.native.attest': AGENT_RP_CAPABILITIES['identity.native.attest'],
} as const

const CARD_CHAT_SEND_REQUEST_BYTES = AGENT_RP_CAPABILITIES['chat.send']
  .runtimePolicies['card-frame-v0'].requestBytes
const CARD_CHAT_SESSION_MUTATE_REQUEST_BYTES = AGENT_RP_CAPABILITIES['chat.session.mutate']
  .runtimePolicies['card-frame-v0'].requestBytes
const CARD_VARIABLE_REQUEST_BYTES = AGENT_RP_CAPABILITIES['session.variables.replace']
  .runtimePolicies['card-frame-v0'].requestBytes
const CARD_EXTERNAL_WINDOW_REQUEST_BYTES = AGENT_RP_CAPABILITIES['ui.external-window.open']
  .runtimePolicies['card-frame-v0'].requestBytes
const CARD_NATIVE_IDENTITY_REQUEST_BYTES = AGENT_RP_CAPABILITIES['identity.native.attest']
  .runtimePolicies['card-frame-v0'].requestBytes

/** Request to select one greeting already owned by the active Character Card. */
export interface CardGreetingSelectRequest {
  readonly source: 'dsh-agent-rp-card'
  readonly action: 'capability-request'
  readonly capability: 'greeting.select'
  readonly token: string
  readonly requestId: string
  readonly greetingIndex: number
}

/** One player-triggered user message emitted by a registered light frontend. */
export interface CardChatSendRequest {
  readonly source: 'dsh-agent-rp-card'
  readonly action: 'capability-request'
  readonly capability: 'chat.send'
  readonly token: string
  readonly requestId: string
  readonly value: string
}

/** One bounded request to append one user message without triggering model generation. */
export interface CardChatSessionMutateCapabilityRequest {
  readonly source: 'dsh-agent-rp-card'
  readonly action: 'capability-request'
  readonly capability: 'chat.session.mutate'
  readonly token: string
  readonly requestId: string
  readonly operation: 'create-chat-messages'
  readonly messages: readonly [{ readonly role: 'user'; readonly message: string }]
  readonly insertAt: 'end'
}

/** One external HTTPS window request from a registered light frontend. */
export interface CardExternalWindowCapabilityRequest extends ExternalWindowRequestPayload {
  readonly source: 'dsh-agent-rp-card'
  readonly action: 'capability-request'
  readonly capability: 'ui.external-window.open'
  readonly token: string
  readonly requestId: string
}

/** One native identity proof request from a registered light frontend. */
export interface CardNativeIdentityCapabilityRequest {
  readonly source: 'dsh-agent-rp-card'
  readonly action: 'capability-request'
  readonly capability: 'identity.native.attest'
  readonly token: string
  readonly requestId: string
  readonly audience: string
  readonly nonce: string
  readonly includeDisplayName: boolean
}

/** One control operation for an approved external window owned by a registered light frontend. */
export interface CardExternalWindowControlRequest {
  readonly source: 'dsh-agent-rp-card'
  readonly action: 'external-window-close' | 'external-window-focus'
  readonly token: string
  readonly requestId: string
}

/** Confirmation that one registered light frontend dispatched an external-window callback. */
export interface CardExternalWindowDeliveryReport {
  readonly source: 'dsh-agent-rp-card'
  readonly action: 'external-window-delivered'
  readonly token: string
  readonly requestId: string
}

/** One content-free CSP violation reported by a registered light frontend. */
export interface CardResourceBlockedReport extends CharacterRemoteResourceApproval {
  readonly source: 'dsh-agent-rp-card'
  readonly action: 'resource-blocked'
  readonly token: string
}

/** One complete variable-namespace replacement from a registered light frontend. */
export interface CardVariableReplaceRequest {
  readonly source: 'dsh-agent-rp-card'
  readonly action: 'variables-replace'
  readonly token: string
  readonly requestId: string
  readonly scope: CardVariableScope
  readonly variables: Readonly<Record<string, JsonValue>>
}

/** One content-free lifecycle report from a registered light frontend. */
export interface CardRuntimeReport {
  readonly source: 'dsh-agent-rp-card'
  readonly action: 'runtime-monitor'
  readonly token: string
  readonly value: CardRuntimePhase
}

/** Parse one bounded player-triggered chat send request. */
export function parseCardChatSendCapabilityRequest(value: unknown): CardChatSendRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = new Set(['source', 'action', 'capability', 'token', 'requestId', 'value'])
  if (Object.keys(record).some(key => !fields.has(key))
    || record.source !== 'dsh-agent-rp-card' || record.action !== 'capability-request'
    || record.capability !== 'chat.send'
    || typeof record.token !== 'string' || !/^[\w:-]{1,128}$/u.test(record.token)
    || typeof record.requestId !== 'string' || !/^card-chat-send-[1-9]\d{0,8}$/u.test(record.requestId)
    || typeof record.value !== 'string' || record.value.trim() === '') return undefined
  try {
    const serialized = JSON.stringify(record)
    if (serialized === undefined
      || new TextEncoder().encode(serialized).byteLength > CARD_CHAT_SEND_REQUEST_BYTES) return undefined
  } catch {
    return undefined
  }
  return {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'chat.send',
    token: record.token, requestId: record.requestId, value: record.value,
  }
}

/** Parse one bounded light-frontend request to append one user message. */
export function parseCardChatSessionMutateCapabilityRequest(
  value: unknown,
): CardChatSessionMutateCapabilityRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = new Set([
    'source', 'action', 'capability', 'token', 'requestId', 'operation', 'messages', 'insertAt',
  ])
  if (Object.keys(record).some(key => !fields.has(key))
    || record.source !== 'dsh-agent-rp-card' || record.action !== 'capability-request'
    || record.capability !== 'chat.session.mutate'
    || typeof record.token !== 'string' || !/^[\w:-]{1,128}$/u.test(record.token)
    || typeof record.requestId !== 'string'
    || !/^card-chat-session-mutate-[1-9]\d{0,8}$/u.test(record.requestId)
    || record.operation !== 'create-chat-messages' || record.insertAt !== 'end'
    || !Array.isArray(record.messages) || record.messages.length !== 1) return undefined
  const message = record.messages[0]
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return undefined
  const messageRecord = message as Record<string, unknown>
  if (Object.keys(messageRecord).some(key => key !== 'role' && key !== 'message')
    || messageRecord.role !== 'user' || typeof messageRecord.message !== 'string'
    || messageRecord.message.trim() === '') return undefined
  try {
    const serialized = JSON.stringify(record)
    if (serialized === undefined
      || new TextEncoder().encode(serialized).byteLength > CARD_CHAT_SESSION_MUTATE_REQUEST_BYTES) return undefined
  } catch {
    return undefined
  }
  return {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'chat.session.mutate',
    token: record.token, requestId: record.requestId, operation: 'create-chat-messages',
    messages: [{ role: 'user', message: messageRecord.message }], insertAt: 'end',
  }
}

/** Parse a bounded light-frontend capability request without accepting extra operations. */
export function parseCardCapabilityRequest(value: unknown): CardGreetingSelectRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = new Set(['source', 'action', 'capability', 'token', 'requestId', 'greetingIndex'])
  if (Object.keys(record).some(key => !fields.has(key))) return undefined
  if (record.source !== 'dsh-agent-rp-card' || record.action !== 'capability-request'
    || record.capability !== 'greeting.select'
    || typeof record.token !== 'string' || !/^[\w:-]{1,128}$/u.test(record.token)
    || typeof record.requestId !== 'string' || !/^card-capability-[1-9]\d{0,8}$/u.test(record.requestId)
    || typeof record.greetingIndex !== 'number' || !Number.isSafeInteger(record.greetingIndex)
    || record.greetingIndex < 0 || record.greetingIndex > 255) return undefined
  return {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'greeting.select',
    token: record.token, requestId: record.requestId, greetingIndex: record.greetingIndex,
  }
}

/** Parse one bounded external-window request from an authenticated light frontend envelope. */
export function parseCardExternalWindowCapabilityRequest(
  value: unknown,
): CardExternalWindowCapabilityRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = new Set(['source', 'action', 'capability', 'token', 'requestId', 'payload'])
  if (Object.keys(record).some(key => !fields.has(key))
    || record.source !== 'dsh-agent-rp-card' || record.action !== 'capability-request'
    || record.capability !== 'ui.external-window.open'
    || typeof record.token !== 'string' || !/^[\w:-]{1,128}$/u.test(record.token)
    || typeof record.requestId !== 'string' || !/^card-external-window-[1-9]\d{0,8}$/u.test(record.requestId)) {
    return undefined
  }
  try {
    const serialized = JSON.stringify(record)
    if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > CARD_EXTERNAL_WINDOW_REQUEST_BYTES) {
      return undefined
    }
  } catch {
    return undefined
  }
  const payload = parseExternalWindowRequestPayload(record.payload)
  if (payload === undefined) return undefined
  return {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'ui.external-window.open',
    token: record.token, requestId: record.requestId, ...payload,
  }
}

/** Parse one bounded native identity proof request from an authenticated light frontend envelope. */
export function parseCardNativeIdentityCapabilityRequest(
  value: unknown,
): CardNativeIdentityCapabilityRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = new Set(['source', 'action', 'capability', 'token', 'requestId', 'payload'])
  if (Object.keys(record).some(key => !fields.has(key))
    || record.source !== 'dsh-agent-rp-card' || record.action !== 'capability-request'
    || record.capability !== 'identity.native.attest'
    || typeof record.token !== 'string' || !/^[\w:-]{1,128}$/u.test(record.token)
    || typeof record.requestId !== 'string' || !/^card-native-identity-[1-9]\d{0,8}$/u.test(record.requestId)
    || typeof record.payload !== 'object' || record.payload === null || Array.isArray(record.payload)) return undefined
  try {
    const serialized = JSON.stringify(record)
    if (new TextEncoder().encode(serialized).byteLength > CARD_NATIVE_IDENTITY_REQUEST_BYTES) return undefined
  } catch {
    return undefined
  }
  const payload = record.payload as Record<string, unknown>
  if (Object.keys(payload).some(key => !['audience', 'nonce', 'includeDisplayName'].includes(key))) return undefined
  const audience = normalizeNativeIdentityAudience(payload.audience)
  const nonce = normalizeNativeIdentityNonce(payload.nonce)
  if (audience === undefined || nonce === undefined || typeof payload.includeDisplayName !== 'boolean') return undefined
  return {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'identity.native.attest',
    token: record.token, requestId: record.requestId, audience, nonce,
    includeDisplayName: payload.includeDisplayName,
  }
}

/** Parse close and focus operations for one registered light frontend external-window handle. */
export function parseCardExternalWindowControlRequest(
  value: unknown,
): CardExternalWindowControlRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = new Set(['source', 'action', 'token', 'requestId'])
  if (Object.keys(record).some(key => !fields.has(key))
    || record.source !== 'dsh-agent-rp-card'
    || (record.action !== 'external-window-close' && record.action !== 'external-window-focus')
    || typeof record.token !== 'string' || !/^[\w:-]{1,128}$/u.test(record.token)
    || typeof record.requestId !== 'string' || !/^card-external-window-[1-9]\d{0,8}$/u.test(record.requestId)) {
    return undefined
  }
  return {
    source: 'dsh-agent-rp-card', action: record.action,
    token: record.token, requestId: record.requestId,
  }
}

/** Parse a content-free callback-delivery confirmation from a registered light frontend. */
export function parseCardExternalWindowDeliveryReport(
  value: unknown,
): CardExternalWindowDeliveryReport | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = new Set(['source', 'action', 'token', 'requestId'])
  if (Object.keys(record).some(key => !fields.has(key))
    || record.source !== 'dsh-agent-rp-card' || record.action !== 'external-window-delivered'
    || typeof record.token !== 'string' || !/^[\w:-]{1,128}$/u.test(record.token)
    || typeof record.requestId !== 'string' || !/^card-external-window-[1-9]\d{0,8}$/u.test(record.requestId)) {
    return undefined
  }
  return {
    source: 'dsh-agent-rp-card', action: 'external-window-delivered',
    token: record.token, requestId: record.requestId,
  }
}

/** Parse a bounded HTTPS resource report without accepting card source or document content. */
export function parseCardResourceBlockedReport(value: unknown): CardResourceBlockedReport | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = new Set(['source', 'action', 'token', 'origin', 'type'])
  if (Object.keys(record).some(key => !fields.has(key))) return undefined
  if (record.source !== 'dsh-agent-rp-card' || record.action !== 'resource-blocked'
    || typeof record.token !== 'string' || !/^[\w:-]{1,128}$/u.test(record.token)
    || typeof record.origin !== 'string' || !isCharacterRemoteResourceType(record.type)) return undefined
  try {
    return {
      source: 'dsh-agent-rp-card', action: 'resource-blocked', token: record.token,
      origin: characterRemoteResourceOrigin(record.origin), type: record.type,
    }
  } catch {
    return undefined
  }
}

/** Parse a registered light-frontend lifecycle report without accepting card content. */
export function parseCardRuntimeReport(value: unknown): CardRuntimeReport | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = new Set(['source', 'action', 'token', 'value'])
  if (Object.keys(record).some(key => !fields.has(key))) return undefined
  if (record.source !== 'dsh-agent-rp-card' || record.action !== 'runtime-monitor'
    || typeof record.token !== 'string' || !/^[\w:-]{1,128}$/u.test(record.token)
    || typeof record.value !== 'string'
    || !(CARD_RUNTIME_PHASES as readonly string[]).includes(record.value)) return undefined
  return {
    source: 'dsh-agent-rp-card', action: 'runtime-monitor', token: record.token,
    value: record.value as CardRuntimePhase,
  }
}

/** Parse and detach one bounded light-frontend variable replacement. */
export function parseCardVariableReplaceRequest(value: unknown): CardVariableReplaceRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const fields = new Set(['source', 'action', 'token', 'requestId', 'scope', 'variables'])
  if (Object.keys(record).some(key => !fields.has(key))) return undefined
  if (record.source !== 'dsh-agent-rp-card' || record.action !== 'variables-replace'
    || typeof record.token !== 'string' || !/^[\w:-]{1,128}$/u.test(record.token)
    || typeof record.requestId !== 'string' || !/^card-variables-[1-9]\d{0,8}$/u.test(record.requestId)
    || (record.scope !== 'global' && record.scope !== 'preset' && record.scope !== 'character'
      && record.scope !== 'chat' && record.scope !== 'message')
    || typeof record.variables !== 'object' || record.variables === null || Array.isArray(record.variables)) {
    return undefined
  }
  try {
    const request = JSON.stringify(record)
    if (request === undefined || new TextEncoder().encode(request).byteLength > CARD_VARIABLE_REQUEST_BYTES) return undefined
    const variables = JSON.parse(JSON.stringify(record.variables)) as unknown
    if (typeof variables !== 'object' || variables === null || Array.isArray(variables)) return undefined
    return {
      source: 'dsh-agent-rp-card', action: 'variables-replace', token: record.token,
      requestId: record.requestId, scope: record.scope,
      variables: variables as Record<string, JsonValue>,
    }
  } catch {
    return undefined
  }
}
