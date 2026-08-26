/** Static Tavern Helper dependency resolution shared by Host preflight and isolated browser runtimes. */

import { parse as parseModule } from 'es-module-lexer/js'
import { localTavernModule, type TavernScriptPreload } from './tavern-local-modules.ts'

export type { TavernScriptPreload } from './tavern-local-modules.ts'

const tavernCompatibilityMarkerPattern = /^__[\p{L}\p{N}_-]{1,112}_loaded__$/u
const remoteCache = new Map<string, string>()
interface PendingRemoteSource {
  readonly controller: AbortController
  readonly promise: Promise<string>
  settled: boolean
  waiters: number
}
const pendingRemoteSources = new Map<string, PendingRemoteSource>()
const MAX_REMOTE_CACHE_ENTRIES = 32

/** Stable, browser-safe failures for bounded remote Tavern Helper resources. */
export class TavernScriptResourceLimitError extends Error {
  override readonly name = 'TavernScriptResourceLimitError'

  constructor(
    readonly code: 'remote-script-too-large' | 'remote-scripts-too-large',
    message: string,
  ) {
    super(message)
  }
}

/** Stable static-analysis failures that are safe to show in local script diagnostics. */
export class TavernScriptResolutionError extends Error {
  override readonly name = 'TavernScriptResolutionError'

  constructor(
    readonly code: 'dynamic-import-not-static' | 'invalid-module-url' | 'mag-var-update-import-form'
      | 'module-graph-incomplete',
    message: string,
  ) {
    super(message)
  }
}

/** Script origins trusted by the built-in jsDelivr bundle resolver. */
export const BUILT_IN_TAVERN_SCRIPT_ORIGINS = ['https://cdn.jsdelivr.net', 'https://testingcf.jsdelivr.net'] as const
const MAX_REMOTE_SCRIPT_BYTES = 8 * 1024 * 1024
const MAX_REMOTE_SCRIPTS_BYTES = 8 * 1024 * 1024

/** One authorized fixed-URL module copied into an isolated Tavern Helper execution plan. */
export interface TavernScriptModuleDependency {
  readonly id: string
  readonly placeholder: string
  readonly source: string
  readonly dependencies: readonly string[]
}

/** One approved stylesheet copied into the isolated plan for exact local fetch replay. */
export interface TavernStylesheetDependency {
  readonly url: string
  readonly source: string
  /** Preserve an HTTP failure so the isolated script can run its own fallback path. */
  readonly status: number
}

/** Browser execution plan for one isolated Tavern Helper script. */
export interface TavernScriptExecution {
  readonly source: string
  readonly mode: 'classic' | 'module'
  /** Classic leaf dependencies evaluated in isolated scopes before the entry script. */
  readonly inlineDependencies?: readonly string[]
  readonly preloads: readonly TavernScriptPreload[]
  readonly needsDomPurify: boolean
  readonly needsFuse: boolean
  /** Authorized fixed-URL ESM graph fetched once by the Host and instantiated inside the isolated frame. */
  readonly moduleDependencies?: readonly TavernScriptModuleDependency[]
  /** Literal readiness flags assigned by authorized dependency modules. */
  readonly compatibilityMarkers: readonly string[]
  /** Static HTTPS image origins declared by the entry script and inspected dependencies. */
  readonly remoteImageOrigins?: readonly string[]
  /** Static HTTPS stylesheet origins declared by the entry script and inspected dependencies. */
  readonly remoteStyleOrigins?: readonly string[]
  /** Exact static HTTPS stylesheet URLs eligible for bounded Host resolution after approval. */
  readonly remoteStylesheetUrls?: readonly string[]
  /** HTTPS font origins discovered inside already-approved stylesheet sources. */
  readonly remoteFontOrigins?: readonly string[]
  /** Approved stylesheet bodies replayed locally to scripts without enabling iframe networking. */
  readonly stylesheetDependencies?: readonly TavernStylesheetDependency[]
  /** Static HTTPS frame origins declared by the entry script and inspected dependencies. */
  readonly remoteFrameOrigins?: readonly string[]
}

/** Signals that a valid HTTPS module origin needs player approval before loading. */
export class TavernScriptOriginApprovalError extends Error {
  /** Origin awaiting approval. */
  readonly origin: string

  constructor(origin: string) {
    super(`远程脚本来源需要授权：${origin}`)
    this.name = 'TavernScriptOriginApprovalError'
    this.origin = origin
  }
}

