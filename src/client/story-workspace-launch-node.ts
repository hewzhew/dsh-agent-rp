/** Durable Chat projection for a Session launched from one play space. */

import type {
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
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

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Session-level entry point for the play space selected at launch. */
    'agent-rp-story-workspace-launch': StoryWorkspaceLaunchChatData
  }
}

interface StoryWorkspaceLaunchState {
  readonly workspaceId?: string
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

type StoryWorkspaceSelection =
  | { readonly kind: 'launch'; readonly workspaceId: string }
  | { readonly kind: 'change'; readonly workspaceId?: string }

function storyWorkspaceSelectionFromEvent(event: {
  readonly type: string
  readonly seq: number
  readonly data: unknown
}): StoryWorkspaceSelection | undefined {
  if (event.type !== 'agent-rp/story-workspace-selection'
    || typeof event.data !== 'object' || event.data === null || Array.isArray(event.data)) return undefined
  const data = event.data as Record<string, unknown>
  if (data.format !== 0 || !(data.workspaceId === undefined
    || (typeof data.workspaceId === 'string' && data.workspaceId !== ''))) return undefined
  if (data.source === 'launch') {
    return event.seq === 0 && data.sourceEventSeq === undefined && typeof data.workspaceId === 'string'
      ? { kind: 'launch', workspaceId: data.workspaceId }
      : undefined
  }
  if (data.source !== undefined || !Number.isSafeInteger(data.sourceEventSeq)
    || Number(data.sourceEventSeq) < 0 || Number(data.sourceEventSeq) >= event.seq) return undefined
  return {
    kind: 'change',
    ...(typeof data.workspaceId === 'string' ? { workspaceId: data.workspaceId } : {}),
  }
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

/** Project the play space currently selected by one launched Session. */
export const storyWorkspaceLaunchDefinition: ConversationNodeDefinition<StoryWorkspaceLaunchState> = {
  kind: 'agent-rp-story-workspace-launch',
  target: 'chat',
  match: (event) => {
    const selection = storyWorkspaceSelectionFromEvent(event)
    return selection === undefined ? null : {
      id: 'launch',
      role: selection.kind === 'launch' ? 'start' : 'update',
    }
  },
  start: (_context, match) => {
    const selection = storyWorkspaceSelectionFromEvent(match.event)
    if (selection?.kind !== 'launch') throw new Error('游玩场地启动节点无效')
    return { workspaceId: selection.workspaceId }
  },
  update: (context, match) => {
    const selection = storyWorkspaceSelectionFromEvent(match.event)
    if (selection?.kind !== 'change') return context.state
    return selection.workspaceId === undefined ? {} : { workspaceId: selection.workspaceId }
  },
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined || context.state?.workspaceId === undefined) return null
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
