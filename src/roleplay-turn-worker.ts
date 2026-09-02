/** Deterministic post-narrative Worker orchestration for Agent RP turns. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BoundRoleplayTurnPlan } from './roleplay-turn-settlement.ts'
import { appendAgentRpSessionEvent } from './session-event-append.ts'
import { sessionEvents } from './session-events.ts'

/** Host service shared by Agent RP profiles and trusted Worker plugins. */
export const ROLEPLAY_TURN_WORKERS_KEY = 'agentRp.turnWorkers'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Trusted Host plugins can register bounded post-narrative Workers here. */
    'agentRp.turnWorkers': RoleplayTurnWorkerRegistry
  }
}

/** Ordered phases after the character Agent has committed its visible narrative. */
export type RoleplayTurnWorkerPhase = 'review' | 'settle'

/** Stable terminal outcome returned by one independent Worker. */
export interface RoleplayTurnWorkerOutcome {
  readonly outcome: 'applied' | 'unchanged' | 'skipped' | 'failed'
  readonly requestEventSeq?: number
  readonly resultEventSeq?: number
}

/** Content-free diagnostic for one Worker execution. */
export interface RoleplayTurnWorkerResultRecord extends RoleplayTurnWorkerOutcome {
  readonly format: 0
  readonly sessionId: string
  readonly turn: number
  readonly step: number
  readonly workerId: string
  readonly phase: RoleplayTurnWorkerPhase
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Ignorable content-free result from one deterministic post-narrative Worker. */
    'agent-rp/turn-worker-result': RoleplayTurnWorkerResultRecord
  }
}

/** Runtime inputs shared by every Worker in one closed Agent step. */
export interface RoleplayTurnWorkerInput {
  readonly ctx: Context
  readonly agent: Agent
  readonly turn: number
  readonly plan: BoundRoleplayTurnPlan
  readonly signal: AbortSignal
}

/** One independently registered responsibility in the post-narrative pipeline. */
export interface RoleplayTurnWorker {
  readonly id: string
  readonly phase: RoleplayTurnWorkerPhase
  readonly order?: number
  run(input: RoleplayTurnWorkerInput): Promise<RoleplayTurnWorkerOutcome>
}

const phaseOrder: Readonly<Record<RoleplayTurnWorkerPhase, number>> = { review: 0, settle: 1 }

function terminalExists(input: RoleplayTurnWorkerInput, workerId: string): boolean {
  return sessionEvents(input.agent.session).some(event => event.type === 'agent-rp/turn-worker-result'
    && event.data.turn === input.turn && event.data.step === input.plan.step
    && event.data.workerId === workerId)
}

/** Registry and serial executor for bounded post-narrative Workers. */
export class RoleplayTurnWorkerRegistry {
  readonly #workers = new Map<string, RoleplayTurnWorker>()

  /** Register one stable Worker id and return its disposer. */
  register(worker: RoleplayTurnWorker): () => void {
    if (!/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(worker.id)) throw new Error(`Roleplay Worker id is invalid: ${worker.id}`)
    if (this.#workers.has(worker.id)) throw new Error(`Roleplay Worker is already registered: ${worker.id}`)
    this.#workers.set(worker.id, worker)
    return () => {
      if (this.#workers.get(worker.id) === worker) this.#workers.delete(worker.id)
    }
  }

  /** Run every registered Worker serially in review-before-settle order. */
  async run(input: RoleplayTurnWorkerInput): Promise<readonly RoleplayTurnWorkerResultRecord[]> {
    const workers = [...this.#workers.values()].sort((left, right) =>
      phaseOrder[left.phase] - phaseOrder[right.phase]
      || (left.order ?? 0) - (right.order ?? 0)
      || left.id.localeCompare(right.id))
    const results: RoleplayTurnWorkerResultRecord[] = []
    for (const worker of workers) {
      if (terminalExists(input, worker.id)) continue
      let outcome: RoleplayTurnWorkerOutcome
      try {
        input.signal.throwIfAborted()
        outcome = await worker.run(input)
      } catch {
        outcome = { outcome: 'failed' }
      }
      const record: RoleplayTurnWorkerResultRecord = {
        format: 0,
        sessionId: String(input.agent.session.id),
        turn: input.turn,
        step: input.plan.step,
        workerId: worker.id,
        phase: worker.phase,
        ...outcome,
      }
      appendAgentRpSessionEvent(input.agent.session, 'agent-rp/turn-worker-result', record)
      results.push(record)
    }
    return results
  }
}

/** Register one trusted Host Worker through the versioned Agent RP extension service. */
export function registerRoleplayTurnWorker(ctx: Context, worker: RoleplayTurnWorker): void {
  const registry = ctx.get(ROLEPLAY_TURN_WORKERS_KEY)
  if (registry === undefined || typeof registry.register !== 'function') {
    throw new Error('Agent RP turn Worker registry is unavailable')
  }
  ctx.effect(() => registry.register(worker), `agent-rp: turn Worker ${worker.id}`)
}
