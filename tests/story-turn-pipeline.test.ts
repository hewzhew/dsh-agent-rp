import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'
import { appendAgentRpSessionEvent } from '../src/session-event-compat.ts'
import { createStoryCharacterId, createStoryNodeId, StoryWorkspaceStore } from '../src/story-workspace.ts'
import { materializeStoryTurn, runStoryTurnPipeline } from '../src/story-turn-pipeline.ts'
import { installIgnorableSessionEventFixture } from './session-event-fixture.ts'

installIgnorableSessionEventFixture()

const aliceId = 'character-00000000-0000-4000-8000-000000000001'
const bobId = 'character-00000000-0000-4000-8000-000000000002'
const arcId = 'node-00000000-0000-4000-8000-000000000001'
const activeNodeId = 'node-00000000-0000-4000-8000-000000000002'
const secretId = 'node-00000000-0000-4000-8000-000000000003'
const aliceFactId = 'fact-00000000-0000-4000-8000-000000000001'
const bobFactId = 'fact-00000000-0000-4000-8000-000000000002'
const historyEventId = 'event-00000000-0000-4000-8000-000000000001'
const sectionId = 'output-00000000-0000-4000-8000-000000000001'
const characterSectionId = 'output-00000000-0000-4000-8000-000000000002'
const historySectionId = 'output-00000000-0000-4000-8000-000000000003'
const sourceId = 'source-00000000-0000-4000-8000-000000000001'

function workspace(): StoryWorkspaceSnapshot {
  return {
    format: 1,
    id: 'story-00000000-0000-4000-8000-000000000001',
    name: '隔离流水线',
    revision: 3,
    createdAt: 1,
    updatedAt: 2,
    pipeline: { maxParallel: 2, workerModel: { provider: 'worker-fixture', model: 'worker-model' } },
    graph: {
      activeNodeId,
      nodes: [
        {
          id: arcId,
          kind: 'arc',
          title: '第一幕',
          status: 'active',
          lifecycle: 'canonical',
          audience: 'director',
          position: { x: 0, y: 0 },
          content: '导演知道下一幕会停电。',
          participantIds: [],
        },
        {
          id: activeNodeId,
          kind: 'beat',
          title: '雨后的车站',
          status: 'active',
          lifecycle: 'canonical',
          audience: 'public',
          position: { x: 320, y: 0 },
          content: '玩家在车站举起徽章。',
          participantIds: [aliceId, bobId],
        },
        {
          id: secretId,
          kind: 'secret',
          title: '怀表',
          status: 'planned',
          lifecycle: 'canonical',
          audience: 'director',
          position: { x: 320, y: 220 },
          content: '怀表将在第三幕打开。',
          participantIds: [],
        },
      ],
      edges: [
        {
          id: 'edge-00000000-0000-4000-8000-000000000001',
          kind: 'contains',
          source: arcId,
          target: activeNodeId,
          label: '',
          lifecycle: 'canonical',
          audience: 'director',
        },
      ],
    },
    characters: [
      { id: aliceId, name: '阿梨', persona: '阿梨谨慎。' },
      { id: bobId, name: '柏舟', persona: '柏舟果断。' },
    ],
    facts: [
      {
        id: aliceFactId,
        text: '阿梨知道徽章的主人。',
        status: 'asserted',
        audience: 'director',
        knownBy: [aliceId],
        source: { kind: 'manual' },
      },
      {
        id: bobFactId,
        text: '柏舟藏起了车票。',
        status: 'asserted',
        audience: 'director',
        knownBy: [bobId],
        source: { kind: 'manual' },
      },
    ],
    events: [{
      id: historyEventId,
      key: 'fixture-history',
      turn: 0,
      title: '雨停',
      summary: '两人都看见雨停了。',
      evidence: '雨声停了。',
      participantIds: [aliceId, bobId],
      nodeId: activeNodeId,
    }],
    outputs: [
      { id: sectionId, name: '正文', kind: 'prose', enabled: true, instructions: '保持第三人称。' },
      { id: characterSectionId, name: '阿梨视角', kind: 'character', enabled: true, characterId: aliceId, instructions: '只写阿梨能表现出的内容。' },
      { id: historySectionId, name: '公开档案', kind: 'history', enabled: true, instructions: '使用简短时间线。' },
    ],
    sources: [{ id: sourceId, name: '检索原著设定', kind: 'web', enabled: true, content: '只查询作品官方设定与原著章节' }],
  }
}

