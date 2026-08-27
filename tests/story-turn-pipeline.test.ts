import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { StoryCharacter, StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'
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
const originalSourceId = 'source-00000000-0000-4000-8000-000000000002'

function character(id: string, name: string, description = ''): StoryCharacter {
  return {
    id,
    name,
    profile: {
      description,
      personality: `${name}只用短句回应。`,
      scenario: '',
      exampleDialogue: `${name}：“先把眼前的事说清楚。”\n${name}：“笨蛋”`,
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
    pipeline: { maxParallel: 2, researchMaxPasses: 2, workerModel: { provider: 'worker-fixture', model: 'worker-model' } },
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
    sources: [
      { id: sourceId, name: '检索原著设定', kind: 'web', enabled: true, content: '只查询作品官方设定与原著章节' },
      {
        id: originalSourceId,
        name: '终章原著',
        kind: 'original',
        enabled: true,
        content: '# 终章设定\n\n鸦青印记只在列车终章显现。\n\n# 人物对白\n\n阿梨：“没看清就别急着下结论。”\n\n柏舟：“那就走近一点看。”\n\n# 语气观察\n\n阿梨常用短反问和理直气壮的断言；柏舟习惯立刻指出她推断里的漏洞，两人熟到省略礼貌和背景说明。',
      },
    ],
    citations: [],
    researchInbox: [],
  }
}

test('runs logged story stages while keeping each character request privately scoped', async () => {
  const session = Session.create(SessionId('story-turn-pipeline'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
  })
  const characterBodies: string[] = []
  const characterSystems: string[] = []
  const sectionSystems: string[] = []
  const sectionBodies: string[] = []
  const researchBodies: string[] = []
  let directorBody = ''
  let voiceBody = ''
  let voiceSystem = ''
  let voiceReviewBody = ''
  let voiceReviewSystem = ''
  let voiceRetryBody = ''
  let voiceRetrySystem = ''
  let voiceReviewCalls = 0
  let editorBody = ''
  let editorSystem = ''
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
            const webReference = body.match(/web:\d+:1/u)?.[0] ?? 'web:missing'
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
          const evidence = body.match(/character:[^"\\]+:example-dialogue/u)?.[0] ?? 'missing'
          text = body.includes('阿梨知道徽章')
            ? JSON.stringify({
              observation: '看见玩家举起徽章。',
              action: '先观察徽章刻痕。',
              speechIntent: '提醒对方先确认眼前事实再下结论。',
              voiceEvidence: [evidence, 'character:invented:example-dialogue'],
            })
            : JSON.stringify({
              observation: '注意到阿梨正在观察徽章。',
              action: '“先别问车票。”',
              speechIntent: '回避车票话题。',
              voiceEvidence: [evidence],
            })
        } else if (system.includes('剧情导演 Worker')) {
          directorBody = body
          text = JSON.stringify({
            sections: [
              {
                sectionId,
                beats: ['阿梨先观察徽章。'],
                speech: [
                  {
                    characterId: aliceId,
                    intent: '提醒对方先确认眼前事实再下结论。',
                    voiceEvidence: [`character:${bobId}:example-dialogue`],
                  },
                  {
                    characterId: bobId,
                    intent: '让阿梨走近一点确认。',
                    voiceEvidence: [`character:${bobId}:example-dialogue`],
                  },
                ],
              },
              { sectionId: characterSectionId, characterId: aliceId },
              { sectionId: historySectionId, beats: ['记录已经发生的公开事实。'] },
            ],
          })
        }
        else if (system.includes('人物对白审校 Worker')) {
          voiceReviewCalls += 1
          if (voiceReviewCalls === 1) {
            voiceReviewBody = body
            voiceReviewSystem = system
            text = JSON.stringify({
              lines: [
                { reference: `${sectionId}:1`, move: 'command', dialogue: '' },
                { reference: `${sectionId}:2`, move: 'correct', dialogue: '' },
              ],
            })
          } else {
            text = JSON.stringify({
              lines: [
                { reference: `${sectionId}:1`, move: 'command', dialogue: '先看徽章，别忙着猜。' },
              ],
            })
          }
        }
        else if (system.includes('人物对白合成 Worker')) {
          if (system.includes('唯一一次退回重写')) {
            voiceRetryBody = body
            voiceRetrySystem = system
            text = JSON.stringify({
              lines: [
                { reference: `${sectionId}:1`, move: 'command', dialogue: '先看徽章，别忙着猜。' },
                { reference: `${sectionId}:2`, move: 'correct', dialogue: '' },
              ],
            })
          } else {
            voiceBody = body
            voiceSystem = system
            text = JSON.stringify({
              lines: [
                { reference: `${sectionId}:1`, move: 'command', dialogue: '谁都能说的胜利台词。' },
                { reference: `${sectionId}:2`, move: 'correct', dialogue: '“谁都能说的胜利台词二。”' },
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
              : '尚显重复的粗稿。尚显重复的粗稿。\n\n“先看徽章，别忙着猜。”\n\n柏舟说：“谁都能说的胜利台词。”'
        } else {
          editorBody = body
          editorSystem = system
          text = '雨停后，阿梨看向徽章，柏舟移开视线。\n\n“先看徽章，别忙着猜。”\n\n柏舟说：“编辑器新增的台词。”'
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
  const runtimeContext = createUserMessage({
    source: { kind: 'plugin', plugin: 'dsh-agent-rp-runtime' },
    content: [{ type: 'text', text: 'Current runtime context: 这不是玩家要求。' }],
  })
  const input = {
    ctx: fake,
    agent,
    workspace: workspace(),
    turn: 1,
    step: 1,
    messages: [message, runtimeContext],
    signal: new AbortController().signal,
  }

  const result = await runStoryTurnPipeline(input)

  assert.equal(calls, 13)
  assert.equal(maxActive, 2)
  assert.equal(routes.every(route => route === 'worker-fixture/worker-model'), true)
  assert.equal(characterBodies.length, 2)
  assert.match(webQuery, /官方设定与原著章节/u)
  assert.match(webQuery, /旧车站徽章 原著设定/u)
  assert.equal(researchBodies.length, 2)
  assert.doesNotMatch(researchBodies.join('\n'), /这不是玩家要求/u)
  assert.doesNotMatch(characterBodies.join('\n'), /这不是玩家要求/u)
  assert.doesNotMatch(directorBody, /这不是玩家要求/u)
  assert.match(researchBodies[0]!, /story:public-history/u)
  assert.doesNotMatch(researchBodies.join('\n'), /story:recent-transcript|近期公开会话/u)
  assert.doesNotMatch(researchBodies[0]!, /鸦青印记只在列车终章显现/u)
  assert.match(researchBodies[1]!, /徽章属于旧车站/u)
  assert.match(researchBodies[1]!, /鸦青印记只在列车终章显现/u)
  assert.match(directorBody, /明确事实.*徽章属于旧车站/u)
  assert.match(directorBody, /明确事实.*鸦青印记只在终章显现/u)
  assert.match(directorBody, /不确定.*无法核验的徽章传闻.*无可核验依据/u)
  assert.doesNotMatch(webQuery, /超过轮数上限/u)
  assert.match(characterBodies[0]!, /阿梨知道徽章/u)
  assert.match(characterBodies[0]!, /character:character-00000000-0000-4000-8000-000000000001:example-dialogue/u)
  assert.match(characterBodies[0]!, /先把眼前的事说清楚/u)
  assert.match(characterSystems[0]!, /不得自行掷骰、移动棋子、切换回合/u)
  assert.match(characterSystems[0]!, /不要写完整正文或逐字对白/u)
  assert.match(characterSystems[0]!, /若开口只是为了让场面热闹/u)
  assert.match(directorBody, /说话意图：提醒对方先确认眼前事实再下结论/u)
  assert.match(directorBody, /语气依据：\[character:character-00000000-0000-4000-8000-000000000001:example-dialogue\]/u)
  assert.doesNotMatch(directorBody, /character:invented:example-dialogue|先别问车票/u)
  assert.doesNotMatch(characterBodies[0]!, /柏舟藏起了车票|下一幕会停电|第三幕打开/u)
  assert.match(characterBodies[1]!, /柏舟藏起了车票/u)
  assert.match(characterBodies[1]!, /character:character-00000000-0000-4000-8000-000000000002:example-dialogue/u)
  assert.doesNotMatch(characterBodies[1]!, /阿梨知道徽章|下一幕会停电|第三幕打开/u)
  assert.equal(sectionSystems.length, 3)
  assert.match(sectionSystems[0]!, /叙事正文、环境、行动与对白/u)
  assert.match(sectionSystems[0]!, /同一事件换句话重复/u)
  assert.match(sectionSystems[0]!, /可执行世界严格只读/u)
  assert.match(sectionSystems[1]!, /聚焦人物“阿梨”/u)
  assert.match(sectionSystems[1]!, /"insights"/u)
  assert.match(sectionSystems[1]!, /knowledge\|intention\|decision/u)
  assert.match(sectionSystems[2]!, /时间线、前情或档案/u)
  assert.match(sectionSystems[2]!, /非空内容，不能返回 <omit-section \/>/u)
  assert.match(sectionBodies[0]!, /获准对白：阿梨｜“先看徽章，别忙着猜。”/u)
  assert.doesNotMatch(sectionBodies.join('\n'), /<voice_evidence>|先把眼前的事说清楚/u)
  assert.match(voiceBody, new RegExp(`speech:${sectionId}:1`, 'u'))
  assert.match(voiceBody, /提醒对方先确认眼前事实再下结论/u)
  assert.match(voiceBody, /先把眼前的事说清楚/u)
  assert.match(voiceBody, /熟到省略礼貌和背景说明/u)
  assert.match(voiceBody, /<target_voice_lines>[\s\S]*阿梨｜先把眼前的事说清楚。/u)
  assert.match(voiceBody, /<conversation_context>[\s\S]*柏舟｜那就走近一点看。/u)
  assert.match(voiceBody, /<voice_notes>[\s\S]*阿梨常用短反问/u)
  const firstSpeechPlan = voiceBody.slice(
    voiceBody.indexOf(`## [speech:${sectionId}:1]`),
    voiceBody.indexOf(`## [speech:${sectionId}:2]`),
  )
  assert.match(firstSpeechPlan, new RegExp(`character:${aliceId}:example-dialogue`, 'u'))
  assert.doesNotMatch(firstSpeechPlan, new RegExp(`character:${bobId}:example-dialogue`, 'u'))
  assert.match(voiceSystem, /不得照抄、拼接、近似复述/u)
  assert.match(voiceSystem, /后一句必须直接接住前一句/u)
  assert.match(voiceSystem, /move 说明句子怎样作用于对方/u)
  assert.match(voiceSystem, /target_voice_lines.*该人物自己的原句/u)
  assert.match(voiceSystem, /conversation_context.*对手原句/u)
  assert.match(voiceSystem, /普通问句、纠正句或胜负套话/u)
  assert.match(voiceReviewBody, /谁都能说的胜利台词/u)
  assert.match(voiceReviewBody, /先把眼前的事说清楚/u)
  assert.match(voiceReviewSystem, /匿名替换检验/u)
  assert.match(voiceReviewSystem, /意图复述检验/u)
  assert.match(voiceReviewSystem, /你怎么还没/u)
  assert.match(voiceReviewSystem, /标题人物自己的原句/u)
  assert.match(voiceReviewSystem, /target_voice_lines/u)
  assert.match(voiceReviewSystem, /conversation_context/u)
  assert.match(voiceReviewSystem, /任意竞争者、朋友或对手/u)
  assert.match(voiceReviewSystem, /仅复述公开棋盘事实/u)
  assert.match(voiceReviewSystem, /绝不参与创作/u)
  assert.match(voiceReviewSystem, /只能逐字返回 draft_dialogue/u)
  assert.match(voiceRetrySystem, /唯一一次退回重写/u)
  assert.match(voiceRetryBody, /rejected_draft/u)
  assert.match(voiceRetryBody, /谁都能说的胜利台词/u)
  assert.match(sectionBodies[0]!, /对白收束：1\/2 句通过声音校准/u)
  assert.ok(editorBody.indexOf('## 正文') < editorBody.indexOf('## 阿梨视角'))
  assert.ok(editorBody.indexOf('## 阿梨视角') < editorBody.indexOf('## 公开档案'))
  assert.match(editorBody, /## 阿梨视角[\s\S]*自己的旧站记忆/u)
  assert.match(editorBody, /先看徽章，别忙着猜/u)
  assert.doesNotMatch(editorBody, /谁都能说的胜利台词|先把眼前的事说清楚/u)
  assert.match(editorBody, /## 公开档案[\s\S]*## 雨停[\s\S]*两人都看见雨停了/u)
  assert.match(editorBody, /<world_state>/u)
  assert.doesNotMatch(editorBody, /<voice_evidence>/u)
  assert.match(editorSystem, /不得新增、恢复、拆分或重写任何对白/u)
  assert.match(editorSystem, /history 的简洁事实记录.*不能因此删除/u)
  assert.match(directorBody, /## 结论所引用的原始证据/u)
  assert.match(directorBody, /终章原著/u)
  assert.match(result.finalDraft, /阿梨看向徽章/u)
  assert.match(result.finalDraft, /先看徽章，别忙着猜/u)
  assert.doesNotMatch(result.finalDraft, /编辑器新增的台词/u)
  assert.match(result.modelContext, /阿梨看向徽章/u)
  assert.match(result.modelContext, /原样返回 edited_draft/u)
  assert.doesNotMatch(result.modelContext, /导演方案|下一幕会停电|第三幕打开/u)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-stage-request').length, 13)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-stage-result').length, 13)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-turn-brief').length, 1)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-web-search-request').length, 1)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-web-search-result').length, 1)
  assert.deepEqual(session.events.flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'research' ? [event.data.subjectId] : []), ['pass-1', 'pass-2'])
  assert.equal(session.events.every(event => !event.type.startsWith('agent-rp/story-') || event.ignorable === true), true)

  assert.deepEqual(await runStoryTurnPipeline(input), result)
  assert.equal(calls, 13)
})

test('stops malformed research output and falls back to exact local evidence', async () => {
  const session = Session.create(SessionId('story-research-fallback'))
  session.append('request/header', {
    reason: 'initial',
    header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 8_192 } },
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
  const fake = {
    get() { throw new Error('不应尝试网络查询') },
    sessions: { flush: async () => true },
    llm: {
      stream(options: { readonly system?: string; readonly messages: readonly unknown[] }) {
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
  assert.match(directorBody, /\[local:source-[0-9a-f-]+:1\].*鸦青印记只在列车终章显现/u)
  assert.equal(session.events.some(event => event.type === 'agent-rp/story-web-search-request'), false)
})

test('materializes continuity from the actually visible reply instead of the prepared draft', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-story-continuity-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: '实际正文沉淀' })
  const characterId = createStoryCharacterId()
  const nodeId = createStoryNodeId()
  const workspace = store.save({
    format: 2,
    id: created.id,
    revision: 0,
    name: '实际正文沉淀',
    pipeline: { maxParallel: 2, researchMaxPasses: 2 },
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
        participantIds: [characterId],
        knowledge: { mode: 'participants', characterIds: [] },
      }],
      edges: [],
    },
    characters: [character(characterId, '阿梨', '谨慎。')],
    facts: [],
    events: [],
    outputs: [],
    sources: [],
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
  appendAgentRpSessionEvent(session, 'agent-rp/story-turn-brief', {
    format: 0,
    sessionId: String(session.id),
    workspaceId: workspace.id,
    workspaceRevision: workspace.revision,
    turn: 1,
    step: 1,
    resultEventSeqs: [webResult.seq],
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
          changes: {
            characters: [{ characterId, location: '雨后的车站', objective: '检查徽章刻痕' }],
            facts: [
              { text: '阿梨亲眼看见雨停。', knownBy: [characterId] },
              { text: '阿梨亲眼看见雨停。', knownBy: [characterId] },
            ],
            nodes: [
              {
                ref: 'next-scene',
                kind: 'beat',
                parent: { kind: 'node', nodeId },
                title: '雨后检查徽章',
                summary: '阿梨在雨后检查徽章刻痕。',
                content: '下一场让阿梨检查徽章刻痕。',
                participantIds: [characterId],
                knowledge: { mode: 'participants', characterIds: [] },
              },
              {
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
                kind: 'precedes',
                source: { kind: 'node', nodeId },
                target: { kind: 'proposal', ref: 'next-scene' },
                label: '雨停后的下一场',
              },
              {
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

  assert.match(requestBody, /实际展示时，阿梨只看见雨停了/u)
  assert.doesNotMatch(requestBody, /流水线准备稿/u)
  assert.match(requestBody, new RegExp(nodeId, 'u'))
  assert.deepEqual(result?.changes.facts[0]?.knownBy, [characterId])
  assert.equal(result?.format, 3)
  assert.equal(result?.changes.nodes.length, 2)
  assert.equal(result?.changes.edges.length, 2)
  const saved = store.get(workspace.id)
  assert.match(saved.events[0]?.summary ?? '', /阿梨在车站看见雨停/u)
  assert.match(saved.events[0]?.evidence ?? '', /实际展示时，阿梨只看见雨停了/u)
  assert.equal(saved.characters.find(character => character.id === characterId)?.state.location, '雨后的车站')
  assert.equal(saved.characters.find(character => character.id === characterId)?.state.objective, '检查徽章刻痕')
  assert.equal(saved.facts.find(fact => fact.text.includes('阿梨亲眼看见雨停'))?.knownBy[0], characterId)
  assert.match(saved.graph.nodes.find(node => node.lifecycle === 'suggested')?.content ?? '', /检查徽章刻痕/u)
  assert.equal(saved.graph.edges.filter(edge => edge.lifecycle === 'suggested').length, 2)
  const nextScene = saved.graph.nodes.find(node => node.title === '雨后检查徽章')
  const badgeSecret = saved.graph.nodes.find(node => node.title === '徽章刻痕')
  assert.equal(nextScene?.parentId, nodeId)
  assert.equal(badgeSecret?.parentId, nextScene?.id)
  assert.deepEqual(nextScene?.knowledge, { mode: 'participants', characterIds: [] })
  assert.equal(saved.graph.edges.find(edge => edge.kind === 'precedes')?.target, nextScene?.id)
  const foreshadow = saved.graph.edges.find(edge => edge.kind === 'foreshadows')
  assert.equal(foreshadow?.source, nextScene?.id)
  assert.equal(foreshadow?.target, badgeSecret?.id)
  assert.deepEqual(saved.researchInbox.map(item => ({ title: item.title, url: item.url, snippet: item.snippet })), [{
    title: '徽章设定资料',
    url: 'https://example.test/badge',
    snippet: '雨水会让旧徽章显出刻痕。',
  }])
  assert.equal(saved.researchInbox[0]?.query, '雨停之后徽章会怎样反光')
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
