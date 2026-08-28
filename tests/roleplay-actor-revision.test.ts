import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { CharacterLibrary } from '../src/character-library.ts'
import { characterLibraryActorRevisionProvider } from '../src/character-library-actor-revision.ts'
import { parseCharacterCardJsonBytes } from '../src/import/character-card.ts'
import { characterLibraryRoleplayResourceId } from '../src/roleplay-resource-library-ids.ts'
import {
  installRoleplayActorRevisionCapability,
  parseRoleplayActorRevisionResult,
  readRoleplayActorRevisionAttempts,
  ROLEPLAY_ACTOR_INSPECTION_TOOL,
  ROLEPLAY_ACTOR_REVISION_TOOL,
  RoleplayActorRevisionConflictError,
  RoleplayActorRevisionRegistry,
  type RoleplayActorDefinition,
  type RoleplayActorRevisionChanges,
  type RoleplayActorRevisionProvider,
  type RoleplayActorRevisionSnapshot,
} from '../src/roleplay-actor-revision.ts'

const ACTOR = { kind: 'actor' as const, id: 'actor:fixture' }

const BASE_DEFINITION: RoleplayActorDefinition = {
  name: '白露',
  description: '住在钟楼旁的学生。',
  personality: '说话直率。',
  scenario: '海城的雨夜。',
  exampleDialogue: '<START>\n{{char}}: 门还没锁。',
  openings: ['门还没锁，你进来吧。', '今天来得很早。'],
}

function clonedDefinition(value: RoleplayActorDefinition): RoleplayActorDefinition {
  return { ...value, openings: [...value.openings] }
}

function changeDefinition(
  current: RoleplayActorDefinition,
  changes: RoleplayActorRevisionChanges,
): RoleplayActorDefinition {
  return {
    name: changes.name?.after ?? current.name,
    description: changes.description?.after ?? current.description,
    personality: changes.personality?.after ?? current.personality,
    scenario: changes.scenario?.after ?? current.scenario,
    exampleDialogue: changes.exampleDialogue?.after ?? current.exampleDialogue,
    openings: [...(changes.openings?.after ?? current.openings)],
  }
}

function memoryProvider(): {
  readonly provider: RoleplayActorRevisionProvider
  readonly current: () => RoleplayActorRevisionSnapshot
  readonly reviseCount: () => number
  readonly replace: (definition: RoleplayActorDefinition) => void
} {
  let revision = 1
  let definition = clonedDefinition(BASE_DEFINITION)
  let revised = 0
  const current = (): RoleplayActorRevisionSnapshot => ({
    actor: ACTOR,
    revision: String(revision),
    definition: clonedDefinition(definition),
  })
  return {
    current,
    reviseCount: () => revised,
    replace(value) {
      definition = clonedDefinition(value)
      revision += 1
    },
    provider: {
      id: 'fixture:actor-revisions',
      inspect: actor => actor.id === ACTOR.id ? current() : undefined,
      revise(input) {
        if (input.expectedRevision !== String(revision)) {
          throw new RoleplayActorRevisionConflictError(current())
        }
        revised += 1
        definition = changeDefinition(definition, input.changes)
        revision += 1
        return current()
      },
    },
  }
}

const CHANGES = {
  description: {
    before: BASE_DEFINITION.description,
    after: '在雨夜守望钟楼的学生。',
  },
  personality: {
    before: BASE_DEFINITION.personality,
    after: '说话直率，但会认真照顾朋友。',
  },
} as const

async function mounted(outcome: (provider: ReturnType<typeof memoryProvider>) => ApprovalOutcome): Promise<{
  readonly ctx: Context
  readonly provider: ReturnType<typeof memoryProvider>
  readonly registry: RoleplayActorRevisionRegistry
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(ApprovalService)
  const provider = memoryProvider()
  const registry = new RoleplayActorRevisionRegistry()
  registry.register(provider.provider)
  installRoleplayActorRevisionCapability(ctx, registry, { resolveActor: () => ACTOR })
  ctx.on('approval/request', () => Promise.resolve(outcome(provider)))
  return { ctx, provider, registry }
}

