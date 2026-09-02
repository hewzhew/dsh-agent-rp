import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { STORY_AUTO_ADVANCE_INPUT, type StoryCharacter, type StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'
import { appendAgentRpSessionEvent } from '../src/session-event-append.ts'
import {
  compileStoryCharacterContext,
  createStoryCharacterId,
  createStoryNodeId,
  createStoryOutputId,
  StoryWorkspaceStore,
} from '../src/story-workspace.ts'
import {
  expandStoryTurnOutputs,
  materializeStoryTurn,
  recoverStoppedStoryTurns,
  runStoryTurnPipeline,
  storyWebFetchAvailable,
  storyWebSearchAvailable,
} from '../src/story-turn-pipeline.ts'
import { sessionEvents } from '../src/session-events.ts'

const aliceId = 'character-00000000-0000-4000-8000-000000000001'
const bobId = 'character-00000000-0000-4000-8000-000000000002'
const arcId = 'node-00000000-0000-4000-8000-000000000001'
const activeNodeId = 'node-00000000-0000-4000-8000-000000000002'
const secretId = 'node-00000000-0000-4000-8000-000000000003'
const aliceFactId = 'fact-00000000-0000-4000-8000-000000000001'
const bobFactId = 'fact-00000000-0000-4000-8000-000000000002'
const sharedFactId = 'fact-00000000-0000-4000-8000-000000000003'
const historyEventId = 'event-00000000-0000-4000-8000-000000000001'
const bobHistoryEventId = 'event-00000000-0000-4000-8000-000000000002'
const sectionId = 'output-00000000-0000-4000-8000-000000000001'
const characterSectionId = 'output-00000000-0000-4000-8000-000000000002'
const aliceCharacterSectionId = `${characterSectionId}:${aliceId}`
const bobCharacterSectionId = `${characterSectionId}:${bobId}`
const historySectionId = 'output-00000000-0000-4000-8000-000000000003'
const sourceId = 'source-00000000-0000-4000-8000-000000000001'
const originalSourceId = 'source-00000000-0000-4000-8000-000000000002'

test('recovers a story turn closed only by its parent Agent boundary', async () => {
  const session = Session.create(SessionId('story-turn-stop-recovery'))
  session.append('turn/start', { turn: 4 })
  appendAgentRpSessionEvent(session, 'agent-rp/story-turn-start', {
    format: 0,
    sessionId: String(session.id),
    workspaceId: 'workspace-1',
    workspaceRevision: 7,
    turn: 4,
    step: 1,
  })
  session.append('turn/end', { turn: 4, reason: { kind: 'aborted', reason: { kind: 'user' } } })
  let flushes = 0
  const ctx = { sessions: { flush: async () => { flushes += 1; return true } } } as unknown as Context
  const agent = { id: session.id, session } as Agent

  assert.deepEqual(await recoverStoppedStoryTurns({ ctx, agent }), [{
    format: 0,
    sessionId: String(session.id),
    workspaceId: 'workspace-1',
    workspaceRevision: 7,
    turn: 4,
    step: 1,
    outcome: 'aborted',
  }])
  assert.equal(flushes, 1)
  assert.deepEqual(await recoverStoppedStoryTurns({ ctx, agent }), [])
  assert.equal(flushes, 1)
})

test('reports optional Host web research services without making a network request', () => {
  assert.equal(storyWebSearchAvailable({
    get(name: string) {
      return name === 'web' ? {
        search: async () => ({ sources: [], truncated: false }),
        fetch: async () => ({ url: 'https://example.test/', statusCode: 200, body: { kind: 'text', content: '' }, truncated: false }),
      } : undefined
    },
  } as unknown as Context), true)
  assert.equal(storyWebFetchAvailable({
    get: () => ({ fetch: async () => ({ url: 'https://example.test/', statusCode: 200, body: { kind: 'text', content: '' }, truncated: false }) }),
  } as unknown as Context), true)
  assert.equal(storyWebSearchAvailable({ get: () => undefined } as unknown as Context), false)
  assert.equal(storyWebFetchAvailable({ get: () => undefined } as unknown as Context), false)
  assert.equal(storyWebSearchAvailable({ get: () => { throw new Error('not registered') } } as unknown as Context), false)
  assert.equal(storyWebFetchAvailable({ get: () => { throw new Error('not registered') } } as unknown as Context), false)
})

function character(id: string, name: string, description = ''): StoryCharacter {
  const sourceDuplicate = name === '阿梨' ? '\n阿梨：“没看清就别急着下结论。”' : ''
  return {
    id,
    name,
    profile: {
      description,
      personality: `${name}只用短句回应。`,
      scenario: '',
      exampleDialogue: `${name}：“先把眼前的事说清楚。”\n${name}：“笨蛋”${sourceDuplicate}`,
      systemPrompt: '',
      postHistoryInstructions: '',
    },
    state: { location: '', condition: '', objective: '', notes: '' },
  }
}

function workspace(): StoryWorkspaceSnapshot {
  return {
    format: 2,
    id: 'story-00000000-0000-4000-8000-000000000001',
    name: '隔离流水线',
    revision: 3,
    createdAt: 1,
    updatedAt: 2,
    pipeline: {
      maxParallel: 2,
      researchMaxPasses: 2,
      voiceDraftReasoning: 'routine',
      workerModel: { provider: 'worker-fixture', model: 'worker-model' },
    },
    graph: {
      activeNodeId,
      nodes: [
        {
          id: arcId,
          kind: 'arc',
          title: '第一幕',
          summary: '雨后车站所在的第一幕。',
          status: 'active',
          lifecycle: 'canonical',
          audience: 'director',
          position: { x: 0, y: 0 },
          content: '导演知道下一幕会停电。',
          participantIds: [],
          knowledge: { mode: 'none', characterIds: [] },
        },
        {
          id: activeNodeId,
          kind: 'beat',
          parentId: arcId,
          title: '雨后的车站',
          summary: '玩家在雨后的车站举起徽章。',
          status: 'active',
          lifecycle: 'canonical',
          audience: 'public',
          position: { x: 320, y: 0 },
          content: '玩家在车站举起徽章。',
          participantIds: [aliceId, bobId],
          knowledge: { mode: 'participants', characterIds: [] },
        },
        {
          id: secretId,
          kind: 'secret',
          parentId: arcId,
          title: '怀表',
          summary: '尚未向人物公开的怀表伏笔。',
          status: 'planned',
          lifecycle: 'canonical',
          audience: 'director',
          position: { x: 320, y: 220 },
          content: '怀表将在第三幕打开。',
          participantIds: [],
          knowledge: { mode: 'none', characterIds: [] },
        },
      ],
      edges: [],
    },
    characters: [
      character(aliceId, '阿梨', '阿梨谨慎。'),
      character(bobId, '柏舟', '柏舟果断。'),
    ],
    facts: [
      {
        id: aliceFactId,
        text: '阿梨知道徽章的主人。',
        status: 'asserted',
        audience: 'director',
        knowledgeMode: 'override',
        knownBy: [aliceId],
        source: { kind: 'manual' },
      },
      {
        id: bobFactId,
        text: '柏舟藏起了车票。',
        status: 'asserted',
        audience: 'director',
        knowledgeMode: 'override',
        knownBy: [bobId],
        source: { kind: 'event', eventId: bobHistoryEventId, evidence: '只有柏舟看见站牌背面反光。' },
      },
      {
        id: sharedFactId,
        text: '两人都看见雨停了。',
        status: 'asserted',
        audience: 'public',
        knowledgeMode: 'override',
        knownBy: [aliceId, bobId],
        source: { kind: 'event', eventId: historyEventId, evidence: '雨声停了。' },
      },
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `fact-00000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
        text: `两人共同记得的车站细节 ${String(index + 1)}。`,
        status: 'asserted' as const,
        audience: 'public' as const,
        knowledgeMode: 'override' as const,
        knownBy: [aliceId, bobId],
        source: { kind: 'manual' as const },
      })),
    ],
    events: [
      {
        id: historyEventId,
        key: 'fixture-history',
        turn: 0,
        title: '雨停',
        summary: '两人都看见雨停了。',
        evidence: '雨声停了。',
        participantIds: [aliceId, bobId],
        nodeId: activeNodeId,
      },
      {
        id: bobHistoryEventId,
        key: 'fixture-bob-history',
        turn: 0,
        title: '站牌反光',
        summary: '只有柏舟看见站牌背面反光。',
        evidence: '柏舟独自绕到站牌背面。',
        participantIds: [bobId],
        nodeId: activeNodeId,
      },
    ],
    outputs: [
      { id: sectionId, name: '正文', kind: 'prose', enabled: true, instructions: '保持第三人称。' },
      { id: characterSectionId, name: '人物私记', kind: 'character', enabled: true, instructions: '只写各人物能表现出的内容。' },
      { id: historySectionId, name: '公开档案', kind: 'history', enabled: true, instructions: '使用简短时间线。' },
    ],
    sources: [
      { id: sourceId, name: '检索原著设定', kind: 'web', enabled: true, content: '只查询作品官方设定与原著章节' },
      {
        id: originalSourceId,
        name: '终章原著',
        kind: 'original',
        enabled: true,
        content: [
          '# 终章设定',
          '鸦青印记只在列车终章显现。',
          '# 人物对白',
          '阿梨：“没看清就别急着下结论。”\n\n柏舟：“那就走近一点看。”',
          '# 语气观察',
          '阿梨常用短反问和理直气壮的断言；柏舟习惯立刻指出她推断里的漏洞，两人熟到省略礼貌和背景说明。',
          '# 码头旧话',
          '阿梨：“船已经走远了。”',
          '# 厨房旧话',
          '阿梨：“汤放凉再喝。”',
          '# 森林旧话',
          '阿梨：“这条路没有脚印。”',
          '# 仓库旧话',
          '阿梨：“门锁不是今天换的。”',
          '# 塔楼旧话',
          '阿梨：“钟声少响了一次。”',
          '# 花园旧话',
          '阿梨：“花期还没有到。”',
          '# 书库旧话',
          '阿梨：“那本书不在这一层。”',
          ...Array.from({ length: 40 }, (_, index) => [
            `# 无关长篇 ${String(index + 1)}`,
            `阿梨：“${'这段闲谈不涉及眼前判断。'.repeat(24)}”`,
          ].join('\n')),
          '# 判断前提',
          [
            '原文：',
            '柏舟：“船はもう遠くへ行った。”',
            '阿梨：“潮が引くまで待つ。”',
            '柏舟：“スープはまだ熱い。”',
            '阿梨：“冷めてから飲めばいい。”',
            '柏舟：“森の道に足跡がない。”',
            '阿梨：“別の道を探す。”',
            '柏舟：“倉庫の鍵は古いままだ。”',
            '阿梨：“今は扉を開けない。”',
            '柏舟：“鐘は一度しか鳴らなかった。”',
            '阿梨：“次の鐘を待つ。”',
            '柏舟：“雨はまだ止んでいない。”',
            '阿梨：“窓を閉めておく。”',
            '柏舟：“地図の端が破れている。”',
            '阿梨：“残った線だけを見る。”',
            '柏舟：“本は机の下に落ちていた。”',
            '阿梨：“棚に戻しておく。”',
            '柏舟：“庭の花はまだ咲いていない。”',
            '阿梨：“季節が来るまで待つ。”',
            `柏舟：“${Array.from({ length: 80 }, (_, index) => `占位词${String(index + 1)}`).join(' ')}”`,
            '阿梨：“这些背景词我都听见了。”',
            '柏舟：“刻印はもう滲んで見えない。”',
            '阿梨：“見えてから結論を出せばいい。”',
            '参考译文：',
            '柏舟：“船已经走远了。”',
            '阿梨：“等退潮再说。”',
            '柏舟：“汤还很烫。”',
            '阿梨：“放凉再喝就好。”',
            '柏舟：“森林的路上没有脚印。”',
            '阿梨：“去找另一条路。”',
            '柏舟：“仓库的锁还是旧的。”',
            '阿梨：“现在先不开门。”',
            '柏舟：“钟只响过一次。”',
            '阿梨：“等下一声钟。”',
            '柏舟：“雨还没有停。”',
            '阿梨：“先把窗关好。”',
            '柏舟：“地图边缘破了。”',
            '阿梨：“只看剩下的线。”',
            '柏舟：“书掉到了桌子底下。”',
            '阿梨：“把它放回书架。”',
            '柏舟：“院里的花还没有开。”',
            '阿梨：“等到花期再说。”',
            `柏舟：“${Array.from({ length: 80 }, (_, index) => `占位词${String(index + 1)}`).join(' ')}”`,
            '阿梨：“这些背景词我都听见了。”',
            '柏舟：“刻痕已经糊得看不清了。”',
            '阿梨：“看清以后再作结论。”',
          ].join('\n'),
        ].join('\n\n'),
      },
    ],
    citations: [],
    researchInbox: [],
  }
}

