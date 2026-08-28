import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentRpHttpServer } from '../src/host-http.ts'
import { installStoryWorkspaceHttp } from '../src/story-workspace-http.ts'
import type { StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'
import { StoryWorkspaceStore } from '../src/story-workspace.ts'
import { searchStoryVoiceSourceExcerpts } from '../src/story-voice-retrieval.ts'

type RegisteredRoute = Parameters<AgentRpHttpServer['register']>[0]

function storyWorkspaceRoute(store: StoryWorkspaceStore, web?: unknown): RegisteredRoute {
  const routes: RegisteredRoute[] = []
  const ctx = {
    effect(register: () => unknown) { register() },
    get(name: string) {
      if (name === 'web' && web !== undefined) return web
      throw new Error('not registered')
    },
  } as unknown as Context
  const server: AgentRpHttpServer = { register(route) { routes.push(route); return () => {} } }
  installStoryWorkspaceHttp(ctx, store, server)
  const route = routes.find(candidate => candidate.kind === 'prefix')
  assert.ok(route)
  return route
}

async function invoke(
  route: RegisteredRoute,
  method: string,
  url: string,
  body: unknown,
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const request = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method,
    url,
    headers: {
      host: '127.0.0.1:3181',
      origin: 'http://127.0.0.1:3181',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
  }) as unknown as IncomingMessage
  let status = 0
  let responseBody = Buffer.alloc(0)
  const response = {
    setHeader() { return response },
    writeHead(value: number) { status = value; return response },
    end(value?: string | Uint8Array) {
      if (value !== undefined) responseBody = Buffer.from(value)
      return response
    },
  } as unknown as ServerResponse
  await route.handler(request, response)
  return { status, body: JSON.parse(responseBody.toString('utf8')) as Record<string, unknown> }
}

test('imports known pages with revision guards, provenance, and explicit voice eligibility', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-url-source-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: '网页资料场地' })
  const calls: string[] = []
  const web = {
    async fetch(request: { readonly url: string }) {
      calls.push(request.url)
      const original = request.url.endsWith('/original')
      return {
        url: original ? 'https://archive.example.test/reimu' : 'https://archive.example.test/reference',
        statusCode: 200,
        body: {
          kind: 'html' as const,
          content: original
            ? '<article><p>博麗霊夢：「先把原文看清楚。」</p><script>ignore()</script></article>'
            : '<article><p>博麗霊夢：「这句参考摘录不能冒充原作。」</p><iframe>ignore</iframe></article>',
        },
        truncated: false,
      }
    },
  }
  const route = storyWorkspaceRoute(store, web)
  const path = `/api/agent-rp/story-workspaces/${encodeURIComponent(created.id)}/sources/url`

  const reference = await invoke(route, 'POST', path, {
    format: 0,
    revision: created.revision,
    url: 'https://source.example.test/reference',
    name: '设定百科',
    kind: 'reference',
  })
  assert.equal(reference.status, 201)
  const referenced = (reference.body.workspace as StoryWorkspaceSnapshot)
  const referenceSource = referenced.sources[0]
  assert.equal(referenceSource?.name, '设定百科')
  assert.equal(referenceSource?.kind, 'reference')
  assert.equal(referenceSource?.content, '博麗霊夢：「这句参考摘录不能冒充原作。」')
  assert.deepEqual(referenceSource?.origin, {
    kind: 'url',
    url: 'https://archive.example.test/reference',
    requestedUrl: 'https://source.example.test/reference',
    truncated: false,
  })
  assert.equal(searchStoryVoiceSourceExcerpts(referenced.sources, ['博麗霊夢'], {
    primary: '看清原文', context: '参考摘录',
  }).length, 0)

  const callsBeforeConflict = calls.length
  const conflict = await invoke(route, 'POST', path, {
    format: 0,
    revision: created.revision,
    url: 'https://source.example.test/stale',
    kind: 'original',
  })
  assert.equal(conflict.status, 409)
  assert.equal(calls.length, callsBeforeConflict)
  assert.equal(store.get(created.id).sources.length, 1)

  const original = await invoke(route, 'POST', path, {
    format: 0,
    revision: referenced.revision,
    url: 'https://source.example.test/original',
    kind: 'original',
  })
  assert.equal(original.status, 201)
  const imported = original.body.workspace as StoryWorkspaceSnapshot
  assert.equal(imported.sources[1]?.kind, 'original')
  const voice = searchStoryVoiceSourceExcerpts(imported.sources, ['博麗霊夢'], {
    primary: '看清原文', context: '确认资料',
  })
  assert.deepEqual(voice.map(item => item.sourceId), [imported.sources[1]?.id])
  assert.match(voice[0]?.text ?? '', /先把原文看清楚/u)
  assert.doesNotMatch(voice[0]?.text ?? '', /不能冒充原作/u)
})

