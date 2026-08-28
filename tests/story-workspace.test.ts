import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { StoryCharacter, StoryWorkspaceSaveRequest, StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'
import { searchStoryWorkspaceSources } from '../src/story-research.ts'
import { splitStorySourcePassages, storySourcePassageSections } from '../src/story-source.ts'
import {
  acceptStorySuggestionBatch,
  rejectStorySuggestionBatch,
  storySuggestionBatch,
} from '../src/story-suggestion-batch.ts'
import {
  compileStoryCharacterContext,
  createStoryCharacterId,
  createStoryCitationId,
  createStoryEdgeId,
  createStoryEventId,
  createStoryFactId,
  createStoryNodeId,
  createStoryOutputId,
  createStorySourceId,
  storyDirectorMap,
  storyOpenForeshadowing,
  storyPublicHistory,
  StoryWorkspaceStore,
} from '../src/story-workspace.ts'

function editable(snapshot: StoryWorkspaceSnapshot): StoryWorkspaceSaveRequest {
  return {
    format: 2,
    id: snapshot.id,
    revision: snapshot.revision,
    name: snapshot.name,
    pipeline: snapshot.pipeline,
    graph: snapshot.graph,
    characters: snapshot.characters,
    facts: snapshot.facts,
    events: snapshot.events,
    outputs: snapshot.outputs,
    sources: snapshot.sources,
    citations: snapshot.citations,
    researchInbox: snapshot.researchInbox,
  }
}

function character(id: string, name: string, description = ''): StoryCharacter {
  return {
    id,
    name,
    profile: { description, personality: '', scenario: '', exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '' },
    state: { location: '', condition: '', objective: '', notes: '' },
  }
}

test('persists typed story objects and rejects stale whole-workspace writes', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-workspace-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: ' 长夜 ' })
  const characterId = createStoryCharacterId()
  const nodeId = createStoryNodeId()
  const outputId = createStoryOutputId()
  const sourceId = createStorySourceId()
  const factId = createStoryFactId()
  const nodeCitationId = createStoryCitationId()
  const factCitationId = createStoryCitationId()

  assert.deepEqual(created.pipeline, { maxParallel: 4, researchMaxPasses: 2, voiceDraftReasoning: 'routine' })
  const saved = store.save({
    format: 2,
    id: created.id,
    revision: created.revision,
    name: '长夜',
    pipeline: {
      maxParallel: 3,
      researchMaxPasses: 3,
      voiceDraftReasoning: 'quality',
      workerModel: { provider: 'fast', model: 'story' },
    },
    graph: {
      activeNodeId: nodeId,
      nodes: [{
        id: nodeId,
        kind: 'beat',
        title: '雪夜重逢',
        summary: '在雪夜车站重逢。',
        status: 'active',
        lifecycle: 'canonical',
        audience: 'public',
        position: { x: 240, y: 80 },
        content: '先在车站重逢。',
        participantIds: [characterId],
        knowledge: { mode: 'participants', characterIds: [] },
      }],
      edges: [],
    },
    characters: [character(characterId, '小满', '怕冷，谨慎。')],
    facts: [{
      id: factId,
      text: '她知道车票背面的字。',
      status: 'asserted',
      audience: 'director',
      knowledgeMode: 'override',
      knownBy: [characterId],
      source: { kind: 'manual' },
    }],
    events: [],
    outputs: [{
      id: outputId,
      name: '小满视角',
      kind: 'character',
      enabled: true,
      characterId,
      instructions: '夜班车尚未到站。',
    }],
    sources: [{
      id: sourceId,
      name: '原著摘录',
      kind: 'original',
      enabled: true,
      content: '原著中的车站终年落雪。',
    }],
    citations: [
      {
        id: nodeCitationId,
        sourceId,
        locator: '第一章 · 第 2 段',
        quote: '原著中的车站终年落雪。',
        note: '支持雪夜场景。',
        target: { kind: 'node', nodeId },
      },
      {
        id: factCitationId,
        sourceId,
        locator: '附录 · 第 1 段',
        quote: '车票背面印有站名。',
        note: '',
        target: { kind: 'fact', factId },
      },
    ],
    researchInbox: [],
  })

  assert.equal(saved.revision, 1)
  assert.deepEqual(saved.pipeline, {
    maxParallel: 3,
    researchMaxPasses: 3,
    voiceDraftReasoning: 'quality',
    workerModel: { provider: 'fast', model: 'story' },
  })
  assert.equal(saved.outputs[0]?.characterId, characterId)
  assert.equal(saved.citations[0]?.target?.kind, 'node')
  assert.deepEqual(saved.citations[1], {
    id: factCitationId,
    sourceId,
    locator: '附录 · 第 1 段',
    quote: '车票背面印有站名。',
    note: '',
    target: { kind: 'fact', factId },
  })
  assert.deepEqual(new StoryWorkspaceStore({ root }).get(saved.id), saved)
  assert.equal(readFileSync(join(root, saved.id, 'nodes', `${nodeId}.md`), 'utf8'), '先在车站重逢。')
  assert.equal(readFileSync(join(root, saved.id, 'characters', characterId, 'description.md'), 'utf8'), '怕冷，谨慎。')
  assert.equal(readFileSync(join(root, saved.id, 'outputs', `${outputId}.md`), 'utf8'), '夜班车尚未到站。')
  assert.equal(readFileSync(join(root, saved.id, 'sources', `${sourceId}.md`), 'utf8'), '原著中的车站终年落雪。')
  assert.match(storyDirectorMap(saved), /原著摘录 · 第一章 · 第 2 段: 原著中的车站终年落雪/u)
  assert.doesNotMatch(storyDirectorMap(saved), /车票背面印有站名/u)
  assert.throws(() => store.save({
    ...editable(saved),
    citations: [{ id: createStoryCitationId(), sourceId: createStorySourceId(), locator: '第 1 段', quote: '未知资料。', note: '' }],
  }), /资料引用指向未知资料/u)
  assert.throws(() => store.save({
    ...editable(saved),
    citations: [{
      id: createStoryCitationId(), sourceId, locator: '第 1 段', quote: '未知节点。', note: '',
      target: { kind: 'node', nodeId: createStoryNodeId() },
    }],
  }), /资料引用指向未知剧情节点/u)
  assert.throws(() => store.save({
    ...editable(saved),
    citations: [{
      id: createStoryCitationId(), sourceId, locator: '第 1 段', quote: '未知事实。', note: '',
      target: { kind: 'fact', factId: createStoryFactId() },
    }],
  }), /资料引用指向未知人物事实/u)
  assert.throws(() => store.save({
    ...editable(saved),
    pipeline: { ...saved.pipeline, researchMaxPasses: 5 },
  }), /故事研究轮数应为 1 至 4/u)
  assert.throws(() => store.save({
    ...editable(saved),
    pipeline: { ...saved.pipeline, voiceDraftReasoning: 'extreme' as never },
  }), /对白起草推理策略无效/u)
  assert.throws(() => store.save({ ...editable(saved), revision: 0, name: '过期编辑' }), /当前 revision 为 1/u)
})

