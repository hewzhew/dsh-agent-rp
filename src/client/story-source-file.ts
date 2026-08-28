/** Local text decoding for original-work and research sources. */

export const STORY_SOURCE_FILE_ACCEPT = '.txt,.md,.markdown,text/plain,text/markdown'
export const MAX_STORY_SOURCE_FILE_BYTES = 2 * 1024 * 1024

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('gb18030', { fatal: true }).decode(bytes)
  }
}

/** Decode one local TXT or Markdown source without uploading or executing it. */
export function decodeStorySourceFile(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_STORY_SOURCE_FILE_BYTES) {
    throw new Error(`单份资料文件不能超过 ${String(MAX_STORY_SOURCE_FILE_BYTES)} 字节`)
  }
  let text: string
  try {
    text = decodeText(bytes).replace(/\r\n?/gu, '\n')
  } catch (error: unknown) {
    throw new Error('资料文件不是可识别的 UTF-8、UTF-16 或 GB18030 文本', { cause: error })
  }
  if (text.includes('\0')) throw new Error('资料文件包含二进制内容，不能作为原文导入')
  if (text.trim() === '') throw new Error('资料文件没有可导入的文本')
  if (new TextEncoder().encode(text).byteLength > MAX_STORY_SOURCE_FILE_BYTES) {
    throw new Error(`解码后的资料不能超过 ${String(MAX_STORY_SOURCE_FILE_BYTES)} 字节`)
  }
  return text
}

/** Derive an editable source title from one local text filename. */
export function storySourceNameFromFile(fileName: string): string {
  const base = fileName.trim().replace(/\.(?:txt|md|markdown)$/iu, '').trim()
  return (base || '导入的原著资料').slice(0, 120)
}