test('rejects unsafe, unavailable, and unsuccessful URL imports without changing the workspace', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-url-source-reject-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: '拒绝网页资料' })
  const path = `/api/agent-rp/story-workspaces/${encodeURIComponent(created.id)}/sources/url`

  const unavailable = await invoke(storyWorkspaceRoute(store), 'POST', path, {
    format: 0, revision: created.revision, url: 'https://example.test/chapter', kind: 'reference',
  })
  assert.equal(unavailable.status, 503)

  let calls = 0
  const route = storyWorkspaceRoute(store, {
    async fetch(request: { readonly url: string }) {
      calls += 1
      return {
        url: request.url,
        statusCode: 404,
        body: { kind: 'text' as const, content: 'not found' },
        truncated: false,
      }
    },
  })
  const unsafe = await invoke(route, 'POST', path, {
    format: 0, revision: created.revision, url: 'https://name:secret@example.test/chapter', kind: 'reference',
  })
  assert.equal(unsafe.status, 400)
  assert.equal(calls, 0)
  const missing = await invoke(route, 'POST', path, {
    format: 0, revision: created.revision, url: 'https://example.test/missing', kind: 'reference',
  })
  assert.equal(missing.status, 502)
  assert.equal(calls, 1)
  assert.equal(store.get(created.id).sources.length, 0)
})

test('promotes a research result with fresh page text and its original search provenance', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-research-source-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: '网络研究场地' })
  const researched = store.materializeTurn(created.id, {
    key: 'research-turn',
    turn: 3,
    title: '研究回合',
    summary: '',
    evidence: '',
    participantIds: [],
    changes: { characters: [], facts: [], nodes: [], edges: [] },
    webResearch: [{
      kind: 'web',
      url: 'https://search.example.test/reimu',
      query: '博丽灵梦 原作台词',
      sessionId: 'session-research',
      turn: 3,
      resultEventSeq: 42,
      title: '灵梦原作对话',
      snippet: '搜索结果里的短摘要。',
    }],
  })
  const item = researched.researchInbox[0]!
  const path = `/api/agent-rp/story-workspaces/${encodeURIComponent(created.id)}/sources/research`
  const unavailable = await invoke(storyWorkspaceRoute(store), 'POST', path, {
    format: 0,
    revision: researched.revision,
    itemId: item.id,
  })
  assert.equal(unavailable.status, 503)
  assert.equal(store.get(created.id).researchInbox.length, 1)

  let calls = 0
  const route = storyWorkspaceRoute(store, {
    async fetch(request: { readonly url: string }) {
      calls += 1
      assert.equal(request.url, item.url)
      return {
        url: 'https://archive.example.test/reimu',
        statusCode: 200,
        body: { kind: 'html' as const, content: '<main>博麗霊夢：「ちゃんと原文を読みなさい。」</main>' },
        truncated: true,
      }
    },
  })
  const accepted = await invoke(route, 'POST', path, {
    format: 0,
    revision: researched.revision,
    itemId: item.id,
  })
  assert.equal(accepted.status, 201)
  assert.equal(calls, 1)
  const sourceImport = accepted.body.sourceImport as { readonly sourceId?: unknown; readonly truncated?: unknown }
  assert.equal(typeof sourceImport.sourceId, 'string')
  assert.equal(sourceImport.truncated, true)
  const workspace = accepted.body.workspace as StoryWorkspaceSnapshot
  assert.equal(workspace.researchInbox.length, 0)
  assert.equal(workspace.sources[0]?.content, '博麗霊夢：「ちゃんと原文を読みなさい。」')
  assert.deepEqual(workspace.sources[0]?.origin, {
    kind: 'web',
    url: item.url,
    query: item.query,
    sessionId: item.sessionId,
    turn: item.turn,
    resultEventSeq: item.resultEventSeq,
  })

  const stale = await invoke(route, 'POST', path, {
    format: 0,
    revision: researched.revision,
    itemId: item.id,
  })
  assert.equal(stale.status, 409)
  assert.equal(calls, 1)
})