function openSession(id: string): { readonly session: Session; readonly agent: Agent } {
  const session = Session.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  return { session, agent: { session } as Agent }
}

function appendCall(session: Session, callId: string, name: string, args: unknown): number {
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
  callSeq: number,
  result: Awaited<ReturnType<ToolRegistry['execute']>>,
): void {
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: ToolCallId(callId),
      content: result.content,
      isError: result.isError,
    }),
    ...(result.meta === undefined ? {} : { meta: result.meta }),
  }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
}

test('reads the exact editable actor revision without mutating the provider', async (context) => {
  const { ctx, provider } = await mounted(() => 'rejected')
  context.after(async () => { await ctx.fiber.dispose() })
  const { session, agent } = openSession('actor-inspection')
  const callId = 'inspect-actor-1'
  appendCall(session, callId, ROLEPLAY_ACTOR_INSPECTION_TOOL, {})

  const result = await ctx.tools.execute({
    callId: ToolCallId(callId), name: ROLEPLAY_ACTOR_INSPECTION_TOOL,
    arguments: {}, agent, signal: new AbortController().signal,
  })

  assert.equal(result.isError, false)
  if (result.isError) throw new Error('inspection unexpectedly failed')
  assert.deepEqual(result.value, {
    version: 0,
    actorId: ACTOR.id,
    revision: '1',
    definition: BASE_DEFINITION,
  })
  assert.equal(provider.reviseCount(), 0)
  assert.equal(session.events.some(event => event.type === 'approval/asked'), false)
})

test('maps source-neutral actor fields onto a reversible CharacterLibrary overlay', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'agent-rp-actor-revision-library-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const data = new Uint8Array(readFileSync('tests/fixtures/manual-character-card.json'))
  const card = parseCharacterCardJsonBytes(data)
  const library = new CharacterLibrary({ root })
  const imported = library.import({
    data,
    filename: '白露.json',
    mediaType: 'application/json',
    card,
    transport: { transport: 'json' },
  })
  const actor = { kind: 'actor' as const, id: characterLibraryRoleplayResourceId(imported.id) }
  const revisions = new RoleplayActorRevisionRegistry()
  revisions.register(characterLibraryActorRevisionProvider(library))
  const current = revisions.inspect(actor)
  const sourceBytes = library.asset(imported.id).data

  const result = revisions.revise({
    actor,
    expectedRevision: current.revision,
    changes: {
      description: {
        before: current.definition.description,
        after: '这是一份由 Agent 提议、玩家批准的本机角色描述。',
      },
      openings: {
        before: current.definition.openings,
        after: ['新的默认开场。', ...current.definition.openings.slice(1)],
      },
    },
  })

  assert.equal(result.outcome, 'applied')
  assert.equal(result.value.revision, '1')
  assert.equal(library.get(imported.id).localEdits, true)
  assert.equal(library.get(imported.id).content.description, '这是一份由 Agent 提议、玩家批准的本机角色描述。')
  assert.equal(library.get(imported.id).content.firstMessage, '新的默认开场。')
  assert.deepEqual(library.asset(imported.id).data, sourceBytes)
  assert.equal(parseCharacterCardJsonBytes(library.asset(imported.id).data).description, card.description)
})

