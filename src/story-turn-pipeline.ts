/** Logged research, character, director, section, and editor Workers for one story turn. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  BlockAssembler,
  createUserMessage,
  ReasoningEffortId,
  type GenerateOptions,
} from '@deepseek-ai/dsh-llm'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { roleplayActModelDispatch, roleplayActModelFailure, type RoleplayActModelDispatch, type RoleplayActModelFailureKind } from './roleplay-act-model-log.ts'
import { appendAgentRpSessionEvent } from './session-event-compat.ts'
import {
  compileStoryCharacterContext,
  storyDirectorMap,
  storyOpenForeshadowing,
  storyParticipantCharacters,
  storyPublicHistory,
  StoryWorkspaceStore,
} from './story-workspace.ts'
import type { StoryTurnMaterialization, StoryWorkspaceSnapshot } from './story-workspace-protocol.ts'
import { searchStoryWorkspaceSources } from './story-research.ts'

/** Ordered model responsibilities before the visible character request. */
export type StoryTurnStage = 'research' | 'character' | 'director' | 'section' | 'editor' | 'continuity'

/** Exact auxiliary request dispatched by the story pipeline. */
export interface StoryTurnStageRequestRecord {
  readonly format: 0
  readonly requestId: string
  readonly sessionId: string
  readonly workspaceId: string
  readonly workspaceRevision: number
  readonly turn: number
  readonly step: number
  readonly stage: StoryTurnStage
  readonly subjectId?: string
  readonly dispatch: RoleplayActModelDispatch
}

/** Terminal output or stable failure for one story-pipeline request. */
export interface StoryTurnStageResultRecord {
  readonly format: 0
  readonly requestId: string
  readonly requestSeq: number
  readonly result:
    | { readonly kind: 'success'; readonly text: string }
    | { readonly kind: 'failure'; readonly failure: RoleplayActModelFailureKind }
}

/** Final draft and provenance made visible to the top-level character Agent. */
export interface StoryTurnBriefRecord {
  readonly format: 0
  readonly sessionId: string
  readonly workspaceId: string
  readonly workspaceRevision: number
  readonly turn: number
  readonly step: number
  readonly resultEventSeqs: readonly number[]
  readonly directorBrief: string
  readonly finalDraft: string
  readonly modelContext: string
}

/** Exact editable story-document update committed after the visible reply. */
export interface StoryTurnMaterializedRecord {
  readonly format: 1
  readonly sessionId: string
  readonly workspaceId: string
  readonly workspaceRevision: number
  readonly turn: number
  readonly step: number
  readonly continuityResultEventSeq: number
  readonly eventSummary: string
  readonly observations: readonly {
    readonly characterId: string
    readonly text: string
  }[]
  readonly plotSuggestions: readonly string[]
  readonly foreshadowSuggestions: readonly string[]
}

/** Logged network-search request generated from an enabled Web source. */
export interface StoryWebSearchRequestRecord {
  readonly format: 0
  readonly sessionId: string
  readonly workspaceId: string
  readonly workspaceRevision: number
  readonly turn: number
  readonly step: number
  readonly query: string
  readonly maxResults: number
}

/** Logged portable network-search result consumed by the research Worker. */
export interface StoryWebSearchResultRecord {
  readonly format: 0
  readonly requestSeq: number
  readonly result:
    | {
        readonly kind: 'success'
        readonly content?: string
        readonly sources: readonly {
          readonly url: string
          readonly title?: string
          readonly snippet?: string
          readonly publishedAt?: string
        }[]
        readonly truncated: boolean
      }
    | { readonly kind: 'failure'; readonly failure: 'unavailable' | 'aborted' | 'provider' }
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Ignorable exact request sent to one story-pipeline Worker. */
    'agent-rp/story-stage-request': StoryTurnStageRequestRecord
    /** Ignorable terminal result from one story-pipeline Worker. */
    'agent-rp/story-stage-result': StoryTurnStageResultRecord
    /** Ignorable final story brief consumed by the visible character request. */
    'agent-rp/story-turn-brief': StoryTurnBriefRecord
    /** Ignorable story-document update committed after the visible reply. */
    'agent-rp/story-turn-materialized': StoryTurnMaterializedRecord
    /** Ignorable exact web query made for one story turn. */
    'agent-rp/story-web-search-request': StoryWebSearchRequestRecord
    /** Ignorable portable web-search result consumed by story research. */
    'agent-rp/story-web-search-result': StoryWebSearchResultRecord
  }
}

