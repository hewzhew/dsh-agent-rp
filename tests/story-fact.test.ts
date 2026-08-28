import assert from 'node:assert/strict'
import test from 'node:test'
import { createEventObservationFact, removeStoryFact } from '../src/story-fact.ts'
import type { StoryEvent, StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'

const event: StoryEvent = {
  id: 'event-00000000-0000-4000-8000-000000000001',
  key: 'turn:1',
  turn: 1,
  title: '走进赛场',
  summary: '灵梦和魔理沙抵达飞行棋赛场。',
  evidence: '魔理沙藏起了一枚备用骰子。',
  participantIds: ['character-00000000-0000-4000-8000-000000000001'],
  nodeId: 'node-00000000-0000-4000-8000-000000000001',
}

test('an event observation starts hidden until actual knowers are selected', () => {
  const fact = createEventObservationFact('fact-00000000-0000-4000-8000-000000000001', event)

  assert.equal(fact.nodeId, event.nodeId)
  assert.deepEqual(fact.knownBy, [])
  assert.equal(fact.knowledgeMode, 'override')
  assert.deepEqual(fact.source, { kind: 'event', eventId: event.id, evidence: event.evidence })
})

test('removing a fact also detaches citations that targeted it', () => {
  const fact = createEventObservationFact('fact-00000000-0000-4000-8000-000000000001', event)
  const workspace: StoryWorkspaceSnapshot = {
    format: 2,
    id: 'story-00000000-0000-4000-8000-000000000001',
    name: '认知编辑验收',
    revision: 0,
    createdAt: 0,
    updatedAt: 0,
    pipeline: { maxParallel: 1, researchMaxPasses: 1, voiceDraftReasoning: 'routine' },
    graph: { nodes: [], edges: [] },
    characters: [],
    facts: [fact],
    events: [event],
    outputs: [],
    sources: [{
      id: 'source-00000000-0000-4000-8000-000000000001',
      name: '原著记录',
      kind: 'original',
      enabled: true,
      content: '',
    }],
    citations: [{
      id: 'citation-00000000-0000-4000-8000-000000000001',
      sourceId: 'source-00000000-0000-4000-8000-000000000001',
      locator: '第 1 页',
      quote: '备用骰子只被一人看见。',
      note: '',
      target: { kind: 'fact' as const, factId: fact.id },
    }],
    researchInbox: [],
  }

  const removed = removeStoryFact(workspace, fact.id)

  assert.deepEqual(removed.facts, [])
  assert.equal(removed.citations[0]?.target, undefined)
})
