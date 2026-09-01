/** Floating native-session tabletop for one selected executable world. */

import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { AgentRpWorldSurfaceViewOwnerProps } from '../client-extension-v0.ts'
import type { AgentRpStoryTurnProgress, AgentRpStoryTurnStage } from '../projection-types.ts'
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
import {
  STORY_AUTO_ADVANCE_INPUT,
  STORY_WORKSPACES_PATH,
  type StoryWorkspaceSnapshot,
} from '../story-workspace-protocol.ts'
import {
  storyTurnDuration,
  storyTurnProgressText,
  storyTurnStageLabels,
  storyTurnSubjectName,
} from './story-turn-progress.ts'
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
  readonly progress?: AgentRpStoryTurnProgress
  readonly navigation: StoryWorkspaceNavigation
  readonly renderPlayWorldView?: (
    moduleId: string,
    props: AgentRpWorldSurfaceViewOwnerProps,
    fallback: ReactNode,
  ) => ReactNode
}

interface StoryDirectorDockProps {
  readonly workspaceId: string
  readonly refreshKey: string
  readonly progress?: AgentRpStoryTurnProgress
  readonly draft: string
  readonly inputPhase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  readonly running: boolean
  readonly setDraft: (text: string) => void
  readonly submit: () => void
  readonly startFreshSession: () => Promise<void>
}

type WorldSurfacePane = 'scene' | 'process'

const storyProcessLanes = [
  { label: '规则', stages: ['world-action'] },
  { label: '入场', stages: ['cast'] },
  { label: '回忆', stages: ['history', 'research'] },
  { label: '人物', stages: ['character'] },
  { label: '导演', stages: ['director'] },
  { label: '写作', stages: ['section'] },
  { label: '润色', stages: ['voice', 'editor', 'continuity'] },
] as const satisfies readonly { readonly label: string; readonly stages: readonly AgentRpStoryTurnStage[] }[]

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
    throw new Error('当前会话的场景投影尚未准备好')
  }
  return { workspace: value.workspace, turn: value.worldTurn ?? null, surface: value.worldSurface }
}

async function readSurface(workspaceId: string, signal?: AbortSignal): Promise<WorldSurfaceState> {
  const response = await fetch(`${STORY_WORKSPACES_PATH}/${encodeURIComponent(workspaceId)}`, {
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  })
  return surfaceState(await readResponse(response, '场景读取'))
}

async function restartSurface(current: WorldSurfaceState): Promise<WorldSurfaceState> {
  const response = await fetch(`${STORY_WORKSPACES_PATH}/${encodeURIComponent(current.workspace.id)}/world/restart`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ format: 0, revision: current.workspace.revision }),
  })
  return surfaceState(await readResponse(response, '重新开局'))
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

