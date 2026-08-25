/** Trusted Host plugin injection registered through the shared Agent RP profile context. */

import type { Context } from '@deepseek-ai/cordis'

/** Host service key used by trusted plugins to install frame injection sources. */
export const TAVERN_SCRIPT_INJECTED_SOURCES_KEY = 'agentRp.tavernScriptInjectedSources'

/** Child frame service key shared by the runtime and its opaque navigation shell. */
export const CHILD_TAVERN_SCRIPT_INJECTED_SOURCES_KEY = 'agentRp.childTavernScriptInjectedSources'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Trusted Host plugins can install a per-frame ST semantics shim here. */
    'agentRp.tavernScriptInjectedSources': TavernScriptInjectedSourceRegistry
    /** Child-frame copy of the injected sources for the opaque navigation shell. */
    'agentRp.childTavernScriptInjectedSources': TavernScriptInjectedSourceRegistry
  }
}

/** One trusted frame-injection source installed by a Host plugin. */
export interface TavernScriptInjectedSource {
  /** Stable non-empty identifier without whitespace. */
  readonly id: string
  /** Frame prelude installed after the runtime surface and before card scripts. */
  readonly source: string
}

interface Registration {
  readonly token: symbol
  readonly id: string
  readonly source: string
}

function stableId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || /\s/u.test(value)) {
    throw new Error(`${label} must be a non-empty stable id without whitespace`)
  }
  return value
}

/** Immutable registry of trusted injection sources installed by Host plugins. */
export class TavernScriptInjectedSourceRegistry {
  readonly #registrations = new Map<string, Registration>()

  /** Register one source and return a stale-disposer-safe revocation. */
  register(source: TavernScriptInjectedSource): () => void {
    const id = stableId(source.id, 'Tavern script injected source id')
    if (this.#registrations.has(id)) {
      throw new Error(`Tavern script injected source ${JSON.stringify(id)} is already registered`)
    }
    if (typeof source.source !== 'string' || source.source.length === 0
      || new TextEncoder().encode(source.source).byteLength > 2 * 1024 * 1024) {
      throw new Error(`Tavern script injected source ${JSON.stringify(id)} is invalid`)
    }
    const registration = { token: Symbol(id), id, source: source.source }
    this.#registrations.set(id, registration)
    return () => {
      if (this.#registrations.get(id)?.token === registration.token) {
        this.#registrations.delete(id)
      }
    }
  }

  /** Snapshot the current sources in stable id order without exposing internals. */
  sources(): readonly TavernScriptInjectedSource[] {
    return [...this.#registrations.values()]
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      .map(registration => Object.freeze({ id: registration.id, source: registration.source }))
  }
}

/** Register through the caller's Cordis scope and return the active registry. */
export function registerTavernScriptInjectedSource(
  ctx: Context,
  source: TavernScriptInjectedSource,
): void {
  const registry = ctx.get(TAVERN_SCRIPT_INJECTED_SOURCES_KEY)
  if (registry === undefined || typeof registry.register !== 'function') {
    throw new Error('Agent RP Tavern script injection service is unavailable')
  }
  ctx.effect(
    () => registry.register(source),
    `agent-rp: Tavern script injected source ${source.id}`,
  )
}