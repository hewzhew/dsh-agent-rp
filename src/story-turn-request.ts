/** Player-facing request text used to advance one story-workspace turn. */

import type { StoryWorkspaceSnapshot } from './story-workspace-protocol.ts'

const DEFAULT_TURN_REQUEST = '请把游玩场地中最新发生的世界事件写成这一回合的角色场面，让人物依据各自掌握的信息自然反应；棋局停在场地当前状态。'

/** Resolve the player's optional direction into one non-empty conversation message. */
export function resolveStoryTurnRequest(workspace: StoryWorkspaceSnapshot, direction: string): string {
  const requested = direction.trim()
  if (requested !== '') return requested
  const latest = workspace.world?.events.at(-1)
  return latest === undefined
    ? DEFAULT_TURN_REQUEST
    : `请把“${latest.title}”这条已经发生的世界事件写成角色场面，让人物依据各自掌握的信息自然反应；棋局停在场地当前状态。`
}