test('native rejection leaves the actor untouched and replays as rejected', async (context) => {
  const { ctx, provider } = await mounted(() => 'rejected')
  context.after(async () => { await ctx.fiber.dispose() })
  const { session, agent } = openSession('actor-revision-rejected')
  const callId = 'revise-actor-rejected'
  const args = { actorId: ACTOR.id, revision: '1', changes: CHANGES }
  const callSeq = appendCall(session, callId, ROLEPLAY_ACTOR_REVISION_TOOL, args)

  const result = await ctx.tools.execute({
    callId: ToolCallId(callId), name: ROLEPLAY_ACTOR_REVISION_TOOL,
    arguments: args, agent, signal: new AbortController().signal,
  })
  appendResult(session, callId, callSeq, result)

  assert.equal(result.isError, true)
  assert.equal(provider.reviseCount(), 0)
  assert.deepEqual(provider.current().definition, BASE_DEFINITION)
  const asked = session.events.find(event => event.type === 'approval/asked')
  assert.equal(asked?.type, 'approval/asked')
  if (asked?.type === 'approval/asked') {
    assert.equal(asked.data.toolName, ROLEPLAY_ACTOR_REVISION_TOOL)
    assert.equal(String(asked.data.callId), callId)
    assert.match(asked.data.reason ?? '', /角色描述、性格/u)
  }
  assert.deepEqual(readRoleplayActorRevisionAttempts(session.events).map(value => value.settlement), ['rejected'])
})

test('one-shot approval applies the exact diff and is reconstructable from the Session Log', async (context) => {
  const { ctx, provider } = await mounted(() => 'allowed-once')
  context.after(async () => { await ctx.fiber.dispose() })
  const { session, agent } = openSession('actor-revision-applied')
  const callId = 'revise-actor-applied'
  const args = { actorId: ACTOR.id, revision: '1', changes: CHANGES }
  const callSeq = appendCall(session, callId, ROLEPLAY_ACTOR_REVISION_TOOL, args)

  const result = await ctx.tools.execute({
    callId: ToolCallId(callId), name: ROLEPLAY_ACTOR_REVISION_TOOL,
    arguments: args, agent, signal: new AbortController().signal,
  })
  appendResult(session, callId, callSeq, result)

  assert.equal(result.isError, false)
  assert.equal(provider.reviseCount(), 1)
  assert.equal(provider.current().revision, '2')
  assert.equal(provider.current().definition.description, CHANGES.description.after)
  assert.equal(provider.current().definition.personality, CHANGES.personality.after)
  const attempts = readRoleplayActorRevisionAttempts(session.events)
  assert.equal(attempts.length, 1)
  assert.deepEqual(attempts[0], {
    callId,
    sourceEventSeq: callSeq,
    input: args,
    settlement: 'applied',
    result: {
      version: 0,
      outcome: 'applied',
      actorName: '白露',
      baseRevision: '1',
      revision: '2',
      changedFields: ['description', 'personality'],
    },
  })
  assert.deepEqual(
    readRoleplayActorRevisionAttempts(Session.create(SessionId('actor-revision-replay'), session.events).events),
    attempts,
  )
})

test('a concurrent local revision after approval was shown settles as conflict without overwrite', async (context) => {
  const { ctx, provider } = await mounted((state) => {
    state.replace({ ...BASE_DEFINITION, scenario: '已经由另一处改为晴天。' })
    return 'allowed-once'
  })
  context.after(async () => { await ctx.fiber.dispose() })
  const { session, agent } = openSession('actor-revision-conflict')
  const callId = 'revise-actor-conflict'
  const args = { actorId: ACTOR.id, revision: '1', changes: CHANGES }
  const callSeq = appendCall(session, callId, ROLEPLAY_ACTOR_REVISION_TOOL, args)

  const result = await ctx.tools.execute({
    callId: ToolCallId(callId), name: ROLEPLAY_ACTOR_REVISION_TOOL,
    arguments: args, agent, signal: new AbortController().signal,
  })
  appendResult(session, callId, callSeq, result)

  assert.equal(result.isError, false)
  if (result.isError) throw new Error('conflict unexpectedly became a tool error')
  assert.equal(parseRoleplayActorRevisionResult(result.value).outcome, 'conflict')
  assert.equal(provider.reviseCount(), 0)
  assert.equal(provider.current().definition.scenario, '已经由另一处改为晴天。')
  assert.equal(provider.current().definition.description, BASE_DEFINITION.description)
  assert.deepEqual(readRoleplayActorRevisionAttempts(session.events).map(value => value.settlement), ['conflict'])
})