function FlyingChessViewport({ owner }: { readonly owner: AgentRpWorldSurfaceViewOwnerProps }) {
  if (!isFlyingChessWorldState(owner.world.state)) return null
  const state = owner.world.state
  const names = new Map(owner.characters.map(character => [character.id, character.name]))
  const name = (id: string): string => names.get(id) ?? id
  const persisted = state.turn > 1 || owner.world.events.length > 1
  return <div className="agent-rp-world-flying">
    <div className="agent-rp-world-round-intro" data-new={!persisted}>
      <div><span>{persisted ? '已保存的棋局' : '新棋局'}</span>
        <strong>{persisted ? `现在是第 ${String(state.turn)} 回合` : '双方飞机已经进入机场'}</strong></div>
      <p>{persisted
        ? '这是此前回合留下的状态；可以从这里继续，也可以在下方选择“新一局”。'
        : '角色会自己掷骰并选择合法行动；你可以直接开始下一回合，或写一句导演提示。'}</p>
    </div>
    <div className="agent-rp-world-board" aria-label="24 格飞行棋棋盘">
      {Array.from({ length: 24 }, (_, index) => {
        const position = flyingCell(index)
        const pieces = state.pieces.filter(piece => flyingPieceCell(state, piece) === index)
        return <div className="agent-rp-world-cell" key={index}
          style={{
            '--agent-rp-world-cell': flyingColors[index % flyingColors.length],
            gridColumn: position.column,
            gridRow: position.row,
          } as CSSProperties}>
          <small>{index + 1}</small>{pieces.map(piece => <span key={piece.id}
            title={`${name(piece.ownerId)} ${String(piece.number)} 号飞机`}
            style={{ '--agent-rp-world-player': flyingColors[state.playerOrder.indexOf(piece.ownerId)] } as CSSProperties}>
            <i aria-hidden="true">✈</i><b>{piece.number}</b>
          </span>)}
        </div>
      })}
      {state.playerOrder.map((playerId, playerIndex) => {
        const base = state.pieces.filter(piece => piece.ownerId === playerId && piece.status === 'base')
        const home = state.pieces.filter(piece => piece.ownerId === playerId && piece.status === 'home')
        return <section className="agent-rp-world-airport" data-player-index={playerIndex} key={playerId}
          style={{ '--agent-rp-world-player': flyingColors[playerIndex] } as CSSProperties}>
          <header><span /><strong>{name(playerId)}</strong></header>
          <div>{base.map(piece => <span key={piece.id} title={`${String(piece.number)} 号飞机在机场`}>
            <i aria-hidden="true">✈</i><b>{piece.number}</b></span>)}</div>
          <small>{base.length} 架待起飞{home.length === 0 ? '' : ` · ${String(home.length)} 架到达`}</small>
        </section>
      })}
      <div className="agent-rp-world-board-center"><small>下一行动</small><strong>{name(state.currentPlayerId)}</strong>
        <span>{state.pendingRoll === undefined ? `第 ${String(state.turn)} 回合` : `骰点 ${String(state.pendingRoll.value)}`}</span></div>
    </div>
    <div className="agent-rp-world-players">{state.playerOrder.map((playerId, playerIndex) => {
      const pieces = state.pieces.filter(piece => piece.ownerId === playerId)
      const base = pieces.filter(piece => piece.status === 'base').length
      const track = pieces.filter(piece => piece.status === 'track').length
      const home = pieces.filter(piece => piece.status === 'home').length
      return <section key={playerId} data-current={state.currentPlayerId === playerId}
        style={{ '--agent-rp-world-player': flyingColors[playerIndex] } as CSSProperties}>
        <header><span /><strong>{name(playerId)}</strong><small>{state.currentPlayerId === playerId ? '下一位' : '等待'}</small></header>
        <dl><div><dt>机场</dt><dd>{base}</dd></div><div><dt>航线</dt><dd>{track}</dd></div>
          <div><dt>到达</dt><dd>{home}</dd></div></dl>
      </section>
    })}</div>
  </div>
}

function GenericWorldViewport({ owner }: { readonly owner: AgentRpWorldSurfaceViewOwnerProps }) {
  return <div className="agent-rp-world-generic">
    {owner.turn === null
      ? <p>当前场景已经停在可介入的位置。</p>
      : <><p>{owner.turn.instruction}</p><small>下一项世界动作会由角色 Agent 在原生回合中完成。</small></>}
  </div>
}

function storyProcessLaneState(
  progress: AgentRpStoryTurnProgress | undefined,
  stages: readonly AgentRpStoryTurnStage[],
): 'idle' | 'running' | 'complete' | 'skipped' {
  const requests = progress?.requests.filter(request => stages.includes(request.stage)) ?? []
  if (requests.some(request => request.status === 'running')) return 'running'
  if (requests.some(request => request.status === 'succeeded')) return 'complete'
  return requests.some(request => request.status === 'failed') ? 'skipped' : 'idle'
}

function StoryProcessPanel({
  workspace,
  progress,
}: {
  readonly workspace: StoryWorkspaceSnapshot
  readonly progress: AgentRpStoryTurnProgress | undefined
}) {
  const current = progress?.workspaceId === workspace.id ? progress : undefined
  return <div className="agent-rp-world-process">
    <div className="agent-rp-world-process-heading">
      <div><span>本轮进程</span><strong>{storyTurnProgressText(workspace, current)}</strong></div>
      {current !== undefined && <small>{current.requests.length} 个 Worker 步骤</small>}
    </div>
    <div className="agent-rp-world-process-lanes" role="list" aria-label="本轮执行阶段">
      {storyProcessLanes.map((lane, index) => {
        const state = storyProcessLaneState(current, lane.stages)
        return <div key={lane.label} role="listitem" data-state={state}>
          <span>{state === 'complete' ? '✓' : state === 'skipped' ? '!' : index + 1}</span>
          <strong>{lane.label}</strong>
        </div>
      })}
    </div>
    {current === undefined || current.requests.length === 0
      ? <p className="agent-rp-world-process-empty">下一次行动会从规则结算开始，并把检索、人物推演、导演规划和整理过程留在这里。</p>
      : <div className="agent-rp-world-process-log">
        {[...current.requests].reverse().slice(0, 10).map(request => {
          const subject = storyTurnSubjectName(workspace, request.subjectId)
          const status = request.status === 'running' ? '进行中'
            : request.status === 'failed' ? '已跳过' : '完成'
          return <div key={request.requestId} data-state={request.status}>
            <span aria-hidden="true" />
            <strong>{storyTurnStageLabels[request.stage]}{subject === undefined ? '' : ` · ${subject}`}</strong>
            <small>{request.durationMs === undefined ? status : `${storyTurnDuration(request.durationMs)} · ${status}`}</small>
          </div>
        })}
      </div>}
  </div>
}

