/** Shared controlled-Web access and page normalization for story research. */

import type { Context } from '@deepseek-ai/cordis'

/** Web service fields consumed by story research and explicit source imports. */
export interface StoryWebGateway {
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
  fetch?(request: { readonly url: string }, signal?: AbortSignal): Promise<{
    readonly url: string
    readonly statusCode: number
    readonly body:
      | { readonly kind: 'html'; readonly content: string }
      | { readonly kind: 'text'; readonly content: string }
    readonly truncated: boolean
  }>
}

/** Bounded plain text returned by the Host Web provider. */
export interface StoryWebPage {
  readonly requestedUrl: string
  readonly url: string
  readonly statusCode: number
  readonly content: string
  readonly truncated: boolean
}

function webGateway(ctx: Context): Partial<StoryWebGateway> | undefined {
  const accessor = ctx as unknown as { readonly get?: (name: string) => unknown }
  if (typeof accessor.get !== 'function') return undefined
  try {
    return accessor.get('web') as Partial<StoryWebGateway> | undefined
  } catch {
    return undefined
  }
}

/** Return the configured search service when the Host exposes one. */
export function storyWebSearchGateway(ctx: Context): StoryWebGateway | undefined {
  const candidate = webGateway(ctx)
  return candidate !== undefined && typeof candidate.search === 'function'
    ? candidate as StoryWebGateway
    : undefined
}

/** Return the configured page reader when the Host exposes one. */
export function storyWebFetchGateway(ctx: Context): Required<Pick<StoryWebGateway, 'fetch'>> | undefined {
  const candidate = webGateway(ctx)
  return candidate !== undefined && typeof candidate.fetch === 'function'
    ? candidate as Required<Pick<StoryWebGateway, 'fetch'>>
    : undefined
}

/** Report whether the current Host context exposes a story-compatible Web search provider. */
export function storyWebSearchAvailable(ctx: Context): boolean {
  return storyWebSearchGateway(ctx) !== undefined
}

/** Report whether the current Host context exposes bounded HTTP(S) page retrieval. */
export function storyWebFetchAvailable(ctx: Context): boolean {
  return storyWebFetchGateway(ctx) !== undefined
}

/** Normalize one credential-free HTTP(S) URL or reject it without network access. */
export function normalizeStoryWebUrl(value: string): string | undefined {
  if (value.length > 4_096) return undefined
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.password === ''
      ? url.href
      : undefined
  } catch {
    return undefined
  }
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

const STORY_WEB_SOURCE_BYTES = 96 * 1_024
const STORY_WEB_OUTPUT_BYTES = 48 * 1_024
const MEDIAWIKI_SECTION_LIMIT = 48
const MEDIAWIKI_FALLBACK_STATUS = new Set([403, 468])
const WEB_HTML_RAW_ELEMENTS = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed'])
const WEB_HTML_BREAK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure',
  'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p',
  'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])
const WEB_HTML_VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])

function webHtmlTagEnd(value: string, start: number): number {
  let quote: '"' | "'" | undefined
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]
    if (quote !== undefined) {
      if (character === quote) quote = undefined
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index
    }
  }
  return value.length - 1
}

function decodeWebHtmlEntities(value: string): string {
  return value.replace(/&(nbsp|amp|lt|gt|quot|apos|#39|#\d{1,7}|#x[0-9a-f]{1,6});/giu, entity => {
    const key = entity.slice(1, -1).toLowerCase()
    if (key === 'nbsp') return ' '
    if (key === 'amp') return '&'
    if (key === 'lt') return '<'
    if (key === 'gt') return '>'
    if (key === 'quot') return '"'
    if (key === 'apos' || key === '#39') return "'"
    const radix = key.startsWith('#x') ? 16 : 10
    const offset = radix === 16 ? 2 : 1
    const codePoint = Number.parseInt(key.slice(offset), radix)
    return Number.isSafeInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
      && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? String.fromCodePoint(codePoint)
      : entity
  })
}

function webHtmlClassNames(tag: string): ReadonlySet<string> {
  const value = tag.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu)?.slice(1).find(Boolean)
  return new Set(value?.split(/\s+/u).filter(Boolean) ?? [])
}

function webHtmlDialogueSemantic(tag: string): 'speaker' | 'content' | undefined {
  const classes = webHtmlClassNames(tag)
  if (classes.has('dialogue-char') || classes.has('dialogue-character') || classes.has('dialogue-speaker')) {
    return 'speaker'
  }
  if (classes.has('dialogue-content')) return 'content'
  return undefined
}

