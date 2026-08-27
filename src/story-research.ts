/** Deterministic local retrieval over editable story sources. */

import type { StoryWorkspaceSnapshot } from './story-workspace-protocol.ts'
import { splitStorySourcePassages } from './story-source.ts'

interface RankedExcerpt {
  readonly sourceIndex: number
  readonly chunkIndex: number
  readonly sourceId: string
  readonly sourceName: string
  readonly locator: string
  readonly text: string
  readonly score: number
}

function queryTerms(query: string): readonly string[] {
  const normalized = query.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim()
  const words = normalized.split(' ').filter(term => term.length >= 2)
  const compact = normalized.replace(/\s+/gu, '')
  const bigrams = Array.from({ length: Math.max(0, compact.length - 1) }, (_, index) => compact.slice(index, index + 2))
  return [...new Set([...words, ...bigrams])].slice(0, 128)
}

function relevance(text: string, terms: readonly string[]): number {
  const normalized = text.toLocaleLowerCase()
  return terms.reduce((score, term) => score + (normalized.includes(term) ? Math.min(8, term.length) : 0), 0)
}

/** Select bounded source excerpts relevant to the current player input and public scene. */
export function searchStoryWorkspaceSources(
  workspace: StoryWorkspaceSnapshot,
  query: string,
  maxCharacters = 48_000,
): string {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) throw new Error('故事资料检索上限无效')
  const terms = queryTerms(query)
  const passagesBySource = new Map(workspace.sources.map(source => [source.id, splitStorySourcePassages(source)]))
  const ranked = workspace.sources.flatMap((source, sourceIndex) => {
    if (!source.enabled || source.kind === 'web') return []
    return splitStorySourcePassages(source).map((passage, chunkIndex): RankedExcerpt => ({
      sourceIndex,
      chunkIndex,
      sourceId: source.id,
      sourceName: source.name,
      locator: passage.locator,
      text: passage.text,
      score: relevance(passage.text, terms),
    }))
  }).filter(excerpt => excerpt.score > 0).sort((left, right) => right.score - left.score
    || left.sourceIndex - right.sourceIndex || left.chunkIndex - right.chunkIndex)
  const selected: string[] = []
  const selectedKeys = new Set<string>()
  let characters = 0
  const append = (excerpt: RankedExcerpt): boolean => {
    const key = `${excerpt.sourceId}:${String(excerpt.chunkIndex)}`
    if (selectedKeys.has(key)) return true
    const rendered = `### ${excerpt.sourceName} · ${excerpt.locator}\n${excerpt.text}`
    const separatorLength = selected.length === 0 ? 0 : 2
    const remaining = maxCharacters - characters - separatorLength
    if (remaining <= 0 || (selected.length > 0 && rendered.length > remaining)) return false
    const value = rendered.slice(0, remaining)
    selected.push(value)
    selectedKeys.add(key)
    characters += value.length + separatorLength
    return true
  }
  for (const excerpt of ranked) {
    if (!append(excerpt)) continue
    const passages = passagesBySource.get(excerpt.sourceId) ?? []
    for (const chunkIndex of [excerpt.chunkIndex - 1, excerpt.chunkIndex + 1]) {
      const passage = passages[chunkIndex]
      if (passage === undefined) continue
      append({
        sourceIndex: excerpt.sourceIndex,
        chunkIndex,
        sourceId: excerpt.sourceId,
        sourceName: excerpt.sourceName,
        locator: passage.locator,
        text: passage.text,
        score: excerpt.score,
      })
    }
    if (characters >= maxCharacters) break
  }
  return selected.join('\n\n')
}
