import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const writerModule = pathToFileURL(resolve(repositoryRoot, 'src/session-event-append.ts')).href
const projectionModule = pathToFileURL(resolve(repositoryRoot, 'src/projection.ts')).href

const writerSource = String.raw`
import { Session, SessionId } from '@deepseek-ai/dsh-session'

const { appendAgentRpSessionEvent } = await import(process.env.AGENT_RP_WRITER_MODULE)
const session = Session.create(SessionId('agent-rp-process-replay'))
appendAgentRpSessionEvent(session, 'agent-rp/state', {
  format: 0,
  id: 'state:restart-proof',
  revision: 1,
  ownerModuleId: 'roleplay:restart-proof',
  writerModuleId: 'roleplay:restart-proof',
  value: { phase: 'before-restart' },
})
process.stdout.write(JSON.stringify({ id: String(session.id), events: session.snapshotEvents() }))
`

const hostReaderSource = String.raw`
import { readFileSync } from 'node:fs'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

const input = JSON.parse(readFileSync(0, 'utf8'))
const session = Session.create(SessionId(input.id), input.events)
process.stdout.write(JSON.stringify({ id: String(session.id), events: session.snapshotEvents() }))
`

const projectorSource = String.raw`
import { readFileSync } from 'node:fs'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

const { agentRpProjectionDefinition } = await import(process.env.AGENT_RP_PROJECTION_MODULE)
const input = JSON.parse(readFileSync(0, 'utf8'))
const session = Session.create(SessionId(input.id), input.events)
let state = agentRpProjectionDefinition.init(session.header, session.inheritedEventCount)
for (const event of session.snapshotEvents()) {
  state = agentRpProjectionDefinition.apply(state, event)
}
process.stdout.write(JSON.stringify(agentRpProjectionDefinition.wire.view(state).nativeStates))
`

function runProcess(
  source: string,
  options: { readonly input?: string; readonly env?: NodeJS.ProcessEnv } = {},
): string {
  const result = spawnSync(process.execPath, [
    '--import',
    'tsx/esm',
    '--input-type=module',
    '--eval',
    source,
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    input: options.input,
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

test('survives a plugin write, a Host-only restart, and a fresh plugin projection', () => {
  const written = runProcess(writerSource, {
    env: { AGENT_RP_WRITER_MODULE: writerModule },
  })
  const reopened = runProcess(hostReaderSource, { input: written })
  const projected = JSON.parse(runProcess(projectorSource, {
    input: reopened,
    env: { AGENT_RP_PROJECTION_MODULE: projectionModule },
  }))

  assert.deepEqual(projected, [{
    id: 'state:restart-proof',
    revision: 1,
    ownerModuleId: 'roleplay:restart-proof',
    writerModuleId: 'roleplay:restart-proof',
    eventSeq: 0,
    value: { phase: 'before-restart' },
  }])
})
