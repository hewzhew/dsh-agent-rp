import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveStoryWorkspaceSessionAction } from '../src/client/story-workspace-session-action.ts'

const availability = {
  workspaceId: 'story-one',
  currentSessionId: 'session-one',
  launchTargetId: 'host-workspace-one',
  canStart: true,
  canContinue: true,
} as const

test('continues only when the current Session belongs to the selected play space', () => {
  assert.equal(resolveStoryWorkspaceSessionAction({
    ...availability,
    currentSessionWorkspaceId: 'story-one',
  }), 'continue')
})

test('starts a new Session when a roleplay Session belongs to another play space', () => {
  assert.equal(resolveStoryWorkspaceSessionAction({
    ...availability,
    currentSessionWorkspaceId: 'story-two',
  }), 'start')
})

test('does not offer an unavailable start for another play space', () => {
  assert.equal(resolveStoryWorkspaceSessionAction({
    ...availability,
    currentSessionWorkspaceId: 'story-two',
    launchTargetId: undefined,
  }), undefined)
})