test('expands an unbound character output into one stable section per participating character', () => {
  const base = workspace()
  const template = {
    id: characterSectionId,
    name: '人物私记',
    kind: 'character' as const,
    enabled: true,
    instructions: '只保留各自的私有决定。',
  }
  const input: StoryWorkspaceSnapshot = {
    ...base,
    outputs: [
      base.outputs[0]!,
      template,
      base.outputs[2]!,
      { ...template, id: createStoryOutputId(), name: '停用模板', enabled: false },
    ],
  }

  const first = expandStoryTurnOutputs(input)
  const second = expandStoryTurnOutputs(input)
  const characterOutputs = first.filter(output => output.kind === 'character')

  assert.deepEqual(first, second)
  assert.deepEqual(characterOutputs.map(output => ({
    id: output.id,
    name: output.name,
    characterId: output.characterId,
  })), [{
    id: `${characterSectionId}:${aliceId}`,
    name: '人物私记 · 阿梨',
    characterId: aliceId,
  }, {
    id: `${characterSectionId}:${bobId}`,
    name: '人物私记 · 柏舟',
    characterId: bobId,
  }])
  assert.equal(first.some(output => output.name === '停用模板'), false)

  const aliceOnly: StoryWorkspaceSnapshot = {
    ...input,
    graph: {
      ...input.graph,
      nodes: input.graph.nodes.map(node => node.id === activeNodeId
        ? { ...node, participantIds: [aliceId] }
        : node),
    },
    outputs: [
      template,
      { ...template, id: createStoryOutputId(), name: '柏舟专属', characterId: bobId },
    ],
  }
  assert.deepEqual(expandStoryTurnOutputs(aliceOnly).map(output => ({
    id: output.id,
    characterId: output.characterId,
  })), [{
    id: `${characterSectionId}:${aliceId}`,
    characterId: aliceId,
  }])
})

test('omits character outputs when their isolated character decision is unavailable', async () => {
  const session = Session.create(SessionId('story-character-section-isolation'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  const base = workspace()
  const inputWorkspace: StoryWorkspaceSnapshot = {
    ...base,
    pipeline: { ...base.pipeline, researchMaxPasses: 1 },
    outputs: [{
      id: characterSectionId,
      name: '人物私记',
      kind: 'character',
      enabled: true,
      instructions: '',
    }],
    sources: [],
  }
  let characterCalls = 0
  const fake = {
    sessions: { flush: async () => true },
    llm: {
      stream(options: { readonly system?: string }) {
        const system = options.system ?? ''
        if (system.includes('指定人物认知')) {
          characterCalls += 1
          if (characterCalls === 2) {
            return (async function* () {
              yield { type: 'finish', reason: { kind: 'stop' } }
            })()
          }
          if (characterCalls === 3) {
            const text = JSON.stringify({ observation: '', action: '', speech: null, insights: [] })
            return (async function* () {
              yield { type: 'block-start', index: 0, blockType: 'text' }
              yield { type: 'text-delta', index: 0, text }
              yield { type: 'block-end', index: 0, block: { type: 'text', text } }
              yield { type: 'finish', reason: { kind: 'stop' } }
            })()
          }
          return (async function* () {
            throw new Error('fixture character failure')
          })()
        }
        const text = system.includes('单个人物的历史检索 Worker')
          ? JSON.stringify({ references: [] })
          : system.includes('剧情研究 Worker')
            ? JSON.stringify({ findings: [], followUps: [] })
            : system.includes('剧情导演 Worker')
              ? JSON.stringify({
                sections: [
                  { sectionId: aliceCharacterSectionId, characterId: aliceId },
                  { sectionId: bobCharacterSectionId, characterId: bobId },
                ],
              })
              : JSON.stringify({ sections: [] })
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context
  const result = await runStoryTurnPipeline({
    ctx: fake,
    agent: { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent,
    workspace: inputWorkspace,
    turn: 1,
    step: 1,
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: STORY_AUTO_ADVANCE_INPUT }] })],
    signal: new AbortController().signal,
  })
  const stageRequests = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request' ? [event.data] : [])

  assert.deepEqual(stageRequests.filter(request => request.stage === 'character').map(request => request.subjectId), [aliceId, bobId, bobId])
  const characterFailures = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-result'
    && event.data.result.kind === 'failure'
    && stageRequests.some(request => request.requestId === event.data.requestId && request.stage === 'character')
    ? [event.data.result]
    : [])
  assert.deepEqual(characterFailures, [
    {
      kind: 'failure',
      failure: 'provider',
      detail: { code: 'STORY_STAGE_STREAM_FAILED', message: 'fixture character failure' },
    },
    {
      kind: 'failure',
      failure: 'unknown',
      detail: {
        code: 'STORY_WORKER_EMPTY_OUTPUT',
        message: '故事 Worker 以 stop 结束但没有返回文本（推理块 0，其他块 0）',
      },
    },
  ])
  assert.equal(sessionEvents(session).some(event => event.type === 'agent-rp/story-stage-result'
    && event.data.result.kind === 'success'
    && stageRequests.some(request => request.requestId === event.data.requestId
      && request.stage === 'character' && request.subjectId === bobId)), true)
  assert.equal(stageRequests.some(request => request.stage === 'section'), false)
  assert.deepEqual(result.finalSections, [])
  assert.equal(result.finalDraft, '')
  assert.doesNotMatch(result.modelContext, /下一幕会停电|第三幕打开/u)
})