interface StageOutput {
  readonly text?: string
  readonly resultEventSeq: number
}

interface ContinuityUpdate {
  readonly history: string
  readonly observations: readonly {
    readonly characterId: string
    readonly text: string
  }[]
  readonly outlineProposals: readonly string[]
  readonly foreshadowingProposals: readonly string[]
}

interface StorySectionDraft {
  readonly id: string
  readonly name: string
  readonly kind: 'prose' | 'character' | 'history'
  readonly text: string
}

interface StoryWebSearchGateway {
  search(request: { readonly query: string; readonly maxResults: number }, signal?: AbortSignal): Promise<{
    readonly content?: string
    readonly sources: readonly {
      readonly url: string
      readonly title?: string
      readonly snippet?: string
      readonly publishedAt?: string
    }[]
    readonly truncated: boolean
  }>
}

/** Inputs owned by one accepted Agent-loop step. */
export interface RunStoryTurnPipelineInput {
  readonly ctx: Context
  readonly agent: Agent
  readonly workspace: StoryWorkspaceSnapshot
  readonly turn: number
  readonly step: number
  readonly messages: readonly UserMessage[]
  readonly signal: AbortSignal
}

function messageText(messages: readonly UserMessage[]): string {
  return messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
    .join('\n').trim()
}

