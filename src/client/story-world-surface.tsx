/** Native conversation-adjacent host for one selected executable world. */

import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { AgentRpPlayWorldViewOwnerProps } from '../client-extension-v0.ts'
import {
  FLYING_CHESS_WORLD_MODULE_ID,
  isFlyingChessWorldState,
  type FlyingChessPiece,
  type FlyingChessWorldState,
} from '../flying-chess-protocol.ts'
import type {
  PlayWorldSurfaceProjection,
  PlayWorldTurnProjection,
} from '../play-world-protocol.ts'
import { STORY_WORKSPACES_PATH, type StoryWorkspaceSnapshot } from '../story-workspace-protocol.ts'
import type { StoryWorkspaceNavigation } from './story-workspace-navigation.ts'
import css from './story-world-surface.css?raw'

interface WorldSurfaceResponse {
  readonly format?: number
  readonly workspace?: StoryWorkspaceSnapshot
  readonly worldTurn?: PlayWorldTurnProjection | null
  readonly worldSurface?: PlayWorldSurfaceProjection | null
  readonly error?: string
}

interface WorldSurfaceState {
  readonly workspace: StoryWorkspaceSnapshot
  readonly turn: PlayWorldTurnProjection | null
  readonly surface: PlayWorldSurfaceProjection
}

interface StoryWorldSurfaceProps {
  readonly workspaceId: string
  readonly refreshKey: string
  readonly draft: string
  readonly setDraft: (text: string) => void
  readonly navigation: StoryWorkspaceNavigation
  readonly renderPlayWorldView?: (
    moduleId: string,
    props: AgentRpPlayWorldViewOwnerProps,
    fallback: ReactNode,
  ) => ReactNode
}

async function readResponse(response: Response, label: string): Promise<WorldSurfaceResponse> {
  const text = await response.text()
  let value: WorldSurfaceResponse
  try {
    value = JSON.parse(text) as WorldSurfaceResponse
  } catch {
    throw new Error(`${label}响应无法识别（${String(response.status)}）`)
  }
  if (!response.ok) throw new Error(value.error ?? `${label}失败（${String(response.status)}）`)
  if (value.format !== 1) throw new Error(`${label}响应版本无效`)
  return value
}

function surfaceState(value: WorldSurfaceResponse): WorldSurfaceState {
  if (value.workspace === undefined || value.workspace.world === undefined
    || !Object.prototype.hasOwnProperty.call(value, 'worldTurn') || value.worldSurface == null) {
    throw new Error('当前会话的场地投影尚未准备好')
  }
  return { workspace: value.workspace, turn: value.worldTurn ?? null, surface: value.worldSurface }
}

async function readSurface(workspaceId: string, signal?: AbortSignal): Promise<WorldSurfaceState> {
  const response = await fetch(`${STORY_WORKSPACES_PATH}/${encodeURIComponent(workspaceId)}`, {
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  })
  return surfaceState(await readResponse(response, '场地读取'))
}

async function dispatchSurfaceAction(
  current: WorldSurfaceState,
  actionId: string,
): Promise<WorldSurfaceState> {
  if (current.turn === null) throw new Error('当前没有可执行的场地动作')
  const response = await fetch(`${STORY_WORKSPACES_PATH}/${encodeURIComponent(current.workspace.id)}/world/actions`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      format: 0,
      revision: current.workspace.revision,
      cycleId: current.turn.cycleId,
      actionId,
    }),
  })
  return surfaceState(await readResponse(response, '场地动作'))
}

const flyingColors = ['#df615c', '#4b9cda', '#e4ae43', '#67aa78'] as const

function flyingCell(index: number): { readonly column: number; readonly row: number } {
  if (index < 7) return { column: index + 1, row: 1 }
  if (index < 13) return { column: 7, row: index - 5 }
  if (index < 19) return { column: 19 - index, row: 7 }
  return { column: 1, row: 25 - index }
}

function flyingPieceCell(state: FlyingChessWorldState, piece: FlyingChessPiece): number | undefined {
  if (piece.status !== 'track') return undefined
  const playerIndex = state.playerOrder.indexOf(piece.ownerId)
  return (playerIndex * Math.floor(24 / state.playerOrder.length) + piece.steps - 1) % 24
}

function FlyingChessViewport({ owner }: { readonly owner: AgentRpPlayWorldViewOwnerProps }) {
  if (!isFlyingChessWorldState(owner.world.state)) return null
  const state = owner.world.state
  const names = new Map(owner.characters.map(character => [character.id, character.name]))
  const name = (id: string): string => names.get(id) ?? id
  const legalActionIds = new Set(owner.turn?.actions.map(action => action.id) ?? [])
  return <div className="agent-rp-world-flying">
    <div className="agent-rp-world-board" aria-label="24 格飞行棋棋盘">
      {Array.from({ length: 24 }, (_, index) => {
        const position = flyingCell(index)
        const pieces = state.pieces.filter(piece => flyingPieceCell(state, piece) === index)
        return <div className="agent-rp-world-cell" key={index}
          style={{ gridColumn: position.column, gridRow: position.row }}>
          <small>{index + 1}</small>{pieces.map(piece => <span key={piece.id}
            title={`${name(piece.ownerId)} ${String(piece.number)} 号飞机`}
            style={{ '--agent-rp-world-player': flyingColors[state.playerOrder.indexOf(piece.ownerId)] } as CSSProperties}>
            {piece.number}
          </span>)}
        </div>
      })}
      <div className="agent-rp-world-board-center"><small>骰点</small><strong>{state.pendingRoll?.value ?? '—'}</strong>
        <span>{name(state.currentPlayerId)}</span></div>
    </div>
    <div className="agent-rp-world-players">{state.playerOrder.map((playerId, playerIndex) => {
      const pieces = state.pieces.filter(piece => piece.ownerId === playerId)
      return <section key={playerId} data-current={state.currentPlayerId === playerId}
        style={{ '--agent-rp-world-player': flyingColors[playerIndex] } as CSSProperties}>
        <header><span /><strong>{name(playerId)}</strong><small>{state.currentPlayerId === playerId ? '行动中' : '等待'}</small></header>
        <div>{pieces.map(piece => {
          const actionId = `move:${piece.id}`
          const legal = (state.pendingRoll?.legalPieceIds.includes(piece.id) ?? false) && legalActionIds.has(actionId)
          const location = piece.status === 'base' ? '基地' : piece.status === 'home' ? '到达' : `航线 ${String(piece.steps)}`
          return <button type="button" key={piece.id} data-legal={legal} disabled={!legal || owner.busy}
            onClick={() => { owner.dispatchAction(actionId) }}><b>{piece.number}</b><small>{location}</small></button>
        })}</div>
      </section>
    })}</div>
  </div>
}

