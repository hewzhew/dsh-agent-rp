/** Compact, browser-safe presentation helpers for one story-workspace turn. */

import type { AgentRpStoryTurnProgress, AgentRpStoryTurnStage } from '../projection-types.ts'
import type { StoryWorkspaceSnapshot } from '../story-workspace-protocol.ts'

/** Public aggregate used to name one native DSH Turn-process disclosure. */
export interface StoryTurnProcessSummary {
  readonly status: 'running' | 'succeeded' | 'failed' | 'aborted'
  readonly stageCount: number
  readonly completedStageCount: number
}

/** Human labels for the durable story Worker stages. */
export const storyTurnStageLabels: Readonly<Record<AgentRpStoryTurnStage, string>> = {
  'world-action': '推进场地规则',
  cast: '确认本轮人物',
  history: '检索人物经历',
  research: '查找资料',
  character: '推演人物行动',
  director: '规划剧情',
  section: '撰写输出分区',
  voice: '校准人物对白',
  editor: '删去套话',
  continuity: '整理事件与认知',
}

/** Resolve a stage label whose visible responsibility changes across voice retries. */
export function storyTurnStageLabel(stage: AgentRpStoryTurnStage, subjectId?: string): string {
  if (stage !== 'voice' || subjectId === undefined) return storyTurnStageLabels[stage]
  if (subjectId.startsWith('draft:')) return '生成对白候选'
  if (subjectId.startsWith('review:')) return '审校人物对白'
  if (subjectId.startsWith('retry-draft:')) return '重写对白候选'
  if (subjectId.startsWith('retry-review:')) return '复核人物对白'
  return storyTurnStageLabels.voice
}

/** Resolve a logged subject identifier to its visible character or output name. */
export function storyTurnSubjectName(
  workspace: StoryWorkspaceSnapshot,
  subjectId: string | undefined,
): string | undefined {
  if (subjectId === undefined) return undefined
  const character = workspace.characters.find(candidate => subjectId.includes(candidate.id))
  if (character !== undefined) return character.name
  return workspace.outputs.find(output => output.id === subjectId)?.name
}

/** Describe the current pipeline state without exposing private Worker prompts. */
export function storyTurnProgressText(
  workspace: StoryWorkspaceSnapshot | undefined,
  progress: AgentRpStoryTurnProgress | undefined,
): string {
  if (workspace === undefined || progress === undefined || progress.workspaceId !== workspace.id) {
    return '等待玩家行动'
  }
  if (progress.status === 'complete') return '本轮已归档'
  if (progress.status === 'prepared') return '正文等待呈现'
  if (progress.status === 'aborted') return '本轮已中止，可以重试'
  if (progress.status === 'failed') return '本轮未完成，可以重试'
  const running = progress.requests.findLast(request => request.status === 'running')
  if (running !== undefined) {
    const subject = storyTurnSubjectName(workspace, running.subjectId)
    return `正在${storyTurnStageLabel(running.stage, running.subjectId)}${subject === undefined ? '' : ` · ${subject}`}`
  }
  const latest = progress.requests.at(-1)
  if (latest === undefined) return '正在准备本轮'
  return latest.status === 'failed'
    ? `${storyTurnStageLabel(latest.stage, latest.subjectId)}已跳过，继续下一阶段`
    : `${storyTurnStageLabel(latest.stage, latest.subjectId)}完成`
}

/** Format one bounded stage duration for the local session UI. */
export function storyTurnDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000))
  if (seconds < 60) return `${String(seconds)} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder === 0 ? `${String(minutes)} 分钟` : `${String(minutes)} 分 ${String(remainder)} 秒`
}

/** Name the native Turn-process row without exposing Worker prompts or outputs. */
export function storyTurnProcessLabel(summary: StoryTurnProcessSummary): string {
  const stages = summary.stageCount === 0 ? '' : ` · ${String(summary.stageCount)} 个阶段`
  if (summary.status === 'succeeded') return `故事回合${stages}`
  if (summary.status === 'aborted') return `故事回合已中止${stages}`
  if (summary.status === 'failed') return `故事回合未完成${stages}`
  if (summary.stageCount === 0) return '正在准备故事回合'
  return `执行故事回合 · ${String(summary.completedStageCount)}/${String(summary.stageCount)} 个阶段`
}