function transcriptText(agent: Agent): string {
  const text = agent.session.deriveMessages().flatMap(message =>
    message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
  return text.length <= 24_000 ? text : text.slice(-24_000)
}

function visibleReplyText(events: readonly SessionEvent[], turn: number): string {
  const event = events.findLast(candidate => candidate.type === 'assistant/message'
    && candidate.data.turn === turn && candidate.data.interrupted !== true
    && candidate.data.message.content.some(block => block.type === 'text' && block.text.trim() !== ''))
  if (event?.type !== 'assistant/message') return ''
  return event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
}

function boundedString(value: unknown, subject: string, max = 64 * 1_024): string {
  if (typeof value !== 'string') throw new Error(`${subject}不是文本`)
  const text = value.trim()
  if (text.length > max) throw new Error(`${subject}过长`)
  return text
}

function stringList(value: unknown, subject: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${subject}不是数组`)
  return value.map((item, index) => boundedString(item, `${subject}[${String(index)}]`, 8 * 1_024)).filter(Boolean)
}

function parseContinuityUpdate(text: string, characterIds: ReadonlySet<string>): ContinuityUpdate {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('连续性记录没有 JSON 对象')
  const value = JSON.parse(unfenced.slice(start, end + 1)) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('连续性记录不是对象')
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !['history', 'observations', 'outlineProposals', 'foreshadowingProposals'].includes(key))
    || !Array.isArray(record.observations)) throw new Error('连续性记录字段无效')
  const observations = record.observations.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`人物观察[${String(index)}]不是对象`)
    }
    const observation = value as Record<string, unknown>
    if (Object.keys(observation).some(key => key !== 'characterId' && key !== 'text')
      || typeof observation.characterId !== 'string' || !characterIds.has(observation.characterId)) {
      throw new Error(`人物观察[${String(index)}]字段无效`)
    }
    return {
      characterId: observation.characterId,
      text: boundedString(observation.text, `人物观察[${String(index)}].text`, 16 * 1_024),
    }
  }).filter(observation => observation.text !== '')
  if (new Set(observations.map(observation => observation.characterId)).size !== observations.length) {
    throw new Error('人物观察包含重复人物')
  }
  return {
    history: boundedString(record.history, '连续性公开历史'),
    observations,
    outlineProposals: stringList(record.outlineProposals, '大纲提案'),
    foreshadowingProposals: stringList(record.foreshadowingProposals, '伏笔提案'),
  }
}

function sectionPurpose(input: RunStoryTurnPipelineInput, section: StoryWorkspaceSnapshot['outputs'][number]): string {
  if (section.kind === 'prose') {
    return '写叙事正文、环境、行动与对白。只呈现导演方案允许公开的内容，不解释创作过程。'
  }
  if (section.kind === 'history') {
    return '写面向读者直接展示的时间线、前情或档案。只写本轮允许公开的既有事实，不把导演计划、未揭示伏笔或人物私密知识当作历史。'
  }
  const target = section.characterId === undefined
    ? undefined
    : input.workspace.characters.find(character => character.id === section.characterId)
  return target === undefined
    ? '聚焦所有参与人物的外显行动、对白与正文允许呈现的内心。不得让人物表现出其私有认知之外的知识。'
    : `聚焦人物“${target.name}”的外显行动、对白与正文允许呈现的内心。不得让该人物表现出其私有认知之外的知识。`
}

function renderSectionDrafts(drafts: readonly StorySectionDraft[]): string {
  if (drafts.length === 1 && drafts[0]!.kind === 'prose') return drafts[0]!.text
  return drafts.map(draft => `## ${draft.name}\n\n${draft.text}`).join('\n\n')
}

function webSearchGateway(ctx: Context): StoryWebSearchGateway | undefined {
  const accessor = ctx as unknown as { readonly get?: (name: string) => unknown }
  if (typeof accessor.get !== 'function') return undefined
  try {
    const candidate = accessor.get('web') as Partial<StoryWebSearchGateway> | undefined
    return candidate !== undefined && typeof candidate.search === 'function'
      ? candidate as StoryWebSearchGateway
      : undefined
  } catch {
    return undefined
  }
}

function webFailure(error: unknown): 'unavailable' | 'aborted' | 'provider' {
  const message = error instanceof Error ? error.message : String(error)
  if (/abort|cancel|取消|中止/iu.test(message)) return 'aborted'
  if (/unavailable|not registered|missing|不可用|未配置/iu.test(message)) return 'unavailable'
  return 'provider'
}

function webSearchText(result: Extract<StoryWebSearchResultRecord['result'], { readonly kind: 'success' }>): string {
  return [
    result.content ?? '',
    ...result.sources.map(source => [
      `### ${source.title ?? source.url}`,
      source.url,
      source.snippet ?? '',
      source.publishedAt === undefined ? '' : `发布时间：${source.publishedAt}`,
    ].filter(Boolean).join('\n')),
  ].filter(Boolean).join('\n\n')
}

function utf8Prefix(value: string, maxBytes: number): string {
  const characters: string[] = []
  let bytes = 0
  for (const character of value.trim()) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > maxBytes) break
    characters.push(character)
    bytes += size
  }
  return characters.join('')
}

function materializedWebResearch(
  events: readonly SessionEvent[],
  resultEventSeqs: readonly number[],
  sessionId: string,
  turn: number,
): StoryTurnMaterialization['webResearch'] {
  const included = new Set(resultEventSeqs)
  const requests = new Map(events.flatMap(event => event.type === 'agent-rp/story-web-search-request'
    ? [[event.seq, event.data] as const] : []))
  return events.flatMap(event => {
    if (event.type !== 'agent-rp/story-web-search-result' || !included.has(event.seq)
      || event.data.result.kind !== 'success') return []
    const request = requests.get(event.data.requestSeq)
    if (request === undefined) return []
    return event.data.result.sources.flatMap(source => {
      if (source.url.length > 4_096) return []
      let url: URL
      try {
        url = new URL(source.url)
      } catch {
        return []
      }
      if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') return []
      return [{
        kind: 'web' as const,
        url: url.href,
        query: utf8Prefix(request.query, 2_500),
        sessionId,
        turn,
        resultEventSeq: event.seq,
        title: (source.title?.trim() || url.hostname).slice(0, 240),
        snippet: utf8Prefix(source.snippet ?? '', 32 * 1_024),
        ...(source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt.trim().slice(0, 120) }),
      }]
    })
  })
}

