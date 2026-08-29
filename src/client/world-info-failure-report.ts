/** Player-requested local report for World Info evaluation failures. */

import type { EjsTemplateErrorDetail, EjsTemplateFailureKind } from '../ejs-template.ts'
import type { LorebookActivationReason } from '../import/lorebook.ts'

const MAX_REPORT_LABEL_LENGTH = 240
const MAX_FAILURE_REPORT_LENGTH = 64 * 1024

type WorldInfoFailureReason = Extract<LorebookActivationReason,
  | 'regex-runtime-unavailable'
  | 'regex-invalid'
  | 'regex-execution-limit'
  | 'regex-resource-limit'
  | 'decorator-unsupported'
  | 'template-unsupported'
  | 'template-error'
>

/** Minimal private identifiers needed to let a player locate one failing entry. */
export interface WorldInfoFailureReportBook {
  readonly name: string
  readonly source: 'character' | 'standalone'
  readonly entries: readonly {
    readonly sourceId: string
    readonly name?: string
    readonly comment?: string
    readonly reason: LorebookActivationReason
    readonly template?: 'rendered' | EjsTemplateFailureKind
    readonly templateError?: EjsTemplateErrorDetail
  }[]
}

function failureReason(reason: LorebookActivationReason): reason is WorldInfoFailureReason {
  return reason === 'regex-runtime-unavailable'
    || reason === 'regex-invalid'
    || reason === 'regex-execution-limit'
    || reason === 'regex-resource-limit'
    || reason === 'decorator-unsupported'
    || reason === 'template-unsupported'
    || reason === 'template-error'
}

function boundedLabel(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim() || fallback
  return normalized.length <= MAX_REPORT_LABEL_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_REPORT_LABEL_LENGTH)}…`
}

function sourceLabel(source: WorldInfoFailureReportBook['source']): string {
  return source === 'character' ? '角色卡' : '独立世界书'
}

/** Structured local details for one World Info evaluation failure. */
export interface WorldInfoFailureDetail {
  readonly bookName: string
  readonly bookSource: WorldInfoFailureReportBook['source']
  readonly entryName: string
  readonly sourceId: string
  readonly reason: WorldInfoFailureReason
  readonly template?: Exclude<NonNullable<WorldInfoFailureReportBook['entries'][number]['template']>, 'rendered'>
  readonly error?: EjsTemplateErrorDetail
}

/** Collect every currently available World Info failure with bounded identifiers. */
export function worldInfoFailureDetails(
  books: readonly WorldInfoFailureReportBook[],
): readonly WorldInfoFailureDetail[] {
  return books.flatMap(book => book.entries.flatMap(entry => {
    if (!failureReason(entry.reason)) return []
    const template = entry.reason === 'template-error' && entry.template !== undefined && entry.template !== 'rendered'
      ? entry.template : undefined
    return [{
      bookName: boundedLabel(book.name, '未命名世界书'),
      bookSource: book.source,
      entryName: boundedLabel(entry.name ?? entry.comment ?? '', `条目 ${entry.sourceId}`),
      sourceId: boundedLabel(entry.sourceId, '未知'),
      reason: entry.reason,
      ...(template === undefined ? {} : { template }),
      ...(entry.templateError === undefined ? {} : { error: entry.templateError }),
    }]
  }))
}

/** Build a local report without copying entry content, keywords, expressions, or model-visible text. */
export function worldInfoFailureReport(
  books: readonly WorldInfoFailureReportBook[],
  options: { readonly includeDebugErrors?: boolean } = {},
): string | undefined {
  const failures = worldInfoFailureDetails(books)
  if (failures.length === 0) return undefined
  const includeDebugErrors = options.includeDebugErrors === true
  const report = [
    'Agent RP 世界书失败详情',
    `格式: ${includeDebugErrors ? 'agent-rp-world-info-failures-debug-v0' : 'agent-rp-world-info-failures-v0'}`,
    `失败数: ${failures.length}`,
    '',
    ...failures.flatMap((entry, index) => [
      `[${index + 1}] ${entry.entryName}`,
      `世界书: ${entry.bookName}`,
      `来源: ${sourceLabel(entry.bookSource)}`,
      `条目编号: ${entry.sourceId}`,
      `类别: ${entry.reason}`,
      ...(entry.template === undefined ? [] : [`细分: ${entry.template}`]),
      ...(includeDebugErrors && entry.error !== undefined ? [
        ...(entry.error.name === undefined ? [] : [`错误名称: ${entry.error.name}`]),
        `错误消息: ${entry.error.message}`,
        ...(entry.error.stack === undefined ? [] : ['调用栈:', entry.error.stack]),
        ...(entry.error.truncated === true ? ['错误已截断: 是'] : []),
      ] : []),
      '',
    ]),
  ].join('\n').trimEnd()
  return report.length <= MAX_FAILURE_REPORT_LENGTH
    ? report
    : `${report.slice(0, MAX_FAILURE_REPORT_LENGTH - 10).trimEnd()}\n…内容已截断`
}