/** Render one executable world as a floating tabletop inside the native conversation. */
export function StoryWorldSurface({
  workspaceId, refreshKey, progress, navigation, renderPlayWorldView,
}: StoryWorldSurfaceProps) {
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<WorldSurfacePane>('scene')
  const [state, setState] = useState<WorldSurfaceState>()
  const [error, setError] = useState<string>()
  useEffect(() => navigation.subscribe((request) => {
    if (request.surface === 'world' && request.workspaceId === workspaceId) {
      setPane('scene')
      setOpen(true)
    }
  }), [navigation, workspaceId])
  useEffect(() => {
    if (progress?.workspaceId === workspaceId && progress.status === 'running') setOpen(false)
  }, [progress?.status, progress?.workspaceId, workspaceId])
  useEffect(() => {
    const controller = new AbortController()
    setError(undefined)
    void readSurface(workspaceId, controller.signal).then(setState, (reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { controller.abort() }
  }, [refreshKey, workspaceId])
  const owner = useMemo<AgentRpWorldSurfaceViewOwnerProps | undefined>(() => state === undefined ? undefined : ({
    world: state.workspace.world!,
    characters: state.workspace.characters.map(character => ({ id: character.id, name: character.name })),
    turn: state.turn,
  }), [state])
  const fallback = owner === undefined ? null
    : owner.world.moduleId === FLYING_CHESS_WORLD_MODULE_ID
      ? <FlyingChessViewport owner={owner} />
      : <GenericWorldViewport owner={owner} />
  const viewport = owner === undefined ? null : renderPlayWorldView === undefined
    ? fallback
    : renderPlayWorldView(owner.world.moduleId, owner, fallback)
  const processText = state === undefined
    ? error ?? '正在读取场景…'
    : progress?.workspaceId === workspaceId && progress.status === 'running'
      ? storyTurnProgressText(state.workspace, progress)
      : state.turn === null ? '等待场地开始'
        : `轮到 ${state.workspace.characters.find(character => character.id === state.turn?.characterId)?.name ?? '下一位人物'}`
  return <section className="agent-rp-world-surface" data-agent-rp-world-surface={workspaceId}
    data-open={open} data-pane={pane}>
    <style>{css}</style>
    <header className="agent-rp-world-summary">
      <button type="button" className="agent-rp-world-toggle" aria-expanded={open}
        aria-label={open ? '收起当前场景' : '展开当前场景'}
        onClick={() => { setOpen(value => !value) }}><span aria-hidden="true">✦</span></button>
      <button type="button" className="agent-rp-world-status" onClick={() => { setOpen(value => !value) }}>
        <strong>{state?.surface.title ?? '正在读取场景…'}</strong>
        <span>{processText}</span>
      </button>
      {open && <nav className="agent-rp-world-tabs" aria-label="场景面板">
        <button type="button" aria-current={pane === 'scene' ? 'page' : undefined}
          onClick={() => { setPane('scene') }}>场景</button>
        <button type="button" aria-current={pane === 'process' ? 'page' : undefined}
          onClick={() => { setPane('process') }}>进程</button>
      </nav>}
      <button type="button" className="agent-rp-world-edit"
        onClick={() => { navigation.request({ workspaceId, surface: 'studio' }) }}>资料</button>
      <button type="button" className="agent-rp-world-collapse" aria-label={open ? '收起' : '展开'}
        onClick={() => { setOpen(value => !value) }}><span aria-hidden="true">{open ? '⌃' : '⌄'}</span></button>
    </header>
    {open && <div className="agent-rp-world-panel">
      {state !== undefined && pane === 'scene' && <>
        <div className="agent-rp-world-lead"><p>{state.surface.summary}</p><dl>{state.surface.facts.map(fact => <div key={fact.label}>
          <dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl></div>
        {viewport}
        {state.workspace.world !== undefined && state.workspace.world.events.length > 0 && <details className="agent-rp-world-events">
          <summary>场景记录</summary>{[...state.workspace.world.events].reverse().slice(0, 5).map(event => <article key={event.id}>
            <strong>{event.title}</strong><span>{event.summary}</span></article>)}
        </details>}
      </>}
      {state !== undefined && pane === 'process' && <StoryProcessPanel workspace={state.workspace} progress={progress} />}
      {error !== undefined && <p className="agent-rp-world-error" role="alert">{error}</p>}
    </div>}
  </section>
}

/** Bind world-aware direction suggestions and checkpoint advancement to the native DSH composer. */
export function StoryDirectorDock({
  workspaceId, refreshKey, progress, draft, inputPhase, running, setDraft, submit, startFreshSession,
}: StoryDirectorDockProps) {
  const [state, setState] = useState<WorldSurfaceState>()
  const [error, setError] = useState<string>()
  const [restartArmed, setRestartArmed] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [restartError, setRestartError] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    setError(undefined)
    setRestartArmed(false)
    setRestartError(undefined)
    void readSurface(workspaceId, controller.signal).then(setState, (reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { controller.abort() }
  }, [refreshKey, workspaceId])
  const storyRunning = running || progress?.status === 'running'
  const hasDraft = draft.trim() !== ''
  const canSubmit = inputPhase === 'plain' && !restarting && (!storyRunning || hasDraft)
  const canRestart = state !== undefined && inputPhase === 'plain' && !storyRunning && !restarting
  const status = state === undefined
    ? error ?? '正在连接场地…'
    : storyRunning ? storyTurnProgressText(state.workspace, progress)
      : progress?.status === 'prepared' ? '正文即将呈现' : '写下一句方向，或留空让人物自行推进'
  const currentCharacter = state?.turn === null || state?.turn === undefined
    ? undefined
    : state.workspace.characters.find(character => character.id === state.turn?.characterId)?.name
  const advance = (): void => {
    if (!canSubmit) return
    if (!hasDraft) setDraft(STORY_AUTO_ADVANCE_INPUT)
    submit()
  }
  const restart = async (): Promise<void> => {
    if (!canRestart || state === undefined) return
    setRestarting(true)
    setRestartError(undefined)
    try {
      const restarted = await restartSurface(state)
      setState(restarted)
      await startFreshSession()
    } catch (reason) {
      setRestartError(reason instanceof Error ? reason.message : String(reason))
      setRestartArmed(false)
    } finally {
      setRestarting(false)
    }
  }
  return <section className="agent-rp-director-dock" data-running={storyRunning} data-confirming={restartArmed}>
    <div className="agent-rp-director-state">
      <span className="agent-rp-director-mark" aria-hidden="true">✦</span>
      <div><strong>{restarting ? '正在准备新棋局' : storyRunning ? '角色正在行动'
        : currentCharacter === undefined ? '导演席' : `${currentCharacter} 准备行动`}</strong>
        <span role="status">{status}</span></div>
    </div>
    <div className="agent-rp-director-actions">
      <button type="button" className="agent-rp-director-restart" disabled={!canRestart}
        onClick={() => { setRestartError(undefined); setRestartArmed(true) }}>新一局</button>
      <button type="button" className="agent-rp-director-advance" disabled={!canSubmit} onClick={advance}>
        {storyRunning && !hasDraft ? '角色行动中' : storyRunning ? '排入下一次介入'
          : hasDraft ? '按这个方向继续' : '让角色继续'}
      </button>
    </div>
    {restartArmed && <div className="agent-rp-director-confirm" role="group" aria-label="确认重新开局">
      <div><strong>确定从头开始？</strong><span>棋局、世界事件和人物临时状态会归零；角色与原著资料保留，旧聊天也会保留。</span></div>
      <button type="button" disabled={restarting} onClick={() => { setRestartArmed(false) }}>取消</button>
      <button type="button" className="agent-rp-director-confirm-primary" disabled={!canRestart}
        onClick={() => { void restart() }}>{restarting ? '正在重新开局…' : '确认新一局'}</button>
    </div>}
    {(error ?? restartError) !== undefined && <span className="agent-rp-director-error" role="alert">
      {restartError ?? error}
    </span>}
  </section>
}
