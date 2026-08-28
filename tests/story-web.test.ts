import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { parseStoryVoiceDocument } from '../src/story-voice-evidence.ts'
import {
  fetchStoryWebPage,
  normalizeStoryWebUrl,
  renderStoryWebPageBody,
  storyWebFetchAvailable,
  storyWebSearchAvailable,
} from '../src/story-web.ts'

test('accepts only credential-free HTTP(S) URLs before calling the Host provider', async () => {
  let calls = 0
  const ctx = {
    get(name: string) {
      assert.equal(name, 'web')
      return {
        async fetch(request: { readonly url: string }) {
          calls += 1
          return {
            url: request.url,
            statusCode: 200,
            body: { kind: 'text' as const, content: '正文' },
            truncated: false,
          }
        },
      }
    },
  } as unknown as Context

  assert.equal(normalizeStoryWebUrl('HTTPS://Example.test/chapter?q=1'), 'https://example.test/chapter?q=1')
  assert.equal(normalizeStoryWebUrl('https://name:secret@example.test/chapter'), undefined)
  assert.equal(normalizeStoryWebUrl('file:///tmp/chapter.txt'), undefined)
  assert.equal(normalizeStoryWebUrl('javascript:alert(1)'), undefined)
  await assert.rejects(fetchStoryWebPage(ctx, 'https://name:secret@example.test/chapter'), /不含账号密码/u)
  await assert.rejects(fetchStoryWebPage(ctx, 'javascript:alert(1)'), /HTTP\(S\)/u)
  assert.equal(calls, 0)
  assert.equal(storyWebFetchAvailable(ctx), true)
  assert.equal(storyWebSearchAvailable(ctx), false)
})

test('cleans active HTML and enforces the durable source byte limit', async () => {
  const cleaned = renderStoryWebPageBody({
    kind: 'html',
    content: '<main><h1>第一章 &amp; 开始</h1><!--藏起来--><p>灵梦&nbsp;出场。</p><script>steal()</script><style>.bad{}</style><iframe>别读</iframe><p>魔理沙回应。</p></main>',
  })
  assert.equal(cleaned.content, '第一章 & 开始\n\n灵梦 出场。\n\n魔理沙回应。')
  assert.equal(cleaned.truncated, false)

  const bounded = renderStoryWebPageBody({ kind: 'text', content: '灵'.repeat(40_000) })
  assert.equal(bounded.truncated, true)
  assert.ok(Buffer.byteLength(bounded.content, 'utf8') <= 48 * 1_024)
  assert.ok(bounded.content.length > 0)
})

test('preserves semantic Web dialogue as explicit speaker-labelled evidence', () => {
  const rendered = renderStoryWebPageBody({
    kind: 'html',
    content: [
      '<article><div class="dialogue-card">',
      '<div class="dialogue-char">博麗霊夢</div>',
      '<div class="dialogue-content"><div class="poem"><p>先走一步。<br />别落后。</p></div></div>',
      '</div></article>',
    ].join(''),
  })
  assert.deepEqual(rendered, {
    content: '博麗霊夢：「先走一步。 别落后。」',
    truncated: false,
  })
})

test('recovers blocked MediaWiki pages through bounded top-level sections', async () => {
  const pageUrl = 'https://wiki.example.test/wiki/%E8%A7%92%E8%89%B2%E5%AF%B9%E8%AF%9D'
  const calls: string[] = []
  const ctx = {
    get() {
      return {
        async fetch(request: { readonly url: string }) {
          calls.push(request.url)
          if (request.url === pageUrl) {
            return {
              url: request.url,
              statusCode: 468,
              body: { kind: 'html' as const, content: '<main>访问校验</main>' },
              truncated: false,
            }
          }
          const url = new URL(request.url)
          assert.equal(url.pathname, '/api.php')
          assert.equal(url.searchParams.get('page'), '角色对话')
          const section = url.searchParams.get('section')
          const content = section === null
            ? JSON.stringify({ parse: { sections: [
                { index: '1', level: '2' },
                { index: '2', level: '3' },
                { index: '3', level: '2' },
              ] } })
            : JSON.stringify({ parse: { text: section === '1'
                ? '<div class="dialogue-char">霧雨魔理沙</div><div class="dialogue-content"><p>先确认线索。</p></div>'
                : `<p>第 ${section} 节</p>` } })
          return {
            url: request.url,
            statusCode: 200,
            body: { kind: 'text' as const, content },
            truncated: false,
          }
        },
      }
    },
  } as unknown as Context

  const page = await fetchStoryWebPage(ctx, pageUrl)
  assert.equal(page.statusCode, 200)
  assert.equal(page.url, pageUrl)
  assert.equal(page.requestedUrl, pageUrl)
  assert.equal(page.truncated, false)
  assert.match(page.content, /霧雨魔理沙：「先确认线索。」/u)
  assert.match(page.content, /第 0 节/u)
  assert.match(page.content, /第 3 节/u)
  assert.equal(calls.some(call => new URL(call).searchParams.get('section') === '2'), false)
  assert.equal(calls.length, 5)
  assert.deepEqual(parseStoryVoiceDocument(page.content).orderedLines.map(line => ({
    speaker: line.speaker,
    dialogue: line.dialogue,
  })), [{ speaker: '霧雨魔理沙', dialogue: '先确认线索。' }])
})

test('requires a fetch-capable Host and a valid final URL', async () => {
  const missing = { get: () => ({ search: async () => ({ sources: [], truncated: false }) }) } as unknown as Context
  assert.equal(storyWebFetchAvailable(missing), false)
  await assert.rejects(fetchStoryWebPage(missing, 'https://example.test/chapter'), /没有可用的网页正文读取能力/u)

  const invalidRedirect = {
    get: () => ({
      fetch: async () => ({
        url: 'file:///private/chapter.txt',
        statusCode: 200,
        body: { kind: 'text' as const, content: '正文' },
        truncated: false,
      }),
    }),
  } as unknown as Context
  await assert.rejects(fetchStoryWebPage(invalidRedirect, 'https://example.test/chapter'), /无效的最终 URL/u)
})
