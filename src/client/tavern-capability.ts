/** Capability routing for authenticated Tavern Helper frame mutations. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { TavernHelperMutationRequest } from '../tavern-helper.ts'
import { AGENT_RP_CAPABILITIES } from '../extension-capability.ts'
import { parseExternalWindowRequestPayload } from './external-window.ts'
import { isJsonValue } from './json-value.ts'
import {
  normalizeNativeIdentityAudience,
  normalizeNativeIdentityNonce,
} from '../native-identity-protocol.ts'
import type { TavernStorageRequest } from './tavern-storage.ts'

/** Host message actions that carry a capability-scoped Tavern mutation request. */
export type TavernMutationCapabilityAction = 'chat-mutate' | 'worldbook-mutate'

const chatOperations = new Set([
  'set-chat-messages', 'create-chat-messages', 'delete-chat-messages', 'rotate-chat-messages', 'set-chat-hidden',
  'replace-message-annotations',
])
const worldInfoOperations = new Set([
  'replace-worldbook', 'delete-worldbook', 'bind-global-worldbooks', 'bind-character-worldbooks', 'bind-chat-worldbook',
])

/** Reject a valid Tavern mutation when it is sent through the wrong Host capability action. */
export function tavernMutationMatchesCapability(
  action: TavernMutationCapabilityAction,
  request: unknown,
): request is TavernHelperMutationRequest {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) return false
  const operation = (request as Record<string, unknown>).operation
  return typeof operation === 'string' && (action === 'chat-mutate'
    ? chatOperations.has(operation) : worldInfoOperations.has(operation))
}

/** Popup kinds that the Host can render outside an opaque Tavern Helper frame. */
export type TavernPopupType = 1 | 2 | 3 | 4

/** Bounded presentation options accepted by the Host popup capability. */
export interface TavernPopupOptions {
  readonly okButton?: string | boolean
  readonly cancelButton?: string | boolean
  readonly rows?: number
  readonly placeholder?: string
  readonly tooltip?: string
  readonly wide?: boolean
  readonly wider?: boolean
  readonly large?: boolean
  readonly leftAlign?: boolean
  readonly allowEscapeClose?: boolean
  readonly customButtons?: readonly { readonly text: string; readonly result: number }[]
}

/** Validated request for the `ui.popup.open` capability. */
export interface TavernPopupCapabilityRequest {
  readonly requestId: string
  readonly type: TavernPopupType
  readonly content: string
  readonly inputValue: string
  readonly options: TavernPopupOptions
}

function popupOptions(value: unknown): TavernPopupOptions | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const label = (key: 'okButton' | 'cancelButton'): string | boolean | undefined => {
    const item = source[key]
    if (typeof item === 'boolean') return item
    return typeof item === 'string' && item.length <= 200 ? item : undefined
  }
  const text = (key: 'placeholder' | 'tooltip'): string | undefined => {
    const item = source[key]
    return typeof item === 'string' && item.length <= 2_000 ? item : undefined
  }
  const flag = (key: 'wide' | 'wider' | 'large' | 'leftAlign' | 'allowEscapeClose'): boolean | undefined => (
    typeof source[key] === 'boolean' ? source[key] : undefined
  )
  const customButtons = source.customButtons === undefined
    ? undefined
    : Array.isArray(source.customButtons) && source.customButtons.length <= 9
      ? source.customButtons.flatMap((value): { readonly text: string; readonly result: number }[] => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
        const button = value as Record<string, unknown>
        if (typeof button.text !== 'string' || button.text.trim() === '' || button.text.length > 200
          || typeof button.result !== 'number' || !Number.isFinite(button.result)) return []
        return [{ text: button.text, result: button.result }]
      })
      : undefined
  if (source.customButtons !== undefined
    && (!Array.isArray(source.customButtons) || customButtons?.length !== source.customButtons.length)) return undefined
  const rows = source.rows === undefined
    ? undefined
    : Number.isSafeInteger(source.rows) && Number(source.rows) >= 1 && Number(source.rows) <= 20
      ? Number(source.rows) : undefined
  if (source.rows !== undefined && rows === undefined) return undefined
  for (const key of ['okButton', 'cancelButton'] as const) {
    if (source[key] !== undefined && label(key) === undefined) return undefined
  }
  for (const key of ['placeholder', 'tooltip'] as const) {
    if (source[key] !== undefined && text(key) === undefined) return undefined
  }
  for (const key of ['wide', 'wider', 'large', 'leftAlign', 'allowEscapeClose'] as const) {
    if (source[key] !== undefined && flag(key) === undefined) return undefined
  }
  const okButton = label('okButton')
  const cancelButton = label('cancelButton')
  const placeholder = text('placeholder')
  const tooltip = text('tooltip')
  const wide = flag('wide')
  const wider = flag('wider')
  const large = flag('large')
  const leftAlign = flag('leftAlign')
  const allowEscapeClose = flag('allowEscapeClose')
  return {
    ...(okButton === undefined ? {} : { okButton }),
    ...(cancelButton === undefined ? {} : { cancelButton }),
    ...(rows === undefined ? {} : { rows }),
    ...(placeholder === undefined ? {} : { placeholder }),
    ...(tooltip === undefined ? {} : { tooltip }),
    ...(wide === undefined ? {} : { wide }),
    ...(wider === undefined ? {} : { wider }),
    ...(large === undefined ? {} : { large }),
    ...(leftAlign === undefined ? {} : { leftAlign }),
    ...(allowEscapeClose === undefined ? {} : { allowEscapeClose }),
    ...(customButtons === undefined ? {} : { customButtons }),
  }
}

