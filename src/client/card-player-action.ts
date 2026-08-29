/** Host-side serialization and user-activation checks for card player actions. */

/** Stable outcome of one Host-side card player action. */
export type CardPlayerActionResult =
  | { readonly status: 'completed' }
  | { readonly status: 'activation-required' }
  | { readonly status: 'busy' }
  | { readonly status: 'failed'; readonly reason: unknown }

/** Options for one card action that may authorize a following generation trigger. */
export interface CardPlayerActionOptions {
  readonly grantTrigger?: boolean
}

const cardTriggerGrantMs = 30_000

/**
 * Serialize player actions for one Session and issue single-use trigger grants.
 * A later accepted player action revokes every earlier grant, including when that action fails.
 */
export class CardPlayerActionCoordinator<Source extends object> {
  readonly #now: () => number
  #pendingAction: { readonly source: Source; readonly work: Promise<CardPlayerActionResult> } | undefined
  #triggering = false
  #triggerGrantGeneration = 0
  readonly #triggerGrants = new WeakMap<Source, { readonly expiresAt: number; readonly generation: number }>()

  /**
   * Create a coordinator for one active Session.
   *
   * @param now - Clock used only to expire short-lived trigger grants.
   */
  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  /**
   * Run one user-activated action after all earlier card actions have settled.
   *
   * @param source - Registered compatibility-frame window.
   * @param playerActivated - Activation result stamped by the Host-owned compatibility shell.
   * @param action - Host operation authorized by this player action.
   * @param options - Whether success authorizes one following generation trigger.
   * @returns A stable action outcome; failures retain their local reason for logging.
   */
  async run(
    source: Source,
    playerActivated: boolean,
    action: () => Promise<void>,
    options: CardPlayerActionOptions = {},
  ): Promise<CardPlayerActionResult> {
    if (!playerActivated) return { status: 'activation-required' }
    if (this.#pendingAction !== undefined || this.#triggering) return { status: 'busy' }
    const grantGeneration = ++this.#triggerGrantGeneration
    const work: Promise<CardPlayerActionResult> = Promise.resolve().then(action).then((): CardPlayerActionResult => {
      if (options.grantTrigger === true) {
        this.#triggerGrants.set(source, {
          expiresAt: this.#now() + cardTriggerGrantMs,
          generation: grantGeneration,
        })
      }
      return { status: 'completed' }
    }, (reason): CardPlayerActionResult => ({ status: 'failed', reason }))
    this.#pendingAction = { source, work }
    try {
      return await work
    } finally {
      if (this.#pendingAction?.work === work) this.#pendingAction = undefined
    }
  }

  /**
   * Run one generation trigger after an active gesture or a successful append action.
   *
   * @param source - Registered compatibility-frame window.
   * @param playerActivated - Activation result stamped by the Host-owned compatibility shell.
   * @param trigger - Host generation trigger.
   * @returns A stable trigger outcome; one grant can start at most one trigger.
   */
  async trigger(
    source: Source,
    playerActivated: boolean,
    trigger: () => Promise<void>,
  ): Promise<CardPlayerActionResult> {
    if (this.#triggering) return { status: 'busy' }
    this.#triggering = true
    try {
      const pending = this.#pendingAction
      if (pending !== undefined) {
        if (pending.source !== source) return { status: 'busy' }
        const result = await pending.work
        if (result.status !== 'completed') return result
      }
      const grant = this.#triggerGrants.get(source)
      const grantAvailable = grant?.generation === this.#triggerGrantGeneration && grant.expiresAt >= this.#now()
      if (!grantAvailable && !playerActivated) {
        if (grant !== undefined) this.#triggerGrants.delete(source)
        return { status: 'activation-required' }
      }
      this.#triggerGrants.delete(source)
      this.#triggerGrantGeneration += 1
      try {
        await trigger()
        return { status: 'completed' }
      } catch (reason) {
        return { status: 'failed', reason }
      }
    } finally {
      this.#triggering = false
    }
  }
}