test('migrates one format 0 workspace into the typed story model and removes obsolete files', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-migration-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const workspaceId = 'story-00000000-0000-4000-8000-000000000011'
  const characterId = 'character-00000000-0000-4000-8000-000000000011'
  const sectionId = 'section-00000000-0000-4000-8000-000000000011'
  const sourceId = 'source-00000000-0000-4000-8000-000000000011'
  const workspaceRoot = join(root, workspaceId)
  mkdirSync(join(workspaceRoot, 'characters', characterId), { recursive: true })
  mkdirSync(join(workspaceRoot, 'sections'), { recursive: true })
  mkdirSync(join(workspaceRoot, 'sources'), { recursive: true })
  writeFileSync(join(workspaceRoot, 'manifest.json'), `${JSON.stringify({
    format: 0,
    id: workspaceId,
    name: '旧故事',
    revision: 4,
    createdAt: 10,
    updatedAt: 20,
    pipeline: { maxParallel: 2 },
    characters: [{ id: characterId, name: '阿梨', enabled: true }],
    sections: [{ id: sectionId, name: '主正文', kind: 'prose', enabled: true }],
    sources: [{ id: sourceId, name: '第一卷', kind: 'original', enabled: true }],
  }, null, 2)}\n`)
  writeFileSync(join(workspaceRoot, 'outline.md'), '第一幕在车站重逢。')
  writeFileSync(join(workspaceRoot, 'foreshadowing.md'), '旧车票将在终章回收。')
  writeFileSync(join(workspaceRoot, 'proposals.md'), '让列车提前进站。')
  writeFileSync(join(workspaceRoot, 'history.md'), '阿梨已经抵达车站。\n\n<!-- agent-rp:turn:old -->')
  writeFileSync(join(workspaceRoot, 'characters', characterId, 'persona.md'), '谨慎、怕冷。')
  writeFileSync(join(workspaceRoot, 'characters', characterId, 'knowledge.md'), '阿梨认得旧车票。\n\n<!-- agent-rp:story-turn:old -->\n\n## 回合 1\n\n阿梨看见雨停。')
  writeFileSync(join(workspaceRoot, 'sections', `${sectionId}.md`), '保持第三人称。')
  writeFileSync(join(workspaceRoot, 'sources', `${sourceId}.md`), '原著中的车站终年落雪。')

  const migrated = new StoryWorkspaceStore({ root }).get(workspaceId)

  assert.equal(migrated.format, 2)
  assert.equal(migrated.revision, 5)
  assert.deepEqual(migrated.pipeline, {
    maxParallel: 2,
    researchMaxPasses: 2,
    voiceDraftReasoning: 'routine',
  })
  assert.equal(migrated.graph.nodes.find(node => node.kind === 'arc')?.content, '第一幕在车站重逢。')
  assert.equal(migrated.graph.nodes.find(node => node.kind === 'secret')?.content, '旧车票将在终章回收。')
  assert.equal(migrated.graph.nodes.find(node => node.lifecycle === 'suggested')?.content, '让列车提前进站。')
  assert.deepEqual(migrated.graph.nodes.find(node => node.id === migrated.graph.activeNodeId)?.participantIds, [characterId])
  assert.equal(migrated.characters[0]?.profile.description, '谨慎、怕冷。')
  assert.match(migrated.facts[0]?.text ?? '', /阿梨认得旧车票/u)
  assert.match(migrated.facts[0]?.text ?? '', /阿梨看见雨停/u)
  assert.equal(migrated.facts[0]?.knownBy[0], characterId)
  assert.match(migrated.events[0]?.summary ?? '', /阿梨已经抵达车站/u)
  assert.equal(migrated.outputs[0]?.instructions, '保持第三人称。')
  assert.equal(migrated.sources[0]?.content, '原著中的车站终年落雪。')
  assert.equal(existsSync(join(workspaceRoot, 'story.json')), true)
  assert.equal(existsSync(join(workspaceRoot, 'manifest.json')), false)
  assert.equal(existsSync(join(workspaceRoot, 'history.md')), false)
  assert.equal(existsSync(join(workspaceRoot, 'characters', characterId, 'knowledge.md')), false)
  assert.equal(existsSync(join(workspaceRoot, 'sections')), false)
  assert.doesNotMatch(JSON.stringify(migrated), /agent-rp:story-turn/u)
})

