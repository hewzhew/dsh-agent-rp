/** Host coordination for one online installed-extension document per Roleplay Session. */

import type {
  StExtensionGenerationCompletion,
  StExtensionGenerationRequest,
} from './st-extension-generation-protocol.ts'

interface WaitingPoll {
  readonly clientId: string
  readonly order: number
  readonly resolve: (request: StExtensionGenerationRequest | undefined) => void
}

interface PendingGeneration {
  readonly request: StExtensionGenerationRequest
  readonly clientId: string
  readonly promise: Promise<StExtensionGenerationCompletion | undefined>
  readonly resolve: (completion: StExtensionGenerationCompletion | undefined) => void
  readonly timer: ReturnType<typeof setTimeout>
  completion?: StExtensionGenerationCompletion
}

/** Result observed by the request assembly barrier. */
export interface StExtensionGenerationBarrierResult {
  readonly outcome: 'absent' | 'applied' | 'failed' | 'timeout'
  readonly error?: string
}

const COMPLETION_TIMEOUT_MS = 15_000

/** Volatile bridge between an Agent request and the currently online browser host. */
export class StExtensionGenerationCoordinator {
  readonly #polls = new Map<string, Map<string, WaitingPoll>>()
  readonly #owners = new Map<string, string>()
  readonly #pending = new Map<string, PendingGeneration>()
  #pollOrder = 0
  #disposed = false

  constructor(private readonly completionTimeoutMs = COMPLETION_TIMEOUT_MS) {
    if (!Number.isSafeInteger(completionTimeoutMs) || completionTimeoutMs <= 0) {
      throw new Error('ST extension generation completion timeout is invalid')
    }
  }