function webHtmlToText(value: string): string {
  const lower = value.toLowerCase()
  const output: string[] = []
  let dialogueSemantic: { depth: number; readonly kind: 'speaker' | 'content' } | undefined
  let awaitingDialogueContent = false
  const appendProse = (prose: string): void => {
    if (dialogueSemantic !== undefined) {
      const compact = prose.replace(/\s+/gu, ' ')
      if (compact.trim() !== '') output.push(compact)
      return
    }
    if (!awaitingDialogueContent || prose.trim() !== '') output.push(prose)
  }
  const trimOutputEnd = (): void => {
    while (output.length > 0) {
      const index = output.length - 1
      const trimmed = output[index]!.replace(/\s+$/u, '')
      if (trimmed !== '') {
        output[index] = trimmed
        return
      }
      output.pop()
    }
  }
  let offset = 0
  while (offset < value.length) {
    const tagStart = value.indexOf('<', offset)
    if (tagStart < 0) {
      appendProse(value.slice(offset))
      break
    }
    appendProse(value.slice(offset, tagStart))
    if (value.startsWith('<!--', tagStart)) {
      const commentEnd = value.indexOf('-->', tagStart + 4)
      offset = commentEnd < 0 ? value.length : commentEnd + 3
      continue
    }
    const tagEnd = webHtmlTagEnd(value, tagStart + 1)
    const tag = value.slice(tagStart + 1, tagEnd).trim()
    const closing = tag.startsWith('/')
    const name = tag.slice(closing ? 1 : 0).match(/^[a-z][a-z0-9:-]*/iu)?.[0]?.toLowerCase()
    if (!closing && name !== undefined && WEB_HTML_RAW_ELEMENTS.has(name)) {
      const closingStart = lower.indexOf(`</${name}`, tagEnd + 1)
      if (closingStart < 0) break
      offset = webHtmlTagEnd(value, closingStart + 2 + name.length) + 1
      continue
    }
    if (dialogueSemantic !== undefined) {
      if (closing) {
        const separate = dialogueSemantic.depth > 1 && name !== undefined && WEB_HTML_BREAK_ELEMENTS.has(name)
        dialogueSemantic.depth -= 1
        if (separate) output.push(' ')
        if (dialogueSemantic.depth === 0) {
          trimOutputEnd()
          if (dialogueSemantic.kind === 'speaker') {
            output.push('：「')
            awaitingDialogueContent = true
          } else {
            output.push('」\n')
          }
          dialogueSemantic = undefined
        }
      } else if (name !== undefined && WEB_HTML_VOID_ELEMENTS.has(name) && WEB_HTML_BREAK_ELEMENTS.has(name)) {
        output.push(' ')
      } else if (name !== undefined && !WEB_HTML_VOID_ELEMENTS.has(name) && !tag.endsWith('/')) {
        dialogueSemantic.depth += 1
      }
      offset = tagEnd + 1
      continue
    }
    if (!closing) {
      const semantic = webHtmlDialogueSemantic(tag)
      if (semantic !== undefined) {
        if (semantic === 'speaker') output.push('\n')
        dialogueSemantic = { depth: 1, kind: semantic }
        if (semantic === 'content') awaitingDialogueContent = false
        offset = tagEnd + 1
        continue
      }
    }
    if (name !== undefined && WEB_HTML_BREAK_ELEMENTS.has(name)) output.push('\n')
    offset = tagEnd + 1
  }
  return decodeWebHtmlEntities(output.join(''))
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t\f\v ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

/** Convert one provider body into bounded plain text suitable for durable story sources. */
export function renderStoryWebPageBody(
  body: { readonly kind: 'html' | 'text'; readonly content: string },
): { readonly content: string; readonly truncated: boolean } {
  const source = utf8Prefix(body.content, STORY_WEB_SOURCE_BYTES)
  const rendered = body.kind === 'html' ? webHtmlToText(source) : source
  const content = utf8Prefix(rendered, STORY_WEB_OUTPUT_BYTES)
  return {
    content,
    truncated: Buffer.byteLength(body.content.trim(), 'utf8') > STORY_WEB_SOURCE_BYTES
      || Buffer.byteLength(rendered.trim(), 'utf8') > STORY_WEB_OUTPUT_BYTES,
  }
}

interface MediaWikiSection {
  readonly index: string
  readonly level: string
}

function mediaWikiPageTitle(value: string): string | undefined {
  const url = new URL(value)
  const queryTitle = url.searchParams.get('title')?.trim()
  if (queryTitle !== undefined && queryTitle !== '') return queryTitle
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return undefined
  }
  const path = pathname.replace(/^\/+|\/+$/gu, '')
  const title = path.startsWith('wiki/') ? path.slice('wiki/'.length) : path
  return title === '' || title === 'index.php' || title === 'api.php' || title.length > 512
    ? undefined
    : title.replaceAll('_', ' ')
}

function mediaWikiApiUrl(pageUrl: string, title: string, prop: 'sections' | 'text', section?: string): string {
  const url = new URL('/api.php', pageUrl)
  url.searchParams.set('action', 'parse')
  url.searchParams.set('page', title)
  url.searchParams.set('prop', prop)
  url.searchParams.set('format', 'json')
  url.searchParams.set('formatversion', '2')
  if (section !== undefined) url.searchParams.set('section', section)
  return url.href
}

