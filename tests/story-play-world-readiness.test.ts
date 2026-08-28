import assert from 'node:assert/strict'
import test from 'node:test'
import type { StoryCharacter, StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'
import {
  inspectStoryPlayWorldReadiness,
  storyPlayWorldParticipants,
} from '../src/client/story-play-world-readiness.ts'

function character(id: string, name: string, options: {
  readonly actor?: boolean
  readonly dialogue?: string
  readonly voiceAliases?: readonly string[]
} = {}): StoryCharacter {
  return {
    id,
    name,
    ...(options.voiceAliases === undefined ? {} : { voiceAliases: options.voiceAliases }),
    profile: {
      description: '',
      personality: '',
      scenario: '',
      exampleDialogue: options.dialogue ?? '',
      systemPrompt: '',
      postHistoryInstructions: '',
    },
    state: { location: '', condition: '', objective: '', notes: '' },
    ...(options.actor === true ? { actor: { kind: 'actor', id: `actor:${id}` } as const } : {}),
  }
}

test('reports real readiness only for the installed flying-chess cast', () => {
  const reimu = character('reimu', '博丽灵梦', { actor: true, voiceAliases: ['霊夢'] })
  const marisa = character('marisa', '雾雨魔理沙', { dialogue: '魔理沙：「借走的东西会好好还的。」' })
  const alice = character('alice', '爱丽丝', { actor: true, dialogue: '爱丽丝：「你好。」' })
  const workspace = {
    format: 2,
    id: 'story-readiness',
    name: 'Readiness',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    pipeline: { maxParallel: 4, researchMaxPasses: 2, voiceDraftReasoning: 'routine' },
    graph: { nodes: [], edges: [] },
    characters: [reimu, marisa, alice],
    facts: [],
    events: [],
    outputs: [],
    sources: [{
      id: 'source-dialogue',
      name: '原作对话',
      kind: 'original',
      enabled: true,
      content: '原文：\n霊夢：「また異変？」\n魔理沙：「面白そうだな。」\n参考译文：\n灵梦：「又是异变？」\n魔理沙：「看起来很有趣。」',
    }],
    citations: [],
    researchInbox: [],
    world: {
      format: 0,
      instanceId: 'world-1',
      moduleId: 'agent-rp/flying-chess',
      moduleVersion: 1,
      title: '幻想乡飞行棋',
      state: {
        kind: 'flying-chess',
        turn: 1,
        playerOrder: ['reimu', 'marisa'],
        currentPlayerId: 'reimu',
        pieces: [],
      },
      events: [],
    },
  } satisfies StoryWorkspaceSnapshot

  assert.deepEqual(storyPlayWorldParticipants(workspace).map(item => item.id), ['reimu', 'marisa'])
  const readiness = inspectStoryPlayWorldReadiness(workspace)
  assert.equal(readiness.enabledProseOutputCount, 0)
  assert.equal(readiness.originalSourceCount, 1)
  assert.deepEqual(readiness.missingActors.map(item => item.id), ['marisa'])
  assert.deepEqual(readiness.missingDialogue.map(item => item.id), ['reimu'])
  assert.deepEqual(readiness.missingSourceVoice, [])
})

test('does not count disabled or non-original sources as voice evidence', () => {
  const reimu = character('reimu', '博丽灵梦', { voiceAliases: ['霊夢'] })
  const workspace = {
    format: 2,
    id: 'story-no-source',
    name: 'No source',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    pipeline: { maxParallel: 4, researchMaxPasses: 2, voiceDraftReasoning: 'routine' },
    graph: { nodes: [], edges: [] },
    characters: [reimu],
    facts: [],
    events: [],
    outputs: [],
    sources: [
      { id: 'disabled', name: '关闭的原著', kind: 'original', enabled: false, content: '霊夢：「测试。」' },
      { id: 'reference', name: '参考资料', kind: 'reference', enabled: true, content: '霊夢：「测试。」' },
    ],
    citations: [],
    researchInbox: [],
  } satisfies StoryWorkspaceSnapshot

  const readiness = inspectStoryPlayWorldReadiness(workspace)
  assert.equal(readiness.originalSourceCount, 0)
  assert.deepEqual(readiness.missingSourceVoice.map(item => item.id), ['reimu'])
})

test('requires an enabled prose output before a world can write a turn', () => {
  const workspace = {
    format: 2,
    id: 'story-output-readiness',
    name: 'Output readiness',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    pipeline: { maxParallel: 4, researchMaxPasses: 2, voiceDraftReasoning: 'routine' },
    graph: { nodes: [], edges: [] },
    characters: [],
    facts: [],
    events: [],
    outputs: [
      { id: 'disabled-prose', name: '关闭正文', kind: 'prose', enabled: false, instructions: '' },
      { id: 'history', name: '棋局记录', kind: 'history', enabled: true, instructions: '' },
      { id: 'prose', name: '正文', kind: 'prose', enabled: true, instructions: '' },
    ],
    sources: [],
    citations: [],
    researchInbox: [],
  } satisfies StoryWorkspaceSnapshot

  assert.equal(inspectStoryPlayWorldReadiness(workspace).enabledProseOutputCount, 1)
})
