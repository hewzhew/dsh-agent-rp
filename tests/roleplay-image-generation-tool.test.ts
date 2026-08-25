import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import { GeneratedImageLibrary } from '../src/generated-image-library.ts'
import {
  installRoleplayImageGenerationTool,
  ROLEPLAY_IMAGE_GENERATION_TOOL,
} from '../src/roleplay-image-generation-tool.ts'
import { prepareRoleplayToolPolicy } from '../src/roleplay-tool-guidance.ts'
import { WorkspaceSettingsStore } from '../src/workspace-settings-store.ts'

async function scopedAgent(ctx: Context, id: string): Promise<{ readonly agent: Agent; readonly scope: Scope }> {
  const session = Session.create(SessionId(id))
  const agent = { id: session.id, session } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, agent) }, {
    inject: ['tools', 'systemPrompt'],
  }))
  Object.assign(agent, { ctx: scope.ctx })
  return { agent, scope }
}

test('hides image generation after its first attempt until the next roleplay turn', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-rp-image-tool-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  const { agent, scope } = await scopedAgent(ctx, 'image-attempt-limit')
  context.after(async () => {
    await scope.dispose()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const policy = prepareRoleplayToolPolicy()
  const controller = installRoleplayImageGenerationTool(ctx, {
    attachments: {} as AttachmentStore,
    credentials: {
      resolve: () => Promise.resolve(undefined),
    } as unknown as CredentialProvider,
    library: new GeneratedImageLibrary({ root: join(root, 'images') }),
    settings: new WorkspaceSettingsStore({ path: join(root, 'settings.json') }),
    toolPolicy: () => policy,
  })

  controller.prepare(agent, policy, 1)
  assert.ok(ctx.tools.schemas(agent).some(tool => tool.name === ROLEPLAY_IMAGE_GENERATION_TOOL))
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('step/start', { turn: 1, step: 1 })
  agent.session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: CallId('image-first-attempt'),
    name: ROLEPLAY_IMAGE_GENERATION_TOOL,
    arguments: JSON.stringify({ prompt: '雨夜钟楼' }),
  })
  const failed = await ctx.tools.execute({
    agent,
    callId: CallId('image-first-attempt'),
    name: ROLEPLAY_IMAGE_GENERATION_TOOL,
    arguments: { prompt: '雨夜钟楼' },
    signal: new AbortController().signal,
  })

  assert.equal(failed.isError, true)
  assert.match(failed.content[0]?.type === 'text' ? failed.content[0].text : '', /图片服务密钥/u)
  assert.ok(!ctx.tools.schemas(agent).some(tool => tool.name === ROLEPLAY_IMAGE_GENERATION_TOOL))
  controller.prepare(agent, policy, 1)
  assert.ok(!ctx.tools.schemas(agent).some(tool => tool.name === ROLEPLAY_IMAGE_GENERATION_TOOL))

  controller.prepare(agent, policy, 2)
  assert.ok(ctx.tools.schemas(agent).some(tool => tool.name === ROLEPLAY_IMAGE_GENERATION_TOOL))
})