/** Validate the small boolean readiness-marker surface shared with card display frames. */
export function validatedTavernCompatibilityMarkers(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap(marker => typeof marker === 'string' && marker.length <= 128
    && tavernCompatibilityMarkerPattern.test(marker) ? [marker] : []))].sort().slice(0, 32)
}

function approvedOrigins(additional: readonly string[]): ReadonlySet<string> {
  return new Set([...BUILT_IN_TAVERN_SCRIPT_ORIGINS, ...additional].map(value => new URL(value).origin))
}

function approvedModuleUrl(specifier: string, origins: ReadonlySet<string>, base?: URL): URL {
  let parsed: URL
  try {
    if (base !== undefined && !/^(?:https:\/\/|\/|\.\.?\/)/u.test(specifier)) {
      throw new Error('nested module specifier is not relative')
    }
    parsed = base === undefined ? new URL(specifier) : new URL(specifier, base)
  } catch {
    throw new TavernScriptResolutionError('invalid-module-url', '远程模块必须使用完整 HTTPS 地址')
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw new TavernScriptResolutionError('invalid-module-url', '远程模块必须使用完整 HTTPS 地址')
  }
  if (!origins.has(parsed.origin)) throw new TavernScriptOriginApprovalError(parsed.origin)
  return parsed
}

function isMagVarUpdateBundle(url: URL): boolean {
  return BUILT_IN_TAVERN_SCRIPT_ORIGINS.includes(url.origin as typeof BUILT_IN_TAVERN_SCRIPT_ORIGINS[number])
    && /^\/gh\/MagicalAstrogy\/MagVarUpdate(?:@[^/]+)?\/artifact\/bundle\.js$/iu.test(url.pathname)
}

async function fetchRemoteSource(parsed: URL, signal: AbortSignal): Promise<string> {
  const response = await fetch(parsed.href, {
    cache: 'force-cache',
    credentials: 'omit',
    headers: { accept: 'text/javascript, application/javascript, text/plain' },
    referrerPolicy: 'no-referrer',
    signal,
  })
  if (!response.ok) throw new Error(`远程脚本读取失败（${response.status}）`)
  if (response.url !== '' && new URL(response.url).origin !== parsed.origin) {
    throw new Error('远程脚本不能重定向到另一个来源')
  }
  const length = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(length) && length > MAX_REMOTE_SCRIPT_BYTES) {
    throw new TavernScriptResourceLimitError('remote-script-too-large', '远程脚本超过 8 MiB')
  }
  const source = await response.text()
  if (new TextEncoder().encode(source).byteLength > MAX_REMOTE_SCRIPT_BYTES) {
    throw new TavernScriptResourceLimitError('remote-script-too-large', '远程脚本超过 8 MiB')
  }
  return source
}

function cacheRemoteSource(href: string, source: string): string {
  remoteCache.delete(href)
  remoteCache.set(href, source)
  while (remoteCache.size > MAX_REMOTE_CACHE_ENTRIES) remoteCache.delete(remoteCache.keys().next().value!)
  return source
}

function startRemoteSource(parsed: URL): PendingRemoteSource {
  const controller = new AbortController()
  const pending: PendingRemoteSource = {
    controller,
    promise: fetchRemoteSource(parsed, controller.signal).then(source => cacheRemoteSource(parsed.href, source)),
    settled: false,
    waiters: 0,
  }
  pendingRemoteSources.set(parsed.href, pending)
  const settle = (): void => {
    pending.settled = true
    if (pendingRemoteSources.get(parsed.href) === pending) pendingRemoteSources.delete(parsed.href)
  }
  void pending.promise.then(settle, settle)
  return pending
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError')
}

function waitForRemoteSource(href: string, pending: PendingRemoteSource, signal: AbortSignal): Promise<string> {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  pending.waiters += 1
  return new Promise<string>((resolve, reject) => {
    let waiting = true
    const finish = (complete: () => void): void => {
      if (!waiting) return
      waiting = false
      signal.removeEventListener('abort', onAbort)
      pending.waiters -= 1
      if (pending.waiters === 0 && !pending.settled) {
        if (pendingRemoteSources.get(href) === pending) pendingRemoteSources.delete(href)
        pending.controller.abort()
      }
      complete()
    }
    const onAbort = (): void => { finish(() => { reject(abortReason(signal)) }) }
    signal.addEventListener('abort', onAbort, { once: true })
    void pending.promise.then(
      source => { finish(() => { resolve(source) }) },
      reason => { finish(() => { reject(reason) }) },
    )
  })
}

