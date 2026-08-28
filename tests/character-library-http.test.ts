import assert from 'node:assert/strict'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { CharacterLibrary } from '../src/character-library.ts'
import { installCharacterLibraryHttp } from '../src/character-library-http.ts'
import { CHARACTER_LIBRARY_PATH } from '../src/character-library-protocol.ts'
import { CharacterWorldBindingStore } from '../src/character-world-binding-store.ts'
import type { AgentRpHttpServer } from '../src/host-http.ts'
import { WorldInfoLibrary } from '../src/world-info-library.ts'

type RegisteredRoute = Parameters<AgentRpHttpServer['register']>[0]

function routeFor(library: CharacterLibrary, sessions: () => readonly SessionEvent[]): RegisteredRoute {
  let route: RegisteredRoute | undefined
  const routeCtx = { effect(register: () => unknown) { register() } } as unknown as Context
  const sessionId = SessionId('character-library-reference')
  const hostCtx = {
    get(name: string) {
      if (name !== 'sessionPersistence') return undefined
      return {
        async listSnapshots() {
          return sessions().length === 0 ? [] : [{ header: { id: sessionId }, revision: 'revision-1' }]
        },
        async inspect(id: SessionId) {
          assert.equal(id, sessionId)
          return { events: sessions() }
        },
      }
    },
  } as unknown as Context
  const server: AgentRpHttpServer = {
    register(next) {
      route = next
      return () => {}
    },
  }
  installCharacterLibraryHttp(routeCtx, hostCtx, library, server)
  assert.ok(route)
  return route
}

async function remove(route: RegisteredRoute, id: string): Promise<{ readonly status: number; readonly json: unknown }> {
  const headers = {
    host: '127.0.0.1:3091', origin: 'http://127.0.0.1:3091', 'sec-fetch-site': 'same-origin',
  } satisfies IncomingHttpHeaders
  const request = Object.assign(Readable.from([]), {
    method: 'DELETE', headers, url: `${CHARACTER_LIBRARY_PATH}/${encodeURIComponent(id)}`,
  }) as unknown as IncomingMessage
  let status: number | undefined
  let body = Buffer.alloc(0)
  const response = {
    writeHead(value: number) { status = value; return response },
    end(value?: string | Uint8Array) { if (value !== undefined) body = Buffer.from(value); return response },
  } as unknown as ServerResponse
  await route.handler(request, response)
  assert.notEqual(status, undefined)
  return { status: status!, json: JSON.parse(body.toString('utf8')) as unknown }
}

async function postJson(
  route: RegisteredRoute,
  path: string,
  value: unknown,
): Promise<{ readonly status: number; readonly json: unknown }> {
  const headers = {
    host: '127.0.0.1:3091', origin: 'http://127.0.0.1:3091', 'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
  } satisfies IncomingHttpHeaders
  const request = Object.assign(Readable.from([JSON.stringify(value)]), {
    method: 'POST', headers, url: `${CHARACTER_LIBRARY_PATH}${path}`,
  }) as unknown as IncomingMessage
  let status: number | undefined
  let body = Buffer.alloc(0)
  const response = {
    writeHead(next: number) { status = next; return response },
    end(next?: string | Uint8Array) { if (next !== undefined) body = Buffer.from(next); return response },
  } as unknown as ServerResponse
  await route.handler(request, response)
  assert.notEqual(status, undefined)
  return { status: status!, json: JSON.parse(body.toString('utf8')) as unknown }
}

test('permanently deletes only an archived Character Card unused by stable Session history', async context => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-character-delete-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const data = new Uint8Array(readFileSync('tests/fixtures/manual-character-card.json'))
  const library = new CharacterLibrary({ root })
  const imported = library.importFile({ data, filename: '白露.json', mediaType: 'application/json' })
  let events: readonly SessionEvent[] = []
  const route = routeFor(library, () => events)

  assert.equal((await remove(route, imported.id)).status, 400)
  library.replaceText(imported.id, '门还没锁', '门没有锁')
  library.archive(imported.id)
  events = [{
    type: 'agent-rp/character-card-seed', seq: 0, time: 1_800_000_000_000,
    data: {
      format: 0,
      source: { characterLibraryId: imported.id },
      meta: { format: 0, result: {}, raw: {} },
    },
  } as SessionEvent]

  const referenced = await remove(route, imported.id)
  assert.equal(referenced.status, 409)
  assert.match(JSON.stringify(referenced.json), /1 个历史会话/u)
  assert.equal(library.get(imported.id).archived, true)

  events = []
  assert.deepEqual(await remove(route, imported.id), { status: 200, json: { format: 0, id: imported.id } })
  assert.deepEqual(readdirSync(root), [])
  assert.throws(() => library.get(imported.id), /角色库中没有/u)

  const reimported = library.importFileWithOutcome({ data, filename: '白露.json', mediaType: 'application/json' })
  assert.equal(reimported.outcome, 'created')
  assert.equal(reimported.entry.id, imported.id)
  assert.equal(reimported.entry.localCorrectionCount, 0)
})

test('updates a complete character world composition through the Host and rejects stale replacement', async context => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-character-world-http-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const bindings = new CharacterWorldBindingStore({ root: join(root, 'bindings') })
  const worlds = new WorldInfoLibrary({ root: join(root, 'worlds'), bindings })
  const library = new CharacterLibrary({ root: join(root, 'characters'), worldInfoLibrary: worlds, worldBindings: bindings })
  const character = library.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-character-card.json')),
    filename: '白露.json',
    mediaType: 'application/json',
  })
  const world = worlds.importFile({
    data: new Uint8Array(readFileSync('tests/fixtures/manual-world-info.json')),
    filename: '海城.json',
  })
  const revision = library.get(character.id).worldBinding!.revision
  const route = routeFor(library, () => [])
  const request = {
    format: 0,
    revision,
    primaryWorldInfoId: world.id,
    additionalWorldInfoIds: [],
  }

  assert.equal((await postJson(route, `/${encodeURIComponent(character.id)}/world-binding`, {
    ...request,
    primaryWorldInfoId: `world-info-${'0'.repeat(32)}`,
  })).status, 400)
  assert.equal(library.get(character.id).worldBinding?.revision, revision)
  const updated = await postJson(route, `/${encodeURIComponent(character.id)}/world-binding`, request)
  assert.equal(updated.status, 200)
  assert.equal((updated.json as { entry: { worldBinding: { primary: { worldInfoId: string } } } })
    .entry.worldBinding.primary.worldInfoId, world.id)
  assert.equal((await postJson(route, `/${encodeURIComponent(character.id)}/world-binding`, {
    ...request,
    primaryWorldInfoId: null,
  })).status, 409)
  assert.equal(library.get(character.id).worldBinding?.primary?.worldInfoId, world.id)
})
