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
import { findStorySourceQuoteMatches, splitStorySourcePassages } from '../src/story-source.ts'
import type { StoryWorkspaceSaveRequest, StoryWorkspaceSnapshot } from '../src/story-workspace-protocol.ts'
import { createStoryCitationId, createStorySourceId, StoryWorkspaceStore } from '../src/story-workspace.ts'
import { searchStoryVoiceSourceExcerpts } from '../src/story-voice-retrieval.ts'

type RegisteredRoute = Parameters<AgentRpHttpServer['register']>[0]

function editable(snapshot: StoryWorkspaceSnapshot): StoryWorkspaceSaveRequest {
  return {
    format: 2,
    id: snapshot.id,
    revision: snapshot.revision,
    name: snapshot.name,
    pipeline: snapshot.pipeline,
    graph: snapshot.graph,
    characters: snapshot.characters,
    facts: snapshot.facts,
    events: snapshot.events,
    outputs: snapshot.outputs,
    sources: snapshot.sources,
    citations: snapshot.citations,
    researchInbox: snapshot.researchInbox,
  }
}

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

test('recovers speaker-labelled dialogue from a successful MediaWiki page through its bounded API', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-mediawiki-source-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: 'MediaWiki 对话资料' })
  const requestedUrl = 'https://thwiki.example.test/游戏对话:测试作品/博丽灵梦'
  const calls: string[] = []
  const route = storyWorkspaceRoute(store, {
    async fetch(request: { readonly url: string }) {
      calls.push(request.url)
      const url = new URL(request.url)
      if (url.pathname !== '/api.php') {
        return {
          url: request.url,
          statusCode: 200,
          body: { kind: 'text' as const, content: '测试作品 游戏对话 見れば判るわよ 村里出大事了' },
          truncated: false,
        }
      }
      const prop = url.searchParams.get('prop')
      const section = url.searchParams.get('section')
      const payload = prop === 'sections'
        ? { parse: { sections: [{ index: '1', level: '2' }] } }
        : section === '0'
          ? { parse: { text: '<p>测试作品</p>' } }
          : { parse: { text: '<p>雾雨魔理沙：「村里出大事了！」</p><p>博丽灵梦：「这不是看一眼就知道了吗！」</p>' } }
      return {
        url: request.url,
        statusCode: 200,
        body: { kind: 'text' as const, content: JSON.stringify(payload) },
        truncated: false,
      }
    },
  })
  const path = `/api/agent-rp/story-workspaces/${encodeURIComponent(created.id)}/sources/url`
  const response = await invoke(route, 'POST', path, {
    format: 0,
    revision: created.revision,
    url: requestedUrl,
    name: '原作对话',
    kind: 'original',
  })

  assert.equal(response.status, 201)
  assert.equal(calls.length, 4)
  assert.equal(calls.filter(url => new URL(url).pathname === '/api.php').length, 3)
  const workspace = response.body.workspace as StoryWorkspaceSnapshot
  assert.match(workspace.sources[0]?.content ?? '', /雾雨魔理沙：「村里出大事了！」/u)
  assert.match(workspace.sources[0]?.content ?? '', /博丽灵梦：「这不是看一眼就知道了吗！」/u)
  const voice = searchStoryVoiceSourceExcerpts(workspace.sources, ['博丽灵梦'], {
    primary: '看一眼就知道',
    context: '村里出大事',
  })
  assert.equal(voice.length, 1)
  assert.match(voice[0]?.text ?? '', /这不是看一眼就知道了吗/u)
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

