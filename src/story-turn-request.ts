/** Player-facing request text used to advance one story-workspace turn. */

import type { StoryWorkspaceSnapshot } from './story-workspace-protocol.ts'
import { storyPendingWorldEvents } from './story-world-events.ts'

const DEFAULT_TURN_REQUEST = '请从游玩场地的当前状态继续：让当前行动人物依据自己的认知选择一个合法世界动作，再把程序结算出的新事件写成这一回合的角色场面。'

/** Resolve the player's optional direction into one non-empty conversation message. */
export function resolveStoryTurnRequest(workspace: StoryWorkspaceSnapshot, direction: string): string {
  const requested = direction.trim()
  if (requested !== '') return requested
  const pending = storyPendingWorldEvents(workspace)
  if (pending.some(event => event.actorId !== undefined)) {
    return `请把游玩场地中尚未写入正文的规则结果（截至“${pending.at(-1)!.title}”）整理成这一回合的角色场面；不要执行新的世界动作。`
  }
  const latest = workspace.world?.events.at(-1)
  return latest === undefined
    ? DEFAULT_TURN_REQUEST
    : `请接着“${latest.title}”之后的当前状态继续：让当前行动人物依据自己的认知选择一个合法世界动作，再把程序结算出的新事件写成这一回合的角色场面。`
}
