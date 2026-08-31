import assert from 'node:assert/strict'
import test from 'node:test'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  acquireStoryWorkspaceLaunchSource,
  openStoryWorkspaceSessionFromHostWorkspace,
  type StoryWorkspaceLaunchSessionService,
} from '../src/client/story-workspace-launch-source.ts'

const workspaceId = 'workspace-story' as WorkspaceId
const memberId = SessionId('session-member')
const otherId = SessionId('session-other')
const createdId = SessionId('session-created')

function workspace(sessionIds: readonly SessionId[]): Pick<WorkspaceView, 'workspaceId' | 'sessionIds'> {
  return { workspaceId, sessionIds }
}

function sessions(byId: Readonly<Partial<Record<SessionId, { readonly blank: boolean }>>>): StoryWorkspaceLaunchSessionService & {
  readonly calls: { readonly workspaceId: WorkspaceId }[]
} {
  const calls: { readonly workspaceId: WorkspaceId }[] = []
  return {
    list: { getSnapshot: () => ({ byId }) },
    calls,
    create: async options => {
      calls.push(options)
      return createdId
    },
  }
}

test('story Workspace launch source reuses only a current member Session', async () => {
  const service = sessions({ [memberId]: { blank: false }, [otherId]: { blank: false } })

  assert.deepEqual(
    await acquireStoryWorkspaceLaunchSource(service, workspace([memberId]), memberId),
    { sessionId: memberId, temporary: false },
  )
  assert.deepEqual(service.calls, [])

  assert.deepEqual(
    await acquireStoryWorkspaceLaunchSource(service, workspace([memberId]), otherId),
    { sessionId: createdId, temporary: true },
  )
  assert.deepEqual(service.calls, [{ workspaceId }])
})

test('story Workspace launch source creates a standard source without a current Session', async () => {
  const service = sessions({})

  assert.deepEqual(
    await acquireStoryWorkspaceLaunchSource(service, workspace([]), undefined),
    { sessionId: createdId, temporary: true },
  )
  assert.equal(service.calls.length, 1)
})

test('story Workspace launch retires a temporary source and leaves the native composer untouched', async () => {
  const service = sessions({ [createdId]: { blank: true } })
  const launchedId = SessionId('session-launched')
  const order: string[] = []

  const result = await openStoryWorkspaceSessionFromHostWorkspace(service, workspace([]), undefined, {
    launch: async sourceSessionId => {
      order.push(`launch:${sourceSessionId}`)
      return launchedId
    },
    archive: async sourceSessionId => { order.push(`archive:${sourceSessionId}`) },
  })

  assert.equal(result, launchedId)
  assert.deepEqual(order, [
    `launch:${createdId}`,
    `archive:${createdId}`,
  ])
})

test('story Workspace launch keeps an active source and cleans a temporary launch failure', async () => {
  const active = sessions({ [memberId]: { blank: false } })
  const activeArchive: SessionId[] = []
  const activeLaunchedId = SessionId('session-active-launch')
  assert.equal(await openStoryWorkspaceSessionFromHostWorkspace(active, workspace([memberId]), memberId, {
    launch: async () => activeLaunchedId,
    archive: async id => { activeArchive.push(id) },
  }), activeLaunchedId)
  assert.deepEqual(activeArchive, [])

  const temporary = sessions({ [createdId]: { blank: true } })
  const temporaryArchive: SessionId[] = []
  await assert.rejects(
    openStoryWorkspaceSessionFromHostWorkspace(temporary, workspace([]), undefined, {
      launch: async () => { throw new Error('launch failed') },
      archive: async id => { temporaryArchive.push(id) },
    }),
    /launch failed/u,
  )
  assert.deepEqual(temporaryArchive, [createdId])
})