test('delegates isolated character decisions to durable DSH Subagent sessions', async () => {
  const session = Session.create(SessionId('story-character-subagents'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  const base = workspace()
  const inputWorkspace: StoryWorkspaceSnapshot = {
    ...base,
    pipeline: { ...base.pipeline, researchMaxPasses: 1 },
    outputs: [],
    sources: [],
  }
  const requests: Array<{
    readonly label?: string
    readonly prompt: readonly { readonly type: string; readonly text?: string }[]
    readonly persona?: string
    readonly toolFilter?: { readonly allow?: readonly string[] }
    readonly outputSchema?: unknown
  }> = []
  const disposed: string[] = []
  const subagents = {
    getProvider(name: string) {
      return name === 'spawn' ? { name: 'spawn' } : undefined
    },
    async start(_name: string, request: typeof requests[number]) {
      requests.push(request)
      const childId = `story-child-${String(requests.length)}`
      return {
        id: SessionId(childId),
        result: Promise.resolve({
          output: [],
          structured: { observation: '', action: '', speech: null, insights: [] },
          stopReason: 'completed' as const,
        }),
        async dispose() { disposed.push(childId) },
      }
    },
  }
  let directCharacterCalls = 0
  const fake = {
    get(name: string) {
      return name === 'subagents' ? subagents : undefined
    },
    logger: { warn() {} },
    sessions: { flush: async () => true },
    llm: {
      stream(options: { readonly system?: string }) {
        const system = options.system ?? ''
        if (system.includes('指定人物认知')) directCharacterCalls += 1
        const text = system.includes('单个人物的历史检索 Worker')
          ? JSON.stringify({ references: [] })
          : system.includes('剧情研究 Worker')
            ? JSON.stringify({ findings: [], followUps: [] })
            : system.includes('剧情导演 Worker')
              ? JSON.stringify({ sections: [] })
              : JSON.stringify({ sections: [] })
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context

  await runStoryTurnPipeline({
    ctx: fake,
    agent: { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent,
    workspace: inputWorkspace,
    turn: 1,
    step: 1,
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '看看徽章。' }] })],
    signal: new AbortController().signal,
  })

  assert.equal(directCharacterCalls, 0)
  assert.deepEqual(requests.map(request => request.label), ['人物推演 · 阿梨', '人物推演 · 柏舟'])
  assert.deepEqual(requests.map(request => request.toolFilter), [{ allow: [] }, { allow: [] }])
  assert.equal(requests.every(request => request.outputSchema !== undefined), true)
  assert.equal(requests.every(request => request.persona?.includes('指定人物认知') === true), true)
  const prompts = requests.map(request => request.prompt.map(block => block.text ?? '').join('\n'))
  assert.equal(prompts.every(prompt => prompt.includes('<worker_instructions>')
    && prompt.includes('structured_output 工具')), true)
  assert.match(prompts[0]!, /阿梨知道徽章/u)
  assert.doesNotMatch(prompts[0]!, /柏舟藏起了车票|只有柏舟看见站牌背面反光/u)
  assert.match(prompts[1]!, /柏舟藏起了车票/u)
  assert.doesNotMatch(prompts[1]!, /阿梨知道徽章/u)
  assert.deepEqual(disposed, ['story-child-1', 'story-child-2'])
  const characterRequests = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'character' ? [event.data] : [])
  assert.equal(characterRequests.length, 2)
  assert.equal(characterRequests.every(request => request.execution?.kind === 'subagent'
    && request.execution.provider === 'spawn'), true)
  const characterResults = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-result'
    && event.data.stage === 'character' ? [event.data] : [])
  assert.deepEqual(characterResults.map(result => result.childSessionId), ['story-child-1', 'story-child-2'])
  assert.equal(characterResults.every(result => result.result.kind === 'success'), true)
})

test('retries a reasoning-only character Subagent with an explicit structured submission request', async () => {
  const session = Session.create(SessionId('story-character-subagent-structured-retry'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  const base = workspace()
  const requests: Array<{
    readonly label?: string
    readonly prompt: readonly { readonly type: string; readonly text?: string }[]
  }> = []
  const attempts = new Map<string, number>()
  const disposed: string[] = []
  const subagents = {
    getProvider(name: string) {
      return name === 'spawn' ? { name: 'spawn' } : undefined
    },
    async start(_name: string, request: typeof requests[number]) {
      requests.push(request)
      const label = request.label ?? ''
      const attempt = (attempts.get(label) ?? 0) + 1
      attempts.set(label, attempt)
      const childId = `structured-retry-child-${String(requests.length)}`
      const missedSubmission = label.includes('阿梨') && attempt === 1
      return {
        id: SessionId(childId),
        result: Promise.resolve(missedSubmission
          ? {
              output: [{ type: 'reasoning' as const, text: '已经形成决定，但没有提交工具调用。' }],
              stopReason: 'max-tokens' as const,
            }
          : {
              output: [],
              structured: { observation: '', action: '', speech: null, opportunityDecisions: [], insights: [] },
              stopReason: 'completed' as const,
            }),
        async dispose() { disposed.push(childId) },
      }
    },
  }
  const fake = {
    get(name: string) {
      return name === 'subagents' ? subagents : undefined
    },
    logger: { warn() {} },
    sessions: { flush: async () => true },
    llm: {
      stream(options: { readonly system?: string }) {
        const system = options.system ?? ''
        const text = system.includes('单个人物的历史检索 Worker')
          ? JSON.stringify({ references: [] })
          : system.includes('剧情研究 Worker')
            ? JSON.stringify({ findings: [], followUps: [] })
            : JSON.stringify({ sections: [] })
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context

  await runStoryTurnPipeline({
    ctx: fake,
    agent: { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent,
    workspace: { ...base, pipeline: { ...base.pipeline, researchMaxPasses: 1 }, outputs: [], sources: [] },
    turn: 1,
    step: 1,
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '继续。' }] })],
    signal: new AbortController().signal,
  })

  assert.equal(attempts.get('人物推演 · 阿梨'), 2)
  assert.equal(attempts.get('人物推演 · 柏舟'), 1)
  assert.deepEqual(disposed.length, requests.length)
  const aliceRequests = requests.filter(request => request.label === '人物推演 · 阿梨')
  assert.equal(aliceRequests.length, 2)
  assert.doesNotMatch(aliceRequests[0]!.prompt.map(block => block.text ?? '').join('\n'), /structured_output_retry/u)
  assert.match(aliceRequests[1]!.prompt.map(block => block.text ?? '').join('\n'), /structured_output_retry/u)
  const characterResults = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-result'
    && event.data.stage === 'character' ? [event.data.result] : [])
  assert.equal(characterResults.some(result => result.kind === 'failure'
    && result.detail?.code === 'STORY_WORKER_INVALID_OUTPUT'), true)
  assert.equal(characterResults.filter(result => result.kind === 'success').length, 2)
})

test('records prose-only character Subagent replies as invalid instead of silently accepting them', async () => {
  const session = Session.create(SessionId('story-character-subagent-prose'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  const base = workspace()
  const starts: string[] = []
  const disposed: string[] = []
  const subagents = {
    getProvider(name: string) {
      return name === 'spawn' ? { name: 'spawn' } : undefined
    },
    async start(_name: string) {
      const childId = `prose-child-${String(starts.length + 1)}`
      starts.push(childId)
      return {
        id: SessionId(childId),
        result: Promise.resolve({
          output: [{ type: 'text' as const, text: '（叹气）又没能起飞。' }],
          stopReason: 'error' as const,
        }),
        async dispose() { disposed.push(childId) },
      }
    },
  }
  const fake = {
    get(name: string) {
      return name === 'subagents' ? subagents : undefined
    },
    logger: { warn() {} },
    sessions: { flush: async () => true },
    llm: {
      stream(options: { readonly system?: string }) {
        const system = options.system ?? ''
        const text = system.includes('单个人物的历史检索 Worker')
          ? JSON.stringify({ references: [] })
          : JSON.stringify({ sections: [] })
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context

  const result = await runStoryTurnPipeline({
    ctx: fake,
    agent: { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent,
    workspace: { ...base, pipeline: { ...base.pipeline, researchMaxPasses: 1 }, outputs: [], sources: [] },
    turn: 1,
    step: 1,
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '继续。' }] })],
    signal: new AbortController().signal,
  })

  assert.equal(starts.length, 4)
  assert.deepEqual(disposed, starts)
  const characterResults = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-result'
    && event.data.stage === 'character' ? [event.data.result] : [])
  assert.equal(characterResults.length, 4)
  assert.equal(characterResults.every(stageResult => stageResult.kind === 'failure'
    && stageResult.detail?.code === 'STORY_WORKER_INVALID_OUTPUT'), true)
  assert.equal(result.finalSections.length, 0)
  assert.equal(result.finalDraft, '')
})