test('migrates format 1 clusters and fact visibility into format 2 inheritance', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-format-1-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const workspaceId = 'story-00000000-0000-4000-8000-000000000021'
  const characterId = 'character-00000000-0000-4000-8000-000000000021'
  const arcId = 'node-00000000-0000-4000-8000-000000000021'
  const sceneId = 'node-00000000-0000-4000-8000-000000000022'
  const eventId = 'event-00000000-0000-4000-8000-000000000021'
  const workspaceRoot = join(root, workspaceId)
  mkdirSync(join(workspaceRoot, 'nodes'), { recursive: true })
  mkdirSync(join(workspaceRoot, 'characters', characterId), { recursive: true })
  writeFileSync(join(workspaceRoot, 'nodes', `${arcId}.md`), '第一幕总览。')
  writeFileSync(join(workspaceRoot, 'nodes', `${sceneId}.md`), '阿梨在雨后的车站举起徽章。')
  writeFileSync(join(workspaceRoot, 'characters', characterId, 'persona.md'), '阿梨谨慎。')
  writeFileSync(join(workspaceRoot, 'story.json'), `${JSON.stringify({
    format: 1,
    id: workspaceId,
    name: '旧类型故事',
    revision: 3,
    createdAt: 10,
    updatedAt: 20,
    pipeline: { maxParallel: 2, researchMaxPasses: 2, voiceDraftReasoning: 'routine' },
    graph: {
      activeNodeId: sceneId,
      nodes: [
        {
          id: arcId,
          kind: 'arc',
          title: '第一幕',
          status: 'active',
          lifecycle: 'canonical',
          audience: 'director',
          position: { x: 0, y: 0 },
          participantIds: [],
        },
        {
          id: sceneId,
          kind: 'beat',
          title: '雨后车站',
          status: 'active',
          lifecycle: 'canonical',
          audience: 'public',
          position: { x: 320, y: 0 },
          participantIds: [characterId],
        },
      ],
      edges: [{
        id: 'edge-00000000-0000-4000-8000-000000000021',
        kind: 'contains',
        source: arcId,
        target: sceneId,
        label: '',
        lifecycle: 'canonical',
        audience: 'director',
      }],
    },
    characters: [{ id: characterId, name: '阿梨' }],
    facts: [{
      id: 'fact-00000000-0000-4000-8000-000000000021',
      text: '阿梨看见徽章。',
      status: 'asserted',
      audience: 'director',
      knownBy: [characterId],
      source: { kind: 'event', eventId, evidence: '她亲眼看见。' },
    }],
    events: [{
      id: eventId,
      key: 'old-turn',
      turn: 1,
      title: '举起徽章',
      summary: '阿梨举起徽章。',
      evidence: '阿梨举起徽章。',
      participantIds: [characterId],
      nodeId: sceneId,
    }],
    outputs: [],
    sources: [],
    citations: [],
    researchInbox: [],
  }, null, 2)}\n`)

  const migrated = new StoryWorkspaceStore({ root }).get(workspaceId)

  assert.equal(migrated.format, 2)
  assert.equal(migrated.graph.nodes.find(node => node.id === sceneId)?.parentId, arcId)
  assert.deepEqual(migrated.graph.nodes.find(node => node.id === sceneId)?.knowledge, { mode: 'participants', characterIds: [] })
  assert.equal(migrated.graph.nodes.find(node => node.id === arcId)?.summary, '第一幕总览。')
  assert.equal(migrated.facts[0]?.nodeId, sceneId)
  assert.equal(migrated.facts[0]?.knowledgeMode, 'override')
  const persisted = JSON.parse(readFileSync(join(workspaceRoot, 'story.json'), 'utf8')) as {
    format?: unknown
    graph: { edges: unknown[] }
  }
  assert.equal(persisted.format, 2)
  assert.deepEqual(persisted.graph.edges, [])
  persisted.graph.edges = [{
    id: 'edge-00000000-0000-4000-8000-000000000021',
    kind: 'contains',
    source: arcId,
    target: sceneId,
    label: '',
    lifecycle: 'canonical',
    audience: 'director',
  }]
  writeFileSync(join(workspaceRoot, 'story.json'), `${JSON.stringify(persisted, null, 2)}\n`)
  assert.deepEqual(new StoryWorkspaceStore({ root }).get(workspaceId).graph.edges, [])
})