test('refreshes a URL source in place and preserves citation evidence across relocation and failures', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-agent-rp-url-source-refresh-'))
  context.after(() => { rmSync(root, { recursive: true, force: true }) })
  const store = new StoryWorkspaceStore({ root })
  const created = store.create({ format: 2, name: '网页资料刷新场地' })
  const requestedUrl = 'https://source.example.test/chapter'
  const initialContent = '第一段唯一证据。\n第二段重复证据。\n第三段即将消失。'
  const refreshedContent = '新开场。\n第一段唯一证据。\n第二段重复证据。这里又写一次第二段重复证据。\n插入内容。\n收尾。'
  let phase: 'initial' | 'refresh' | 'throw' | 'missing' = 'initial'
  const calls: string[] = []
  const route = storyWorkspaceRoute(store, {
    async fetch(request: { readonly url: string }) {
      calls.push(request.url)
      assert.equal(request.url, requestedUrl)
      if (phase === 'throw') throw new Error('temporary network failure')
      if (phase === 'missing') {
        return {
          url: request.url,
          statusCode: 404,
          body: { kind: 'text' as const, content: 'not found' },
          truncated: false,
        }
      }
      return {
        url: phase === 'initial'
          ? 'https://archive.example.test/chapter-v1'
          : 'https://archive.example.test/chapter-v2',
        statusCode: 200,
        body: { kind: 'text' as const, content: phase === 'initial' ? initialContent : refreshedContent },
        truncated: phase === 'refresh',
      }
    },
  })
  const importPath = `/api/agent-rp/story-workspaces/${encodeURIComponent(created.id)}/sources/url`
  const importedResponse = await invoke(route, 'POST', importPath, {
    format: 0,
    revision: created.revision,
    url: requestedUrl,
    name: '会更新的章节',
    kind: 'original',
  })
  assert.equal(importedResponse.status, 201)
  const imported = importedResponse.body.workspace as StoryWorkspaceSnapshot
  const source = imported.sources[0]!
  const initialPassages = splitStorySourcePassages(source)
  const uniquePassage = initialPassages.find(passage => passage.text.includes('第一段唯一证据。'))!
  const ambiguousPassage = initialPassages.find(passage => passage.text.includes('第二段重复证据。'))!
  const missingPassage = initialPassages.find(passage => passage.text.includes('第三段即将消失。'))!
  const localSource = {
    id: createStorySourceId(),
    name: '本地资料',
    kind: 'reference' as const,
    enabled: true,
    content: '本地证据。',
  }
  const uniqueCitationId = createStoryCitationId()
  const ambiguousCitationId = createStoryCitationId()
  const missingCitationId = createStoryCitationId()
  const localCitationId = createStoryCitationId()
  const prepared = store.save({
    ...editable(imported),
    sources: [...imported.sources, localSource],
    citations: [{
      id: uniqueCitationId,
      sourceId: source.id,
      locator: uniquePassage.locator,
      quote: '第一段唯一证据。',
      note: '应迁移定位',
    }, {
      id: ambiguousCitationId,
      sourceId: source.id,
      locator: ambiguousPassage.locator,
      quote: '第二段重复证据。',
      note: '应保留旧定位',
    }, {
      id: missingCitationId,
      sourceId: source.id,
      locator: missingPassage.locator,
      quote: '第三段即将消失。',
      note: '应保留原句快照',
    }, {
      id: localCitationId,
      sourceId: localSource.id,
      locator: '第 1 段',
      quote: '本地证据。',
      note: '其他资料不受影响',
    }],
  })
  const citationsBeforeRefresh = prepared.citations.map(citation => ({ ...citation }))
  phase = 'refresh'
  const refreshPath = `/api/agent-rp/story-workspaces/${encodeURIComponent(created.id)}/sources/${encodeURIComponent(source.id)}/refresh`
  const refreshedResponse = await invoke(route, 'POST', refreshPath, {
    format: 0,
    revision: prepared.revision,
    sourceId: source.id,
  })
  assert.equal(refreshedResponse.status, 200)
  assert.equal(calls.length, 2)
  const refreshed = refreshedResponse.body.workspace as StoryWorkspaceSnapshot
  assert.equal(refreshed.sources.length, prepared.sources.length)
  assert.equal(refreshed.sources[0]?.id, source.id)
  assert.equal(refreshed.sources[0]?.content, refreshedContent)
  assert.deepEqual(refreshed.sources[0]?.origin, {
    kind: 'url',
    url: 'https://archive.example.test/chapter-v2',
    requestedUrl,
    truncated: true,
  })
  assert.deepEqual(refreshed.sources[1], localSource)
  assert.deepEqual(
    refreshed.citations.map(citation => ({ id: citation.id, quote: citation.quote })),
    citationsBeforeRefresh.map(citation => ({ id: citation.id, quote: citation.quote })),
  )
  const expectedUniqueLocator = splitStorySourcePassages(refreshed.sources[0]!)
    .find(passage => passage.text.includes('第一段唯一证据。'))!.locator
  assert.notEqual(expectedUniqueLocator, uniquePassage.locator)
  assert.equal(refreshed.citations.find(citation => citation.id === uniqueCitationId)?.locator, expectedUniqueLocator)
  assert.equal(refreshed.citations.find(citation => citation.id === ambiguousCitationId)?.locator, ambiguousPassage.locator)
  assert.equal(refreshed.citations.find(citation => citation.id === missingCitationId)?.locator, missingPassage.locator)
  assert.deepEqual(refreshed.citations.find(citation => citation.id === uniqueCitationId)?.refreshReview, {
    kind: 'relocated',
    previousLocator: uniquePassage.locator,
  })
  assert.deepEqual(refreshed.citations.find(citation => citation.id === ambiguousCitationId)?.refreshReview, {
    kind: 'ambiguous',
    previousLocator: ambiguousPassage.locator,
  })
  assert.deepEqual(refreshed.citations.find(citation => citation.id === missingCitationId)?.refreshReview, {
    kind: 'missing',
    previousLocator: missingPassage.locator,
  })
  assert.deepEqual(refreshed.citations.find(citation => citation.id === localCitationId), citationsBeforeRefresh[3])
  assert.deepEqual(new StoryWorkspaceStore({ root }).get(created.id).citations, refreshed.citations)
  const ambiguousMatches = findStorySourceQuoteMatches(splitStorySourcePassages(refreshed.sources[0]!), '第二段重复证据。')
  assert.equal(ambiguousMatches.length, 1)
  assert.equal(ambiguousMatches[0]?.occurrenceCount, 2)
  assert.deepEqual(refreshedResponse.body.sourceRefresh, {
    sourceId: source.id,
    truncated: true,
    citationCount: 3,
    relocatedCitationIds: [uniqueCitationId],
    ambiguousCitationIds: [ambiguousCitationId],
    missingCitationIds: [missingCitationId],
  })

  const stabilizedResponse = await invoke(route, 'POST', refreshPath, {
    format: 0,
    revision: refreshed.revision,
    sourceId: source.id,
  })
  assert.equal(stabilizedResponse.status, 200)
  const stabilized = stabilizedResponse.body.workspace as StoryWorkspaceSnapshot
  assert.equal(stabilized.citations.find(citation => citation.id === uniqueCitationId)?.refreshReview, undefined)
  assert.equal(stabilized.citations.find(citation => citation.id === ambiguousCitationId)?.refreshReview?.kind, 'ambiguous')
  assert.equal(stabilized.citations.find(citation => citation.id === missingCitationId)?.refreshReview?.kind, 'missing')

  const callsBeforeConflict = calls.length
  const stale = await invoke(route, 'POST', refreshPath, {
    format: 0,
    revision: prepared.revision,
    sourceId: source.id,
  })
  assert.equal(stale.status, 409)
  assert.equal(calls.length, callsBeforeConflict)
  assert.deepEqual(store.get(created.id), stabilized)

  phase = 'throw'
  const beforeThrownFetch = store.get(created.id)
  const thrownFetch = await invoke(route, 'POST', refreshPath, {
    format: 0,
    revision: beforeThrownFetch.revision,
    sourceId: source.id,
  })
  assert.equal(thrownFetch.status, 502)
  assert.deepEqual(store.get(created.id), beforeThrownFetch)

  phase = 'missing'
  const beforeMissingPage = store.get(created.id)
  const missingPage = await invoke(route, 'POST', refreshPath, {
    format: 0,
    revision: beforeMissingPage.revision,
    sourceId: source.id,
  })
  assert.equal(missingPage.status, 502)
  assert.deepEqual(store.get(created.id), beforeMissingPage)

  const callsBeforeLocalSource = calls.length
  const localRefresh = await invoke(route, 'POST',
    `/api/agent-rp/story-workspaces/${encodeURIComponent(created.id)}/sources/${encodeURIComponent(localSource.id)}/refresh`, {
      format: 0,
      revision: beforeMissingPage.revision,
      sourceId: localSource.id,
    })
  assert.equal(localRefresh.status, 400)
  assert.equal(calls.length, callsBeforeLocalSource)
  assert.deepEqual(store.get(created.id), beforeMissingPage)

  const reviewed = store.get(created.id)
  const resolved = store.save({
    ...editable(reviewed),
    citations: reviewed.citations.map(citation => {
      if (citation.sourceId !== source.id) return citation
      const { refreshReview: _refreshReview, ...withoutReview } = citation
      return citation.id === ambiguousCitationId
        ? { ...withoutReview, locator: ambiguousMatches[0]!.passage.locator }
        : withoutReview
    }),
  })
  assert.equal(resolved.citations.find(citation => citation.id === ambiguousCitationId)?.locator, ambiguousMatches[0]?.passage.locator)
  assert.equal(resolved.citations.every(citation => citation.refreshReview === undefined), true)
  assert.deepEqual(new StoryWorkspaceStore({ root }).get(created.id).citations, resolved.citations)
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
