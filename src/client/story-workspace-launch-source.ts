/** Source-Session selection for starting a play-space Session. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'

interface StoryWorkspaceLaunchSessionList {
  readonly getSnapshot: () => {
    readonly byId: Readonly<Partial<Record<SessionId, { readonly blank: boolean }>>>
  }
}

/** Minimal Session service used to acquire a launch source. */
export interface StoryWorkspaceLaunchSessionService {
  readonly list: StoryWorkspaceLaunchSessionList
  create(options: { readonly workspaceId: WorkspaceId }): Promise<SessionId>
}

/** A source Session and whether Agent RP created it only for this launch. */
export interface StoryWorkspaceLaunchSource {
  readonly sessionId: SessionId
  readonly temporary: boolean
}

/** Session launch and source retirement operations supplied by the client shell. */
export interface StoryWorkspaceOpenOperations {
  launch(sourceSessionId: SessionId): Promise<SessionId>
  archive(sourceSessionId: SessionId): Promise<void>
}

/**
 * Reuse the current Session only when it is an authoritative member of the
 * selected Host Workspace; otherwise create a standard temporary Session in
 * that Workspace.
 * @param sessions - Client Session service.
 * @param workspace - Explicit Host Workspace selected by the player.
 * @param currentSessionId - Current Session, when one is selected.
 * @returns the source whose model, cwd, and Agent settings may be inherited.
 */
export async function acquireStoryWorkspaceLaunchSource(
  sessions: StoryWorkspaceLaunchSessionService,
  workspace: Pick<WorkspaceView, 'workspaceId' | 'sessionIds'>,
  currentSessionId: SessionId | undefined,
): Promise<StoryWorkspaceLaunchSource> {
  if (currentSessionId !== undefined
    && workspace.sessionIds.includes(currentSessionId)
    && sessions.list.getSnapshot().byId[currentSessionId] !== undefined) {
    return { sessionId: currentSessionId, temporary: false }
  }
  return {
    sessionId: await sessions.create({ workspaceId: workspace.workspaceId }),
    temporary: true,
  }
}

/**
 * Open a play-space Session through a selected Host Workspace and retire only
 * a consumed blank or temporary source. The launched Session remains blank so
 * the native DSH composer owns the player's first free-form input.
 * @param sessions - Client Session service.
 * @param workspace - Explicit Host Workspace selected by the player.
 * @param currentSessionId - Current Session, when one is selected.
 * @param operations - Seeded launch and source archival operations.
 * @returns the launched Session selected by the client shell.
 */
export async function openStoryWorkspaceSessionFromHostWorkspace(
  sessions: StoryWorkspaceLaunchSessionService,
  workspace: Pick<WorkspaceView, 'workspaceId' | 'sessionIds'>,
  currentSessionId: SessionId | undefined,
  operations: StoryWorkspaceOpenOperations,
): Promise<SessionId> {
  const source = await acquireStoryWorkspaceLaunchSource(sessions, workspace, currentSessionId)
  let launchedSessionId: SessionId
  try {
    launchedSessionId = await operations.launch(source.sessionId)
  } catch (reason: unknown) {
    if (source.temporary) await operations.archive(source.sessionId)
    throw reason
  }
  if (source.temporary || sessions.list.getSnapshot().byId[source.sessionId]?.blank === true) {
    await operations.archive(source.sessionId)
  }
  return launchedSessionId
}