test('runs logged story stages while keeping each character request privately scoped', async () => {
  const session = Session.create(SessionId('story-turn-pipeline'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  const characterBodies: string[] = []
  const sectionSystems: string[] = []
  let researchBody = ''
  let editorBody = ''
  let webQuery = ''
  let calls = 0
  let active = 0
  let maxActive = 0
  const routes: string[] = []
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
      }
    },
    sessions: { flush: async () => true },
    llm: {
      stream(options: {
        readonly provider: string
        readonly model: string
        readonly system?: string
        readonly messages: readonly unknown[]
      }) {
        calls += 1
        active += 1
        maxActive = Math.max(maxActive, active)
        routes.push(`${options.provider}/${options.model}`)
        const system = options.system ?? ''
        const body = JSON.stringify(options.messages)
        let text: string
        if (system.includes('剧情研究 Worker')) {
          researchBody = body
          text = '研究简报'
        }
        else if (system.includes('指定人物认知')) {
          characterBodies.push(body)
          text = body.includes('阿梨知道徽章') ? '阿梨先观察徽章。' : '柏舟避开车票话题。'
        } else if (system.includes('剧情导演 Worker')) text = '导演方案'
        else if (system.includes('分区的 ')) {
          sectionSystems.push(system)
          text = body.includes('kind=\\"character\\"') ? '阿梨谨慎地观察徽章。'
            : body.includes('kind=\\"history\\"') ? '零点：站钟停走。' : '尚显重复的粗稿。尚显重复的粗稿。'
        } else {
          editorBody = body
          text = '雨停后，阿梨看向徽章，柏舟移开视线。'
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
  const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '玩家举起徽章。' }] })
  const input = {
    ctx: fake,
    agent,
    workspace: workspace(),
    turn: 1,
    step: 1,
    messages: [message],
    signal: new AbortController().signal,
  }

  const result = await runStoryTurnPipeline(input)

  assert.equal(calls, 8)
  assert.equal(maxActive, 2)
  assert.equal(routes.every(route => route === 'worker-fixture/worker-model'), true)
  assert.equal(characterBodies.length, 2)
  assert.match(webQuery, /官方设定与原著章节/u)
  assert.match(webQuery, /玩家举起徽章/u)
  assert.match(researchBody, /徽章属于旧车站/u)
  assert.match(characterBodies[0]!, /阿梨知道徽章/u)
  assert.doesNotMatch(characterBodies[0]!, /柏舟藏起了车票|下一幕会停电|第三幕打开/u)
  assert.match(characterBodies[1]!, /柏舟藏起了车票/u)
  assert.doesNotMatch(characterBodies[1]!, /阿梨知道徽章|下一幕会停电|第三幕打开/u)
  assert.equal(sectionSystems.length, 3)
  assert.match(sectionSystems[0]!, /叙事正文、环境、行动与对白/u)
  assert.match(sectionSystems[1]!, /聚焦人物“阿梨”/u)
  assert.match(sectionSystems[2]!, /时间线、前情或档案/u)
  assert.ok(editorBody.indexOf('## 正文') < editorBody.indexOf('## 阿梨视角'))
  assert.ok(editorBody.indexOf('## 阿梨视角') < editorBody.indexOf('## 公开档案'))
  assert.match(result.finalDraft, /阿梨看向徽章/u)
  assert.match(result.modelContext, /阿梨看向徽章/u)
  assert.doesNotMatch(result.modelContext, /导演方案|下一幕会停电|第三幕打开/u)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-stage-request').length, 8)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-stage-result').length, 8)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-turn-brief').length, 1)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-web-search-request').length, 1)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-web-search-result').length, 1)
  assert.equal(session.events.every(event => !event.type.startsWith('agent-rp/story-') || event.ignorable === true), true)

  assert.deepEqual(await runStoryTurnPipeline(input), result)
  assert.equal(calls, 8)
})

test('materializes continuity from the actually visible reply instead of the prepared draft', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-continuity-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 1, name: '实际正文沉淀' })
  const characterId = createStoryCharacterId()
  const nodeId = createStoryNodeId()
  const workspace = store.save({
    format: 1,
    id: created.id,
    revision: 0,
    name: '实际正文沉淀',
    pipeline: { maxParallel: 2 },
    graph: {
      activeNodeId: nodeId,
      nodes: [{
        id: nodeId,
        kind: 'beat',
        title: '车站重逢',
        status: 'active',
        lifecycle: 'canonical',
        audience: 'public',
        position: { x: 0, y: 0 },
        content: '在车站重逢。',
        participantIds: [characterId],
      }],
      edges: [],
    },
    characters: [{ id: characterId, name: '阿梨', persona: '谨慎。' }],
    facts: [],
    events: [],
    outputs: [],
    sources: [],
  })
  const session = Session.create(SessionId('story-continuity'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  appendAgentRpSessionEvent(session, 'agent-rp/story-turn-brief', {
    format: 0,
    sessionId: String(session.id),
    workspaceId: workspace.id,
    workspaceRevision: workspace.revision,
    turn: 1,
    step: 1,
    resultEventSeqs: [],
    directorBrief: '内部导演方案。',
    finalDraft: '流水线准备稿。',
    modelContext: '准备上下文。',
  })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: '实际展示时，阿梨只看见雨停了。' }],
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
          history: '阿梨在车站看见雨停。',
          observations: [{ characterId, text: '阿梨亲眼看见雨停。' }],
          outlineProposals: [],
          foreshadowingProposals: ['后续可以让徽章在雨后反光。'],
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

  assert.match(requestBody, /实际展示时，阿梨只看见雨停了/u)
  assert.doesNotMatch(requestBody, /流水线准备稿/u)
  assert.equal(result?.observations[0]?.characterId, characterId)
  const saved = store.get(workspace.id)
  assert.match(saved.events[0]?.summary ?? '', /阿梨在车站看见雨停/u)
  assert.match(saved.events[0]?.evidence ?? '', /实际展示时，阿梨只看见雨停了/u)
  assert.equal(saved.facts.find(fact => fact.text.includes('阿梨亲眼看见雨停'))?.knownBy[0], characterId)
  assert.match(saved.graph.nodes.find(node => node.lifecycle === 'suggested')?.content ?? '', /徽章在雨后反光/u)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-turn-materialized').length, 1)
  assert.equal(session.events.find(event => event.type === 'agent-rp/story-stage-request')?.data.stage, 'continuity')

  assert.deepEqual(await materializeStoryTurn({
    ctx: fake,
    agent,
    store,
    workspaceId: workspace.id,
    turn: 1,
    signal: new AbortController().signal,
  }), result)
  assert.equal(store.get(workspace.id).revision, saved.revision)
})
