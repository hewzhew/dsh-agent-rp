import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { StoryWorkspaceSaveRequest, StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'
import { searchStoryWorkspaceSources } from '../src/story-research.ts'
import { splitStorySourcePassages } from '../src/story-source.ts'
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
  StoryWorkspaceStore,
} from '../src/story-workspace.ts'

function editable(snapshot: StoryWorkspaceSnapshot): StoryWorkspaceSaveRequest {
  return {
    format: 1,
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
  }
}

test('persists typed story objects and rejects stale whole-workspace writes', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-workspace-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 1, name: ' 长夜 ' })
  const characterId = createStoryCharacterId()
  const nodeId = createStoryNodeId()
  const outputId = createStoryOutputId()
  const sourceId = createStorySourceId()
  const factId = createStoryFactId()
  const nodeCitationId = createStoryCitationId()
  const factCitationId = createStoryCitationId()

  assert.deepEqual(created.pipeline, { maxParallel: 4 })
  const saved = store.save({
    format: 1,
    id: created.id,
    revision: created.revision,
    name: '长夜',
    pipeline: { maxParallel: 3, workerModel: { provider: 'fast', model: 'story' } },
    graph: {
      activeNodeId: nodeId,
      nodes: [{
        id: nodeId,
        kind: 'beat',
        title: '雪夜重逢',
        status: 'active',
        lifecycle: 'canonical',
        audience: 'public',
        position: { x: 240, y: 80 },
        content: '先在车站重逢。',
        participantIds: [characterId],
      }],
      edges: [],
    },
    characters: [{ id: characterId, name: '小满', persona: '怕冷，谨慎。' }],
    facts: [{
      id: factId,
      text: '她知道车票背面的字。',
      status: 'asserted',
      audience: 'director',
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
  })

  assert.equal(saved.revision, 1)
  assert.deepEqual(saved.pipeline, {
    maxParallel: 3,
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
  assert.equal(readFileSync(join(root, saved.id, 'characters', characterId, 'persona.md'), 'utf8'), '怕冷，谨慎。')
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

  assert.equal(migrated.format, 1)
  assert.equal(migrated.revision, 5)
  assert.equal(migrated.graph.nodes.find(node => node.kind === 'arc')?.content, '第一幕在车站重逢。')
  assert.equal(migrated.graph.nodes.find(node => node.kind === 'secret')?.content, '旧车票将在终章回收。')
  assert.equal(migrated.graph.nodes.find(node => node.lifecycle === 'suggested')?.content, '让列车提前进站。')
  assert.deepEqual(migrated.graph.nodes.find(node => node.id === migrated.graph.activeNodeId)?.participantIds, [characterId])
  assert.equal(migrated.characters[0]?.persona, '谨慎、怕冷。')
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

test('compiles one character context from fact visibility without director or another character knowledge', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-character-context-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 1, name: '认知隔离' })
  const aliceId = createStoryCharacterId()
  const bobId = createStoryCharacterId()
  const nodeId = createStoryNodeId()
  const eventId = createStoryEventId()
  const aliceFactId = createStoryFactId()
  const bobFactId = createStoryFactId()
  const sourceId = createStorySourceId()
  const workspace = store.save({
    ...editable(created),
    graph: {
      activeNodeId: nodeId,
      nodes: [{
        id: nodeId,
        kind: 'beat',
        title: '桥边',
        status: 'active',
        lifecycle: 'canonical',
        audience: 'public',
        position: { x: 0, y: 0 },
        content: '导演秘密：下一幕桥会断。',
        participantIds: [aliceId, bobId],
      }],
      edges: [],
    },
    characters: [
      { id: aliceId, name: '阿梨', persona: '阿梨遇事先观察。' },
      { id: bobId, name: '柏舟', persona: '柏舟说话直接。' },
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
        id: aliceFactId,
        text: '阿梨私密：她认得旧徽章。',
        status: 'asserted',
        audience: 'director',
        knownBy: [aliceId],
        source: { kind: 'manual' },
      },
      {
        id: bobFactId,
        text: '柏舟私密：他藏起了地图。',
        status: 'asserted',
        audience: 'director',
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

  assert.match(compiled.text, /阿梨私密：她认得旧徽章/u)
  assert.match(compiled.text, /角色设定集 · 人物篇 · 第 1 段/u)
  assert.match(compiled.text, /阿梨曾在旧站见过徽章/u)
  assert.doesNotMatch(compiled.text, /所有人都看见雨停了/u)
  assert.doesNotMatch(compiled.text, /柏舟私密/u)
  assert.doesNotMatch(compiled.text, /柏舟独自拿走地图/u)
  assert.doesNotMatch(compiled.text, /桥会断/u)
})

test('keeps suggested graph objects out of formal director and current-scene inputs', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-candidate-graph-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 1, name: '候选隔离' })
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
          status: 'active',
          lifecycle: 'canonical',
          audience: 'public',
          position: { x: 0, y: 0 },
          content: '已经接受的剧情。',
          participantIds: [],
        },
        {
          id: suggestedNodeId,
          kind: 'secret',
          title: '尚未接受的秘密',
          status: 'planned',
          lifecycle: 'suggested',
          audience: 'director',
          position: { x: 300, y: 0 },
          content: '不应进入导演输入。',
          participantIds: [],
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

test('materializes one visible turn into an event, observed facts, and suggested story nodes exactly once', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-materialization-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 1, name: '回合沉淀' })
  const aliceId = createStoryCharacterId()
  const bobId = createStoryCharacterId()
  const activeNodeId = createStoryNodeId()
  const workspace = store.save({
    ...editable(created),
    graph: {
      activeNodeId,
      nodes: [{
        id: activeNodeId,
        kind: 'beat',
        title: '门廊',
        status: 'active',
        lifecycle: 'canonical',
        audience: 'public',
        position: { x: 100, y: 40 },
        content: '保持原剧情节点。',
        participantIds: [aliceId, bobId],
      }],
      edges: [],
    },
    characters: [
      { id: aliceId, name: '阿梨', persona: '谨慎。' },
      { id: bobId, name: '柏舟', persona: '直接。' },
    ],
    facts: [{
      id: createStoryFactId(),
      text: '阿梨认得徽章。',
      status: 'asserted',
      audience: 'director',
      knownBy: [aliceId],
      source: { kind: 'manual' },
    }],
  })

  const materialized = store.materializeTurn(workspace.id, {
    key: 'session-1:turn-1',
    turn: 1,
    title: '回合 1',
    summary: '阿梨在门廊举起徽章。',
    evidence: '阿梨举起徽章，门外的雨声停了。',
    participantIds: [aliceId, bobId],
    observations: [{ characterId: aliceId, text: '阿梨看见门廊外已经停雨。' }],
    plotSuggestions: ['下一幕让柏舟认出徽章。'],
    foreshadowSuggestions: ['后续可以回收徽章来历。'],
  })

  assert.equal(materialized.revision, workspace.revision + 1)
  assert.equal(materialized.events[0]?.summary, '阿梨在门廊举起徽章。')
  assert.equal(materialized.events[0]?.evidence, '阿梨举起徽章，门外的雨声停了。')
  assert.equal(materialized.events[0]?.nodeId, activeNodeId)
  const observed = materialized.facts.find(fact => fact.text.includes('门廊外已经停雨'))
  assert.deepEqual(observed?.knownBy, [aliceId])
  assert.equal(observed?.source.kind, 'event')
  assert.equal(materialized.graph.nodes.filter(node => node.lifecycle === 'suggested').length, 2)
  assert.equal(materialized.graph.nodes.find(node => node.kind === 'secret' && node.lifecycle === 'suggested')?.sourceEventId, materialized.events[0]?.id)

  const replayed = store.materializeTurn(workspace.id, {
    key: 'session-1:turn-1',
    turn: 1,
    title: '回合 1',
    summary: '不应重复追加。',
    evidence: '不应重复追加。',
    participantIds: [aliceId],
    observations: [{ characterId: aliceId, text: '不应重复追加。' }],
    plotSuggestions: ['不应重复追加。'],
    foreshadowSuggestions: ['不应重复追加。'],
  })
  assert.equal(replayed.revision, materialized.revision)
  assert.equal(replayed.events.length, 1)
  assert.equal(replayed.graph.nodes.filter(node => node.lifecycle === 'suggested').length, 2)
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

test('retrieves the most relevant bounded original excerpts before model research', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-search-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 1, name: '原著检索' })
  const workspace = store.save({
    ...editable(created),
    pipeline: { maxParallel: 2 },
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
  assert.match(result, /第二卷/u)
  assert.match(result, /第三章 · 第 2 段/u)
  assert.match(result, /旧车票藏进怀表/u)
  assert.equal(result.length <= 120, true)
})
