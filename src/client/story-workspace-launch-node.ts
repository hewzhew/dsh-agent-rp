/** Durable Chat projection for a Session launched from one play space. */

import type {
  ChatConversationViewNode,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { STORY_WORKSPACES_PATH } from '../story-workspace-protocol.ts'

/** Stable payload rendered by the play-space launch Chat card. */
export interface StoryWorkspaceLaunchChatData {
  readonly workspaceId: string
}

/** Current display facts fetched from the authoritative play space. */
export interface StoryWorkspaceLaunchSummary {
  readonly name: string
  readonly worldTitle?: string
  readonly characterCount: number
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Session-level entry point for the play space selected at launch. */
    'agent-rp-story-workspace-launch': StoryWorkspaceLaunchChatData
  }
}

interface StoryWorkspaceLaunchState {
  readonly workspaceId: string
}

interface StoryWorkspaceReadResponse {
  readonly format?: number
  readonly workspace?: {
    readonly name?: unknown
    readonly characters?: unknown
    readonly world?: { readonly title?: unknown }
  }
  readonly error?: string
}

function workspaceIdFromLaunchEvent(event: {
  readonly type: string
  readonly seq: number
  readonly data: unknown
}): string | undefined {
  if (event.type !== 'agent-rp/story-workspace-selection' || event.seq !== 0
    || typeof event.data !== 'object' || event.data === null || Array.isArray(event.data)) return undefined
  const data = event.data as Record<string, unknown>
  return data.format === 0 && data.source === 'launch' && data.sourceEventSeq === undefined
    && typeof data.workspaceId === 'string' && data.workspaceId !== ''
    ? data.workspaceId
    : undefined
}

/** Build the same-origin URL for one play-space launch card read. */
export function storyWorkspaceLaunchUrl(workspaceId: string): string {
  return `${STORY_WORKSPACES_PATH}/${encodeURIComponent(workspaceId)}`
}

/** Read the small current summary shown by a durable launch card. */
export async function readStoryWorkspaceLaunchSummary(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<StoryWorkspaceLaunchSummary> {
  const response = await fetcher(storyWorkspaceLaunchUrl(workspaceId), {
    headers: { accept: 'application/json' },
  })
  const text = await response.text()
  let value: StoryWorkspaceReadResponse
  try {
    value = JSON.parse(text) as StoryWorkspaceReadResponse
  } catch {
    throw new Error(`游玩场地响应无法识别（${response.status}）`)
  }
  if (!response.ok) throw new Error(value.error ?? `游玩场地请求失败（${response.status}）`)
  const workspace = value.workspace
  if (value.format !== 1 || workspace === undefined || typeof workspace.name !== 'string'
    || !Array.isArray(workspace.characters)) throw new Error('游玩场地读取响应无效')
  const worldTitle = typeof workspace.world?.title === 'string' ? workspace.world.title : undefined
  return {
    name: workspace.name,
    ...(worldTitle === undefined ? {} : { worldTitle }),
    characterCount: workspace.characters.length,
  }
}

/** Project only the launch seed, not later interactive workspace changes. */
export const storyWorkspaceLaunchDefinition: ConversationNodeDefinition<StoryWorkspaceLaunchState> = {
  kind: 'agent-rp-story-workspace-launch',
  target: 'chat',
  match: (event) => {
    const workspaceId = workspaceIdFromLaunchEvent(event)
    return workspaceId === undefined ? null : { id: 'launch', role: 'start' }
  },
  start: (_context, match) => {
    const workspaceId = workspaceIdFromLaunchEvent(match.event)
    if (workspaceId === undefined) throw new Error('游玩场地启动节点无效')
    return { workspaceId }
  },
  update: context => context.state,
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined || context.state === undefined) return null
    return {
      key: context.key,
      kind: 'agent-rp-story-workspace-launch',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data: { workspaceId: context.state.workspaceId },
    }
  },
}