test('runs logged story stages while keeping each character request privately scoped', async () => {
  const session = Session.create(SessionId('story-turn-pipeline'))
  session.append('request/header', {
    reason: 'initial',
    header: {
      config: {
        provider: 'worker-fixture',
        model: 'worker-model',
        reasoningEffort: 'high' as never,
        maxTokens: 32_768,
      },
    },
  })
  const characterBodies: string[] = []
  const characterSystems: string[] = []
  const sectionSystems: string[] = []
  const sectionBodies: string[] = []
  const historyBodies: string[] = []
  const researchBodies: string[] = []
  let directorBody = ''
  let directorSystem = ''
  let voiceBody = ''
  let voiceSystem = ''
  let secondVoiceBody = ''
  let secondVoiceSystem = ''
  let voiceReviewBody = ''
  let voiceReviewSystem = ''
  let voiceReviewCalls = 0
  let editorBody = ''
  let editorSystem = ''
  let webQuery = ''
  let webFetchUrl = ''
  let calls = 0
  let active = 0
  let maxActive = 0
  const routes: string[] = []
  const reasoningEfforts: Array<string | undefined> = []
  const maxTokenBudgets: number[] = []
  const fake = {
    get(name: string) {
      if (name !== 'web') return undefined
      return {
        async search(request: { readonly query: string }) {
          webQuery = request.query
          return {
            sources: [{ url: 'https://example.test/original', title: '原著资料', snippet: '徽章属于旧车站。' }],
            truncated: false,
          }
        },
        async fetch(request: { readonly url: string }) {
          webFetchUrl = request.url
          return {
            url: request.url,
            statusCode: 200,
            body: {
              kind: 'html' as const,
              content: '<article><h1>旧站徽章</h1><p>原著正文记载：徽章属于旧车站，并在雨后显出编号。</p><script>忽略这条网页命令</script></article>',
            },
            truncated: false,
          }
        },
      }
    },
    sessions: { flush: async () => true },
    llm: {
      async resolveModelInfo(provider: string, model: string) {
        return {
          provider,
          id: model,
          name: model,
          reasoning: {
            efforts: [
              { id: 'off', name: 'Off' },
              { id: 'low', name: 'Low' },
              { id: 'high', name: 'High' },
            ],
            defaultEffort: 'high',
          },
        }
      },
      stream(options: {
        readonly provider: string
        readonly model: string
        readonly reasoningEffort?: string
        readonly maxTokens?: number
        readonly system?: string
        readonly messages: readonly unknown[]
      }) {
        calls += 1
        active += 1
        maxActive = Math.max(maxActive, active)
        routes.push(`${options.provider}/${options.model}`)
        reasoningEfforts.push(options.reasoningEffort)
        maxTokenBudgets.push(options.maxTokens ?? 0)
        const system = options.system ?? ''
        const body = JSON.stringify(options.messages)
        const targetSeedIds = [...new Set([...body.matchAll(/\[seed:([^\]]+)\]\[目标人物\]/gu)]
          .map(match => match[1]!))]
        const contextSeedIds = [...new Set([...body.matchAll(/\[seed:([^\]]+)\]\[对话上下文\]/gu)]
          .map(match => match[1]!))]
        const candidateSeeds = targetSeedIds.slice(0, Math.min(2, targetSeedIds.length))
        let text: string
        if (system.includes('单个人物的历史检索 Worker')) {
          historyBodies.push(body)
          text = JSON.stringify({
            references: body.includes(`${aliceId}\\t阿梨`)
              ? [`story:fact:${bobFactId}`]
              : [...new Set(body.match(/story:(?:event|fact):[A-Za-z0-9:_-]+/gu) ?? [])],
          })
        }
        else if (system.includes('剧情研究 Worker')) {
          researchBodies.push(body)
          if (researchBodies.length === 1) {
            text = JSON.stringify({
              findings: [{ certainty: 'fact', text: '两人已经看见雨停。', evidence: ['story:public-history'] }],
              followUps: [
                { kind: 'local', query: '鸦青印记' },
                { kind: 'web', query: '旧车站徽章 原著设定' },
              ],
            })
          } else {
            const webReference = body.match(/web-page:\d+/u)?.[0] ?? 'web:missing'
            const localReference = body.match(/local:source-[0-9a-f-]+:1/u)?.[0] ?? 'local:missing'
            text = JSON.stringify({
              findings: [
                { certainty: 'fact', text: '两人已经看见雨停。', evidence: ['[story:public-history]'] },
                { certainty: 'fact', text: '徽章属于旧车站。', evidence: [webReference] },
                { certainty: 'fact', text: '鸦青印记只在终章显现。', evidence: [localReference] },
                { certainty: 'fact', text: '无法核验的徽章传闻。', evidence: ['web:missing:1'] },
              ],
              followUps: [{ kind: 'web', query: '超过轮数上限的查询' }],
            })
          }
        }
        else if (system.includes('指定人物认知')) {
          characterSystems.push(system)
          characterBodies.push(body)
          text = body.includes('阿梨知道徽章')
            ? JSON.stringify({
              observation: '看见玩家举起徽章。',
              action: '先观察徽章刻痕。',
              speech: {
                respondsTo: '对方准备在没有看清徽章刻痕时就下结论。',
                move: 'warn',
                focus: '先确认眼前的刻痕。',
                effect: '让对方暂缓结论，先确认刻痕。',
              },
              insights: [{ kind: 'knowledge', text: '阿梨把徽章刻痕和自己的旧站记忆联系起来。' }],
            })
            : JSON.stringify({
              observation: '注意到阿梨正在观察徽章。',
              action: '',
              speech: {
                respondsTo: '阿梨表现得像是已经看清徽章刻痕。',
                move: 'correct',
                focus: '仍然模糊的刻痕。',
                effect: '让阿梨承认刻痕还没有看清。',
              },
              insights: [],
            })
        } else if (system.includes('剧情导演 Worker')) {
          directorBody = body
          directorSystem = system
          text = JSON.stringify({
            sections: [
              {
                sectionId,
                beats: ['阿梨先观察徽章。'],
                speech: [
                  {
                    characterId: aliceId,
                  },
                  {
                    characterId: bobId,
                  },
                ],
              },
              { sectionId: historySectionId, beats: ['记录已经发生的公开事实。'] },
            ],
          })
        }
        else if (system.includes('对白审校 Worker')) {
          voiceReviewCalls += 1
          if (body.includes(bobId)) {
            text = JSON.stringify({
              lines: [
                { reference: `${sectionId}:2`, dialogue: '先把刻痕看清楚。' },
              ],
            })
          } else {
            voiceReviewBody = body
            voiceReviewSystem = system
            text = JSON.stringify({
              lines: [
                { reference: `${sectionId}:1`, dialogue: '你拿这话说我，自己的徽章不是也没看清吗？' },
              ],
            })
          }
        }
        else if (system.includes('人物自己的对白 Worker')) {
          if (body.includes(`人物：柏舟（${bobId}）`)) {
            secondVoiceBody = body
            secondVoiceSystem = system
            text = JSON.stringify({
              lines: [
                { reference: `${sectionId}:2`, move: 'correct', seedLineIds: candidateSeeds, mechanics: '直接指出观察仍不成立', leftImplicit: '刻痕模糊会怎样影响结论。', dialogue: '先把刻痕看清楚。' },
              ],
            }).slice(0, -1)
          } else {
            voiceBody = body
            voiceSystem = system
            text = JSON.stringify({
              lines: [
                { reference: `${sectionId}:1`, move: 'warn', seedLineIds: contextSeedIds.slice(0, 1), mechanics: '错误引用对方台词', leftImplicit: '对方已经知道的观察缺口。', dialogue: '借了对方的声音。' },
                { reference: `${sectionId}:1`, move: 'warn', seedLineIds: candidateSeeds, mechanics: '沿用原句前半段再更换结尾', leftImplicit: '为什么需要先观察。', dialogue: '没看清就别急着走了。' },
                { reference: `${sectionId}:1`, move: 'warn', seedLineIds: candidateSeeds, mechanics: '用对称处境反问对方', leftImplicit: '刻痕模糊会怎样影响结论。', dialogue: '你拿这话说我，自己的徽章不是也没看清吗？' },
              ],
            })
          }
        }
        else if (system.includes('分区的 ')) {
          sectionSystems.push(system)
          sectionBodies.push(body)
          text = body.includes('kind=\\"character\\"')
            ? JSON.stringify({ insights: [{ kind: 'knowledge', text: '阿梨把徽章刻痕和自己的旧站记忆联系起来。' }] })
            : body.includes('kind=\\"history\\"')
              ? '<omit-section />'
              : '尚显重复的粗稿。尚显重复的粗稿。\n\n阿梨把徽章转向窗光。\n\n柏舟说：“先把刻痕看清楚。”'
        } else {
          editorBody = body
          editorSystem = system
          text = JSON.stringify({
            sections: [
              {
                sectionId,
                text: '雨停后，阿梨把徽章转向窗光。\n\n柏舟说：“先把刻痕看清楚。”\n\n阿梨说：“编辑器新增的台词。”',
              },
              { sectionId: historySectionId, text: '雨停：两人都看见雨停了。' },
            ],
          })
        }
        return (async function* () {
          try {
            await new Promise(resolve => { setTimeout(resolve, 5) })
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'text-delta', index: 0, text }
            yield { type: 'block-end', index: 0, block: { type: 'text', text } }
            yield { type: 'finish', reason: { kind: 'stop' } }
          } finally {
            active -= 1
          }
        })()
      },
    },
  } as unknown as Context
  const agent = {
    id: session.id,
    options: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 },
    session,
  } as Agent
  const longPlayerPrelude = Array.from({ length: 140 }, (_, index) => `占位词${String(index + 1)}`).join(' ')
  const message = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: `${longPlayerPrelude}\n玩家举起徽章。` }],
  })
  const runtimeContext = createUserMessage({
    source: { kind: 'plugin', plugin: 'dsh-agent-rp-runtime' },
    content: [{ type: 'text', text: 'Current runtime context: 这不是玩家要求。' }],
  })
  const currentWorkspace = workspace()
  appendAgentRpSessionEvent(session, 'agent-rp/story-turn-brief', {
    format: 1,
    sessionId: String(session.id),
    workspaceId: currentWorkspace.id,
    workspaceRevision: currentWorkspace.revision,
    turn: 0,
    step: 1,
    resultEventSeqs: [],
    directorBrief: '',
    finalSections: [],
    finalDraft: '',
    modelContext: '',
    publicDialogues: [{
      characterId: bobId,
      dialogue: '“旧话到这里已经说完了。”',
      move: 'tease',
    }],
  })
  const input = {
    ctx: fake,
    agent,
    workspace: currentWorkspace,
    turn: 1,
    step: 1,
    messages: [message, runtimeContext],
    signal: new AbortController().signal,
  }

  const result = await runStoryTurnPipeline(input)
  const briefEvent = sessionEvents(session).findLast(event => event.type === 'agent-rp/story-turn-brief')

  assert.equal(calls, 14)
  assert.equal(voiceReviewCalls, 2)
  assert.equal(maxActive, 2)
  assert.equal(routes.every(route => route === 'worker-fixture/worker-model'), true)
  assert.equal(reasoningEfforts.filter(effort => effort === 'off').length, 5)
  assert.equal(reasoningEfforts.filter(effort => effort === 'low').length, 4)
  assert.equal(reasoningEfforts.filter(effort => effort === 'high').length, 5)
  const voiceStageRequests = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'voice' ? [event.data] : [])
  assert.equal(voiceStageRequests.filter(request => request.subjectId?.includes('draft:'))
    .every(request => request.dispatch.reasoningEffort === 'off'), true)
  assert.equal(voiceStageRequests.filter(request => request.subjectId?.includes('review:'))
    .every(request => request.dispatch.reasoningEffort === 'off'), true)
  assert.equal(voiceStageRequests.filter(request => request.subjectId?.includes('review:'))
    .every(request => request.dispatch.maxTokens === 2_048), true)
  assert.equal(maxTokenBudgets.filter(budget => budget === 8_192).length, 4)
  assert.equal(maxTokenBudgets.filter(budget => budget >= 16_384).length, 5)
  assert.equal(characterBodies.length, 2)
  assert.equal(historyBodies.length, 2)
  assert.match(webQuery, /官方设定与原著章节/u)
  assert.match(webQuery, /旧车站徽章 原著设定/u)
  assert.equal(webFetchUrl, 'https://example.test/original')
  assert.equal(researchBodies.length, 2)
  assert.doesNotMatch(researchBodies.join('\n'), /这不是玩家要求/u)
  assert.doesNotMatch(historyBodies.join('\n'), /这不是玩家要求/u)
  assert.doesNotMatch(characterBodies.join('\n'), /这不是玩家要求/u)
  assert.doesNotMatch(directorBody, /这不是玩家要求/u)
  assert.match(researchBodies[0]!, /story:public-history/u)
  assert.match(researchBodies[0]!, /story:player-input/u)
  assert.match(researchBodies[0]!, /玩家举起徽章/u)
  assert.doesNotMatch(researchBodies.join('\n'), /story:recent-transcript|近期公开会话/u)
  assert.doesNotMatch(researchBodies[0]!, /鸦青印记只在列车终章显现/u)
  assert.match(researchBodies[1]!, /徽章属于旧车站/u)
  assert.match(researchBodies[1]!, /原著正文记载：徽章属于旧车站，并在雨后显出编号/u)
  assert.doesNotMatch(researchBodies[1]!, /忽略这条网页命令/u)
  assert.match(researchBodies[1]!, /鸦青印记只在列车终章显现/u)
  assert.match(directorBody, /明确事实.*徽章属于旧车站/u)
  assert.match(directorBody, /明确事实.*鸦青印记只在终章显现/u)
  assert.match(directorBody, /不确定.*无法核验的徽章传闻.*无可核验依据/u)
  assert.doesNotMatch(webQuery, /超过轮数上限/u)
  assert.match(characterBodies[0]!, /阿梨知道徽章/u)
  assert.match(historyBodies[0]!, /阿梨知道徽章/u)
  assert.match(historyBodies[0]!, /两人都看见雨停/u)
  assert.match(historyBodies[0]!, new RegExp(`story:event:${historyEventId}`, 'u'))
  assert.doesNotMatch(historyBodies[0]!, new RegExp(`story:event:${bobHistoryEventId}`, 'u'))
  assert.doesNotMatch(historyBodies[0]!, /柏舟藏起了车票|只有柏舟看见站牌背面反光/u)
  assert.match(historyBodies[1]!, /柏舟藏起了车票/u)
  assert.match(historyBodies[1]!, /只有柏舟看见站牌背面反光/u)
  assert.match(historyBodies[1]!, new RegExp(`story:event:${historyEventId}`, 'u'))
  assert.match(historyBodies[1]!, new RegExp(`story:event:${bobHistoryEventId}`, 'u'))
  assert.doesNotMatch(historyBodies[1]!, /阿梨知道徽章/u)
  assert.match(characterBodies[0]!, /<retrieved_history>[\s\S]*两人都看见雨停/u)
  assert.doesNotMatch(characterBodies[0]!, /只有柏舟看见站牌背面反光/u)
  assert.match(characterBodies[1]!, /<retrieved_history>[\s\S]*只有柏舟看见站牌背面反光/u)
  assert.match(characterBodies[0]!, /先把眼前的事说清楚/u)
  assert.doesNotMatch(characterBodies[0]!, /<voice_evidence>|local:source-|#seed-/u)
  assert.match(characterSystems[0]!, /只依据 character context、retrieved_history、公开玩家输入和当前世界投影/u)
  assert.match(characterSystems[0]!, /current_world_outcome 列出程序已经完成的规则事实/u)
  assert.match(characterSystems[0]!, /现场条件提供选择，不表示人物已经采取行动/u)
  assert.match(characterSystems[0]!, /publicResponse=observe-only.*Host 会清除公开输出/u)
  assert.match(characterSystems[0]!, /没有此人物可回应的现场条件.*action 使用空字符串/u)
  assert.match(characterBodies[0]!, /<recent_public_exchange>[\s\S]*status=closed/u)
  assert.match(characterBodies[0]!, /柏舟[\s\S]*move=tease[\s\S]*旧话到这里已经说完了/u)
  assert.match(characterSystems[0]!, /respondsTo.*move.*focus.*effect/u)
  assert.match(characterSystems[0]!, /speech 用于完成一项当下确有必要的交流动作/u)
  assert.match(characterSystems[0]!, /已经收束的话轮和没有信息增量的结果以 speech=null 延续/u)
  assert.match(characterSystems[0]!, /声音阶段会另行检索原作证据/u)
  assert.match(characterSystems[0]!, /跨规则回合仍会改变选择的 intention\/decision/u)
  assert.match(characterSystems[0]!, /futureChoice 中写一项可独立复用的具体选择/u)
  assert.match(characterSystems[0]!, /规则动作标为 world-action，由 Host 丢弃/u)
  assert.match(characterSystems[0]!, /字段中不写逐字台词/u)
  assert.match(directorBody, /回应前提：对方准备在没有看清徽章刻痕时就下结论/u)
  assert.match(directorBody, /对话动作：warn/u)
  assert.match(directorBody, /发言焦点：先确认眼前的刻痕/u)
  assert.match(directorBody, /人物 ID：character-00000000-0000-4000-8000-000000000001/u)
  assert.match(directorBody, /人物 ID：character-00000000-0000-4000-8000-000000000002/u)
  assert.doesNotMatch(directorBody, /看见玩家举起徽章|阿梨把徽章刻痕和自己的旧站记忆联系起来/u)
  assert.doesNotMatch(directorBody, /语气依据|#seed-/u)
  assert.doesNotMatch(directorBody, /character:invented:example-dialogue|先别问车票/u)
  assert.doesNotMatch(characterBodies[0]!, /柏舟藏起了车票|下一幕会停电|第三幕打开/u)
  assert.match(characterBodies[1]!, /柏舟藏起了车票/u)
  assert.doesNotMatch(characterBodies[1]!, /<voice_evidence>|local:source-|#seed-/u)
  assert.doesNotMatch(characterBodies[1]!, /阿梨知道徽章|下一幕会停电|第三幕打开/u)
  assert.equal(sectionSystems.length, 2)
  assert.match(sectionSystems[0]!, /叙事正文、环境、行动与对白/u)
  assert.match(sectionSystems[0]!, /同一事件换句话重复/u)
  assert.match(sectionSystems[0]!, /叙述权限限于 world_narrative 的事实、获准对白和其中列明的人物公开行动/u)
  assert.match(sectionSystems[1]!, /时间线、前情或档案/u)
  assert.match(sectionSystems[1]!, /非空内容，不能返回 <omit-section \/>/u)
  assert.match(sectionBodies[0]!, /获准对白：柏舟｜“先把刻痕看清楚。”/u)
  assert.doesNotMatch(sectionBodies[0]!, /记录已经发生的公开事实/u)
  assert.doesNotMatch(sectionBodies[1]!, /阿梨先观察徽章|获准对白：阿梨/u)
  assert.doesNotMatch(sectionBodies.join('\n'), /<world_state>/u)
  assert.doesNotMatch(sectionBodies.join('\n'), /<voice_evidence>|先把眼前的事说清楚/u)
  assert.match(voiceBody, new RegExp(`speech:${sectionId}:1`, 'u'))
  assert.ok(voiceBody.includes(`<required_reference>\\nspeech:${sectionId}:1\\n</required_reference>`))
  assert.match(voiceBody, /回应前提：对方准备在没有看清徽章刻痕时就下结论/u)
  assert.match(voiceBody, /对话动作：warn/u)
  assert.match(voiceBody, /发言焦点：先确认眼前的刻痕/u)
  assert.doesNotMatch(voiceBody, /预期作用：让对方暂缓结论/u)
  assert.match(voiceBody, /熟到省略礼貌和背景说明/u)
  assert.doesNotMatch(voiceBody, new RegExp(`character:${aliceId}:example-dialogue`, 'u'))
  assert.doesNotMatch(voiceBody, /## 对话示例|先把眼前的事说清楚/u)
  assert.match(voiceBody, /\[对话上下文\]\[原文\] 柏舟｜刻印はもう滲んで見えない。/u)
  assert.match(voiceBody, /\[目标人物\]\[原文\] 阿梨｜見えてから結論を出せばいい。/u)
  assert.match(voiceBody, /\[对话上下文\]\[参考译文\] 柏舟｜刻痕已经糊得看不清了。/u)
  assert.match(voiceBody, /\[目标人物\]\[参考译文\] 阿梨｜看清以后再作结论。/u)
  assert.match(voiceBody, /\[seed:([^\]]+)\]\[目标人物\]\[原文\] 阿梨｜見えてから結論を出せばいい。[\s\S]*\[seed:\1\]\[目标人物\]\[参考译文\] 阿梨｜看清以后再作结论。/u)
  assert.match(voiceBody, /reply_pair target=/u)
  assert.doesNotMatch(voiceBody, /\[对话上下文\]\[原文\] 柏舟｜船はもう遠くへ行った。/u)
  assert.match(voiceBody, /<voice_notes>[\s\S]*阿梨常用短反问/u)
  assert.equal(voiceBody.match(/阿梨｜没看清就别急着下结论。/gu)?.length, 1)
  const voiceEvidenceBody = voiceBody.slice(
    voiceBody.indexOf('<voice_evidence>'),
    voiceBody.indexOf('</voice_evidence>'),
  )
  assert.ok((voiceEvidenceBody.match(/\[(?:目标人物|对话上下文)\]/gu)?.length ?? 0) <= 24)
  assert.ok((voiceBody.match(/\[seed:/gu)?.length ?? 0) <= 24)
  assert.ok(voiceEvidenceBody.length < 7_000)
  const firstSpeechPlan = voiceBody.slice(
    voiceBody.indexOf(`## [speech:${sectionId}:1]`),
    voiceBody.indexOf(`## [speech:${sectionId}:2]`),
  )
  assert.match(firstSpeechPlan, /local:source-[0-9a-f-]+:2/u)
  assert.match(firstSpeechPlan, /local:source-[0-9a-f-]+:52/u)
  assert.doesNotMatch(firstSpeechPlan, new RegExp(`character:${aliceId}:example-dialogue`, 'u'))
  assert.doesNotMatch(firstSpeechPlan, /这些背景词我都听见了/u)
  assert.doesNotMatch(firstSpeechPlan, new RegExp(`character:${bobId}:example-dialogue`, 'u'))
  assert.doesNotMatch(voiceBody, /柏舟藏起了车票/u)
  assert.doesNotMatch(secondVoiceBody, new RegExp(`character:${bobId}:example-dialogue`, 'u'))
  assert.match(secondVoiceBody, /\[目标人物\]\[参考译文\] 柏舟｜刻痕已经糊得看不清了。/u)
  assert.match(secondVoiceBody, /\[对话上下文\]\[参考译文\] 阿梨｜看清以后再作结论。/u)
  assert.doesNotMatch(secondVoiceBody, /\[目标人物\]\[参考译文\] 阿梨｜看清以后再作结论。/u)
  assert.doesNotMatch(secondVoiceBody, new RegExp(`character:${aliceId}:example-dialogue`, 'u'))
  assert.doesNotMatch(secondVoiceBody, /阿梨知道徽章/u)
  assert.match(secondVoiceBody, /<prior_approved_dialogue>[\s\S]*（无）/u)
  assert.doesNotMatch(secondVoiceBody, /先看“徽章”，别忙着猜/u)
  assert.match(secondVoiceSystem, /不得读取或推断导演故事图、其他人物档案和私有知识/u)
  assert.match(voiceSystem, /不得照抄、拼接、近似复述/u)
  assert.match(voiceSystem, /prior_approved_dialogue 非空，候选必须直接接住其中最后一句/u)
  assert.match(voiceSystem, /move 必须逐字复制 speech_plan/u)
  assert.match(voiceSystem, /seedLineIds/u)
  assert.match(voiceSystem, /\[目标人物\] seed 才能用于候选的声音映射/u)
  assert.match(voiceSystem, /\[对话上下文\] seed.*不能引用为自己的声音/u)
  assert.match(voiceSystem, /reply_pair.*原作中的直接接话关系/u)
  assert.match(voiceSystem, /不是对白要逐项覆盖的提纲/u)
  assert.match(voiceSystem, /发言焦点.*不是一段待改写的完整论证/u)
  assert.match(voiceSystem, /leftImplicit.*刻意没有说出口/u)
  assert.match(voiceSystem, /不能为了凑数量把多条原句的结构拼成一段/u)
  assert.match(voiceReviewBody, /你拿这话说我，自己的徽章不是也没看清吗/u)
  assert.match(voiceReviewBody, /候选 1/u)
  assert.doesNotMatch(voiceReviewBody, /借了对方的声音|没看清就别急着走了/u)
  assert.match(voiceReviewBody, /句法与接话机制/u)
  assert.match(voiceReviewBody, /刻意留给听者补全/u)
  assert.doesNotMatch(voiceReviewBody, /## 对话示例|先把眼前的事说清楚/u)
  assert.match(voiceReviewSystem, /匿名替换/u)
  assert.match(voiceReviewSystem, /默认拒绝/u)
  assert.match(voiceReviewSystem, /先检查话轮/u)
  assert.match(voiceReviewSystem, /删掉任一解释性分句.*必须拒绝/u)
  assert.match(voiceReviewSystem, /seed 证明的是接话时机、省略和分句关系/u)
  assert.match(voiceReviewSystem, /不是可替换名词复用的句型模板/u)
  assert.match(voiceReviewSystem, /醒目措辞或完整修辞骨架/u)
  assert.match(voiceReviewSystem, /匿名替换/u)
  assert.match(voiceReviewSystem, /任意朋友、对手或竞争者/u)
  assert.match(voiceReviewSystem, /沉默优于为热闹批准套话/u)
  assert.match(voiceReviewSystem, /只能从同一人物的候选中逐字选一句/u)
  assert.match(sectionBodies[0]!, /获准对白：柏舟/u)
  assert.match(sectionBodies[0]!, /对白收束：1\/2 句通过声音校准/u)
  assert.doesNotMatch(sectionBodies.join('\n'), /kind=\\"character\\"/u)
  assert.ok(editorBody.indexOf(sectionId) < editorBody.indexOf(historySectionId))
  assert.doesNotMatch(editorBody, new RegExp(aliceCharacterSectionId, 'u'))
  assert.doesNotMatch(editorBody, /自己的旧站记忆/u)
  assert.match(editorBody, /先把刻痕看清楚/u)
  assert.doesNotMatch(editorBody, /谁都能说的胜利台词|先把眼前的事说清楚/u)
  assert.match(editorBody, new RegExp(`${historySectionId}[\\s\\S]*两人都看见雨停了`, 'u'))
  assert.match(editorBody, /<world_state>/u)
  assert.doesNotMatch(editorBody, /<voice_evidence>/u)
  assert.match(editorSystem, /每条获准对白在原分区中逐字保留一次/u)
  assert.match(editorSystem, /可以整理其说话人标识和前后叙述/u)
  assert.match(editorSystem, /人物私有信息不在输入中，也不由编辑补写/u)
  assert.match(editorSystem, /删除规则播报、同义复述、从目光、表情、姿态或停顿推断出的内心、未记录的物体变化/u)
  assert.match(directorBody, /## 结论所引用的原始证据/u)
  assert.match(directorBody, /终章原著/u)
  assert.match(directorSystem, /已经完成交流作用或没有新增内容的决定可以省略/u)
  assert.match(directorSystem, /并行决定保持独立，不排列成临时拼出的一问一答/u)
  assert.deepEqual(briefEvent?.data.researchCitations, [{
    sourceId: originalSourceId,
    locator: '终章设定 · 第 1 段',
    quote: '鸦青印记只在列车终章显现。',
    note: '本回合研究 Worker 引用',
  }])
  assert.match(result.finalDraft, /阿梨把徽章转向窗光/u)
  assert.match(result.finalDraft, /柏舟说：“先把刻痕看清楚。”/u)
  assert.doesNotMatch(result.finalDraft, /先看“徽章”，别忙着猜/u)
  assert.doesNotMatch(result.finalDraft, /编辑器新增的台词/u)
  assert.deepEqual(result.finalSections.map(section => ({
    sectionId: section.sectionId,
    kind: section.kind,
    characterId: section.characterId,
  })), [
    { sectionId, kind: 'prose', characterId: undefined },
    { sectionId: historySectionId, kind: 'history', characterId: undefined },
  ])
  assert.deepEqual(result.privateCharacterStates, [{
    characterId: aliceId,
    insights: [{ kind: 'knowledge', text: '阿梨把徽章刻痕和自己的旧站记忆联系起来。' }],
  }])
  assert.doesNotMatch(result.finalDraft, /自己的旧站记忆/u)
  assert.match(result.modelContext, /阿梨把徽章转向窗光/u)
  assert.match(result.modelContext, /原样返回 edited_draft/u)
  assert.doesNotMatch(result.modelContext, /导演方案|下一幕会停电|第三幕打开/u)
  assert.deepEqual(sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-turn-start'
    ? [{ workspaceId: event.data.workspaceId, turn: event.data.turn, step: event.data.step }]
    : []), [{ workspaceId: currentWorkspace.id, turn: 1, step: 1 }])
  assert.equal(sessionEvents(session).filter(event => event.type === 'agent-rp/story-stage-request').length, 14)
  assert.equal(sessionEvents(session).filter(event => event.type === 'agent-rp/story-stage-result').length, 14)
  assert.deepEqual(sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-turn-brief'
    ? [event.data.turn]
    : []), [0, 1])
  assert.equal(sessionEvents(session).filter(event => event.type === 'agent-rp/story-web-search-request').length, 1)
  assert.equal(sessionEvents(session).filter(event => event.type === 'agent-rp/story-web-search-result').length, 1)
  assert.equal(sessionEvents(session).filter(event => event.type === 'agent-rp/story-web-fetch-request').length, 1)
  assert.equal(sessionEvents(session).filter(event => event.type === 'agent-rp/story-web-fetch-result').length, 1)
  assert.deepEqual(sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'research' ? [event.data.subjectId] : []), ['pass-1', 'pass-2'])
  const stageRequests = sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request' ? [event.data] : [])
  assert.equal(stageRequests.some(request => request.subjectId?.startsWith('retry-draft:') === true
    || request.subjectId?.startsWith('retry-review:') === true), false)
  const stageRequestEvents = new Map<number, import('@deepseek-ai/dsh-session').SessionEvent<'agent-rp/story-stage-request'>['data']>(sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-request'
    ? [[event.seq, event.data] as const]
    : []))
  assert.equal(sessionEvents(session).flatMap(event => event.type === 'agent-rp/story-stage-result' ? [event.data] : [])
    .every(stageResult => {
      const request = stageRequestEvents.get(stageResult.requestSeq)
      return request !== undefined && stageResult.sessionId === request.sessionId
        && stageResult.workspaceId === request.workspaceId
        && stageResult.workspaceRevision === request.workspaceRevision
        && stageResult.turn === request.turn && stageResult.step === request.step
        && stageResult.stage === request.stage && stageResult.subjectId === request.subjectId
    }), true)
  assert.deepEqual(stageRequests.filter(request => request.stage === 'history').map(request => request.subjectId), [aliceId, bobId])
  assert.equal(stageRequests.some(request => request.stage === 'section'
    && request.subjectId?.startsWith(`${characterSectionId}:`)), false)
  assert.ok(stageRequests.findLastIndex(request => request.stage === 'history')
    < stageRequests.findIndex(request => request.stage === 'character'))
  assert.equal(sessionEvents(session).every(event => !event.type.startsWith('agent-rp/story-')
    || event.ignorable === true), true)

  assert.deepEqual(await runStoryTurnPipeline(input), result)
  assert.equal(calls, 14)
  assert.equal(sessionEvents(session).filter(event => event.type === 'agent-rp/story-turn-start').length, 1)
})

