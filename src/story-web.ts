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

const WEB_HTML_RAW_ELEMENTS = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed'])
const WEB_HTML_BREAK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure',
  'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p',
  'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
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

function webHtmlToText(value: string): string {
  const lower = value.toLowerCase()
  const output: string[] = []
  let offset = 0
  while (offset < value.length) {
    const tagStart = value.indexOf('<', offset)
    if (tagStart < 0) {
      output.push(value.slice(offset))
      break
    }
    output.push(value.slice(offset, tagStart))
    if (value.startsWith('<!--', tagStart)) {
      const commentEnd = value.indexOf('-->', tagStart + 4)
      offset = commentEnd < 0 ? value.length : commentEnd + 3
      continue
    }
    const tagEnd = webHtmlTagEnd(value, tagStart + 1)
    const tag = value.slice(tagStart + 1, tagEnd).trim()
    const closing = tag.startsWith('/')
    const name = tag.slice(closing ? 1 : 0).match(/^[a-z][a-z0-9:-]*/iu)?.[0]?.toLowerCase()
    if (name !== undefined && WEB_HTML_BREAK_ELEMENTS.has(name)) output.push('\n')
    if (!closing && name !== undefined && WEB_HTML_RAW_ELEMENTS.has(name)) {
      const closingStart = lower.indexOf(`</${name}`, tagEnd + 1)
      if (closingStart < 0) break
      offset = webHtmlTagEnd(value, closingStart + 2 + name.length) + 1
      continue
    }
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
  const sourceLimit = 96 * 1_024
  const outputLimit = 48 * 1_024
  const source = utf8Prefix(body.content, sourceLimit)
  const rendered = body.kind === 'html' ? webHtmlToText(source) : source
  const content = utf8Prefix(rendered, outputLimit)
  return {
    content,
    truncated: Buffer.byteLength(body.content.trim(), 'utf8') > sourceLimit
      || Buffer.byteLength(rendered.trim(), 'utf8') > outputLimit,
  }
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
  const rendered = renderStoryWebPageBody(fetched.body)
  return {
    requestedUrl,
    url,
    statusCode: fetched.statusCode,
    content: rendered.content,
    truncated: fetched.truncated || rendered.truncated,
  }
}