test('rejects cyclic story-cluster hierarchy', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-cycle-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: '层级循环' })
  const firstId = createStoryNodeId()
  const secondId = createStoryNodeId()
  const node = (id: string, parentId: string, title: string) => ({
    id,
    parentId,
    kind: 'beat' as const,
    title,
    summary: title,
    status: 'planned' as const,
    lifecycle: 'canonical' as const,
    audience: 'director' as const,
    position: { x: 0, y: 0 },
    content: title,
    participantIds: [],
    knowledge: { mode: 'inherit' as const, characterIds: [] },
  })

  assert.throws(() => store.save({
    ...editable(created),
    graph: { nodes: [node(firstId, secondId, '甲'), node(secondId, firstId, '乙')], edges: [] },
  }), /故事节点层级不能形成循环/u)
})

test('requires a suggested parent cluster to be accepted before its child', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-parent-lifecycle-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: '候选父级' })
  const parentId = createStoryNodeId()
  const childId = createStoryNodeId()
  const base = {
    status: 'planned' as const,
    audience: 'director' as const,
    position: { x: 0, y: 0 },
    participantIds: [],
    knowledge: { mode: 'none' as const, characterIds: [] },
  }

  assert.throws(() => store.save({
    ...editable(created),
    graph: {
      nodes: [{
        ...base, id: parentId, kind: 'arc', title: '候选篇章', summary: '候选篇章', content: '', lifecycle: 'suggested',
      }, {
        ...base, id: childId, parentId, kind: 'beat', title: '正式场景', summary: '正式场景', content: '', lifecycle: 'canonical',
      }],
      edges: [],
    },
  }), /正式故事节点不能属于候选故事簇/u)
})

test('compiles inherited scene knowledge while preserving private fact overrides', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-character-context-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: '认知隔离' })
  const aliceId = createStoryCharacterId()
  const bobId = createStoryCharacterId()
  const nodeId = createStoryNodeId()
  const eventId = createStoryEventId()
  const aliceFactId = createStoryFactId()
  const bobFactId = createStoryFactId()
  const sharedFactId = createStoryFactId()
  const sourceId = createStorySourceId()
  const workspace = store.save({
    ...editable(created),
    graph: {
      activeNodeId: nodeId,
      nodes: [{
        id: nodeId,
        kind: 'beat',
        title: '桥边',
        summary: '阿梨与柏舟一起站在桥边。',
        status: 'active',
        lifecycle: 'canonical',
        audience: 'public',
        position: { x: 0, y: 0 },
        content: '导演秘密：下一幕桥会断。',
        participantIds: [aliceId, bobId],
        knowledge: { mode: 'participants', characterIds: [] },
      }],
      edges: [],
    },
    characters: [
      {
        ...character(aliceId, '阿梨', '阿梨遇事先观察。'),
        profile: {
          ...character(aliceId, '阿梨').profile,
          description: '阿梨遇事先观察。',
          scenario: '本局开始时，阿梨还在旧车站候车室。',
        },
        state: { location: '桥边', condition: '衣角被雨打湿', objective: '确认徽章来历', notes: '' },
      },
      character(bobId, '柏舟', '柏舟说话直接。'),
    ],
    events: [{
      id: eventId,
      key: 'seen-rain',
      turn: 1,
      title: '雨停',
      summary: '所有人都看见雨停了。',
      evidence: '雨声止住。',
      participantIds: [aliceId, bobId],
      nodeId,
    }],
    facts: [
      {
        id: sharedFactId,
        nodeId,
        text: '桥边的雨已经停了。',
        status: 'asserted',
        audience: 'public',
        knowledgeMode: 'inherit',
        knownBy: [],
        source: { kind: 'manual' },
      },
      {
        id: aliceFactId,
        text: '阿梨私密：她认得旧徽章。',
        status: 'asserted',
        audience: 'director',
        knowledgeMode: 'override',
        knownBy: [aliceId],
        source: { kind: 'manual' },
      },
      {
        id: bobFactId,
        text: '柏舟私密：他藏起了地图。',
        status: 'asserted',
        audience: 'director',
        knowledgeMode: 'override',
        knownBy: [bobId],
        source: { kind: 'event', eventId, evidence: '柏舟把地图折进袖口。' },
      },
    ],
    sources: [{
      id: sourceId,
      name: '角色设定集',
      kind: 'original',
      enabled: true,
      content: '阿梨曾在旧站见过徽章。\n\n柏舟独自拿走地图。',
    }],
    citations: [
      {
        id: createStoryCitationId(),
        sourceId,
        locator: '人物篇 · 第 1 段',
        quote: '阿梨曾在旧站见过徽章。',
        note: '',
        target: { kind: 'fact', factId: aliceFactId },
      },
      {
        id: createStoryCitationId(),
        sourceId,
        locator: '人物篇 · 第 2 段',
        quote: '柏舟独自拿走地图。',
        note: '',
        target: { kind: 'fact', factId: bobFactId },
      },
    ],
  })

  const compiled = compileStoryCharacterContext(workspace, aliceId, {
    playerInput: '玩家问阿梨是否见过这枚徽章。',
  })
  const bobCompiled = compileStoryCharacterContext(workspace, bobId, {
    playerInput: '玩家问柏舟雨停了吗。',
  })

  assert.match(compiled.text, /桥边的雨已经停了/u)
  assert.match(compiled.text, /## 入场情境[\s\S]*旧车站候车室/u)
  assert.match(compiled.text, /## 当前场地状态[\s\S]*位置：桥边/u)
  assert.match(compiled.text, /与当前场地状态冲突时，以当前场地状态为准/u)
  assert.match(compiled.text, /阿梨私密：她认得旧徽章/u)
  assert.match(compiled.text, /角色设定集 · 人物篇 · 第 1 段/u)
  assert.match(compiled.text, /阿梨曾在旧站见过徽章/u)
  assert.doesNotMatch(compiled.text, /所有人都看见雨停了/u)
  assert.doesNotMatch(compiled.text, /柏舟私密/u)
  assert.doesNotMatch(compiled.text, /柏舟独自拿走地图/u)
  assert.doesNotMatch(compiled.text, /桥会断/u)
  assert.match(bobCompiled.text, /桥边的雨已经停了/u)
  assert.match(bobCompiled.text, /柏舟私密：他藏起了地图/u)
  assert.doesNotMatch(bobCompiled.text, /阿梨私密/u)
})

