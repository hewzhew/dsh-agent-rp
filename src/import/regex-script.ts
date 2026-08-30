/** Shared SillyTavern regex-script parsing. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ImportedRegexScript } from './types.ts'

type JsonObject = { [key: string]: JsonValue }

function object(value: JsonValue | undefined, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value
}

function requiredString(value: JsonValue | undefined, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  return value
}

function optionalBoolean(value: JsonValue | undefined, path: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`)
  return value
}

function optionalFiniteNumber(value: JsonValue | undefined, path: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`)
  return value
}

function optionalSubstituteRegex(value: JsonValue | undefined, path: string): number | undefined {
  if (value === undefined) return undefined
  const normalized = typeof value === 'number'
    ? value
    : typeof value === 'string' || typeof value === 'boolean' || value === null
      ? Number(value)
      : Number.NaN
  if (!Number.isFinite(normalized)) throw new Error(`${path} must be a finite numeric value`)
  return normalized
}

function stringArray(value: JsonValue | undefined, path: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${path} must be an array of strings`)
  }
  return [...value] as string[]
}

function numberArray(value: JsonValue | undefined, path: string): number[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error(`${path} must be an array of finite numbers`)
  }
  return [...value] as number[]
}

function nullableFiniteNumber(value: JsonValue | undefined, path: string): number | null {
  if (value === undefined || value === null) return null
  return optionalFiniteNumber(value, path) ?? null
}

/** Parse one imported extension regex without executing it. */
export function parseRegexScript(value: JsonValue, path: string): ImportedRegexScript {
  const script = object(value, path)
  return {
    ...(typeof script.id === 'string' && script.id.trim() !== '' ? { id: script.id } : {}),
    scriptName: requiredString(script.scriptName, `${path}.scriptName`),
    findRegex: requiredString(script.findRegex, `${path}.findRegex`),
    replaceString: requiredString(script.replaceString, `${path}.replaceString`),
    trimStrings: stringArray(script.trimStrings, `${path}.trimStrings`),
    placement: numberArray(script.placement, `${path}.placement`),
    disabled: optionalBoolean(script.disabled, `${path}.disabled`) ?? false,
    markdownOnly: optionalBoolean(script.markdownOnly, `${path}.markdownOnly`) ?? false,
    promptOnly: optionalBoolean(script.promptOnly, `${path}.promptOnly`) ?? false,
    runOnEdit: optionalBoolean(script.runOnEdit, `${path}.runOnEdit`) ?? false,
    substituteRegex: optionalSubstituteRegex(script.substituteRegex, `${path}.substituteRegex`) ?? 0,
    minDepth: nullableFiniteNumber(script.minDepth, `${path}.minDepth`),
    maxDepth: nullableFiniteNumber(script.maxDepth, `${path}.maxDepth`),
  }
}