function requestWithinLimit(
  capability: 'identity.native.attest' | 'settings.extension.persist' | 'storage.script.persist'
    | 'ui.external-window.open' | 'ui.popup.open',
  message: Readonly<Record<string, unknown>>,
): boolean {
  try {
    const policy = AGENT_RP_CAPABILITIES[capability].runtimePolicies['tavern-script-frame-v0']
    return new TextEncoder().encode(JSON.stringify(message)).byteLength <= policy.requestBytes
  } catch {
    return false
  }
}

/** Validated request for the `ui.external-window.open` capability. */
export interface TavernExternalWindowCapabilityRequest {
  readonly requestId: string
  readonly url: string
  readonly target: string
  readonly features: string
}

/** Validated request for the `identity.native.attest` capability. */
export interface TavernNativeIdentityCapabilityRequest {
  readonly requestId: string
  readonly audience: string
  readonly nonce: string
  readonly includeDisplayName: boolean
}

/** Validate one external HTTPS window request before presenting it to the player. */
export function parseTavernExternalWindowCapabilityRequest(
  value: unknown,
): TavernExternalWindowCapabilityRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const message = value as Record<string, unknown>
  if (message.action !== 'capability-request' || message.capability !== 'ui.external-window.open'
    || typeof message.requestId !== 'string' || message.requestId.length === 0 || message.requestId.length > 128
    || typeof message.payload !== 'object' || message.payload === null || Array.isArray(message.payload)
    || !requestWithinLimit('ui.external-window.open', message)) return undefined
  const payload = parseExternalWindowRequestPayload(message.payload)
  return payload === undefined ? undefined : { requestId: message.requestId, ...payload }
}

/** Validate one native identity proof request before presenting its exact audience to the player. */
export function parseTavernNativeIdentityCapabilityRequest(
  value: unknown,
): TavernNativeIdentityCapabilityRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const message = value as Record<string, unknown>
  const fields = new Set(['source', 'scriptId', 'action', 'capability', 'requestId', 'payload'])
  if (Object.keys(message).some(key => !fields.has(key))
    || message.source !== 'dsh-agent-rp-tavern-script'
    || typeof message.scriptId !== 'string' || message.scriptId.length === 0 || message.scriptId.length > 512
    || message.action !== 'capability-request' || message.capability !== 'identity.native.attest'
    || typeof message.requestId !== 'string' || message.requestId.length === 0 || message.requestId.length > 128
    || typeof message.payload !== 'object' || message.payload === null || Array.isArray(message.payload)
    || !requestWithinLimit('identity.native.attest', message)) return undefined
  const payload = message.payload as Record<string, unknown>
  if (Object.keys(payload).some(key => !['audience', 'nonce', 'includeDisplayName'].includes(key))) return undefined
  const audience = normalizeNativeIdentityAudience(payload.audience)
  const nonce = normalizeNativeIdentityNonce(payload.nonce)
  if (audience === undefined || nonce === undefined || typeof payload.includeDisplayName !== 'boolean') return undefined
  return { requestId: message.requestId, audience, nonce, includeDisplayName: payload.includeDisplayName }
}

/** Validated request for the `settings.extension.persist` capability. */
export interface TavernExtensionSettingsCapabilityRequest {
  readonly requestId: string
  readonly settings: Readonly<Record<string, JsonValue>>
}