test('keeps suggested graph objects out of formal director and current-scene inputs', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-candidate-graph-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: '候选隔离' })
  const activeNodeId = createStoryNodeId()
  const suggestedNodeId = createStoryNodeId()
  const workspace = store.save({
    ...editable(created),
    graph: {
      activeNodeId,
      nodes: [
        {
          id: activeNodeId,
          kind: 'beat',
          title: '正式场景',
          summary: '已经接受的场景。',
          status: 'active',
          lifecycle: 'canonical',
          audience: 'public',
          position: { x: 0, y: 0 },
          content: '已经接受的剧情。',
          participantIds: [],
          knowledge: { mode: 'none', characterIds: [] },
        },
        {
          id: suggestedNodeId,
          kind: 'secret',
          title: '尚未接受的秘密',
          summary: '尚待接受的秘密建议。',
          status: 'planned',
          lifecycle: 'suggested',
          audience: 'director',
          position: { x: 300, y: 0 },
          content: '不应进入导演输入。',
          participantIds: [],
          knowledge: { mode: 'none', characterIds: [] },
        },
      ],
      edges: [{
        id: createStoryEdgeId(),
        kind: 'foreshadows',
        source: activeNodeId,
        target: suggestedNodeId,
        label: '候选关系',
        lifecycle: 'canonical',
        audience: 'director',
        foreshadowStatus: 'planted',
      }],
    },
  })

  assert.doesNotMatch(storyDirectorMap(workspace), /尚未接受/u)
  assert.doesNotMatch(storyOpenForeshadowing(workspace), /尚未接受|候选关系/u)
  assert.throws(() => store.save({
    ...editable(workspace),
    graph: { ...workspace.graph, activeNodeId: suggestedNodeId },
  }), /当前剧情节点必须是未放弃的正式剧情节点/u)
})

