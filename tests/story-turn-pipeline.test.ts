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
import {
  compileStoryCharacterContext,
  createStoryCharacterId,
  createStoryNodeId,
  createStoryOutputId,
  StoryWorkspaceStore,
} from '../src/story-workspace.ts'
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
  const researchBodies: string[] = []
  let directorBody = ''
  let directorSystem = ''
  let voiceBody = ''
  let voiceSystem = ''
  let secondVoiceBody = ''
  let secondVoiceSystem = ''
  let voiceReviewBody = ''
  let voiceRetryReviewBody = ''
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
          const conversationEvidence = body.match(/local:source-[0-9a-f-]+:3/u)?.[0] ?? 'missing-context'
          const voiceNotesEvidence = body.match(/local:source-[0-9a-f-]+:4/u)?.[0] ?? 'missing-notes'
          text = body.includes('阿梨知道徽章')
            ? JSON.stringify({
              observation: '看见玩家举起徽章。',
              action: '先观察徽章刻痕。',
              speech: {
                respondsTo: '对方准备在没有看清徽章刻痕时就下结论。',
                move: 'warn',
                content: '要求对方先确认眼前的刻痕再作判断。',
              },
              voiceEvidence: [evidence, conversationEvidence, voiceNotesEvidence, 'character:invented:example-dialogue'],
              insights: [{ kind: 'knowledge', text: '阿梨把徽章刻痕和自己的旧站记忆联系起来。' }],
            })
            : JSON.stringify({
              observation: '注意到阿梨正在观察徽章。',
              action: '',
              speech: {
                respondsTo: '阿梨表现得像是已经看清徽章刻痕。',
                move: 'correct',
                content: '指出刻痕仍然模糊，现在不能当作已经看清。',
              },
              voiceEvidence: [evidence],
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
                ],
              },
              { sectionId: characterSectionId, characterId: '阿梨' },
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
          } else if (body.includes('先看“徽章”，别忙着猜。')) {
            voiceRetryReviewBody = body
            text = JSON.stringify({
              lines: [
                { reference: `${sectionId}:1`, dialogue: '先看“徽章”，别忙着猜。' },
              ],
            })
          } else {
            voiceReviewBody = body
            voiceReviewSystem = system
            text = JSON.stringify({
              lines: [
                { reference: `${sectionId}:1`, dialogue: '你连徽章都没看清，谈什么结论。' },
              ],
            })
          }
        }
        else if (system.includes('人物自己的对白 Worker')) {
          if (system.includes('唯一一次退回重写')) {
            voiceRetryBody = body
            voiceRetrySystem = system
            text = JSON.stringify({
              lines: [
                { reference: `${sectionId}:1`, move: 'warn', seedLineIds: candidateSeeds.slice(0, 1), mechanics: '只用一条依据的无效候选', dialogue: '只看一条也够了。' },
                { reference: `${sectionId}:1`, move: 'warn', seedLineIds: candidateSeeds, mechanics: '先指出眼前缺口，再截断过早结论', dialogue: '先看“徽章”，别忙着猜。' },
              ],
            })
          } else if (body.includes(`人物：柏舟（${bobId}）`)) {
            secondVoiceBody = body
            secondVoiceSystem = system
            text = JSON.stringify({
              lines: [
                { reference: `${sectionId}:2`, move: 'correct', seedLineIds: candidateSeeds, mechanics: '直接指出观察仍不成立', dialogue: '先把刻痕看清楚。' },
              ],
            })
          } else {
            voiceBody = body
            voiceSystem = system
            text = JSON.stringify({
              lines: [
                { reference: `${sectionId}:1`, move: 'warn', seedLineIds: contextSeedIds.slice(0, 1), mechanics: '错误引用对方台词', dialogue: '借了对方的声音。' },
                { reference: `${sectionId}:1`, move: 'challenge', seedLineIds: candidateSeeds, mechanics: '擅自改变既定动作', dialogue: '把提醒改成质疑。' },
                { reference: `${sectionId}:1`, move: 'warn', seedLineIds: candidateSeeds, mechanics: '以未满足的观察前提反问结论', dialogue: '你连徽章都没看清，谈什么结论。' },
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
              : '尚显重复的粗稿。尚显重复的粗稿。\n\n「先看“徽章”，别忙着猜。」\n\n柏舟说：“谁都能说的胜利台词。”'
        } else {
          editorBody = body
          editorSystem = system
          text = JSON.stringify({
            sections: [
              {
                sectionId,
                text: '雨停后，阿梨看向徽章，柏舟移开视线。\n\n柏舟说：“编辑器新增的台词。”',
              },
              { sectionId: characterSectionId, text: '阿梨把徽章刻痕和自己的旧站记忆联系起来。' },
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

  assert.equal(calls, 14)
  assert.equal(maxActive, 2)
  assert.equal(routes.every(route => route === 'worker-fixture/worker-model'), true)
  assert.equal(reasoningEfforts.filter(effort => effort === 'low').length, 3)
  assert.equal(reasoningEfforts.filter(effort => effort === 'high').length, 11)
  assert.equal(maxTokenBudgets.every(budget => budget >= 16_384), true)
  assert.equal(characterBodies.length, 2)
  assert.match(webQuery, /官方设定与原著章节/u)
  assert.match(webQuery, /旧车站徽章 原著设定/u)
  assert.equal(researchBodies.length, 2)
  assert.doesNotMatch(researchBodies.join('\n'), /这不是玩家要求/u)
  assert.doesNotMatch(characterBodies.join('\n'), /这不是玩家要求/u)
  assert.doesNotMatch(directorBody, /这不是玩家要求/u)
  assert.match(researchBodies[0]!, /story:public-history/u)
  assert.match(researchBodies[0]!, /story:player-input/u)
  assert.match(researchBodies[0]!, /玩家举起徽章/u)
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
  assert.match(characterSystems[0]!, /为了让场面热闹.*speech 必须为 null/u)
  assert.match(characterSystems[0]!, /respondsTo.*move.*content/u)
  assert.match(characterSystems[0]!, /不要用看向、换手、敲碰物件/u)
  assert.match(characterSystems[0]!, /当前或下一项掷骰、移动、结束回合等程序动作必须标成 world-action/u)
  assert.match(directorBody, /回应前提：对方准备在没有看清徽章刻痕时就下结论/u)
  assert.match(directorBody, /对话动作：warn/u)
  assert.match(directorBody, /传达内容：要求对方先确认眼前的刻痕再作判断/u)
  assert.match(directorBody, /人物 ID：character-00000000-0000-4000-8000-000000000001/u)
  assert.match(directorBody, /人物 ID：character-00000000-0000-4000-8000-000000000002/u)
  assert.match(directorBody, /语气依据：\[character:character-00000000-0000-4000-8000-000000000001:example-dialogue\]/u)
  assert.doesNotMatch(directorBody, /character:invented:example-dialogue|先别问车票/u)
  assert.doesNotMatch(characterBodies[0]!, /柏舟藏起了车票|下一幕会停电|第三幕打开/u)
  assert.match(characterBodies[1]!, /柏舟藏起了车票/u)
  assert.match(characterBodies[1]!, /character:character-00000000-0000-4000-8000-000000000002:example-dialogue/u)
  assert.doesNotMatch(characterBodies[1]!, /阿梨知道徽章|下一幕会停电|第三幕打开/u)
  assert.equal(sectionSystems.length, 2)
  assert.match(sectionSystems[0]!, /叙事正文、环境、行动与对白/u)
  assert.match(sectionSystems[0]!, /同一事件换句话重复/u)
  assert.match(sectionSystems[0]!, /可执行世界严格只读/u)
  assert.match(sectionSystems[1]!, /时间线、前情或档案/u)
  assert.match(sectionSystems[1]!, /非空内容，不能返回 <omit-section \/>/u)
  assert.match(sectionBodies[0]!, /获准对白：阿梨｜「先看“徽章”，别忙着猜。」/u)
  assert.doesNotMatch(sectionBodies.join('\n'), /<voice_evidence>|先把眼前的事说清楚/u)
  assert.match(voiceBody, new RegExp(`speech:${sectionId}:1`, 'u'))
  assert.ok(voiceBody.includes(`<required_reference>\\nspeech:${sectionId}:1\\n</required_reference>`))
  assert.match(voiceBody, /回应前提：对方准备在没有看清徽章刻痕时就下结论/u)
  assert.match(voiceBody, /对话动作：warn/u)
  assert.match(voiceBody, /传达内容：要求对方先确认眼前的刻痕再作判断/u)
  assert.match(voiceBody, /先把眼前的事说清楚/u)
  assert.match(voiceBody, /熟到省略礼貌和背景说明/u)
  assert.match(voiceBody, /<voice_exchange>[\s\S]*\[目标人物\]\[示例\] 阿梨｜先把眼前的事说清楚。/u)
  assert.match(voiceBody, /\[对话上下文\]\[原文\] 柏舟｜刻印はもう滲んで見えない。/u)
  assert.match(voiceBody, /\[目标人物\]\[原文\] 阿梨｜見えてから結論を出せばいい。/u)
  assert.match(voiceBody, /\[对话上下文\]\[参考译文\] 柏舟｜刻痕已经糊得看不清了。/u)
  assert.match(voiceBody, /\[目标人物\]\[参考译文\] 阿梨｜看清以后再作结论。/u)
  assert.match(voiceBody, /\[seed:([^\]]+)\]\[目标人物\]\[原文\] 阿梨｜見えてから結論を出せばいい。[\s\S]*\[seed:\1\]\[目标人物\]\[参考译文\] 阿梨｜看清以后再作结论。/u)
  assert.doesNotMatch(voiceBody, /\[对话上下文\]\[原文\] 柏舟｜船はもう遠くへ行った。/u)
  assert.match(voiceBody, /<voice_notes>[\s\S]*阿梨常用短反问/u)
  assert.equal(voiceBody.match(/阿梨｜没看清就别急着下结论。/gu)?.length, 1)
  const voiceEvidenceBody = voiceBody.slice(
    voiceBody.indexOf('<voice_evidence>'),
    voiceBody.indexOf('</voice_evidence>'),
  )
  assert.ok((voiceEvidenceBody.match(/\[(?:目标人物|对话上下文)\]/gu)?.length ?? 0) <= 36)
  assert.ok(voiceEvidenceBody.length < 7_000)
  const firstSpeechPlan = voiceBody.slice(
    voiceBody.indexOf(`## [speech:${sectionId}:1]`),
    voiceBody.indexOf(`## [speech:${sectionId}:2]`),
  )
  assert.match(firstSpeechPlan, /local:source-[0-9a-f-]+:2/u)
  assert.match(firstSpeechPlan, /local:source-[0-9a-f-]+:12/u)
  assert.match(firstSpeechPlan, new RegExp(`character:${aliceId}:example-dialogue`, 'u'))
  assert.doesNotMatch(firstSpeechPlan, new RegExp(`character:${bobId}:example-dialogue`, 'u'))
  assert.doesNotMatch(voiceBody, /柏舟藏起了车票/u)
  assert.match(secondVoiceBody, new RegExp(`character:${bobId}:example-dialogue`, 'u'))
  assert.match(secondVoiceBody, /\[目标人物\]\[参考译文\] 柏舟｜刻痕已经糊得看不清了。/u)
  assert.match(secondVoiceBody, /\[对话上下文\]\[参考译文\] 阿梨｜看清以后再作结论。/u)
  assert.doesNotMatch(secondVoiceBody, /\[目标人物\]\[参考译文\] 阿梨｜看清以后再作结论。/u)
  assert.doesNotMatch(secondVoiceBody, new RegExp(`character:${aliceId}:example-dialogue`, 'u'))
  assert.doesNotMatch(secondVoiceBody, /阿梨知道徽章/u)
  assert.match(secondVoiceBody, /<prior_approved_dialogue>[\s\S]*先看“徽章”，别忙着猜/u)
  assert.match(secondVoiceSystem, /不得读取或推断导演故事图、其他人物档案和私有知识/u)
  assert.match(voiceSystem, /不得照抄、拼接、近似复述/u)
  assert.match(voiceSystem, /prior_approved_dialogue 非空，候选必须直接接住其中最后一句/u)
  assert.match(voiceSystem, /move 必须逐字复制 speech_plan/u)
  assert.match(voiceSystem, /seedLineIds/u)
  assert.match(voiceSystem, /\[目标人物\] seed 才能用于候选的声音映射/u)
  assert.match(voiceSystem, /\[对话上下文\] seed.*不能引用为自己的声音/u)
  assert.match(voiceSystem, /普通问句、纠正句或胜负套话/u)
  assert.match(voiceReviewBody, /你连徽章都没看清，谈什么结论/u)
  assert.match(voiceReviewBody, /候选 1/u)
  assert.doesNotMatch(voiceReviewBody, /借了对方的声音|把提醒改成质疑/u)
  assert.match(voiceReviewBody, /句法与接话机制/u)
  assert.match(voiceReviewBody, /先把眼前的事说清楚/u)
  assert.match(voiceReviewSystem, /匿名替换检验/u)
  assert.match(voiceReviewSystem, /意图复述检验/u)
  assert.match(voiceReviewSystem, /你怎么还没/u)
  assert.match(voiceReviewSystem, /你是连……都/u)
  assert.match(voiceReviewSystem, /你连……都……，谈什么/u)
  assert.match(voiceReviewSystem, /朴素短句可以批准/u)
  assert.match(voiceReviewSystem, /\[目标人物\].*此人物自己的原句/u)
  assert.match(voiceReviewSystem, /\[对话上下文\].*不能拿来模仿/u)
  assert.match(voiceReviewSystem, /素材归属检验/u)
  assert.match(voiceReviewSystem, /任意竞争者、朋友或对手/u)
  assert.match(voiceReviewSystem, /仅复述公开世界事实/u)
  assert.match(voiceReviewSystem, /绝不参与创作/u)
  assert.match(voiceReviewSystem, /只能逐字返回 draft_candidates/u)
  assert.match(voiceReviewSystem, /多个候选合格时只选/u)
  assert.match(voiceReviewSystem, /审校不拥有也不返回说话动作/u)
  assert.match(voiceRetrySystem, /唯一一次退回重写/u)
  assert.match(voiceRetrySystem, /凭空制造比喻/u)
  assert.match(voiceRetryBody, /rejected_candidates/u)
  assert.ok(voiceRetryBody.includes(`<required_reference>\\nspeech:${sectionId}:1\\n</required_reference>`))
  assert.match(voiceRetryBody, /你连徽章都没看清，谈什么结论/u)
  assert.doesNotMatch(voiceRetryReviewBody, /只看一条也够了/u)
  assert.match(voiceRetryReviewBody, /「先看“徽章”，别忙着猜。」/u)
  assert.match(sectionBodies[0]!, /获准对白：阿梨/u)
  assert.doesNotMatch(sectionBodies[0]!, /对白收束/u)
  assert.doesNotMatch(sectionBodies.join('\n'), /kind=\\"character\\"/u)
  assert.ok(editorBody.indexOf(sectionId) < editorBody.indexOf(characterSectionId))
  assert.ok(editorBody.indexOf(characterSectionId) < editorBody.indexOf(historySectionId))
  assert.match(editorBody, new RegExp(`${characterSectionId}[\\s\\S]*自己的旧站记忆`, 'u'))
  assert.match(editorBody, /先看“徽章”，别忙着猜/u)
  assert.doesNotMatch(editorBody, /谁都能说的胜利台词|先把眼前的事说清楚/u)
  assert.match(editorBody, new RegExp(`${historySectionId}[\\s\\S]*两人都看见雨停了`, 'u'))
  assert.match(editorBody, /<world_state>/u)
  assert.doesNotMatch(editorBody, /<voice_evidence>/u)
  assert.match(editorSystem, /不得新增、恢复、拆分、重写或删除任何获准对白/u)
  assert.match(editorSystem, /history 的简洁事实记录.*不能因此删除/u)
  assert.match(directorBody, /## 结论所引用的原始证据/u)
  assert.match(directorBody, /终章原著/u)
  assert.match(directorSystem, /Host 会把导演遗漏的有效决定补回默认正文分区/u)
  assert.match(result.finalDraft, /阿梨看向徽章/u)
  assert.match(result.finalDraft, /「先看“徽章”，别忙着猜。」/u)
  assert.doesNotMatch(result.finalDraft, /编辑器新增的台词/u)
  assert.deepEqual(result.finalSections.map(section => ({
    sectionId: section.sectionId,
    kind: section.kind,
    characterId: section.characterId,
  })), [
    { sectionId, kind: 'prose', characterId: undefined },
    { sectionId: characterSectionId, kind: 'character', characterId: aliceId },
    { sectionId: historySectionId, kind: 'history', characterId: undefined },
  ])
  assert.match(result.modelContext, /阿梨看向徽章/u)
  assert.match(result.modelContext, /原样返回 edited_draft/u)
  assert.doesNotMatch(result.modelContext, /导演方案|下一幕会停电|第三幕打开/u)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-stage-request').length, 14)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-stage-result').length, 14)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-turn-brief').length, 1)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-web-search-request').length, 1)
  assert.equal(session.events.filter(event => event.type === 'agent-rp/story-web-search-result').length, 1)
  assert.deepEqual(session.events.flatMap(event => event.type === 'agent-rp/story-stage-request'
    && event.data.stage === 'research' ? [event.data.subjectId] : []), ['pass-1', 'pass-2'])
  assert.equal(session.events.every(event => !event.type.startsWith('agent-rp/story-') || event.ignorable === true), true)

  assert.deepEqual(await runStoryTurnPipeline(input), result)
  assert.equal(calls, 14)
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
  assert.equal(session.events.some(event => event.type === 'agent-rp/story-web-search-request'), false)
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
  const privateSectionId = createStoryOutputId()
  const historySectionId = createStoryOutputId()
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
      { id: privateSectionId, name: '魔理沙视角', kind: 'character', enabled: true, characterId: marisaId, instructions: '' },
      { id: historySectionId, name: '公开回合记录', kind: 'history', enabled: true, instructions: '' },
    ],
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
    format: 1,
    sessionId: String(session.id),
    workspaceId: workspace.id,
    workspaceRevision: workspace.revision,
    turn: 1,
    step: 1,
    resultEventSeqs: [webResult.seq],
    directorBrief: '内部导演方案。',
    finalSections: [
      { sectionId: proseSectionId, name: '对局正文', kind: 'prose', text: '流水线准备稿里的公开正文。' },
      {
        sectionId: privateSectionId,
        name: '魔理沙视角',
        kind: 'character',
        characterId: marisaId,
        privateInsights: [{ kind: 'decision', text: '流水线准备稿里的私人决定。' }],
        text: '流水线准备稿里的私人决定。',
      },
      { sectionId: historySectionId, name: '公开回合记录', kind: 'history', text: '流水线准备稿里的公开记录。' },
    ],
    finalDraft: '## 对局正文\n\n流水线准备稿里的公开正文。\n\n## 魔理沙视角\n\n流水线准备稿里的私人决定。\n\n## 公开回合记录\n\n流水线准备稿里的公开记录。',
    modelContext: '准备上下文。',
  })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{
        type: 'text',
        text: '## 对局正文\n\n实际展示时，两人都看见雨停了。\n\n## 魔理沙视角\n\n魔理沙决定继续当前棋局。\n\n## 公开回合记录\n\n雨停了。',
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
