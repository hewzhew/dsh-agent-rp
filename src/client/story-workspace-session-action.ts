/** Available Session action for the selected play space. */
export type StoryWorkspaceSessionAction = 'start' | 'continue' | undefined

/**
 * Choose whether the selected play space continues the current Session or starts a new one.
 *
 * A roleplay Session can only continue the play space recorded by its latest story turn.
 */
export function resolveStoryWorkspaceSessionAction({
  workspaceId,
  currentSessionId,
  currentSessionWorkspaceId,
  launchTargetId,
  canStart,
  canContinue,
}: {
  readonly workspaceId: string
  readonly currentSessionId: string | undefined
  readonly currentSessionWorkspaceId: string | undefined
  readonly launchTargetId: string | undefined
  readonly canStart: boolean
  readonly canContinue: boolean
}): StoryWorkspaceSessionAction {
  if (canContinue && currentSessionId !== undefined && currentSessionWorkspaceId === workspaceId) {
    return 'continue'
  }
  if (canStart && launchTargetId !== undefined) return 'start'
  return undefined
}
