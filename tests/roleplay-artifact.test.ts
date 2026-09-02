import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId, type ImageAttachmentRef, type SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { ToolCallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionSeq } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import { resolveConfig } from '../src/config.ts'
import { installAgentRp } from '../src/index.ts'
import {
  detectRoleplayArtifactFollowup,
  installRoleplayArtifactCapability,
  readRoleplayArtifactAutoStageIntent,
  readRoleplayArtifactStageRecord,
  readStagedRoleplayArtifacts,
  readToolArtifactPresentationMeta,
  renderRoleplayArtifactToolGuidance,
  ROLEPLAY_ARTIFACT_AUTO_STAGE_FORMAT,
  ROLEPLAY_ARTIFACT_PUBLISH_TOOL,
  ROLEPLAY_ARTIFACT_STAGE_TOOL,
} from '../src/roleplay-artifact.ts'
import { sessionEvents } from '../src/session-events.ts'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

const IMAGE: ImageAttachmentRef = {
  attachmentId: AttachmentId('sha256:roleplay-artifact-fixture'),
  mediaType: 'image/png',
  bytes: 68,
  width: 1,
  height: 1,
  name: 'scene.png',
}

test('guides every image producer through one provider-neutral publication path', () => {
  const guidance = renderRoleplayArtifactToolGuidance()
  assert.match(guidance, /stage_roleplay_artifact/u)
  assert.match(guidance, /publish_roleplay_image/u)
  assert.match(guidance, /一次图片只使用一种发布方式/u)
  assert.match(guidance, /不得原样重复调用/u)
  assert.doesNotMatch(guidance, /Comfy|MCP|DashScope|OpenAI/u)

  const custom = renderRoleplayArtifactToolGuidance({
    enabled: true,
    includeFramework: false,
    includeAgentRp: true,
    imageMode: 'always',
    custom: [{ id: 'fixture-provider', enabled: true, text: 'CALL_FIXTURE_IMAGE_TOOL' }],
  })
  assert.match(custom, /CALL_FIXTURE_IMAGE_TOOL/u)
  assert.match(custom, /本回合应至多尝试一次/u)
  assert.doesNotMatch(custom, /持久记忆工具/u)

  const never = renderRoleplayArtifactToolGuidance({
    enabled: true,
    includeFramework: true,
    includeAgentRp: true,
    imageMode: 'never',
    custom: [],
  })
  assert.match(never, /本回合不生成或发布/u)
  assert.doesNotMatch(never, /stage_roleplay_artifact|publish_roleplay_image/u)
  assert.equal(renderRoleplayArtifactToolGuidance({
    enabled: false,
    includeFramework: true,
    includeAgentRp: true,
    imageMode: 'auto',
    custom: [],
  }), '')
})

function openSession(id: string, cwd?: string): { readonly session: Session; readonly agent: Agent } {
  const sessionId = SessionId(id)
  const session = cwd === undefined
    ? Session.create(sessionId)
    : Session.create(sessionId, [], { version: 0, id: sessionId, createdAt: 0, cwd, isSeeded: false })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  return { session, agent: { session } as Agent }
}

function appendCall(session: Session, callId: string, name: string, args: unknown): SessionSeq {
  return session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: ToolCallId(callId),
    name,
    arguments: JSON.stringify(args),
  }).seq
}

function appendResult(
  session: Session,
  callId: string,
  callSeq: SessionSeq,
  meta: JsonValue | undefined,
  content: Parameters<typeof createToolResultMessage>[0]['content'] = [{ type: 'text', text: 'ok' }],
): number {
  return session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: ToolCallId(callId),
      content,
      isError: false,
    }),
    ...(meta === undefined ? {} : { meta }),
  }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] }).seq
}