function GenericWorldViewport({ owner }: { readonly owner: AgentRpPlayWorldViewOwnerProps }) {
  return <div className="agent-rp-world-generic">
    {owner.turn === null ? <p>当前没有待执行的场地动作。</p> : <>
      <p>{owner.turn.instruction}</p>
      <div>{owner.turn.actions.map(action => <button type="button" key={action.id} disabled={owner.busy}
        onClick={() => { owner.dispatchAction(action.id) }}><strong>{action.label}</strong><span>{action.description}</span></button>)}</div>
    </>}
  </div>
}

/** Render an executable world inside the native conversation composer area. */
export function StoryWorldSurface({
  workspaceId, refreshKey, draft, setDraft, navigation, renderPlayWorldView,
}: StoryWorldSurfaceProps) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<WorldSurfaceState>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => navigation.subscribe((request) => {
    if (request.surface === 'world' && request.workspaceId === workspaceId) setOpen(true)
  }), [navigation, workspaceId])
  useEffect(() => {
    const controller = new AbortController()
    setError(undefined)
    void readSurface(workspaceId, controller.signal).then(setState, (reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { controller.abort() }
  }, [refreshKey, workspaceId])
  const owner = useMemo<AgentRpPlayWorldViewOwnerProps | undefined>(() => state === undefined ? undefined : ({
    world: state.workspace.world!,
    characters: state.workspace.characters.map(character => ({ id: character.id, name: character.name })),
    turn: state.turn,
    busy,
    dirty: false,
    dispatchAction: (actionId: string) => {
      setBusy(true)
      setError(undefined)
      void dispatchSurfaceAction(state, actionId).then(setState, (reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      }).finally(() => { setBusy(false) })
    },
  }), [busy, state])
  const fallback = owner === undefined ? null
    : owner.world.moduleId === FLYING_CHESS_WORLD_MODULE_ID
      ? <FlyingChessViewport owner={owner} />
      : <GenericWorldViewport owner={owner} />
  const viewport = owner === undefined ? null : renderPlayWorldView === undefined
    ? fallback
    : renderPlayWorldView(owner.world.moduleId, owner, fallback)
  return <section className="agent-rp-world-surface" data-agent-rp-world-surface={workspaceId} data-open={open}>
    <style>{css}</style>
    <header className="agent-rp-world-summary">
      <button type="button" className="agent-rp-world-toggle" aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}><span aria-hidden="true">{open ? '⌄' : '›'}</span><b>场地</b></button>
      <button type="button" className="agent-rp-world-status" onClick={() => { setOpen(value => !value) }}>
        <strong>{state?.surface.title ?? '正在读取场地…'}</strong>
        <span>{state?.surface.status ?? error ?? ''}</span>
      </button>
      <button type="button" className="agent-rp-world-edit"
        onClick={() => { navigation.request({ workspaceId, surface: 'studio' }) }}>编辑</button>
    </header>
    {open && <div className="agent-rp-world-panel">
      {state !== undefined && <>
        <div className="agent-rp-world-lead"><p>{state.surface.summary}</p><dl>{state.surface.facts.map(fact => <div key={fact.label}>
          <dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl></div>
        {viewport}
        {state.turn !== null && state.turn.actions.some(action => action.id === 'roll') && <div className="agent-rp-world-primary-actions">
          <button type="button" disabled={busy} onClick={() => { owner?.dispatchAction('roll') }}>掷骰</button>
        </div>}
        {state.surface.composerSuggestions.length > 0 && <div className="agent-rp-world-suggestions"><span>填入下方输入框</span>
          {state.surface.composerSuggestions.map(suggestion => <button type="button" key={suggestion.id} onClick={() => {
            setDraft(draft.trim() === '' ? suggestion.draft : `${draft.trimEnd()}\n${suggestion.draft}`)
          }}>{suggestion.label}</button>)}</div>}
        {state.workspace.world !== undefined && state.workspace.world.events.length > 0 && <details className="agent-rp-world-events">
          <summary>最近的场地记录</summary>{[...state.workspace.world.events].reverse().slice(0, 5).map(event => <article key={event.id}>
            <strong>{event.title}</strong><span>{event.summary}</span></article>)}
        </details>}
      </>}
      {error !== undefined && <p className="agent-rp-world-error" role="alert">{error}</p>}
    </div>}
  </section>
}