test('materializes one visible turn into an event, observed facts, and a suggested story graph exactly once', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-materialization-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: '回合沉淀' })
  const aliceId = createStoryCharacterId()
  const bobId = createStoryCharacterId()
  const activeNodeId = createStoryNodeId()
  const sourceId = createStorySourceId()
  const workspace = store.save({
    ...editable(created),
    graph: {
      activeNodeId,
      nodes: [{
        id: activeNodeId,
        kind: 'beat',
        title: '门廊',
        summary: '阿梨与柏舟在门廊。',
        status: 'active',
        lifecycle: 'canonical',
        audience: 'public',
        position: { x: 100, y: 40 },
        content: '保持原剧情节点。',
        participantIds: [aliceId, bobId],
        knowledge: { mode: 'participants', characterIds: [] },
      }],
      edges: [],
    },
    characters: [
      character(aliceId, '阿梨', '谨慎。'),
      character(bobId, '柏舟', '直接。'),
    ],
    facts: [{
      id: createStoryFactId(),
      text: '阿梨认得徽章。',
      status: 'asserted',
      audience: 'director',
      knowledgeMode: 'override',
      knownBy: [aliceId],
      source: { kind: 'manual' },
    }],
    sources: [{
      id: sourceId,
      name: '旧站原著',
      kind: 'original',
      enabled: true,
      content: '徽章背面刻着旧站编号。',
    }],
  })

  const materialized = store.materializeTurn(workspace.id, {
    key: 'session-1:turn-1',
    turn: 1,
    title: '回合 1',
    summary: '阿梨在门廊举起徽章。',
    evidence: '阿梨举起徽章，门外的雨声停了。',
    participantIds: [aliceId, bobId],
    changes: {
      characters: [{ characterId: aliceId, location: '车站门廊', objective: '确认徽章来历' }],
      facts: [
        { text: '阿梨和柏舟都看见门廊外已经停雨。', knownBy: [aliceId] },
        { text: '阿梨和柏舟都看见门廊外已经停雨。', knownBy: [bobId] },
      ],
      nodes: [
        {
          ref: 'next-scene',
          kind: 'beat',
          parent: { kind: 'node', nodeId: activeNodeId },
          title: '柏舟认出徽章',
          summary: '柏舟在下一幕认出徽章。',
          content: '下一幕让柏舟认出徽章。',
          participantIds: [bobId],
          knowledge: { mode: 'participants', characterIds: [] },
        },
        {
          ref: 'badge-secret',
          kind: 'secret',
          parent: { kind: 'proposal', ref: 'next-scene' },
          title: '徽章来历',
          summary: '徽章来历等待回收。',
          content: '后续可以回收徽章来历。',
          participantIds: [],
          knowledge: { mode: 'inherit', characterIds: [] },
        },
      ],
      edges: [
        {
          kind: 'precedes',
          source: { kind: 'node', nodeId: activeNodeId },
          target: { kind: 'proposal', ref: 'next-scene' },
          label: '下一场',
        },
        {
          kind: 'foreshadows',
          source: { kind: 'node', nodeId: activeNodeId },
          target: { kind: 'proposal', ref: 'badge-secret' },
          label: '雨后徽章埋下线索',
          foreshadowStatus: 'planted',
        },
      ],
    },
    citations: [{
      sourceId,
      locator: '徽章档案 · 第 3 段',
      quote: '徽章背面刻着旧站编号。',
      note: '本回合研究 Worker 引用',
    }],
    webResearch: [{
      kind: 'web',
      url: 'https://example.test/badge',
      query: '徽章来历',
      sessionId: 'session-1',
      turn: 1,
      resultEventSeq: 24,
      title: '旧站徽章档案',
      snippet: '徽章背面刻着旧站编号。',
    }, {
      kind: 'web',
      url: 'https://example.test/badge',
      query: '重复结果',
      sessionId: 'session-1',
      turn: 1,
      resultEventSeq: 25,
      title: '同一个 URL 不重复进入收件箱',
      snippet: '重复摘要。',
    }],
  })

  assert.equal(materialized.revision, workspace.revision + 1)
  assert.equal(materialized.events[0]?.summary, '阿梨在门廊举起徽章。')
  assert.equal(materialized.events[0]?.evidence, '阿梨举起徽章，门外的雨声停了。')
  assert.equal(materialized.characters.find(character => character.id === aliceId)?.state.location, '车站门廊')
  assert.equal(materialized.characters.find(character => character.id === aliceId)?.state.objective, '确认徽章来历')
  assert.equal(materialized.events[0]?.nodeId, activeNodeId)
  const observed = materialized.facts.find(fact => fact.text.includes('门廊外已经停雨'))
  assert.deepEqual(observed?.knownBy, [aliceId, bobId])
  assert.equal(observed?.source.kind, 'event')
  assert.equal(materialized.graph.nodes.filter(node => node.lifecycle === 'suggested').length, 2)
  assert.equal(materialized.graph.nodes.find(node => node.kind === 'secret' && node.lifecycle === 'suggested')?.sourceEventId, materialized.events[0]?.id)
  assert.equal(materialized.graph.edges.filter(edge => edge.lifecycle === 'suggested').length, 2)
  const nextScene = materialized.graph.nodes.find(node => node.title === '柏舟认出徽章')
  const badgeSecret = materialized.graph.nodes.find(node => node.title === '徽章来历')
  assert.equal(nextScene?.parentId, activeNodeId)
  assert.equal(badgeSecret?.parentId, nextScene?.id)
  assert.deepEqual(nextScene?.knowledge, { mode: 'participants', characterIds: [] })
  assert.deepEqual(badgeSecret?.knowledge, { mode: 'inherit', characterIds: [] })
  assert.equal(materialized.graph.edges.find(edge => edge.kind === 'precedes')?.target, nextScene?.id)
  assert.equal(materialized.graph.edges.find(edge => edge.kind === 'foreshadows')?.target, badgeSecret?.id)
  assert.equal(materialized.graph.edges.find(edge => edge.kind === 'foreshadows')?.foreshadowStatus, 'planted')
  assert.equal(materialized.graph.edges.every(edge => edge.sourceEventId === materialized.events[0]?.id), true)
  const eventId = materialized.events[0]!.id
  assert.deepEqual(storySuggestionBatch(materialized, eventId), {
    nodeIds: [nextScene!.id, badgeSecret!.id],
    edgeIds: materialized.graph.edges.map(edge => edge.id),
  })
  const acceptedBatch = acceptStorySuggestionBatch(materialized, eventId)
  assert.equal(acceptedBatch.graph.nodes.every(node => node.lifecycle === 'canonical'), true)
  assert.equal(acceptedBatch.graph.edges.every(edge => edge.lifecycle === 'canonical'), true)
  const splitBatch = {
    ...materialized,
    graph: {
      ...materialized.graph,
      nodes: materialized.graph.nodes.map(node => node.id === nextScene?.id
        ? { ...node, sourceEventId: 'event-99999999-9999-4999-8999-999999999999' }
        : node),
    },
  }
  assert.throws(() => acceptStorySuggestionBatch(splitBatch, eventId), /依赖另一个尚未接受的故事簇/u)
  const rejectedBatch = rejectStorySuggestionBatch(materialized, eventId)
  assert.equal(rejectedBatch.graph.nodes.some(node => node.lifecycle === 'suggested'), false)
  assert.equal(rejectedBatch.graph.edges.length, 0)
  assert.equal(rejectedBatch.events.length, 1)
  assert.equal(rejectedBatch.facts.some(fact => fact.source.kind === 'event' && fact.source.eventId === eventId), true)
  assert.equal(materialized.researchInbox[0]?.url, 'https://example.test/badge')
  assert.equal(materialized.researchInbox.length, 1)
  assert.deepEqual(materialized.citations.map(citation => ({
    sourceId: citation.sourceId,
    locator: citation.locator,
    quote: citation.quote,
    note: citation.note,
    target: citation.target,
  })), [{
    sourceId,
    locator: '徽章档案 · 第 3 段',
    quote: '徽章背面刻着旧站编号。',
    note: '本回合研究 Worker 引用',
    target: { kind: 'event', eventId },
  }])
  assert.deepEqual(new StoryWorkspaceStore({ root }).get(workspace.id).citations, materialized.citations)
  assert.match(storyPublicHistory(materialized), /本回合研究依据：[\s\S]*旧站原著 · 徽章档案 · 第 3 段: [\s\S]*徽章背面刻着旧站编号/u)
  assert.throws(() => store.save({
    ...editable(materialized),
    citations: [{
      id: createStoryCitationId(),
      sourceId,
      locator: '徽章档案 · 第 3 段',
      quote: '徽章背面刻着旧站编号。',
      note: '',
      target: { kind: 'event', eventId: createStoryEventId() },
    }],
  }), /资料引用指向未知故事事件/u)

  const researchItem = materialized.researchInbox[0]!
  const acceptedSourceId = createStorySourceId()
  const accepted = store.save({
    ...editable(materialized),
    sources: [...materialized.sources, {
      id: acceptedSourceId,
      name: researchItem.title,
      kind: 'research',
      enabled: true,
      content: researchItem.snippet,
      origin: {
        kind: 'web',
        url: researchItem.url,
        query: researchItem.query,
        sessionId: researchItem.sessionId,
        turn: researchItem.turn,
        resultEventSeq: researchItem.resultEventSeq,
      },
    }],
    researchInbox: [],
  })
  const acceptedOrigin = accepted.sources.find(source => source.id === acceptedSourceId)?.origin
  assert.equal(acceptedOrigin?.kind === 'web' ? acceptedOrigin.url : undefined, 'https://example.test/badge')
  assert.equal(accepted.researchInbox.length, 0)

  const replayed = store.materializeTurn(workspace.id, {
    key: 'session-1:turn-1',
    turn: 1,
    title: '回合 1',
    summary: '不应重复追加。',
    evidence: '不应重复追加。',
    participantIds: [aliceId],
    changes: {
      characters: [],
      facts: [{ text: '不应重复追加。', knownBy: [aliceId] }],
      nodes: [{
        ref: 'duplicate', kind: 'beat', title: '不应重复追加', summary: '不应重复追加。',
        content: '不应重复追加。', participantIds: [aliceId], knowledge: { mode: 'participants', characterIds: [] },
      }],
      edges: [],
    },
    citations: [{
      sourceId,
      locator: '徽章档案 · 第 3 段',
      quote: '徽章背面刻着旧站编号。',
      note: '本回合研究 Worker 引用',
    }],
    webResearch: [],
  })
  assert.equal(replayed.revision, accepted.revision)
  assert.equal(replayed.events.length, 1)
  assert.equal(replayed.graph.nodes.filter(node => node.lifecycle === 'suggested').length, 2)
  assert.equal(replayed.graph.edges.filter(edge => edge.lifecycle === 'suggested').length, 2)
  assert.equal(replayed.citations.length, 1)
})