async function mounted(): Promise<Context> {
  const ctx = new Context()
  ctx.provide('attachments' as never, {
    imageLimits: {
      maxImageBytes: 1_000_000,
      maxImagesPerMessage: 4,
      maxMessageImageBytes: 4_000_000,
      maxImagePixels: 10_000_000,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
    saveImage: (input: SaveImageAttachment) => Promise.resolve({
      attachmentId: AttachmentId('sha256:published-workspace-image'),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...(input.name === undefined ? {} : { name: input.name }),
    }),
    readImage: (ref: ImageAttachmentRef) => Promise.resolve({ ref, data: new Uint8Array(ref.bytes) }),
  } as never)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  installRoleplayArtifactCapability(ctx)
  return ctx
}

test('stages one explicit same-turn durable artifact and replays its provenance', async (context) => {
  const ctx = await mounted()
  context.after(async () => { await ctx.fiber.dispose() })
  const { session, agent } = openSession('stage-artifact')
  const sourceCallSeq = appendCall(session, 'image-1', 'generate_image', { prompt: '雨夜钟楼' })
  const sourceResultSeq = appendResult(session, 'image-1', sourceCallSeq, {
    format: 'dsh.tool-artifacts',
    version: 0,
    artifacts: [{ type: 'image', attachment: IMAGE }],
  } as unknown as JsonValue)
  const stageCallSeq = appendCall(session, 'stage-1', ROLEPLAY_ARTIFACT_STAGE_TOOL, {
    artifactId: String(IMAGE.attachmentId),
    caption: '雨落在钟楼外。',
  })

  const result = await ctx.tools.execute({
    callId: ToolCallId('stage-1'),
    name: ROLEPLAY_ARTIFACT_STAGE_TOOL,
    arguments: { artifactId: String(IMAGE.attachmentId), caption: '  雨落在钟楼外。  ' },
    agent,
    signal: new AbortController().signal,
  })

  assert.equal(result.isError, false)
  assert.equal(result.concludesTurn, true)
  if (result.isError) throw new Error('staging unexpectedly failed')
  const record = readRoleplayArtifactStageRecord(result.meta)
  assert.deepEqual(record, {
    format: 'agent-rp.staged-artifact',
    version: 0,
    artifact: { type: 'image', attachment: IMAGE },
    sourceResultSeq,
    sourceCallId: 'image-1',
    sourceToolName: 'generate_image',
    caption: '雨落在钟楼外。',
  })
  const stageResultSeq = appendResult(session, 'stage-1', stageCallSeq, result.meta)
  assert.deepEqual(readStagedRoleplayArtifacts(sessionEvents(session), 1, stageResultSeq + 1), [record])
})

test('keeps the narrative lane when an image tool runs before prose', () => {
  const toolOnly = openSession('artifact-followup-tool-only').session
  appendCall(toolOnly, 'image-before-prose', 'mcp__image__generate', { prompt: '雨夜钟楼' })
  assert.equal(detectRoleplayArtifactFollowup(sessionEvents(toolOnly), 'image-before-prose', {
    isError: false,
    content: [{ type: 'image', attachment: IMAGE }],
  }), undefined)
})

test('accepts Thetail publish_roleplay_image calls over legacy native image results', async (context) => {
  const ctx = await mounted()
  context.after(async () => { await ctx.fiber.dispose() })
  const { session, agent } = openSession('publish-the-tail')
  const sourceCallSeq = appendCall(session, 'mcp-image-1', 'mcp__image__generate', { prompt: '雨夜钟楼' })
  const sourceResultSeq = appendResult(
    session, 'mcp-image-1', sourceCallSeq, undefined, [{ type: 'image', attachment: IMAGE }],
  )
  const publishCallSeq = appendCall(session, 'publish-1', ROLEPLAY_ARTIFACT_PUBLISH_TOOL, {
    caption: '雨落在钟楼外。',
  })

  const result = await ctx.tools.execute({
    callId: ToolCallId('publish-1'),
    name: ROLEPLAY_ARTIFACT_PUBLISH_TOOL,
    arguments: { caption: '  雨落在钟楼外。  ' },
    agent,
    signal: new AbortController().signal,
  })

  assert.equal(result.isError, false)
  assert.equal(result.concludesTurn, true)
  if (result.isError) throw new Error('publication unexpectedly failed')
  const meta = readToolArtifactPresentationMeta(result.meta)
  assert.deepEqual(meta?.artifacts, [{ type: 'image', attachment: IMAGE }])
  assert.deepEqual(readRoleplayArtifactAutoStageIntent(meta?.data), {
    format: ROLEPLAY_ARTIFACT_AUTO_STAGE_FORMAT,
    version: 0,
    sourceResultSeq,
    caption: '雨落在钟楼外。',
  })
  const publishResultSeq = appendResult(session, 'publish-1', publishCallSeq, result.meta)
  assert.deepEqual(readStagedRoleplayArtifacts(sessionEvents(session), 1, publishResultSeq + 1), [{
    format: 'agent-rp.staged-artifact',
    version: 0,
    artifact: { type: 'image', attachment: IMAGE },
    sourceResultSeq: publishResultSeq,
    sourceCallId: 'publish-1',
    sourceToolName: ROLEPLAY_ARTIFACT_PUBLISH_TOOL,
    caption: '雨落在钟楼外。',
  }])

  appendCall(session, 'publish-duplicate', ROLEPLAY_ARTIFACT_PUBLISH_TOOL, {})
  const duplicate = await ctx.tools.execute({
    callId: ToolCallId('publish-duplicate'),
    name: ROLEPLAY_ARTIFACT_PUBLISH_TOOL,
    arguments: {},
    agent,
    signal: new AbortController().signal,
  })
  assert.equal(duplicate.isError, true)
  assert.match(duplicate.content[0]?.type === 'text' ? duplicate.content[0].text : '', /already published/u)
})

test('replays early Thetail publication results that carried a native image block', () => {
  const { session } = openSession('publish-the-tail-history')
  const publishCallSeq = appendCall(session, 'publish-history', ROLEPLAY_ARTIFACT_PUBLISH_TOOL, {})
  const publishResultSeq = appendResult(
    session,
    'publish-history',
    publishCallSeq,
    {
      format: 0,
      version: 0,
      sourceEventSeq: publishCallSeq,
      images: [IMAGE],
      caption: '旧会话里的雨夜。',
    } as unknown as JsonValue,
    [{ type: 'text', text: 'published' }, { type: 'image', attachment: IMAGE }],
  )

  assert.deepEqual(readStagedRoleplayArtifacts(sessionEvents(session), 1, publishResultSeq + 1), [{
    format: 'agent-rp.staged-artifact',
    version: 0,
    artifact: { type: 'image', attachment: IMAGE },
    sourceResultSeq: publishResultSeq,
    sourceCallId: 'publish-history',
    sourceToolName: ROLEPLAY_ARTIFACT_PUBLISH_TOOL,
    caption: '旧会话里的雨夜。',
  }])
})

test('publishes a real workspace image through the compatibility tool without accepting outside paths', async (context) => {
  const ctx = await mounted()
  context.after(async () => { await ctx.fiber.dispose() })
  const root = await mkdtemp(join(tmpdir(), 'agent-rp-publish-compat-'))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'scene.png'), PNG)
  await writeFile(join(root, 'outside.png'), PNG)
  context.after(async () => { await rm(root, { recursive: true, force: true }) })
  const { session, agent } = openSession('publish-workspace', workspace)
  appendCall(session, 'publish-outside', ROLEPLAY_ARTIFACT_PUBLISH_TOOL, { path: join(root, 'outside.png') })
  const outside = await ctx.tools.execute({
    callId: ToolCallId('publish-outside'),
    name: ROLEPLAY_ARTIFACT_PUBLISH_TOOL,
    arguments: { path: join(root, 'outside.png') },
    agent,
    signal: new AbortController().signal,
  })
  assert.equal(outside.isError, true)
  assert.equal(outside.concludesTurn, undefined)
  assert.match(outside.content[0]?.type === 'text' ? outside.content[0].text : '', /inside the Session workspace/u)

  const publishCallSeq = appendCall(session, 'publish-path', ROLEPLAY_ARTIFACT_PUBLISH_TOOL, {
    path: 'scene.png',
  })

  const result = await ctx.tools.execute({
    callId: ToolCallId('publish-path'),
    name: ROLEPLAY_ARTIFACT_PUBLISH_TOOL,
    arguments: { path: 'scene.png' },
    agent,
    signal: new AbortController().signal,
  })

  assert.equal(result.isError, false)
  if (result.isError) throw new Error('workspace publication unexpectedly failed')
  const meta = readToolArtifactPresentationMeta(result.meta)
  assert.equal(meta?.artifacts[0]?.attachment.name, 'scene.png')
  assert.equal(meta?.artifacts[0]?.attachment.mediaType, 'image/png')
  const publishResultSeq = appendResult(session, 'publish-path', publishCallSeq, result.meta)
  assert.equal(readStagedRoleplayArtifacts(sessionEvents(session), 1, publishResultSeq + 1).length, 1)
})