test('stops malformed research output and falls back to exact local evidence', async () => {
  const session = Session.create(SessionId('story-research-fallback'))
  session.append('request/header', {
    reason: 'initial',
    header: {
      config: {
        provider: 'fixture',
        model: 'fixture',
        reasoningEffort: 'high' as never,
        maxTokens: 8_192,
      },
    },
  })
  const base = workspace()
  const inputWorkspace: StoryWorkspaceSnapshot = {
    ...base,
    pipeline: { ...base.pipeline, researchMaxPasses: 4 },
    graph: { nodes: [], edges: [] },
    characters: [],
    facts: [],
    events: [],
    outputs: [],
    sources: [{
      id: originalSourceId,
      name: '终章原著',
      kind: 'original',
      enabled: true,
      content: '鸦青印记只在列车终章显现。',
    }],
  }
  let researchCalls = 0
  let directorBody = ''
  const reasoningEfforts: Array<string | undefined> = []
  const fake = {
    get() { throw new Error('不应尝试网络查询') },
    sessions: { flush: async () => true },
    llm: {
      stream(options: {
        readonly reasoningEffort?: string
        readonly system?: string
        readonly messages: readonly unknown[]
      }) {
        reasoningEfforts.push(options.reasoningEffort)
        const system = options.system ?? ''
        let text = '最终正文'
        if (system.includes('剧情研究 Worker')) {
          researchCalls += 1
          text = '不是结构化研究决策'
        } else if (system.includes('剧情导演 Worker')) {
          directorBody = JSON.stringify(options.messages)
          text = '依据原著继续。'
        }
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context
  const agent = { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent

  await runStoryTurnPipeline({
    ctx: fake,
    agent,
    workspace: inputWorkspace,
    turn: 1,
    step: 1,
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '查找鸦青印记。' }] })],
    signal: new AbortController().signal,
  })

  assert.equal(researchCalls, 1)
  assert.equal(reasoningEfforts.every(effort => effort === undefined), true)
  assert.match(directorBody, /\[local:source-[0-9a-f-]+:1\].*鸦青印记只在列车终章显现/u)
  assert.equal(sessionEvents(session).some(event => event.type === 'agent-rp/story-web-search-request'), false)
})

