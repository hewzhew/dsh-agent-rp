/** Native Chat rows for story Workers and authoritative world evidence. */

import type { Context } from '@deepseek-ai/cordis'
import { DisclosureRow, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { useEffect, useState } from 'react'
import { STORY_WORKSPACES_PATH } from '../story-workspace-protocol.ts'
import { storyTurnDuration, storyTurnStageLabel } from './story-turn-progress.ts'
import {
  storyWorkspaceStageDefinition,
  storyWorkspaceWorldEvidenceDefinition,
  type StoryWorkspaceStageChatData,
} from './story-workspace-stage-node.ts'
import css from './story-workspace-stage-card.css?raw'

type StoryWorkspaceStageProps = PropsRuntime<'conversation.chat.node', 'agent-rp-story-stage'>
type StoryWorkspaceWorldEvidenceProps = PropsRuntime<'conversation.chat.node', 'agent-rp-story-world-evidence'>

async function readWorkspaceLabels(workspaceId: string, signal: AbortSignal): Promise<Readonly<Record<string, string>>> {
  const response = await fetch(`${STORY_WORKSPACES_PATH}/${encodeURIComponent(workspaceId)}`, {
    headers: { accept: 'application/json' }, signal,
  })
  if (!response.ok) return {}
  const value = await response.json() as {
    readonly workspace?: {
      readonly characters?: readonly { readonly id?: unknown; readonly name?: unknown }[]
      readonly outputs?: readonly { readonly id?: unknown; readonly name?: unknown }[]
    }
  }
  return Object.fromEntries([...value.workspace?.characters ?? [], ...value.workspace?.outputs ?? []]
    .flatMap(item => typeof item.id === 'string' && typeof item.name === 'string' ? [[item.id, item.name]] : []))
}

function subjectName(labels: Readonly<Record<string, string>>, subjectId: string | undefined): string | undefined {
  if (subjectId === undefined) return undefined
  const id = Object.keys(labels).find(candidate => subjectId === candidate || subjectId.includes(candidate))
  return id === undefined ? undefined : labels[id]
}

function stageTitle(stage: StoryWorkspaceStageChatData, labels: Readonly<Record<string, string>>): string {
  const subject = subjectName(labels, stage.subjectId)
  const label = storyTurnStageLabel(stage.stage, stage.subjectId)
  return subject === undefined ? label : `${label} · ${subject}`
}

function stageStatus(stage: StoryWorkspaceStageChatData): string {
  if (stage.status === 'running') return '进行中'
  if (stage.finishedAt === undefined) return stage.status === 'failed' ? '未完成' : '完成'
  const duration = storyTurnDuration(Math.max(0, stage.finishedAt - stage.startedAt))
  return stage.status === 'failed' ? `${duration} · 未完成` : duration
}

function StoryWorkspaceStage({ node }: StoryWorkspaceStageProps) {
  const data = node.data
  const [labels, setLabels] = useState<Readonly<Record<string, string>>>({})
  useEffect(() => {
    const controller = new AbortController()
    void readWorkspaceLabels(data.workspaceId, controller.signal).then(setLabels, () => {})
    return () => { controller.abort() }
  }, [data.workspaceId])
  const state = data.status === 'running' ? 'ongoing' : data.status === 'failed' ? 'warning' : 'done'
  return <div className="agent-rp-story-stage" data-state={data.status} data-agent-rp-story-stage={data.stage}>
    <StateDot state={state} />
    <span className="agent-rp-story-stage-title">{stageTitle(data, labels)}</span>
    <span className="agent-rp-story-stage-status">{stageStatus(data)}</span>
    {data.failure !== undefined && <span className="agent-rp-story-stage-failure">{data.failure}</span>}
  </div>
}

function StoryWorkspaceWorldEvidence({ node }: StoryWorkspaceWorldEvidenceProps) {
  const [open, setOpen] = useState(false)
  const count = `${String(node.data.events.length)} 个规则事件`
  return <div className="agent-rp-story-world-evidence" data-agent-rp-story-world-evidence>
    <DisclosureRow
      rowClassName="agent-rp-story-world-evidence-row"
      leadingClassName="agent-rp-story-world-evidence-leading"
      titleClassName="agent-rp-story-world-evidence-title"
      chevronClassName="agent-rp-story-world-evidence-chevron"
      icon={<StateDot state="done" />}
      title="场地结算"
      open={open}
      expandable
      expandOnRowClick
      keepContentWhenOpen
      onToggle={() => { setOpen(value => !value) }}
      collapsedContent={<>
        <span className="agent-rp-story-world-evidence-separator" aria-hidden />
        <span className="agent-rp-story-world-evidence-summary">{count}</span>
      </>}
    >
      <div className="agent-rp-story-world-evidence-body">
        {node.data.events.map((event, index) => <div className="agent-rp-story-world-evidence-event"
            key={`${event.type}:${String(index)}`}>
          <strong>{event.title}</strong>
          {event.summary !== '' && <span>{event.summary}</span>}
        </div>)}
      </div>
    </DisclosureRow>
  </div>
}

/** Register the story-stage projections, renderers, and apply-lifetime styles. */
export function installStoryWorkspaceStageCard(ctx: Context): void {
  ctx.effect(
    () => ctx.uiConversation.events.register(storyWorkspaceStageDefinition),
    'agent-rp: project story Worker stage',
  )
  ctx.effect(
    () => ctx.uiConversation.events.register(storyWorkspaceWorldEvidenceDefinition),
    'agent-rp: project story world evidence',
  )
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.agentRpStoryWorkspaceStageCard = ''
    style.textContent = css
    document.head.append(style)
    return () => { style.remove() }
  }, 'agent-rp: style story execution rows')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'agent-rp-story-stage',
  }, StoryWorkspaceStage))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'agent-rp-story-world-evidence',
  }, StoryWorkspaceWorldEvidence))
}