async function remoteSource(url: URL, signal: AbortSignal): Promise<string> {
  const parsed = new URL(url)
  const cached = remoteCache.get(parsed.href)
  if (cached !== undefined) return cached
  if (signal.aborted) throw abortReason(signal)
  const pending = pendingRemoteSources.get(parsed.href) ?? startRemoteSource(parsed)
  return waitForRemoteSource(parsed.href, pending, signal)
}

function removeSourceRanges(source: string, ranges: readonly { readonly start: number; readonly end: number }[]): string {
  let result = source
  for (const range of [...ranges].sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, range.start)}${result.slice(range.end)}`
  }
  return result.trim()
}

interface TavernModuleReference {
  readonly url: URL
  readonly start: number
  readonly end: number
  readonly dynamic: boolean
}

interface LoadedTavernModule {
  readonly url: URL
  readonly source: string
  readonly references: readonly TavernModuleReference[]
}

interface ParsedModuleReference {
  readonly n: string | undefined
  readonly s: number
  readonly e: number
  readonly ss: number
  readonly se: number
  readonly d: number
}

const javascriptIdentifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/u
const staticHttpsConstPattern = /(?:^|[;\r\n])[\t ]*const[\t ]+([A-Za-z_$][A-Za-z0-9_$]*)[\t ]*=[\t ]*(['"])(https:\/\/[^'"\\\r\n]+)\2[\t ]*(?=;|[\r\n]|$)/gmu

function fixedModuleSpecifier(source: string, imported: ParsedModuleReference): string | undefined {
  if (imported.n !== undefined) return imported.n
  if (imported.d < 0) return undefined
  const identifier = source.slice(imported.s, imported.e).trim()
  if (!javascriptIdentifierPattern.test(identifier)) return undefined
  const declarations = [...source.matchAll(staticHttpsConstPattern)].filter(match =>
    match[1] === identifier && match.index < imported.ss)
  return declarations.length === 1 ? declarations[0]![3] : undefined
}

function magVarUpdateAdapterRange(
  source: string,
  imported: ParsedModuleReference,
): { readonly start: number; readonly end: number } | undefined {
  if (imported.d === -1 && /^\s*import\s*['"]/u.test(source.slice(imported.ss, imported.se))) {
    let end = imported.se
    while (source[end] === ' ' || source[end] === '\t') end += 1
    if (source[end] === ';') end += 1
    return { start: imported.ss, end }
  }
  if (imported.d < 0) return undefined
  const prefix = source.slice(0, imported.ss).match(/(?:^|[;{}\r\n])[\t ]*(await[\t ]+)?$/u)
  if (prefix === null) return undefined
  let end = imported.se
  while (source[end] === ' ' || source[end] === '\t') end += 1
  if (source[end] === ';') end += 1
  let next = end
  while (source[next] === ' ' || source[next] === '\t') next += 1
  if (next < source.length && source[next] !== '\r' && source[next] !== '\n') return undefined
  return { start: imported.ss - (prefix[1]?.length ?? 0), end }
}

function moduleReferences(
  source: string,
  origins: ReadonlySet<string>,
  base?: URL,
): readonly TavernModuleReference[] {
  const [imports] = parseModule(source)
  return imports.flatMap(imported => {
    if (imported.d === -2) return []
    const specifier = fixedModuleSpecifier(source, imported)
    if (specifier === undefined) {
      throw new TavernScriptResolutionError(
        'dynamic-import-not-static', '远程模块的动态 import 必须使用固定 HTTPS 地址',
      )
    }
    return [{
      url: approvedModuleUrl(specifier, origins, base),
      start: imported.s,
      end: imported.e,
      dynamic: imported.d !== -1,
    }]
  })
}

function modulePlaceholder(index: number, sources: readonly string[]): string {
  let attempt = 0
  while (true) {
    const suffix = attempt === 0 ? '' : `_${attempt}`
    const placeholder = `__dsh_tavern_remote_module_${index}${suffix}__`
    if (sources.every(source => !source.includes(placeholder))) return placeholder
    attempt += 1
  }
}

function replaceModuleReferences(
  source: string,
  references: readonly TavernModuleReference[],
  modulesByHref: ReadonlyMap<string, TavernScriptModuleDependency>,
): string {
  let result = source
  for (const reference of [...references].sort((left, right) => right.start - left.start)) {
    const module = modulesByHref.get(reference.url.href)
    if (module === undefined) {
      throw new TavernScriptResolutionError('module-graph-incomplete', '远程模块依赖图不完整')
    }
    const replacement = reference.dynamic ? JSON.stringify(module.placeholder) : module.placeholder
    result = `${result.slice(0, reference.start)}${replacement}${result.slice(reference.end)}`
  }
  return result
}

async function loadModuleGraph(
  roots: readonly TavernModuleReference[],
  origins: ReadonlySet<string>,
  signal: AbortSignal,
  entrySource: string,
): Promise<{
  readonly loaded: ReadonlyMap<string, LoadedTavernModule>
  readonly modulesByHref: ReadonlyMap<string, TavernScriptModuleDependency>
  readonly preloads: readonly TavernScriptPreload[]
}> {
  const loaded = new Map<string, LoadedTavernModule>()
  const processed = new Map<string, boolean>()
  const outcomes = new Map<string, { readonly source: string } | { readonly error: unknown }>()
  const preloads = new Set<TavernScriptPreload>()
  let queue = roots.map(reference => ({ url: reference.url, startupRequired: !reference.dynamic }))
  while (queue.length > 0) {
    const pending = new Map<string, { readonly url: URL; readonly startupRequired: boolean }>()
    for (const candidate of queue) {
      const prior = processed.get(candidate.url.href)
      if (prior === true || (prior === false && !candidate.startupRequired)) continue
      const queued = pending.get(candidate.url.href)
      pending.set(candidate.url.href, {
        url: candidate.url,
        startupRequired: candidate.startupRequired || queued?.startupRequired === true,
      })
    }
    const batch = [...pending.values()]
    queue = []
    const results = await Promise.all(batch.map(async candidate => {
      const existing = outcomes.get(candidate.url.href)
      if (existing !== undefined) return { candidate, outcome: existing }
      const local = localTavernModule(candidate.url)
      try {
        const outcome = { source: local?.source ?? await remoteSource(candidate.url, signal) }
        outcomes.set(candidate.url.href, outcome)
        return { candidate, outcome }
      } catch (error) {
        const outcome = { error }
        outcomes.set(candidate.url.href, outcome)
        return { candidate, outcome }
      }
    }))
    for (const { candidate, outcome } of results) {
      const { url, startupRequired } = candidate
      processed.set(url.href, startupRequired)
      if ('error' in outcome) {
        if (startupRequired) throw outcome.error
        loaded.set(url.href, {
          url,
          source: `throw new Error(${JSON.stringify('可选远程模块不可用')})`,
          references: [],
        })
        continue
      }
      const source = outcome.source
      for (const preload of localTavernModule(url)?.preloads ?? []) preloads.add(preload)
      const references = moduleReferences(source, origins, url)
      loaded.set(url.href, { url, source, references })
      queue.push(...references.map(reference => ({
        url: reference.url,
        startupRequired: startupRequired && !reference.dynamic,
      })))
    }
  }
  const sources = [entrySource, ...[...loaded.values()].map(module => module.source)]
  const identities = new Map([...loaded.keys()].map((href, index) => [href, {
    id: `remote-module-${index}`,
    placeholder: modulePlaceholder(index, sources),
  }] as const))
  const skeletons = new Map([...loaded.keys()].map(href => {
    const identity = identities.get(href)!
    return [href, { ...identity, source: '', dependencies: [] }] as const
  }))
  const modulesByHref = new Map([...loaded.values()].map(entry => {
    const identity = identities.get(entry.url.href)!
    const dependencies = [...new Set(entry.references.map(reference => identities.get(reference.url.href)!.id))]
    return [entry.url.href, {
      ...identity,
      source: replaceModuleReferences(entry.source, entry.references, skeletons),
      dependencies,
    }] as const
  }))
  return { loaded, modulesByHref, preloads: [...preloads] }
}

const trueCompatibilityMarkerAssignmentPattern = /(?:\bwindow\b(?:\s*\.\s*(?:parent|top))?|\(\s*window\s*\.\s*(?:parent|top)\s*\|\|\s*window\s*\))\s*(?:\.\s*(__[\p{L}\p{N}_-]{1,112}_loaded__)|\[\s*(['"])(__[\p{L}\p{N}_-]{1,112}_loaded__)\2\s*\])\s*=\s*true\b/gu

/** Find literal Window readiness assignments without executing dependency source. */
export function declaredTavernCompatibilityMarkers(source: string): readonly string[] {
  return validatedTavernCompatibilityMarkers([...source.matchAll(trueCompatibilityMarkerAssignmentPattern)]
    .map(match => match[1] ?? match[3]))
}

/** Find literal HTTPS image origins without executing script source. */
export function declaredTavernImageOrigins(source: string): readonly string[] {
  const origins = new Set<string>()
  for (const match of source.matchAll(/https:\/\/[^\s"'<>`\\)]+/giu)) {
    try {
      const url = new URL(match[0].replace(/[),.;]+$/u, ''))
      if (url.protocol === 'https:' && /\.(?:avif|gif|jpe?g|png|svg|webp)$/iu.test(url.pathname)) origins.add(url.origin)
    } catch {
      // Template fragments and URL-like script text are not static browser resources.
    }
  }
  return [...origins].sort()
}

