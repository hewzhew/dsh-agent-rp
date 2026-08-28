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

function sourceHeading(line: string): string | undefined {
  const markdown = /^#{1,6}\s+(.+?)(?:\s+#+)?$/u.exec(line)
  if (markdown !== null) return markdown[1]?.trim()
  return line.length <= 120 && PLAIN_TEXT_HEADING.test(line) ? line : undefined
}

/** Split one source into bounded passages while retaining the nearest Markdown heading. */
export function splitStorySourcePassages(source: StorySource): readonly StorySourcePassage[] {
  const passages: StorySourcePassage[] = []
  let heading = ''
  let paragraph = 0
  for (const line of source.content.replace(/\r\n?/gu, '\n').split('\n')) {
    const block = line.trim()
    if (block === '') continue
    const nextHeading = sourceHeading(block)
    if (nextHeading !== undefined) {
      heading = nextHeading
      paragraph = 0
      continue
    }
    for (let offset = 0; offset < block.length; offset += MAX_PASSAGE_CHARACTERS) {
      paragraph += 1
      passages.push({
        ordinal: passages.length,
        locator: `${heading === '' ? '' : `${heading} · `}第 ${String(paragraph)} 段`,
        text: block.slice(offset, offset + MAX_PASSAGE_CHARACTERS),
      })
    }
  }
  return passages
}
