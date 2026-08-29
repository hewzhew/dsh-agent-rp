/** Deterministic chapter and paragraph projection over editable story-source text. */

import type { StorySource } from './story-workspace-protocol.ts'

const MAX_PASSAGE_CHARACTERS = 2_000
const PLAIN_TEXT_HEADING = /^(?:第[0-9０-９一二三四五六七八九十百千万零〇两]+[章回卷部篇幕节集].{0,80}|序章.{0,80}|楔子.{0,80}|引子.{0,80}|前言.{0,80}|后记.{0,80}|终章.{0,80}|尾声.{0,80})$/u

/** One reader-visible and citeable source passage. */
export interface StorySourcePassage {
  readonly ordinal: number
  readonly locator: string
  readonly text: string
}

/** Exact occurrences of one quote within a citeable source passage. */
export interface StorySourceQuoteMatch {
  readonly passage: StorySourcePassage
  readonly occurrenceCount: number
}

/** One source passage with offsets into its normalized LF-only source text. */
export interface LocatedStorySourcePassage extends StorySourcePassage {
  readonly sourceStart: number
  readonly sourceEnd: number
}

const WIKI_SECTION_HEADING = /^(.{1,160}?)\s*\[(?:编辑|edit)\]$/iu

/** Project stable section labels without changing existing passage locators or ordinals. */
export function storySourcePassageSections(passages: readonly StorySourcePassage[]): readonly string[] {
  let section = '全文'
  return passages.map(passage => {
    const located = /^(.*?) · 第 \d+ 段$/u.exec(passage.locator)?.[1]?.trim()
    const wiki = WIKI_SECTION_HEADING.exec(passage.text)?.[1]?.trim()
    const next = located === undefined || located === '' ? wiki : located
    if (next !== undefined && next !== '') section = next
    return section
  })
}

interface IndexedSourceLine {
  readonly sourceStart: number
  readonly text: string
}

interface JoinedBlockPiece {
  readonly joinedStart: number
  readonly sourceStart: number
  readonly text: string
}

function sourceHeading(line: string): string | undefined {
  const markdown = /^#{1,6}\s+(.+?)(?:\s+#+)?$/u.exec(line)
  if (markdown !== null) return markdown[1]?.trim()
  return line.length <= 120 && PLAIN_TEXT_HEADING.test(line) ? line : undefined
}

/** Normalize source newlines for stable passage offsets and local citation processing. */
export function normalizeStorySourceContent(value: string): string {
  return value.replace(/\r\n?/gu, '\n')
}

/** Split one source into bounded passages and retain offsets used by dialogue retrieval. */
export function splitLocatedStorySourcePassages(source: StorySource): readonly LocatedStorySourcePassage[] {
  const passages: LocatedStorySourcePassage[] = []
  const content = normalizeStorySourceContent(source.content)
  let sourceOffset = 0
  const lines: IndexedSourceLine[] = content.split('\n').map(text => {
    const line = { sourceStart: sourceOffset, text }
    sourceOffset += text.length + 1
    return line
  })
  const preservesMarkdownParagraphs = lines.some(line => /^#{1,6}\s+/u.test(line.text.trim()))
  let heading = ''
  let paragraph = 0
  const appendBlock = (block: string, pieces: readonly JoinedBlockPiece[]): void => {
    for (let offset = 0; offset < block.length; offset += MAX_PASSAGE_CHARACTERS) {
      const end = Math.min(block.length, offset + MAX_PASSAGE_CHARACTERS)
      const first = pieces.find(piece => piece.joinedStart + piece.text.length > offset) ?? pieces.at(-1)!
      const last = [...pieces].reverse().find(piece => piece.joinedStart < end) ?? first
      paragraph += 1
      passages.push({
        ordinal: passages.length,
        locator: `${heading === '' ? '' : `${heading} · `}第 ${String(paragraph)} 段`,
        text: block.slice(offset, end),
        sourceStart: first.sourceStart + Math.max(0, offset - first.joinedStart),
        sourceEnd: last.sourceStart + Math.min(last.text.length, end - last.joinedStart),
      })
    }
  }
  if (!preservesMarkdownParagraphs) {
    for (const line of lines) {
      const block = line.text.trim()
      if (block === '') continue
      const nextHeading = sourceHeading(block)
      if (nextHeading !== undefined) {
        heading = nextHeading
        paragraph = 0
      } else {
        appendBlock(block, [{
          joinedStart: 0,
          sourceStart: line.sourceStart + line.text.indexOf(block),
          text: block,
        }])
      }
    }
    return passages
  }
  let pending: IndexedSourceLine[] = []
  const flush = (): void => {
    if (pending.length === 0) return
    let block = ''
    const pieces: JoinedBlockPiece[] = []
    for (const line of pending) {
      const text = line.text.trim()
      if (block !== '') block += '\n'
      pieces.push({
        joinedStart: block.length,
        sourceStart: line.sourceStart + line.text.indexOf(text),
        text,
      })
      block += text
    }
    appendBlock(block, pieces)
    pending = []
  }
  for (const line of lines) {
    const block = line.text.trim()
    if (block === '') {
      flush()
      continue
    }
    const nextHeading = sourceHeading(block)
    if (nextHeading !== undefined) {
      flush()
      heading = nextHeading
      paragraph = 0
    } else {
      pending.push(line)
    }
  }
  flush()
  return passages
}

/** Split one source into bounded passages while retaining the nearest source heading. */
export function splitStorySourcePassages(source: StorySource): readonly StorySourcePassage[] {
  return splitLocatedStorySourcePassages(source).map(({ ordinal, locator, text }) => ({ ordinal, locator, text }))
}

/** Find every exact quote occurrence while grouping candidates by citeable passage. */
export function findStorySourceQuoteMatches(
  passages: readonly StorySourcePassage[],
  quote: string,
): readonly StorySourceQuoteMatch[] {
  if (quote === '') return []
  return passages.flatMap(passage => {
    let occurrenceCount = 0
    for (let offset = passage.text.indexOf(quote); offset >= 0;
      offset = passage.text.indexOf(quote, offset + 1)) occurrenceCount += 1
    return occurrenceCount === 0 ? [] : [{ passage, occurrenceCount }]
  })
}
