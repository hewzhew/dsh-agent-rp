/** Deterministic chapter and paragraph projection over editable story-source text. */

import type { StorySource } from './story-workspace-protocol.ts'

const MAX_PASSAGE_CHARACTERS = 2_000

/** One reader-visible and citeable source passage. */
export interface StorySourcePassage {
  readonly ordinal: number
  readonly locator: string
  readonly text: string
}

/** Split one source into bounded passages while retaining the nearest Markdown heading. */
export function splitStorySourcePassages(source: StorySource): readonly StorySourcePassage[] {
  const blocks = source.content.replace(/\r\n?/gu, '\n').split(/\n{2,}/u).map(value => value.trim()).filter(Boolean)
  const passages: StorySourcePassage[] = []
  let heading = ''
  let paragraph = 0
  for (const block of blocks) {
    const match = /^#{1,6}\s+(.+)$/u.exec(block)
    if (match !== null) {
      heading = match[1]?.trim() ?? ''
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