async function searchWeb(
  input: RunStoryTurnPipelineInput,
  playerInput: string,
  resultEventSeqs: number[],
): Promise<string> {
  const webSources = input.workspace.sources.filter(source => source.enabled && source.kind === 'web')
  if (webSources.length === 0) return ''
  const scope = webSources.map(source => {
    return `${source.name}: ${source.content}`
  }).join('\n').slice(0, 2_000)
  const query = `${scope}\n${playerInput}`.trim().slice(0, 2_500)
  const requestEvent = appendAgentRpSessionEvent(input.agent.session, 'agent-rp/story-web-search-request', {
    format: 0,
    sessionId: String(input.agent.session.id),
    workspaceId: input.workspace.id,
    workspaceRevision: input.workspace.revision,
    turn: input.turn,
    step: input.step,
    query,
    maxResults: 6,
  })
  try {
    await input.ctx.sessions.flush(input.agent.session)
    const web = webSearchGateway(input.ctx)
    if (web === undefined) throw new Error('web search unavailable')
    const result = await web.search({ query, maxResults: 6 }, input.signal)
    const resultEvent = appendAgentRpSessionEvent(input.agent.session, 'agent-rp/story-web-search-result', {
      format: 0,
      requestSeq: requestEvent.seq,
      result: { kind: 'success', ...result },
    })
    resultEventSeqs.push(resultEvent.seq)
    return webSearchText({ kind: 'success', ...result })
  } catch (error: unknown) {
    const resultEvent = appendAgentRpSessionEvent(input.agent.session, 'agent-rp/story-web-search-result', {
      format: 0,
      requestSeq: requestEvent.seq,
      result: { kind: 'failure', failure: webFailure(error) },
    })
    resultEventSeqs.push(resultEvent.seq)
    return ''
  }
}

function baseGenerateOptions(input: RunStoryTurnPipelineInput): Pick<GenerateOptions, 'provider' | 'model' | 'maxTokens'> {
  const config = input.agent.session.requestHeader()?.config
  const workerModel = input.workspace.pipeline.workerModel
  const provider = workerModel?.provider ?? config?.provider ?? input.agent.options.provider
  const model = workerModel?.model ?? config?.model ?? input.agent.options.model
  if (provider === undefined || provider.trim() === '' || model === undefined || model.trim() === '') {
    throw new Error('故事流水线没有可用的模型路由')
  }
  const maxTokens = config?.maxTokens ?? input.agent.options.maxTokens
  return { provider, model, ...(maxTokens === undefined ? {} : { maxTokens }) }
}

async function mapStoryPeers<T, R>(
  items: readonly T[],
  maxParallel: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<readonly R[]> {
  if (items.length === 0) return []
  let nextIndex = 0
  const results = new Map<number, R>()
  const run = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results.set(index, await worker(items[index]!, index))
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxParallel, items.length) }, run))
  return items.map((_item, index) => {
    if (!results.has(index)) throw new Error(`故事同阶段任务 ${String(index)} 没有结果`)
    return results.get(index) as R
  })
}

function generateOptions(
  input: RunStoryTurnPipelineInput,
  system: string,
  body: string,
  maxTokens: number,
  temperature: number,
): GenerateOptions {
  const base = baseGenerateOptions(input)
  return {
    ...base,
    reasoningEffort: ReasoningEffortId('off'),
    temperature,
    maxTokens: Math.min(base.maxTokens ?? maxTokens, maxTokens),
    system,
    messages: [createUserMessage({
      source: { kind: 'plugin', plugin: 'dsh-agent-rp-story-engine' },
      content: [{ type: 'text', text: body }],
    })],
    signal: input.signal,
  }
}