test('rejects paths, old-turn ids, and unrecorded artifacts instead of guessing', async (context) => {
  const ctx = await mounted()
  context.after(async () => { await ctx.fiber.dispose() })
  const { session, agent } = openSession('reject-artifact')
  appendCall(session, 'stage-path', ROLEPLAY_ARTIFACT_STAGE_TOOL, { artifactId: 'C:\\scene.png' })
  const pathResult = await ctx.tools.execute({
    callId: ToolCallId('stage-path'),
    name: ROLEPLAY_ARTIFACT_STAGE_TOOL,
    arguments: { artifactId: 'C:\\scene.png' },
    agent,
    signal: new AbortController().signal,
  })
  assert.equal(pathResult.isError, true)

  appendCall(session, 'stage-missing', ROLEPLAY_ARTIFACT_STAGE_TOOL, { artifactId: 'sha256:missing' })
  const missing = await ctx.tools.execute({
    callId: ToolCallId('stage-missing'),
    name: ROLEPLAY_ARTIFACT_STAGE_TOOL,
    arguments: { artifactId: 'sha256:missing' },
    agent,
    signal: new AbortController().signal,
  })
  assert.equal(missing.isError, true)
  assert.match(missing.content[0]?.type === 'text' ? missing.content[0].text : '', /not available/u)
})