test('opaque ids prevent workspace and child paths from escaping the configured root', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-paths-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })

  assert.throws(() => store.get('../outside'), /id 无效/u)
  assert.equal(existsSync(join(root, '..', 'outside')), false)
})

test('projects Markdown headings and paragraphs into stable source passages', () => {
  const passages = splitStorySourcePassages({
    id: createStorySourceId(),
    name: '第一卷',
    kind: 'original',
    enabled: true,
    content: '# 第一章\n\n钟楼在午夜停摆。\n\n阿梨把旧车票藏进怀表。',
  })

  assert.deepEqual(passages.map(passage => ({ locator: passage.locator, text: passage.text })), [
    { locator: '第一章 · 第 1 段', text: '钟楼在午夜停摆。' },
    { locator: '第一章 · 第 2 段', text: '阿梨把旧车票藏进怀表。' },
  ])
})

test('projects common Chinese TXT chapters and single-line paragraphs', () => {
  const passages = splitStorySourcePassages({
    id: createStorySourceId(),
    name: '红雾异变',
    kind: 'original',
    enabled: true,
    content: '第一章 红雾笼罩幻想乡\r\n灵梦离开神社。\r\n魔理沙从森林赶来。\r\n\r\n第二章　湖边\r\n两人在湖边会合。',
  })

  assert.deepEqual(passages.map(passage => ({ locator: passage.locator, text: passage.text })), [
    { locator: '第一章 红雾笼罩幻想乡 · 第 1 段', text: '灵梦离开神社。' },
    { locator: '第一章 红雾笼罩幻想乡 · 第 2 段', text: '魔理沙从森林赶来。' },
    { locator: '第二章　湖边 · 第 1 段', text: '两人在湖边会合。' },
  ])
})