async function fetchMediaWikiJson(
  web: Required<Pick<StoryWebGateway, 'fetch'>>,
  url: string,
  signal?: AbortSignal,
): Promise<unknown | undefined> {
  try {
    const response = await web.fetch({ url }, signal)
    if (response.statusCode < 200 || response.statusCode >= 300 || response.truncated) return undefined
    return JSON.parse(response.body.content) as unknown
  } catch (error: unknown) {
    if (signal?.aborted === true) throw error
    return undefined
  }
}

function mediaWikiSections(value: unknown): readonly MediaWikiSection[] | undefined {
  const parse = (value as { readonly parse?: unknown } | null)?.parse
  if (typeof parse !== 'object' || parse === null) return undefined
  const sections = (parse as { readonly sections?: unknown }).sections
  if (!Array.isArray(sections)) return undefined
  const result = sections.flatMap((section): MediaWikiSection[] => {
    if (typeof section !== 'object' || section === null) return []
    const { index, level } = section as { readonly index?: unknown; readonly level?: unknown }
    return typeof index === 'string' && /^\d+$/u.test(index) && typeof level === 'string' && /^\d+$/u.test(level)
      ? [{ index, level }]
      : []
  })
  return result.length === sections.length ? result : undefined
}

function mediaWikiSectionHtml(value: unknown): string | undefined {
  const parse = (value as { readonly parse?: unknown } | null)?.parse
  if (typeof parse !== 'object' || parse === null) return undefined
  const text = (parse as { readonly text?: unknown }).text
  return typeof text === 'string' ? text : undefined
}

async function fetchStoryMediaWikiPage(
  web: Required<Pick<StoryWebGateway, 'fetch'>>,
  pageUrl: string,
  signal?: AbortSignal,
): Promise<{ readonly content: string; readonly truncated: boolean } | undefined> {
  const title = mediaWikiPageTitle(pageUrl)
  if (title === undefined) return undefined
  const sectionsPayload = await fetchMediaWikiJson(web, mediaWikiApiUrl(pageUrl, title, 'sections'), signal)
  const sections = mediaWikiSections(sectionsPayload)
  if (sections === undefined) return undefined
  const topLevel = sections.length === 0
    ? []
    : sections.filter(section => section.level === String(Math.min(...sections.map(item => Number(item.level)))))
  const selected = ['0', ...topLevel.slice(0, MEDIAWIKI_SECTION_LIMIT).map(section => section.index)]
  const renderedSections: string[] = []
  let truncated = topLevel.length > MEDIAWIKI_SECTION_LIMIT
  for (const section of selected) {
    const payload = await fetchMediaWikiJson(web, mediaWikiApiUrl(pageUrl, title, 'text', section), signal)
    const html = mediaWikiSectionHtml(payload)
    if (html === undefined) return undefined
    const rendered = renderStoryWebPageBody({ kind: 'html', content: html })
    if (rendered.content !== '') renderedSections.push(rendered.content)
    truncated ||= rendered.truncated
  }
  const rendered = renderedSections.join('\n\n')
  truncated ||= Buffer.byteLength(rendered, 'utf8') > STORY_WEB_OUTPUT_BYTES
  return { content: utf8Prefix(rendered, STORY_WEB_OUTPUT_BYTES), truncated }
}

/** Fetch and normalize one page exclusively through the configured Host Web provider. */
export async function fetchStoryWebPage(ctx: Context, value: string, signal?: AbortSignal): Promise<StoryWebPage> {
  const requestedUrl = normalizeStoryWebUrl(value)
  if (requestedUrl === undefined) throw new Error('资料 URL 必须是不含账号密码的 HTTP(S) 地址')
  const web = storyWebFetchGateway(ctx)
  if (web === undefined) throw new Error('当前 Host 没有可用的网页正文读取能力')
  const fetched = await web.fetch({ url: requestedUrl }, signal)
  const url = normalizeStoryWebUrl(fetched.url)
  if (url === undefined) throw new Error('网页读取服务返回了无效的最终 URL')
  if (MEDIAWIKI_FALLBACK_STATUS.has(fetched.statusCode)) {
    const mediaWiki = await fetchStoryMediaWikiPage(web, url, signal)
    if (mediaWiki !== undefined) {
      return {
        requestedUrl,
        url,
        statusCode: 200,
        content: mediaWiki.content,
        truncated: mediaWiki.truncated,
      }
    }
  }
  const rendered = renderStoryWebPageBody(fetched.body)
  return {
    requestedUrl,
    url,
    statusCode: fetched.statusCode,
    content: rendered.content,
    truncated: fetched.truncated || rendered.truncated,
  }
}
