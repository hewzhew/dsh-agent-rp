/** Native eligibility rules for display-regex output rendered inside the Host message body. */

import { marked } from 'marked'
import type { CharacterDisplaySegment, CompiledCharacterDisplay } from './card-display-compiler.ts'

/** Exact element names retained by the Host-native rich-text sanitizer. */
export const NATIVE_MESSAGE_INLINE_TAGS = Object.freeze([
  'b', 'br', 'code', 'del', 'div', 'em', 'font', 'i', 'mark', 'p', 'q', 'rp', 'rt', 'ruby',
  's', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'u',
])

/** Exact attribute names retained by the Host-native rich-text sanitizer. */
export const NATIVE_MESSAGE_INLINE_ATTRIBUTES = Object.freeze([
  'color', 'face', 'size', 'style', 'title',
])

const nativeInlineTags = new Set<string>(NATIVE_MESSAGE_INLINE_TAGS)

const nativeStyleProperties = new Set([
  'background-color', 'color', 'font-style', 'font-weight', 'opacity',
  'text-decoration', 'text-decoration-color', 'text-decoration-line', 'text-decoration-style',
])

const htmlTag = /<\/?[A-Za-z][^<>]*>/gu
const attribute = /\s+([A-Za-z][A-Za-z0-9:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gy

/** Browser-renderable display plan that cannot create a document, resource, or interactive frontend. */
export interface NativeMessageDisplay {
  readonly segments: readonly Extract<CharacterDisplaySegment, { readonly kind: 'markdown' | 'inline-html' }>[]
}

function nativeStyle(value: string): boolean {
  if (value.length > 1_024 || /(?:url\s*\(|expression\s*\(|[&@{}\\])/iu.test(value)) return false
  const declarations = value.split(';').map(item => item.trim()).filter(Boolean)
  if (declarations.length === 0 || declarations.length > 16) return false
  return declarations.every(declaration => {
    const separator = declaration.indexOf(':')
    if (separator <= 0) return false
    const property = declaration.slice(0, separator).trim().toLocaleLowerCase()
    const propertyValue = declaration.slice(separator + 1).trim().replace(/\s*!important\s*$/iu, '')
    return nativeStyleProperties.has(property) && propertyValue !== '' && propertyValue.length <= 256
  })
}

function nativeAttribute(tag: string, name: string, value: string | undefined): boolean {
  const normalized = name.toLocaleLowerCase()
  if (normalized === 'title') return value !== undefined && value.length <= 1_024
  if (normalized === 'style') return value !== undefined && nativeStyle(value)
  if (tag !== 'font' || value === undefined) return false
  if (normalized === 'color') return value.length <= 128 && !/[<>`]/u.test(value)
  if (normalized === 'face') return value.length <= 128 && !/[<>`]/u.test(value)
  return normalized === 'size' && /^[+-]?[1-7]$/u.test(value)
}

function nativeTag(source: string): boolean {
  const parsed = source.match(/^<(\/?)\s*([A-Za-z][A-Za-z0-9-]*)([\s\S]*?)(\/?)>$/u)
  if (parsed === null) return false
  const closing = parsed[1] === '/'
  const tag = parsed[2]!.toLocaleLowerCase()
  if (!nativeInlineTags.has(tag)) return false
  const attributes = parsed[3] ?? ''
  if (closing) return attributes.trim() === '' && parsed[4] !== '/'
  let cursor = 0
  attribute.lastIndex = 0
  while (cursor < attributes.length) {
    attribute.lastIndex = cursor
    const match = attribute.exec(attributes)
    if (match === null || match.index !== cursor) return attributes.slice(cursor).trim() === ''
    const value = match[2] ?? match[3] ?? match[4]
    if (!nativeAttribute(tag, match[1]!, value)) return false
    cursor = attribute.lastIndex
  }
  return true
}

function nativeMessageHtml(source: string): boolean {
  const matches = [...source.matchAll(htmlTag)]
  if (matches.length === 0 || matches.length > 256) return false
  if (matches.some(match => !nativeTag(match[0]))) return false
  const withoutTags = source.replace(htmlTag, '')
  return !/<\/?[A-Za-z]/u.test(withoutTags)
}

/**
 * Expand Markdown in one local-decoration segment using the exact client renderer options.
 *
 * @param source - display-regex output classified as inline HTML.
 * @returns browser HTML that still requires the client sanitizer before insertion.
 */
export function renderNativeMessageInlineHtml(source: string): string {
  return marked.parse(source, { async: false, breaks: true, gfm: true }) as string
}

/**
 * Decide whether one inline-HTML segment is only local text decoration.
 *
 * @param source - display-regex output classified as inline HTML.
 * @returns whether the source can render inside the Host message without loading resources or adding interaction.
 */
export function isNativeMessageInlineHtml(source: string): boolean {
  if (source.length === 0 || source.length > 1024 * 1024) return false
  if (!nativeMessageHtml(source)) return false
  return nativeMessageHtml(renderNativeMessageInlineHtml(source))
}

/**
 * Preserve native Markdown and local text decoration while leaving richer frontends on the iframe path.
 *
 * @param compilation - deterministic display-regex compilation.
 * @returns immutable native segments, or undefined when any segment needs the frontend renderer.
 */
export function nativeMessageDisplay(compilation: CompiledCharacterDisplay): NativeMessageDisplay | undefined {
  if (compilation.segments.length === 0) return undefined
  const eligible = compilation.segments.every(segment => segment.kind === 'markdown'
    || (segment.kind === 'inline-html' && isNativeMessageInlineHtml(segment.source)))
  if (!eligible) return undefined
  const segments = compilation.segments as NativeMessageDisplay['segments']
  return Object.freeze({ segments: Object.freeze([...segments]) })
}