  /** Wait until this browser is selected for a real generation or its poll is replaced. */
  poll(sessionId: string, clientId: string, signal: AbortSignal): Promise<StExtensionGenerationRequest | undefined> {
    if (this.#disposed || signal.aborted) return Promise.resolve(undefined)
    return new Promise(resolve => {
      const polls = this.#polls.get(sessionId) ?? new Map<string, WaitingPoll>()
      polls.get(clientId)?.resolve(undefined)
      let settled = false
      const finish = (request: StExtensionGenerationRequest | undefined): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        resolve(request)
      }
      const waiting: WaitingPoll = { clientId, order: ++this.#pollOrder, resolve: finish }
      polls.set(clientId, waiting)
      this.#polls.set(sessionId, polls)
      const abort = (): void => {
        if (polls.get(clientId) !== waiting) return
        polls.delete(clientId)
        if (polls.size === 0) this.#polls.delete(sessionId)
        finish(undefined)
      }
      signal.addEventListener('abort', abort, { once: true })
    })
  }

  /** Start one barrier only when at least one browser host is already polling. */
  begin(sessionId: string, turn: number): boolean {
    if (this.#disposed) return false
    const existing = this.#pending.get(sessionId)
    if (existing !== undefined) {
      if (existing.request.turn === turn) return true
      if (existing.completion === undefined) return false
      clearTimeout(existing.timer)
      this.#pending.delete(sessionId)
    }
    const polls = this.#polls.get(sessionId)
    if (polls === undefined || polls.size === 0) return false
    const ownerId = this.#owners.get(sessionId)
    const selected = ownerId === undefined ? undefined : polls.get(ownerId)
    const poll = selected ?? [...polls.values()].sort((left, right) => right.order - left.order)[0]
    if (poll === undefined) return false
    polls.delete(poll.clientId)
    if (polls.size === 0) this.#polls.delete(sessionId)
    this.#owners.set(sessionId, poll.clientId)
    const request: StExtensionGenerationRequest = {
      format: 0,
      requestId: crypto.randomUUID(),
      sessionId,
      turn,
    }
    let settle!: (completion: StExtensionGenerationCompletion | undefined) => void
    const promise = new Promise<StExtensionGenerationCompletion | undefined>(resolve => { settle = resolve })
    const timer = setTimeout(() => {
      const pending = this.#pending.get(sessionId)
      if (pending?.request.requestId !== request.requestId) return
      this.#pending.delete(sessionId)
      settle(undefined)
    }, this.completionTimeoutMs)
    this.#pending.set(sessionId, { request, clientId: poll.clientId, promise, resolve: settle, timer })
    poll.resolve(request)
    return true
  }

  /** Wait for the browser write barrier without retaining the Agent turn signal. */
  async wait(sessionId: string, turn: number, signal: AbortSignal): Promise<StExtensionGenerationBarrierResult> {
    const pending = this.#pending.get(sessionId)
    if (pending === undefined || pending.request.turn !== turn) return { outcome: 'absent' }
    if (signal.aborted) return { outcome: 'failed', error: 'generation aborted' }
    let abortListener: (() => void) | undefined
    const aborted = new Promise<undefined>(resolve => {
      abortListener = () => { resolve(undefined) }
      signal.addEventListener('abort', abortListener, { once: true })
    })
    let completion: StExtensionGenerationCompletion | undefined
    try {
      completion = await Promise.race([pending.promise, aborted])
    } finally {
      if (abortListener !== undefined) signal.removeEventListener('abort', abortListener)
      if (this.#pending.get(sessionId) === pending) {
        clearTimeout(pending.timer)
        this.#pending.delete(sessionId)
      }
    }
    if (completion === undefined) {
      return signal.aborted ? { outcome: 'failed', error: 'generation aborted' } : { outcome: 'timeout' }
    }
    return completion.outcome === 'applied'
      ? { outcome: 'applied' }
      : { outcome: 'failed', ...(completion.error === undefined ? {} : { error: completion.error }) }
  }

  /** Settle the exact request selected for this browser client. */
  complete(completion: StExtensionGenerationCompletion): void {
    const pending = this.#pending.get(completion.sessionId)
    if (pending === undefined || pending.request.requestId !== completion.requestId
      || pending.clientId !== completion.clientId || pending.completion !== undefined) {
      throw new Error('ST extension generation request is stale or belongs to another browser host')
    }
    pending.completion = completion
    pending.resolve(completion)
  }

  /** Release every outstanding HTTP response and request barrier. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const polls of this.#polls.values()) {
      for (const poll of polls.values()) poll.resolve(undefined)
    }
    this.#polls.clear()
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.resolve(undefined)
    }
    this.#pending.clear()
    this.#owners.clear()
  }
}

interface SharedStExtensionGenerationDirectory {
  readonly coordinators: Set<StExtensionGenerationCoordinator>
}

const DIRECTORY_SYMBOL = Symbol.for('@hewzhew/dsh-agent-rp/st-extension-generation-directory/v0')

function sharedDirectory(): SharedStExtensionGenerationDirectory {
  const existing = Reflect.get(globalThis, DIRECTORY_SYMBOL) as SharedStExtensionGenerationDirectory | undefined
  if (existing !== undefined) return existing
  const created: SharedStExtensionGenerationDirectory = { coordinators: new Set() }
  Reflect.set(globalThis, DIRECTORY_SYMBOL, created)
  return created
}

/** Register one Web Host coordinator for independently rooted Agent preset contexts. */
export function registerStExtensionGenerationCoordinator(
  coordinator: StExtensionGenerationCoordinator,
): () => void {
  const directory = sharedDirectory()
  directory.coordinators.add(coordinator)
  let active = true
  return () => {
    if (!active) return
    active = false
    directory.coordinators.delete(coordinator)
  }
}

/** Select the registered Host that already owns a browser poll for this Session. */
export function beginStExtensionGeneration(
  sessionId: string,
  turn: number,
): StExtensionGenerationCoordinator | undefined {
  for (const coordinator of sharedDirectory().coordinators) {
    if (coordinator.begin(sessionId, turn)) return coordinator
  }
  return undefined
}