test('replaces the full roleplay prompt with a narrow artifact handoff after visible prose', async (context) => {
  const root = new Context()
  await root.plugin(LlmRuntime)
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRegistry)
  await root.plugin(AgentRegistry)
  root.provide('commands' as never, { register: () => () => {} } as never)
  root.provide('attachments' as never, {} as never)
  root.provide('credentials' as never, {} as never)
  const presetKey = {}
  const preset = createScope(root, presetKey)
  const libraryRoot = await mkdtemp(join(tmpdir(), 'agent-rp-artifact-handoff-'))
  const attachment: ImageAttachmentRef = {
    ...IMAGE,
    attachmentId: AttachmentId('sha256:artifact-handoff-integration'),
  }
  let agentParentCtx: Context | undefined
  await preset.ctx.plugin({
    inject: ['llm', 'systemPrompt', 'tools'],
    apply(pluginCtx: Context) {
      pluginCtx.tools.register({
        name: 'fixture_generate_image',
        description: 'Return one durable fixture image.',
        parameters: {},
        output: {
          schema: { type: 'string' },
          render: () => [{ type: 'image', attachment }],
        },
        execute: () => Promise.resolve('generated'),
      })
      installAgentRp(pluginCtx, resolveConfig({ characterName: '完整酒馆角色提示' }), {
        characterLibraryRoot: libraryRoot,
      })
      agentParentCtx = pluginCtx
    },
  })
  assert.ok(agentParentCtx)

  const session = Session.create(SessionId('artifact-handoff-integration'))
  const agent = { id: session.id, session } as Agent
  const agentScope = createScope(agentParentCtx, agent, { parent: presetKey })
  Object.assign(agent, { ctx: agentScope.ctx })
  const disposeAgent = root.agents.register(agent)
  context.after(async () => {
    disposeAgent()
    await agentScope.dispose()
    await preset.dispose()
    await root.fiber.dispose()
    await rm(libraryRoot, { recursive: true, force: true })
  })
  session.append('turn/start', { turn: 1 })
  const pending = createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: '写完正文后生成插图。' }],
  })
  agentEvents(root, agent).emit('agent/inbox/claimed', { message: pending, turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', pending, { surfaceOp: 'append' })
  await agentEvents(root, agent).waterfall('agent/request', {
    turn: 1,
    step: 1,
    signal: new AbortController().signal,
  }, () => Promise.resolve({ provider: 'fixture', model: 'fixture' }))
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: '钟楼的雨声淹没了最后一句话。' }, {
        type: 'tool-call', id: ToolCallId('handoff-image'), name: 'fixture_generate_image', arguments: '{}',
      }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: ToolCallId('handoff-image'),
    name: 'fixture_generate_image',
    arguments: '{}',
  })
  const result = await root.tools.execute({
    callId: ToolCallId('handoff-image'),
    name: 'fixture_generate_image',
    arguments: {},
    agent,
    signal: new AbortController().signal,
  })
  assert.equal(result.isError, false)

  const handoff = await root.systemPrompt.assemble({ scope: agent })
  const prompt = renderPrompt(handoff)
  assert.match(prompt, /Agent RP 产物交接/u)
  assert.doesNotMatch(prompt, /完整酒馆角色提示/u)
  assert.equal(handoff.contexts.find(value => value.name === 'agent-rp:memory')?.text, '')
  assert.equal(handoff.contexts.find(value => value.name === 'agent-rp:artifact-tools')?.text, '')
})