/** Validate one authenticated frame message before it enters the Host popup queue. */
export function parseTavernPopupCapabilityRequest(value: unknown): TavernPopupCapabilityRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const message = value as Record<string, unknown>
  if (message.action !== 'capability-request' || message.capability !== 'ui.popup.open'
    || typeof message.requestId !== 'string' || message.requestId.length === 0 || message.requestId.length > 128
    || typeof message.payload !== 'object' || message.payload === null || Array.isArray(message.payload)) return undefined
  const payload = message.payload as Record<string, unknown>
  if (payload.popupType !== 1 && payload.popupType !== 2 && payload.popupType !== 3 && payload.popupType !== 4) return undefined
  if (typeof payload.content !== 'string' || payload.content.length > 262_144
    || typeof payload.inputValue !== 'string' || payload.inputValue.length > 65_536) return undefined
  const options = popupOptions(payload.options)
  if (options === undefined) return undefined
  if (!requestWithinLimit('ui.popup.open', message)) return undefined
  return {
    requestId: message.requestId,
    type: payload.popupType,
    content: payload.content,
    inputValue: payload.inputValue,
    options,
  }
}

/** Validate one authenticated extension-settings replacement before persistent storage access. */
export function parseTavernExtensionSettingsCapabilityRequest(
  value: unknown,
): TavernExtensionSettingsCapabilityRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const message = value as Record<string, unknown>
  if (message.action !== 'capability-request' || message.capability !== 'settings.extension.persist'
    || typeof message.requestId !== 'string' || message.requestId.length === 0 || message.requestId.length > 128
    || typeof message.payload !== 'object' || message.payload === null || Array.isArray(message.payload)
    || !requestWithinLimit('settings.extension.persist', message)) return undefined
  const settings = (message.payload as Record<string, unknown>).settings
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings) || !isJsonValue(settings)) {
    return undefined
  }
  return { requestId: message.requestId, settings: settings as Readonly<Record<string, JsonValue>> }
}

/** Validate one authenticated persistent-storage request before IndexedDB access. */
export function parseTavernStorageCapabilityRequest(value: unknown): {
  readonly requestId: string
  readonly request: TavernStorageRequest
} | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const message = value as Record<string, unknown>
  if (message.action !== 'capability-request' || message.capability !== 'storage.script.persist'
    || typeof message.requestId !== 'string' || message.requestId.length === 0 || message.requestId.length > 128
    || typeof message.payload !== 'object' || message.payload === null || Array.isArray(message.payload)
    || !requestWithinLimit('storage.script.persist', message)) return undefined
  const payload = message.payload as Record<string, unknown>
  const operation = payload.operation
  if (operation !== 'get' && operation !== 'set' && operation !== 'remove' && operation !== 'clear'
    && operation !== 'keys' && operation !== 'length' && operation !== 'key') return undefined
  if (typeof payload.namespace !== 'string' || payload.namespace.length === 0 || payload.namespace.length > 512) {
    return undefined
  }
  const usesKey = operation === 'get' || operation === 'set' || operation === 'remove'
  if (usesKey) {
    if (typeof payload.key !== 'string' || payload.key.length === 0 || payload.key.length > 2_048) return undefined
  } else if (payload.key !== undefined) return undefined
  if (operation === 'set') {
    if (!Object.hasOwn(payload, 'value') || !isJsonValue(payload.value)) return undefined
  } else if (payload.value !== undefined) return undefined
  if (operation === 'key') {
    if (payload.index !== undefined && !Number.isSafeInteger(payload.index)) return undefined
  } else if (payload.index !== undefined) return undefined
  return {
    requestId: message.requestId,
    request: {
      operation,
      namespace: payload.namespace,
      ...(usesKey ? { key: payload.key as string } : {}),
      ...(operation === 'set' ? { value: payload.value as JsonValue } : {}),
      ...(operation === 'key' && payload.index !== undefined ? { index: Number(payload.index) } : {}),
    },
  }
}

/** Verify that one storage result is JSON-safe and within the advertised capability limit. */
export function validTavernStorageCapabilityResult(value: unknown): boolean {
  if (value !== undefined && !isJsonValue(value)) return false
  try {
    const policy = AGENT_RP_CAPABILITIES['storage.script.persist'].runtimePolicies['tavern-script-frame-v0']
    const encoded = value === undefined ? '' : JSON.stringify(value)
    return new TextEncoder().encode(encoded).byteLength <= policy.resultBytes
  } catch {
    return false
  }
}
