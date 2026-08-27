/** Deterministic local retrieval over editable story sources. */

import type { StoryWorkspaceSnapshot } from './story-workspace-protocol.ts'

const MAX_CHUNK_CHARACTERS = 1_200

interface RankedExcerpt {
  readonly sourceIndex: number
  readonly chunkIndex: number
  readonly sourceName: string
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

function chunks(content: string): readonly string[] {
  const paragraphs = content.replace(/\r\n?/gu, '\n').split(/\n{2,}/u).map(value => value.trim()).filter(Boolean)
  const result: string[] = []
  for (const paragraph of paragraphs) {
    for (let offset = 0; offset < paragraph.length; offset += MAX_CHUNK_CHARACTERS) {
      result.push(paragraph.slice(offset, offset + MAX_CHUNK_CHARACTERS))
    }
  }
  return result
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
  const ranked = workspace.sources.flatMap((source, sourceIndex) => {
    if (!source.enabled) return []
    return chunks(source.content).map((text, chunkIndex): RankedExcerpt => ({
      sourceIndex,
      chunkIndex,
      sourceName: source.name,
      text,
      score: relevance(text, terms),
    }))
  }).sort((left, right) => right.score - left.score
    || left.sourceIndex - right.sourceIndex || left.chunkIndex - right.chunkIndex)
  const selected: string[] = []
  let characters = 0
  for (const excerpt of ranked) {
    const rendered = `### ${excerpt.sourceName}\n${excerpt.text}`
    if (selected.length > 0 && characters + rendered.length + 2 > maxCharacters) continue
    selected.push(rendered.slice(0, Math.max(0, maxCharacters - characters)))
    characters += rendered.length + 2
    if (characters >= maxCharacters) break
  }
  return selected.join('\n\n')
}