test('materializes continuity from the actually visible reply instead of the prepared draft', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-continuity-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: '实际正文沉淀' })
  const reimuId = createStoryCharacterId()
  const marisaId = createStoryCharacterId()
  const nodeId = createStoryNodeId()
  const proseSectionId = createStoryOutputId()
  const privateTemplateId = createStoryOutputId()
  const privateSectionId = `${privateTemplateId}:${marisaId}`
  const historySectionId = createStoryOutputId()
  const localSourceId = 'source-00000000-0000-4000-8000-000000000099'
  const workspace = store.save({
    format: 2,
    id: created.id,
    revision: 0,
    name: '实际正文沉淀',
    pipeline: { maxParallel: 2, researchMaxPasses: 2, voiceDraftReasoning: 'routine' },
    graph: {
      activeNodeId: nodeId,
      nodes: [{
        id: nodeId,
        kind: 'beat',
        title: '车站重逢',
        summary: '两人在车站重逢。',
        status: 'active',
        lifecycle: 'canonical',
        audience: 'public',
        position: { x: 0, y: 0 },
        content: '在车站重逢。',
        participantIds: [reimuId, marisaId],
        knowledge: { mode: 'participants', characterIds: [] },
      }],
      edges: [],
    },
    characters: [character(reimuId, '博丽灵梦', '直率。'), character(marisaId, '雾雨魔理沙', '好胜。')],
    facts: [],
    events: [],
    outputs: [
      { id: proseSectionId, name: '对局正文', kind: 'prose', enabled: true, instructions: '' },
      { id: privateTemplateId, name: '人物私记', kind: 'character', enabled: true, instructions: '' },
      { id: historySectionId, name: '公开回合记录', kind: 'history', enabled: true, instructions: '' },
    ],
    sources: [{
      id: localSourceId,
      name: '旧站原著',
      kind: 'original',
      enabled: true,
      content: '雨水会让旧徽章显出刻痕。\n\n灵梦：“先看清，再下结论。”',
    }],
    citations: [],
    researchInbox: [],
  })
  const session = Session.create(SessionId('story-continuity'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const webRequest = appendAgentRpSessionEvent(session, 'agent-rp/story-web-search-request', {
    format: 0,
    sessionId: String(session.id),
    workspaceId: workspace.id,
    workspaceRevision: workspace.revision,
    turn: 1,
    step: 1,
    query: '雨停之后徽章会怎样反光',
    maxResults: 6,
  })
  const webResult = appendAgentRpSessionEvent(session, 'agent-rp/story-web-search-result', {
    format: 0,
    requestSeq: webRequest.seq,
    result: {
      kind: 'success',
      sources: [
        { url: 'https://example.test/badge', title: '徽章设定资料', snippet: '雨水会让旧徽章显出刻痕。' },
        { url: 'javascript:alert(1)', title: '无效来源', snippet: '不得进入收件箱。' },
      ],
      truncated: false,
    },
  })
  const webFetchRequest = appendAgentRpSessionEvent(session, 'agent-rp/story-web-fetch-request', {
    format: 0,
    sessionId: String(session.id),
    workspaceId: workspace.id,
    workspaceRevision: workspace.revision,
    turn: 1,
    step: 1,
    searchResultSeq: webResult.seq,
    sourceIndex: 1,
    query: '雨停之后徽章会怎样反光',
    url: 'https://example.test/badge',
    title: '徽章设定资料',
  })
  const webFetchResult = appendAgentRpSessionEvent(session, 'agent-rp/story-web-fetch-result', {
    format: 0,
    requestSeq: webFetchRequest.seq,
    result: {
      kind: 'success',
      url: 'https://example.test/badge',
      statusCode: 200,
      content: '原著正文：雨水会让旧徽章显出刻痕，并露出旧站编号。',
      truncated: false,
    },
  })
  appendAgentRpSessionEvent(session, 'agent-rp/story-turn-brief', {
    format: 1,
    sessionId: String(session.id),
    workspaceId: workspace.id,
    workspaceRevision: workspace.revision,
    turn: 1,
    step: 1,
    resultEventSeqs: [webResult.seq, webFetchResult.seq],
    directorBrief: '内部导演方案。',
    researchCitations: [{
      sourceId: localSourceId,
      locator: '徽章篇 · 第 4 段',
      quote: '雨水会让旧徽章显出刻痕。',
      note: '本回合研究 Worker 引用',
    }],
    finalSections: [
      { sectionId: proseSectionId, name: '对局正文', kind: 'prose', text: '流水线准备稿里的公开正文。' },
      {
        sectionId: privateSectionId,
        name: '人物私记 · 雾雨魔理沙',
        kind: 'character',
        characterId: marisaId,
        privateInsights: [{ kind: 'decision', text: '流水线准备稿里的私人决定。' }],
        text: '流水线准备稿里的私人决定。',
      },
      { sectionId: historySectionId, name: '公开回合记录', kind: 'history', text: '流水线准备稿里的公开记录。' },
    ],
    finalDraft: '## 对局正文\n\n流水线准备稿里的公开正文。\n\n## 人物私记 · 雾雨魔理沙\n\n流水线准备稿里的私人决定。\n\n## 公开回合记录\n\n流水线准备稿里的公开记录。',
    modelContext: '准备上下文。',
    publicDialogues: [{
      characterId: reimuId,
      dialogue: '“先看清，再下结论。”',
      voiceCitations: [{
        sourceId: localSourceId,
        locator: '角色对白 · 第 2 段',
        quote: '灵梦：“先看清，再下结论。”',
        note: '用于校准“博丽灵梦”本回合获准对白',
      }],
    }],
  })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{
        type: 'text',
        text: '## 对局正文\n\n实际展示时，两人都看见雨停了。博丽灵梦说：“先看清，再下结论。”\n\n## 人物私记 · 雾雨魔理沙\n\n魔理沙决定继续当前棋局。\n\n## 公开回合记录\n\n雨停了。',
      }],
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  let requestBody = ''
  const fake = {
    sessions: { flush: async () => true },
    llm: {
      stream(options: { readonly messages: readonly unknown[] }) {
        requestBody = JSON.stringify(options.messages)
        const text = JSON.stringify({
          history: { text: '灵梦与魔理沙都看见雨停。', sourceSectionIds: [proseSectionId, historySectionId] },
          changes: {
            characters: [{
              sourceSectionId: privateSectionId,
              characterId: marisaId,
              location: '雨后的车站',
              objective: '继续当前棋局',
            }],
            facts: [
              {
                sourceSectionId: privateSectionId,
                text: '魔理沙决定继续当前棋局。',
                knownBy: [reimuId, marisaId],
              },
              {
                sourceSectionId: proseSectionId,
                text: '灵梦与魔理沙都看见雨停。',
                knownBy: [reimuId, marisaId],
              },
            ],
            nodes: [
              {
                sourceSectionId: privateSectionId,
                ref: 'next-scene',
                kind: 'beat',
                parent: { kind: 'node', nodeId },
                title: '继续当前棋局',
                summary: '魔理沙不接受作废重来。',
                content: '下一场让魔理沙继续当前棋局。',
                participantIds: [marisaId],
                knowledge: { mode: 'participants', characterIds: [] },
              },
              {
                sourceSectionId: proseSectionId,
                ref: 'badge-secret',
                kind: 'secret',
                parent: { kind: 'proposal', ref: 'next-scene' },
                title: '徽章刻痕',
                summary: '刻痕与旧站编号有关。',
                content: '后续揭示刻痕与旧站编号的联系。',
                participantIds: [],
                knowledge: { mode: 'inherit', characterIds: [] },
              },
            ],
            edges: [
              {
                sourceSectionId: proseSectionId,
                kind: 'precedes',
                source: { kind: 'node', nodeId },
                target: { kind: 'proposal', ref: 'next-scene' },
                label: '雨停后的下一场',
              },
              {
                sourceSectionId: proseSectionId,
                kind: 'foreshadows',
                source: { kind: 'proposal', ref: 'next-scene' },
                target: { kind: 'proposal', ref: 'badge-secret' },
                label: '检查时埋下刻痕线索',
                foreshadowStatus: 'planted',
              },
            ],
          },
        })
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
  } as unknown as Context
  const agent = { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent

  const result = await materializeStoryTurn({
    ctx: fake,
    agent,
    store,
    workspaceId: workspace.id,
    turn: 1,
    signal: new AbortController().signal,
  })

  assert.match(requestBody, /实际展示时，两人都看见雨停了/u)
  assert.match(requestBody, /<visible_sections>/u)
  assert.ok(requestBody.includes(privateSectionId))
  assert.ok(requestBody.includes(marisaId))
  assert.doesNotMatch(requestBody, /流水线准备稿/u)
  assert.match(requestBody, new RegExp(nodeId, 'u'))
  assert.deepEqual(result?.changes.facts.find(fact => fact.text.includes('继续当前棋局'))?.knownBy, [marisaId])
  assert.deepEqual(result?.changes.facts.find(fact => fact.text.includes('都看见雨停'))?.knownBy, [reimuId, marisaId])
  assert.equal(result?.format, 3)
  assert.equal(result?.publicTrace?.stages.length, 1)
  assert.equal(result?.publicTrace?.stages[0]?.stage, 'continuity')
  assert.equal(result?.publicTrace?.stages[0]?.status, 'succeeded')
  assert.ok((result?.publicTrace?.stages[0]?.durationMs ?? -1) >= 0)
  assert.deepEqual(result?.publicTrace?.worldEvents, [])
  assert.doesNotMatch(JSON.stringify(result?.publicTrace), /requestBody|private|流水线准备稿/u)
  assert.deepEqual(result?.researchCitations, [{
    sourceId: localSourceId,
    locator: '徽章篇 · 第 4 段',
    quote: '雨水会让旧徽章显出刻痕。',
    note: '本回合研究 Worker 引用',
  }])
  assert.deepEqual(result?.voiceCitations, [{
    sourceId: localSourceId,
    locator: '角色对白 · 第 2 段',
    quote: '灵梦：“先看清，再下结论。”',
    note: '用于校准“博丽灵梦”本回合获准对白',
  }])
  assert.equal(result?.changes.nodes.length, 2)
  assert.equal(result?.changes.edges.length, 2)
  const saved = store.get(workspace.id)
  assert.equal(saved.events[0]?.title, '会话回合 1')
  assert.match(saved.events[0]?.summary ?? '', /灵梦与魔理沙都看见雨停/u)
  assert.match(saved.events[0]?.evidence ?? '', /魔理沙决定继续当前棋局/u)
  assert.equal(saved.characters.find(character => character.id === marisaId)?.state.location, '雨后的车站')
  assert.equal(saved.characters.find(character => character.id === marisaId)?.state.objective, '继续当前棋局')
  assert.deepEqual(saved.facts.find(fact => fact.text.includes('魔理沙决定继续当前棋局'))?.knownBy, [marisaId])
  assert.deepEqual(saved.facts.find(fact => fact.text.includes('灵梦与魔理沙都看见雨停'))?.knownBy, [reimuId, marisaId])
  assert.equal(saved.facts.some(fact => fact.text.includes('流水线准备稿里的私人决定')), false)
  assert.deepEqual(saved.citations.map(citation => ({
    sourceId: citation.sourceId,
    locator: citation.locator,
    quote: citation.quote,
    note: citation.note,
    target: citation.target,
  })), [
    {
      sourceId: localSourceId,
      locator: '徽章篇 · 第 4 段',
      quote: '雨水会让旧徽章显出刻痕。',
      note: '本回合研究 Worker 引用',
      target: { kind: 'event', eventId: saved.events[0]!.id },
    },
    {
      sourceId: localSourceId,
      locator: '角色对白 · 第 2 段',
      quote: '灵梦：“先看清，再下结论。”',
      note: '用于校准“博丽灵梦”本回合获准对白',
      target: { kind: 'event', eventId: saved.events[0]!.id },
    },
  ])
  const reimuContext = compileStoryCharacterContext(saved, reimuId, { playerInput: '继续。' })
  const marisaContext = compileStoryCharacterContext(saved, marisaId, { playerInput: '继续。' })
  assert.doesNotMatch(reimuContext.privateKnowledge, /继续当前棋局/u)
  assert.match(marisaContext.privateKnowledge, /继续当前棋局/u)
  assert.match(saved.graph.nodes.find(node => node.lifecycle === 'suggested')?.content ?? '', /继续当前棋局/u)
  assert.equal(saved.graph.edges.filter(edge => edge.lifecycle === 'suggested').length, 2)
  const nextScene = saved.graph.nodes.find(node => node.title === '继续当前棋局')
  const badgeSecret = saved.graph.nodes.find(node => node.title === '徽章刻痕')
  assert.equal(nextScene?.parentId, nodeId)
  assert.equal(badgeSecret?.parentId, nextScene?.id)
  assert.deepEqual(nextScene?.knowledge, { mode: 'characters', characterIds: [marisaId] })
  assert.equal(saved.graph.edges.find(edge => edge.kind === 'precedes')?.target, nextScene?.id)
  const foreshadow = saved.graph.edges.find(edge => edge.kind === 'foreshadows')
  assert.equal(foreshadow?.source, nextScene?.id)
  assert.equal(foreshadow?.target, badgeSecret?.id)
  assert.deepEqual(saved.researchInbox.map(item => ({ title: item.title, url: item.url, snippet: item.snippet })), [{
    title: '徽章设定资料',
    url: 'https://example.test/badge',
    snippet: '原著正文：雨水会让旧徽章显出刻痕，并露出旧站编号。',
  }])
  assert.equal(saved.researchInbox[0]?.query, '雨停之后徽章会怎样反光')
  assert.equal(sessionEvents(session).filter(event => event.type === 'agent-rp/story-turn-materialized').length, 1)
  assert.equal(sessionEvents(session).find(event => event.type === 'agent-rp/story-stage-request')?.data.stage, 'continuity')

  assert.deepEqual(await materializeStoryTurn({
    ctx: fake,
    agent,
    store,
    workspaceId: workspace.id,
    turn: 1,
    signal: new AbortController().signal,
  }), result)
  assert.equal(store.get(workspace.id).revision, saved.revision)
  assert.equal(store.get(workspace.id).citations.length, 2)
})

test('keeps materialization idempotency separate across sessions with matching local event sequences', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-materialization-session-key-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: '跨会话故事事件' })
  const fake = { sessions: { flush: async () => true } } as unknown as Context

  const materialize = async (sessionId: string, text: string): Promise<void> => {
    const session = Session.create(SessionId(sessionId))
    appendAgentRpSessionEvent(session, 'agent-rp/story-turn-brief', {
      format: 1,
      sessionId: String(session.id),
      workspaceId: created.id,
      workspaceRevision: store.get(created.id).revision,
      turn: 1,
      step: 1,
      resultEventSeqs: [],
      directorBrief: '',
      finalSections: [{ sectionId: 'prose', name: '正文', kind: 'prose', text }],
      finalDraft: text,
      modelContext: '',
      hostOwnedWorldDraft: true,
    })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        source: { provider: 'fixture', model: 'fixture' },
        content: [{ type: 'text', text }],
      }),
    }, { surfaceOp: 'append' })
    const agent = { id: session.id, options: { provider: 'fixture', model: 'fixture' }, session } as Agent
    await materializeStoryTurn({
      ctx: fake,
      agent,
      store,
      workspaceId: created.id,
      turn: 1,
      signal: new AbortController().signal,
    })
  }

  await materialize('materialize-session-a', '第一段会话实际展示的正文。')
  await materialize('materialize-session-b', '第二段会话实际展示的正文。')

  const saved = store.get(created.id)
  assert.equal(saved.events.length, 2)
  assert.notEqual(saved.events[0]?.key, saved.events[1]?.key)
  assert.deepEqual(saved.events.map(event => event.evidence), [
    '第一段会话实际展示的正文。',
    '第二段会话实际展示的正文。',
  ])
})
