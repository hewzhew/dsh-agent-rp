import assert from 'node:assert/strict'
import test from 'node:test'
import { groupStoryTimeline } from '../src/story-timeline.ts'
import type { StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'

test('groups events by canonical arcs while preserving unassigned history', () => {
  const workspace = {
    graph: {
      nodes: [
        { id: 'arc-one', kind: 'arc', lifecycle: 'canonical', status: 'active', title: '第一幕', summary: '棋局刚刚开始。' },
        { id: 'scene-one', kind: 'beat', lifecycle: 'canonical', status: 'active', parentId: 'arc-one', title: '赛前约定', summary: '' },
        { id: 'scene-two', kind: 'beat', lifecycle: 'canonical', status: 'planned', parentId: 'arc-one', title: '棋局开场', summary: '' },
        { id: 'standalone', kind: 'beat', lifecycle: 'canonical', status: 'completed', title: '尾声', summary: '收好棋子。' },
      ],
    },
    events: [
      { id: 'event-three', turn: 3, title: '收局', nodeId: 'standalone' },
      { id: 'event-one', turn: 1, title: '定下规则', nodeId: 'scene-one' },
      { id: 'event-four', turn: 4, title: '未整理的插曲' },
      { id: 'event-two', turn: 2, title: '灵梦先手', nodeId: 'scene-two' },
    ],
  } as unknown as StoryWorkspaceSnapshot

  const groups = groupStoryTimeline(workspace)
  assert.deepEqual(groups.map(group => ({
    key: group.key,
    title: group.title,
    summary: group.summary,
    turns: [group.firstTurn, group.lastTurn],
    events: group.events.map(event => event.title),
  })), [
    { key: 'arc-one', title: '第一幕', summary: '棋局刚刚开始。', turns: [1, 2], events: ['定下规则', '灵梦先手'] },
    { key: 'standalone', title: '尾声', summary: '收好棋子。', turns: [3, 3], events: ['收局'] },
    {
      key: 'unassigned',
      title: '未归入故事簇',
      summary: '这些事件尚未关联到故事地图中的正式篇章或场景。',
      turns: [4, 4],
      events: ['未整理的插曲'],
    },
  ])
})

test('does not use suggested or dropped nodes as timeline groups', () => {
  const workspace = {
    graph: { nodes: [
      { id: 'suggested', kind: 'arc', lifecycle: 'suggested', status: 'planned', title: '候选篇章', summary: '' },
      { id: 'dropped', kind: 'beat', lifecycle: 'canonical', status: 'dropped', title: '废弃场景', summary: '' },
    ] },
    events: [
      { id: 'event-one', turn: 1, title: '候选事件', nodeId: 'suggested' },
      { id: 'event-two', turn: 2, title: '废弃事件', nodeId: 'dropped' },
    ],
  } as unknown as StoryWorkspaceSnapshot

  assert.deepEqual(groupStoryTimeline(workspace).map(group => group.key), ['unassigned'])
})