async function runStage(
  input: RunStoryTurnPipelineInput,
  stage: StoryTurnStage,
  request: GenerateOptions,
  resultEventSeqs: number[],
  subjectId?: string,
): Promise<StageOutput> {
  const requestId = crypto.randomUUID()
  const requestEvent = appendAgentRpSessionEvent(input.agent.session, 'agent-rp/story-stage-request', {
    format: 0,
    requestId,
    sessionId: String(input.agent.session.id),
    workspaceId: input.workspace.id,
    workspaceRevision: input.workspace.revision,
    turn: input.turn,
    step: input.step,
    stage,
    ...(subjectId === undefined ? {} : { subjectId }),
    dispatch: roleplayActModelDispatch(request),
  })
  try {
    await input.ctx.sessions.flush(input.agent.session)
    const assembler = new BlockAssembler()
    for await (const chunk of input.ctx.llm.stream(request)) assembler.push(chunk)
    if (assembler.finish.kind === 'error' || assembler.finish.kind === 'aborted') {
      const resultEvent = appendAgentRpSessionEvent(input.agent.session, 'agent-rp/story-stage-result', {
        format: 0,
        requestId,
        requestSeq: requestEvent.seq,
        result: { kind: 'failure', failure: assembler.finish.kind === 'aborted' ? 'aborted' : 'provider' },
      })
      resultEventSeqs.push(resultEvent.seq)
      return { resultEventSeq: resultEvent.seq }
    }
    const text = assembler.blocks().flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
    if (text === '' || text.length > 256 * 1_024) throw new Error('故事 Worker 返回了不可用文本')
    const resultEvent = appendAgentRpSessionEvent(input.agent.session, 'agent-rp/story-stage-result', {
      format: 0,
      requestId,
      requestSeq: requestEvent.seq,
      result: { kind: 'success', text },
    })
    resultEventSeqs.push(resultEvent.seq)
    return { text, resultEventSeq: resultEvent.seq }
  } catch (error: unknown) {
    const existing = input.agent.session.events.find(event => event.type === 'agent-rp/story-stage-result'
      && event.data.requestSeq === requestEvent.seq)
    const resultEvent = existing ?? appendAgentRpSessionEvent(input.agent.session, 'agent-rp/story-stage-result', {
      format: 0,
      requestId,
      requestSeq: requestEvent.seq,
      result: { kind: 'failure', failure: roleplayActModelFailure(error) },
    })
    resultEventSeqs.push(resultEvent.seq)
    return { resultEventSeq: resultEvent.seq }
  }
}

function existingBrief(
  events: readonly SessionEvent[],
  input: RunStoryTurnPipelineInput,
): SessionEvent<'agent-rp/story-turn-brief'> | undefined {
  return events.findLast((event): event is SessionEvent<'agent-rp/story-turn-brief'> =>
    event.type === 'agent-rp/story-turn-brief' && event.data.turn === input.turn && event.data.step === input.step
      && event.data.workspaceId === input.workspace.id
      && event.data.workspaceRevision === input.workspace.revision)
}

function directorFallback(
  input: RunStoryTurnPipelineInput,
  playerInput: string,
  research: string,
  characterDecisions: readonly string[],
): string {
  return [
    '# 本轮剧情目标',
    storyDirectorMap(input.workspace),
    '# 尚未回收的伏笔',
    storyOpenForeshadowing(input.workspace),
    '# 与本轮相关的资料',
    research,
    '# 各人物独立决策',
    characterDecisions.join('\n\n'),
    '# 玩家输入',
    playerInput,
  ].join('\n\n')
}