test('projects flat wiki headings without changing stable passage locators', () => {
  const passages = splitStorySourcePassages({
    id: createStorySourceId(),
    name: '网页原著',
    kind: 'original',
    enabled: true,
    content: '体验版[编辑]\n开场说明。\n博丽灵梦 vs. 雾雨魔理沙 (Stage 3)[编辑]\n对话总览。\n这一节说明两人的分歧。',
  })

  assert.deepEqual(passages.map(passage => passage.locator), ['第 1 段', '第 2 段', '第 3 段', '第 4 段', '第 5 段'])
  assert.deepEqual(storySourcePassageSections(passages), [
    '体验版',
    '体验版',
    '博丽灵梦 vs. 雾雨魔理沙 (Stage 3)',
    '博丽灵梦 vs. 雾雨魔理沙 (Stage 3)',
    '博丽灵梦 vs. 雾雨魔理沙 (Stage 3)',
  ])
})

test('retrieves the most relevant bounded original excerpts before model research', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-search-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: '原著检索' })
  const workspace = store.save({
    ...editable(created),
    pipeline: { maxParallel: 2, researchMaxPasses: 2, voiceDraftReasoning: 'routine' },
    sources: [
      {
        id: createStorySourceId(),
        name: '第一卷',
        kind: 'original',
        enabled: true,
        content: '# 集市\n\n春日的集市很热闹。\n\n旧钟楼在午夜敲了十二下。',
      },
      {
        id: createStorySourceId(),
        name: '第二卷',
        kind: 'original',
        enabled: true,
        content: '# 第三章\n\n雪原尽头的车站没有售票员。\n\n阿梨把旧车票藏进怀表。',
      },
    ],
  })

  const result = searchStoryWorkspaceSources(workspace, '阿梨手里的怀表和车票', 120)
  assert.match(result, /### \[local:source-[0-9a-f-]+:\d+\]/u)
  assert.match(result, /第二卷/u)
  assert.match(result, /第三章 · 第 2 段/u)
  assert.match(result, /旧车票藏进怀表/u)
  assert.equal(result.length <= 120, true)

  const contextWorkspace = store.save({
    ...editable(workspace),
    sources: [...workspace.sources, {
      id: createStorySourceId(),
      name: '钟楼章节',
      kind: 'original',
      enabled: true,
      content: '# 第七章\n\n守门人先熄灭门灯。\n\n钟楼暗号只在午夜出现。\n\n随后北门会短暂开启。',
    }, {
      id: createStorySourceId(),
      name: '网络查询范围',
      kind: 'web',
      enabled: true,
      content: '仅查询不会成为本地证据的紫色彗星。',
    }, {
      id: createStorySourceId(),
      name: '网页原著',
      kind: 'original',
      enabled: true,
      content: '体验版[编辑]\n开场说明。\n博丽灵梦 vs. 雾雨魔理沙 (Stage 3)[编辑]\n对话总览。\n这一节说明两人的分歧。',
    }],
  })
  const expanded = searchStoryWorkspaceSources(contextWorkspace, '钟楼暗号', 500)
  assert.match(expanded, /守门人先熄灭门灯/u)
  assert.match(expanded, /钟楼暗号只在午夜出现/u)
  assert.match(expanded, /随后北门会短暂开启/u)
  const byChapter = searchStoryWorkspaceSources(contextWorkspace, '第七章', 500)
  assert.match(byChapter, /钟楼章节/u)
  assert.match(byChapter, /第七章 · 第 1 段/u)
  assert.match(byChapter, /守门人先熄灭门灯/u)
  const bySourceName = searchStoryWorkspaceSources(contextWorkspace, '第二卷', 500)
  assert.match(bySourceName, /第二卷/u)
  assert.match(bySourceName, /雪原尽头的车站/u)
  const byProjectedWebSection = searchStoryWorkspaceSources(contextWorkspace, 'Stage 3', 500)
  assert.match(byProjectedWebSection, /这一节说明两人的分歧/u)
  assert.equal(searchStoryWorkspaceSources(contextWorkspace, '紫色彗星', 500), '')

  const crowdedWorkspace = store.save({
    ...editable(contextWorkspace),
    sources: [...contextWorkspace.sources, {
      id: createStorySourceId(),
      name: '人物长篇原著',
      kind: 'original',
      enabled: true,
      content: [
        '# 无关闲谈',
        ...Array.from({ length: 32 }, (_, index) => `阿梨只是在重复第 ${String(index + 1)} 段普通闲话。${'天气平静。'.repeat(16)}`),
        '# 判断前提',
        '阿梨：“刻痕模糊时，不应该立刻作出结论。”',
      ].join('\n\n'),
    }],
  })
  const longQuery = [
    '阿梨',
    '对方准备在没有看清徽章刻痕时就下结论。',
    '先确认眼前的刻痕。',
    Array.from({ length: 140 }, (_, index) => `占位词${String(index + 1)}`).join(' '),
  ].join('\n')
  const prioritized = searchStoryWorkspaceSources(crowdedWorkspace, longQuery, 800)
  assert.match(prioritized, /判断前提 · 第 1 段[\s\S]*刻痕模糊时，不应该立刻作出结论/u)
})
