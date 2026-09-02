/** Browser-safe records for the first-party flying-chess world module. */

/** Stable module id used by persistence, HTTP discovery, and the native renderer. */
export const FLYING_CHESS_WORLD_MODULE_ID = 'agent-rp/flying-chess'

export type FlyingChessPieceStatus = 'base' | 'track' | 'home'

/** Supported trigger for one resource-authored flying-chess narrative card. */
export interface FlyingChessConsecutivePassesTrigger {
  readonly kind: 'consecutive-passes'
  readonly count: number
}

/** One structured scene event supplied by a flying-chess world resource. */
export interface FlyingChessNarrativeCard {
  readonly id: string
  readonly trigger: FlyingChessConsecutivePassesTrigger
  readonly event: {
    readonly title: string
    readonly summary: string
  }
  readonly cue: {
    readonly kind: 'change' | 'pressure' | 'opportunity' | 'relationship'
    readonly text: string
    readonly responders: 'all'
  }
  readonly repeat: boolean
}

/** Durable recipe configuration understood by the first-party flying-chess module. */
export interface FlyingChessWorldConfiguration {
  readonly format: 0
  readonly ruleset: 'classic-24'
  readonly narrativeCards?: readonly FlyingChessNarrativeCard[]
}

/** One authoritative piece in a flying-chess match. */
export interface FlyingChessPiece {
  readonly id: string
  readonly ownerId: string
  readonly number: number
  readonly status: FlyingChessPieceStatus
  readonly steps: number
}

/** Pending die result that must be resolved by one legal move. */
export interface FlyingChessPendingRoll {
  readonly playerId: string
  readonly value: number
  readonly legalPieceIds: readonly string[]
}

/** Complete public state for the compact 24-cell flying-chess module. */
export interface FlyingChessWorldState {
  readonly kind: 'flying-chess'
  readonly turn: number
  readonly playerOrder: readonly string[]
  readonly currentPlayerId: string
  readonly pieces: readonly FlyingChessPiece[]
  readonly pendingRoll?: FlyingChessPendingRoll
  readonly winnerId?: string
}

export type FlyingChessWorldAction =
  | { readonly type: 'roll'; readonly actorId: string }
  | { readonly type: 'move'; readonly actorId: string; readonly pieceId: string }

/** Narrow module-owned state before the native client renders it. */
export function isFlyingChessWorldState(value: unknown): value is FlyingChessWorldState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.kind === 'flying-chess' && typeof record.turn === 'number'
    && Array.isArray(record.playerOrder) && typeof record.currentPlayerId === 'string'
    && Array.isArray(record.pieces)
}