function modelContext(finalDraft: string): string {
  return [
    '故事引擎已经依据人物私有认知分别推演，并完成导演规划、分区写作与编辑。',
    '<edited_draft>',
    finalDraft,
    '</edited_draft>',
    '请把 edited_draft 作为本轮可见正文；只允许为角色口吻和既有格式做必要的局部适配，不得重新安排剧情，也不得解释故事流水线。',
  ].join('\n')
}

/** Run or replay the complete story Worker pipeline for one accepted model step. */
export async function runStoryTurnPipeline(input: RunStoryTurnPipelineInput): Promise<StoryTurnBriefRecord> {
  const prior = existingBrief(input.agent.session.events, input)
  if (prior !== undefined) return prior.data
  input.signal.throwIfAborted()
  const playerInput = messageText(input.messages)
  if (playerInput === '') throw new Error('故事流水线没有可用的玩家输入')
  const recentTranscript = transcriptText(input.agent)
  const sourceExcerpts = searchStoryWorkspaceSources(input.workspace, `${recentTranscript}\n${playerInput}`)
  const resultEventSeqs: number[] = []
  const webResearch = await searchWeb(input, playerInput, resultEventSeqs)
  const researchBody = [
    '<public_history>', storyPublicHistory(input.workspace), '</public_history>',
    '<recent_transcript>', recentTranscript, '</recent_transcript>',
    '<source_excerpts>', sourceExcerpts, '</source_excerpts>',
    '<web_research>', webResearch, '</web_research>',
    '<player_input>', playerInput, '</player_input>',
  ].join('\n')
  const research = await runStage(input, 'research', generateOptions(
    input,
    '你是剧情研究 Worker。只提取与本轮输入直接相关的既有事实、原著约束和连续性信息；区分明确事实与不确定推测。不要设计剧情，不要替角色决定行动。只返回精炼的研究简报。',
    researchBody,
    4_096,
    0.1,
  ), resultEventSeqs)
  const researchText = research.text ?? [sourceExcerpts, webResearch].filter(Boolean).join('\n\n')

  const enabledCharacters = storyParticipantCharacters(input.workspace)
  const characterDecisions = (await mapStoryPeers(
    enabledCharacters,
    input.workspace.pipeline.maxParallel,
    async character => {
      input.signal.throwIfAborted()
      const context = compileStoryCharacterContext(input.workspace, character.id, {
        playerInput,
      })
      const decision = await runStage(input, 'character', generateOptions(
        input,
        '你是一个只拥有指定人物认知的角色 Worker。独立判断人物此刻能观察到什么、相信什么、想做什么以及可能说什么。不能使用未出现在输入中的知识。不要写完整正文，只返回给导演的行动提案。',
        context.text,
        2_048,
        0.5,
      ), resultEventSeqs, character.id)
      return decision.text === undefined ? undefined : `## ${character.name}\n${decision.text}`
    },
  )).filter((value): value is string => value !== undefined)

  const fallback = directorFallback(input, playerInput, researchText, characterDecisions)
  const director = await runStage(input, 'director', generateOptions(
    input,
    '你是剧情导演 Worker。依据大纲、伏笔、研究简报和各人物独立行动提案，为本轮设计具体正文方案。保证因果连续，尊重玩家输入；隐藏知识只能影响拥有者或导演安排，不能让不知情人物表现出全知。明确每个启用正文分区应写什么。不要直接向玩家解释内部资料。',
    [
      '<story_map>', storyDirectorMap(input.workspace), '</story_map>',
      '<foreshadowing>', storyOpenForeshadowing(input.workspace), '</foreshadowing>',
      '<public_history>', storyPublicHistory(input.workspace), '</public_history>',
      '<research>', researchText, '</research>',
      '<character_decisions>', characterDecisions.join('\n\n'), '</character_decisions>',
      '<sections>', input.workspace.outputs.filter(section => section.enabled)
        .map(section => {
          const target = section.characterId === undefined
            ? ''
            : input.workspace.characters.find(character => character.id === section.characterId)?.name ?? ''
          return `${section.id}\t${section.kind}\t${section.name}\t${target}`
        }).join('\n'), '</sections>',
      '<player_input>', playerInput, '</player_input>',
    ].join('\n'),
    4_096,
    0.4,
  ), resultEventSeqs)
  const directorBrief = director.text ?? fallback

  const enabledSections = input.workspace.outputs.filter(section => section.enabled)
  let sectionDrafts: readonly StorySectionDraft[]
  if (enabledSections.length === 0) {
    sectionDrafts = [{ id: 'director-fallback', name: '正文', kind: 'prose', text: directorBrief }]
  } else {
    sectionDrafts = (await mapStoryPeers(
      enabledSections,
      input.workspace.pipeline.maxParallel,
      async section => {
        input.signal.throwIfAborted()
        const existing = section.instructions
        const draft = await runStage(input, 'section', generateOptions(
          input,
          `你是“${section.name}”分区的 ${section.kind} Worker。${sectionPurpose(input, section)}保持既有文风和连续性，只返回这个分区可直接展示的内容。`,
          [
            `<section_reference kind="${section.kind}">`, existing, '</section_reference>',
            '<director_brief>', directorBrief, '</director_brief>',
            '<player_input>', playerInput, '</player_input>',
          ].join('\n'),
          6_144,
          0.7,
        ), resultEventSeqs, section.id)
        return draft.text === undefined ? undefined : {
          id: section.id,
          name: section.name,
          kind: section.kind,
          text: draft.text,
        }
      },
    )).filter((value): value is StorySectionDraft => value !== undefined)
  }
  const uneditedDraft = renderSectionDrafts(sectionDrafts).trim() || directorBrief
  const edited = await runStage(input, 'editor', generateOptions(
    input,
    '你是最终正文编辑 Worker。删除复读、八股句式、空泛总结、机械排比和正文外解释；保留全部事实、行动、对白归属、因果、叙事视角与必要格式。不要增加事件，不要改变人物认知。输入含多个二级标题时必须保留标题、顺序与分区职责，不得合并分区。只返回可直接展示的完整正文。',
    `<ordered_sections>\n${uneditedDraft}\n</ordered_sections>`,
    8_192,
    0.2,
  ), resultEventSeqs)
  const finalDraft = edited.text ?? uneditedDraft
  const context = modelContext(finalDraft)
  const record: StoryTurnBriefRecord = {
    format: 0,
    sessionId: String(input.agent.session.id),
    workspaceId: input.workspace.id,
    workspaceRevision: input.workspace.revision,
    turn: input.turn,
    step: input.step,
    resultEventSeqs,
    directorBrief,
    finalDraft,
    modelContext: context,
  }
  appendAgentRpSessionEvent(input.agent.session, 'agent-rp/story-turn-brief', record)
  await input.ctx.sessions.flush(input.agent.session)
  return record
}

