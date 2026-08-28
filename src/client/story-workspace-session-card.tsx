/** Native Chat card for a Session connected to an executable play space. */

import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { useEffect, useState, type CSSProperties } from 'react'
import {
  readStoryWorkspaceLaunchSummary,
  storyWorkspaceLaunchDefinition,
  type StoryWorkspaceLaunchSummary,
} from './story-workspace-launch-node.ts'
import type { StoryWorkspaceNavigation } from './story-workspace-navigation.ts'
import css from './story-workspace-session-card.css?raw'

interface StoryWorkspaceSessionCardInjected {
  readonly openStoryWorkspace: (workspaceId: string) => void
}

type StoryWorkspaceSessionCardProps = PropsRuntime<
  'conversation.chat.node',
  'agent-rp-story-workspace-launch'
> & StoryWorkspaceSessionCardInjected

type SummaryState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly summary: StoryWorkspaceLaunchSummary }
  | { readonly status: 'error'; readonly message: string }

function StoryWorkspaceSessionCard({ node, openStoryWorkspace }: StoryWorkspaceSessionCardProps) {
  const workspaceId = node.data.workspaceId
  const [state, setState] = useState<SummaryState>({ status: 'loading' })
  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    void readStoryWorkspaceLaunchSummary(workspaceId).then(
      summary => { if (active) setState({ status: 'ready', summary }) },
      reason => {
        if (active) setState({
          status: 'error',
          message: reason instanceof Error ? reason.message : String(reason),
        })
      },
    )
    return () => { active = false }
  }, [workspaceId])

  const name = state.status === 'ready' ? state.summary.name : '已连接的游玩场地'
  return <article className="agent-rp-story-launch-card" data-agent-rp-story-workspace-launch={workspaceId}
    style={{ '--story-launch-accent': '#d5a64c' } as CSSProperties}>
    <div className="agent-rp-story-launch-heading">
      <span className="agent-rp-story-launch-mark" aria-hidden="true">✦</span>
      <span className="agent-rp-story-launch-title"><small>游玩场地已连接</small><strong>{name}</strong></span>
    </div>
    <p className="agent-rp-story-launch-copy">
      世界规则、人物认知、故事地图与生成流水线会在这个场地里持续更新；聊天只记录实际发生的游玩过程。
    </p>
    <div className="agent-rp-story-launch-facts" aria-label="场地概况">
      {state.status === 'loading' && <span className="agent-rp-story-launch-fact">正在读取场地…</span>}
      {state.status === 'ready' && <>
        {state.summary.worldTitle !== undefined && <span className="agent-rp-story-launch-fact">世界 · {state.summary.worldTitle}</span>}
        <span className="agent-rp-story-launch-fact">人物 · {state.summary.characterCount}</span>
      </>}
      {state.status === 'error' && <span className="agent-rp-story-launch-error" role="status">
        暂时无法读取场地概况：{state.message}
      </span>}
    </div>
    <button type="button" className="agent-rp-story-launch-action"
      onClick={() => { openStoryWorkspace(workspaceId) }}>打开游玩场地 <span aria-hidden="true">→</span></button>
  </article>
}

/** Register the launch projection, renderer, and apply-lifetime styles. */
export function installStoryWorkspaceSessionCard(
  ctx: Context,
  navigation: StoryWorkspaceNavigation,
): void {
  ctx.effect(
    () => ctx.uiConversation.events.register(storyWorkspaceLaunchDefinition),
    'agent-rp: project play-space Session launches',
  )
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.agentRpStoryWorkspaceSessionCard = ''
    style.textContent = css
    document.head.append(style)
    return () => { style.remove() }
  }, 'agent-rp: style play-space Session card')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'agent-rp-story-workspace-launch',
    inject: (): StoryWorkspaceSessionCardInjected => ({
      openStoryWorkspace: workspaceId => { navigation.request({ workspaceId }) },
    }),
  }, StoryWorkspaceSessionCard))
}