function declaredLoadedTavernImageOrigins(source: string): readonly string[] {
  const origins = new Set<string>()
  const literals = new Map<string, string>()
  const imageVariables = new Set<string>()
  const add = (value: string): void => {
    try {
      const url = new URL(value.replace(/[),.;]+$/u, ''))
      if (url.protocol === 'https:' && url.username === '' && url.password === ''
        && /\.(?:avif|gif|jpe?g|png|svg|webp)$/iu.test(url.pathname)) origins.add(url.origin)
    } catch {
      // Template fragments and URL-like script text are not static browser resources.
    }
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*=\s*(['"])(https:\/\/[^\s"'<>`\\)]+)\2/giu)) {
    literals.set(match[1]!, match[3]!)
  }
  for (const match of source.matchAll(/<img\b[^>]*\bsrc\s*=\s*(['"])(https:\/\/[^\s"'<>`\\)]+)\1/giu)) add(match[2]!)
  for (const match of source.matchAll(/\burl\(\s*(['"]?)(https:\/\/[^\s"'<>`\\)]+)\1\s*\)/giu)) add(match[2]!)
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*=\s*(?:new\s+Image\s*\(\s*\)|document\.createElement\(\s*(['"])img\2\s*\))/giu)) {
    imageVariables.add(match[1]!)
  }
  for (const variable of imageVariables) {
    const escaped = variable.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const assignment = new RegExp(`\\b${escaped}\\s*\\.\\s*src\\s*=\\s*(?:(['"])(https:\\/\\/[^\\s"'<>\\x60\\\\)]+)\\1|([\\p{L}_$][\\p{L}\\p{N}_$]*))`, 'giu')
    const setter = new RegExp(`\\b${escaped}\\s*\\.\\s*(?:setAttribute|attr)\\(\\s*['"]src['"]\\s*,\\s*(?:(['"])(https:\\/\\/[^\\s"'<>\\x60\\\\)]+)\\1|([\\p{L}_$][\\p{L}\\p{N}_$]*))`, 'giu')
    for (const pattern of [assignment, setter]) for (const match of source.matchAll(pattern)) {
      const value = match[2] ?? literals.get(match[3]!)
      if (value !== undefined) add(value)
    }
  }
  return [...origins].sort()
}

/** Find exact static HTTPS stylesheet URLs without evaluating script source. */
export function declaredTavernStylesheetUrls(source: string): readonly string[] {
  const urls = new Set<string>()
  const literals = new Map<string, string>()
  const linkVariables = new Set<string>()
  const add = (value: string): void => {
    try {
      const url = new URL(value.replace(/[),.;]+$/u, ''))
      if (url.protocol === 'https:' && url.username === '' && url.password === '') urls.add(url.href)
    } catch {
      // Template fragments and URL-like script text are not static browser resources.
    }
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*=\s*(['"])(https:\/\/[^\s"'<>`\\)]+)\2/giu)) {
    literals.set(match[1]!, match[3]!)
  }
  for (const match of source.matchAll(/https:\/\/[^\s"'<>`\\)]+/giu)) {
    try {
      const url = new URL(match[0].replace(/[),.;]+$/u, ''))
      if (/\.css$/iu.test(url.pathname)) add(url.href)
    } catch {
      // Template fragments and URL-like script text are not static browser resources.
    }
  }
  for (const match of source.matchAll(/@import\s+(?:url\(\s*)?(['"])(https:\/\/[^\s"'<>`\\)]+)\1/giu)) add(match[2]!)
  for (const match of source.matchAll(/<link\b[^>]*>/giu)) {
    if (!/\brel\s*=\s*(['"])stylesheet\1/iu.test(match[0])) continue
    const href = match[0].match(/\bhref\s*=\s*(['"])(https:\/\/[^\s"'<>`\\)]+)\1/iu)?.[2]
    if (href !== undefined) add(href)
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*=\s*document\.createElement\(\s*(['"])link\2\s*\)/giu)) {
    linkVariables.add(match[1]!)
  }
  for (const variable of linkVariables) {
    const escaped = variable.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const assignment = new RegExp(`\\b${escaped}\\s*\\.\\s*href\\s*=\\s*(?:(['"])(https:\\/\\/[^\\s"'<>\\x60\\\\)]+)\\1|([\\p{L}_$][\\p{L}\\p{N}_$]*))`, 'giu')
    const setter = new RegExp(`\\b${escaped}\\s*\\.\\s*(?:setAttribute|attr)\\(\\s*['"]href['"]\\s*,\\s*(?:(['"])(https:\\/\\/[^\\s"'<>\\x60\\\\)]+)\\1|([\\p{L}_$][\\p{L}\\p{N}_$]*))`, 'giu')
    for (const pattern of [assignment, setter]) for (const match of source.matchAll(pattern)) {
      const value = match[2] ?? literals.get(match[3]!)
      if (value !== undefined) add(value)
    }
  }
  return [...urls].sort()
}

/** Find static HTTPS stylesheet origins without evaluating script source. */
export function declaredTavernStyleOrigins(source: string): readonly string[] {
  return [...new Set(declaredTavernStylesheetUrls(source).map(value => new URL(value).origin))].sort()
}

/** Find static HTTPS iframe origins without executing script source. */
export function declaredTavernFrameOrigins(source: string): readonly string[] {
  if (!/(?:<iframe\b|createElement\(\s*['"]iframe['"]\s*\))/iu.test(source)) return []
  const origins = new Set<string>()
  const literals = new Map<string, string>()
  const add = (value: string): void => {
    try {
      const url = new URL(value.replace(/[),.;]+$/u, ''))
      if (url.protocol === 'https:' && url.username === '' && url.password === '') origins.add(url.origin)
    } catch {
      // Template fragments and URL-like script text are not static browser resources.
    }
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*=\s*(['"])(https:\/\/[^\s"'<>`\\)]+)\2/giu)) {
    literals.set(match[1]!, match[3]!)
  }
  for (const match of source.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*(['"])(https:\/\/[^\s"'<>`\\)]+)\1/giu)) {
    add(match[2]!)
  }
  for (const match of source.matchAll(/(?:\.\s*src\s*=|\.\s*(?:setAttribute|attr)\(\s*['"]src['"]\s*,)\s*(?:(['"])(https:\/\/[^\s"'<>`\\)]+)\1|([\p{L}_$][\p{L}\p{N}_$]*))/giu)) {
    const value = match[2] ?? literals.get(match[3]!)
    if (value !== undefined) add(value)
  }
  return [...origins].sort()
}

/** Resolve and authorize one card script while preserving ESM module boundaries. */
export async function resolveTavernScriptExecution(
  content: string,
  signal: AbortSignal,
  additionalOrigins: readonly string[] = [],
): Promise<TavernScriptExecution> {
  const origins = approvedOrigins(additionalOrigins)
  const [imports] = parseModule(content)
  const urls: URL[] = []
  const adapterRanges: { readonly start: number; readonly end: number }[] = []
  const remoteImports: { readonly url: URL; readonly start: number; readonly end: number; readonly sideEffect: boolean }[] = []
  for (const imported of imports) {
    if (imported.d === -2) continue
    const specifier = fixedModuleSpecifier(content, imported)
    if (specifier === undefined) {
      throw new TavernScriptResolutionError(
        'dynamic-import-not-static', '远程模块的动态 import 必须使用固定 HTTPS 地址',
      )
    }
    const url = approvedModuleUrl(specifier, origins)
    if (isMagVarUpdateBundle(url)) {
      const range = magVarUpdateAdapterRange(content, imported)
      if (range === undefined) {
        throw new TavernScriptResolutionError(
          'mag-var-update-import-form', 'MagVarUpdate 宿主适配仅支持不读取返回值的导入',
        )
      }
      adapterRanges.push(range)
      continue
    }
    let end = imported.se
    while (content[end] === ' ' || content[end] === '\t') end += 1
    if (content[end] === ';') end += 1
    const remoteImport = {
      url, start: imported.ss, end,
      sideEffect: imported.d === -1 && /^\s*import\s*['"]/u.test(content.slice(imported.ss, imported.se)),
    }
    remoteImports.push(remoteImport)
    if (remoteImport.sideEffect) urls.push(url)
  }
  const uniqueUrls = [...new Map(urls.map(url => [url.href, url])).values()]
  const sources = await Promise.all(uniqueUrls.map(url => localTavernModule(url)?.source ?? remoteSource(url, signal)))
  const sourceByUrl = new Map(uniqueUrls.map((url, index) => [url.href, sources[index]!]))
  const inlineDependencies: string[] = []
  for (const url of uniqueUrls) {
    const occurrences = remoteImports.filter(item => item.url.href === url.href)
    const dependency = sourceByUrl.get(url.href)!
    const [dependencyImports, , , dependencyHasModuleSyntax] = parseModule(dependency)
    if (occurrences.length === 0 || occurrences.some(item => !item.sideEffect)
      || dependencyImports.length > 0 || dependencyHasModuleSyntax) continue
    adapterRanges.push(...occurrences.map(item => ({ start: item.start, end: item.end })))
    inlineDependencies.push(dependency)
  }
  const total = sources.reduce((size, source) => size + new TextEncoder().encode(source).byteLength, 0)
  if (total > MAX_REMOTE_SCRIPTS_BYTES) {
    throw new TavernScriptResourceLimitError('remote-scripts-too-large', '远程脚本合计超过 8 MiB')
  }
  const source = removeSourceRanges(content, adapterRanges)
  const [, , , hasModuleSyntax] = parseModule(source)
  const remainingReferences = moduleReferences(source, origins)
  const graph = await loadModuleGraph(remainingReferences, origins, signal, source)
  const allRemoteSources = new Map(sourceByUrl)
  for (const [href, entry] of graph.loaded) allRemoteSources.set(href, entry.source)
  const allRemoteBytes = [...allRemoteSources.values()]
    .reduce((size, remote) => size + new TextEncoder().encode(remote).byteLength, 0)
  if (allRemoteBytes > MAX_REMOTE_SCRIPTS_BYTES) {
    throw new TavernScriptResourceLimitError('remote-scripts-too-large', '远程脚本合计超过 8 MiB')
  }
  const resolvedSource = replaceModuleReferences(source, remainingReferences, graph.modulesByHref)
  const dependencySources = [...allRemoteSources.values()]
  const dependencySource = [resolvedSource, ...dependencySources].join('\n')
  const preloads = new Set<TavernScriptPreload>(graph.preloads)
  if (/\bVue\b/u.test(dependencySource)) preloads.add('vue')
  if (/\bYAML\b/u.test(dependencySource)) preloads.add('yaml')
  if (/\bz\.(?:any|array|boolean|coerce|discriminatedUnion|enum|intersection|lazy|literal|nullable|number|object|optional|preprocess|record|string|tuple|union|unknown)\b/u.test(dependencySource)
    // Some pre-bundled Tavern modules capture the conventional Zod global before using its methods.
    || /\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*z\s*[;,]/u.test(dependencySource)) {
    preloads.add('zod')
  }
  return {
    source: resolvedSource,
    mode: hasModuleSyntax || remainingReferences.length > 0 ? 'module' : 'classic',
    inlineDependencies,
    preloads: [...preloads],
    needsDomPurify: /\bDOMPurify\b/u.test(dependencySource),
    needsFuse: /\bFuse\b/u.test(dependencySource),
    moduleDependencies: [...graph.modulesByHref.values()],
    compatibilityMarkers: declaredTavernCompatibilityMarkers(dependencySource),
    remoteImageOrigins: [...new Set([
      ...declaredTavernImageOrigins(resolvedSource),
      ...dependencySources.flatMap(declaredLoadedTavernImageOrigins),
    ])].sort(),
    remoteStyleOrigins: declaredTavernStyleOrigins(dependencySource),
    remoteStylesheetUrls: declaredTavernStylesheetUrls(dependencySource),
    remoteFontOrigins: [],
    stylesheetDependencies: [],
    remoteFrameOrigins: declaredTavernFrameOrigins(dependencySource),
  }
}