/** Materialize the actually visible reply into global history and character-scoped observations. */
export async function materializeStoryTurn(input: {
  readonly ctx: Context
  readonly agent: Agent
  readonly store: StoryWorkspaceStore
  readonly workspaceId: string
  readonly turn: number
  readonly signal: AbortSignal
}): Promise<StoryTurnMaterializedRecord | undefined> {
  const previous = input.agent.session.events.findLast((event): event is SessionEvent<'agent-rp/story-turn-materialized'> =>
    event.type === 'agent-rp/story-turn-materialized' && event.data.turn === input.turn
      && event.data.workspaceId === input.workspaceId)
  if (previous !== undefined) return previous.data
  const briefEvent = input.agent.session.events.findLast((event): event is SessionEvent<'agent-rp/story-turn-brief'> =>
    event.type === 'agent-rp/story-turn-brief' && event.data.turn === input.turn
      && event.data.workspaceId === input.workspaceId)
  if (briefEvent === undefined) return undefined
  const visibleReply = visibleReplyText(input.agent.session.events, input.turn)
  if (visibleReply === '') return undefined
  const workspace = input.store.get(input.workspaceId)
  const participants = storyParticipantCharacters(workspace)
  const stageInput: RunStoryTurnPipelineInput = {
    ctx: input.ctx,
    agent: input.agent,
    workspace,
    turn: input.turn,
    step: briefEvent.data.step,
    messages: [],
    signal: input.signal,
  }
  const resultEventSeqs: number[] = []
  const continuity = await runStage(stageInput, 'continuity', generateOptions(
    stageInput,
    [
      '你是剧情连续性记录 Worker。正文已经完成；不要续写、改写或评价正文。',
      'history 只概括正文中已经发生、可供导演维持连续性的事件，不记录创作过程。',
      'observations 只为列出的当前场景参与人物记录其在正文中明确亲历或可感知的事实；不得写入别人的内心、未公开秘密、离场事件或仅由导演知道的内容。没有可靠观察就省略该人物。',
      'outlineProposals 与 foreshadowingProposals 只是供用户审查的建议；不要把建议当成已经发生的事实。',
      '只返回 JSON：{"history":"...","observations":[{"characterId":"...","text":"..."}],"outlineProposals":[],"foreshadowingProposals":[]}。不要使用 Markdown 围栏。',
    ].join('\n'),
    [
      '<participants>', participants.map(character => `${character.id}\t${character.name}`).join('\n'), '</participants>',
      '<current_story_map>', storyDirectorMap(workspace), '</current_story_map>',
      '<current_foreshadowing>', storyOpenForeshadowing(workspace), '</current_foreshadowing>',
      '<visible_reply>', visibleReply, '</visible_reply>',
    ].join('\n'),
    4_096,
    0,
  ), resultEventSeqs)
  let update: ContinuityUpdate
  try {
    update = parseContinuityUpdate(continuity.text ?? '', new Set(participants.map(character => character.id)))
  } catch {
    update = {
      history: visibleReply,
      observations: [],
      outlineProposals: [],
      foreshadowingProposals: [],
    }
  }
  const materialized = input.store.materializeTurn(input.workspaceId, {
    key: `turn-${String(input.turn)}-brief-${String(briefEvent.seq)}`,
    turn: input.turn,
    title: `回合 ${String(input.turn)}`,
    summary: update.history,
    evidence: visibleReply,
    participantIds: participants.map(character => character.id),
    observations: update.observations,
    plotSuggestions: update.outlineProposals,
    foreshadowSuggestions: update.foreshadowingProposals,
    webResearch: materializedWebResearch(
      input.agent.session.events,
      briefEvent.data.resultEventSeqs,
      String(input.agent.session.id),
      input.turn,
    ),
  })
  const record: StoryTurnMaterializedRecord = {
    format: 1,
    sessionId: String(input.agent.session.id),
    workspaceId: input.workspaceId,
    workspaceRevision: materialized.revision,
    turn: input.turn,
    step: briefEvent.data.step,
    continuityResultEventSeq: continuity.resultEventSeq,
    eventSummary: update.history,
    observations: update.observations,
    plotSuggestions: update.outlineProposals,
    foreshadowSuggestions: update.foreshadowingProposals,
  }
  appendAgentRpSessionEvent(input.agent.session, 'agent-rp/story-turn-materialized', record)
  await input.ctx.sessions.flush(input.agent.session)
  return record
}

/** Read the exact story brief already prepared for one model step. */
export function readStoryTurnBrief(
  events: readonly SessionEvent[],
  turn: number,
  step: number,
): StoryTurnBriefRecord | undefined {
  return events.findLast((event): event is SessionEvent<'agent-rp/story-turn-brief'> =>
    event.type === 'agent-rp/story-turn-brief' && event.data.turn === turn && event.data.step === step)?.data
}
