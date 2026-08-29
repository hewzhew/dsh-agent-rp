/** Installation of the profile bundle's managed Agent RP preset. */

import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** Preset id selected by the bundle's profile patch. */
export const AGENT_RP_PRESET_ID = 'agent-rp'

const OWNER = '@hewzhew/dsh-agent-rp'
const LEGACY_OWNERS = new Set(['@dsh-external/dsh-agent-rp'])
const MANIFEST = '.dsh-agent-rp-owner.json'
const PRESET_FILES = ['agent.cordis.yml', 'preset.yml'] as const
type PresetFiles = readonly [composition: string, metadata: string]

interface OwnedPresetManifest {
  readonly owner: string
  readonly format: 0
  readonly digest: string
}

/** Observable outcome of one idempotent preset installation. */
export type PresetInstallResult = 'created' | 'updated' | 'unchanged'

/** Testable filesystem inputs for the managed-preset installer. */
export interface PresetInstallOptions {
  /** Directory scanned by the Host as its user preset root. */
  readonly presetRoot?: string
  /** Package-owned source directory containing the preset files. */
  readonly sourceDir?: string
}

function digest(files: PresetFiles): string {
  const hash = createHash('sha256')
  for (const [filename, content] of [
    [PRESET_FILES[0], files[0]],
    [PRESET_FILES[1], files[1]],
  ] as const) {
    hash.update(filename)
    hash.update('\0')
    hash.update(content)
    hash.update('\0')
  }
  return hash.digest('hex')
}

function readPresetFiles(directory: string): PresetFiles {
  return [
    readFileSync(join(directory, PRESET_FILES[0]), 'utf8'),
    readFileSync(join(directory, PRESET_FILES[1]), 'utf8'),
  ]
}

function readOwnedManifest(directory: string): OwnedPresetManifest {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(join(directory, MANIFEST), 'utf8'))
  } catch (error) {
    throw new Error(`Agent RP preset ${JSON.stringify(directory)} is not managed by ${OWNER}`, { cause: error })
  }
  const record = value as Partial<OwnedPresetManifest> | null
  if ((record?.owner !== OWNER && !LEGACY_OWNERS.has(record?.owner ?? ''))
    || record?.format !== 0 || typeof record.digest !== 'string') {
    throw new Error(`Agent RP preset ${JSON.stringify(directory)} has an invalid ownership manifest`)
  }
  return record as OwnedPresetManifest
}

function assertUnmodified(directory: string, manifest: OwnedPresetManifest): void {
  const expectedEntries = new Set<string>([...PRESET_FILES, MANIFEST])
  const entries = readdirSync(directory)
  if (entries.length !== expectedEntries.size || entries.some(entry => !expectedEntries.has(entry))) {
    throw new Error(`managed Agent RP preset ${JSON.stringify(directory)} contains unowned files`)
  }
  if (digest(readPresetFiles(directory)) !== manifest.digest) {
    throw new Error(`managed Agent RP preset ${JSON.stringify(directory)} was edited locally; copy it to another preset id before upgrading`)
  }
}

function stagePreset(root: string, files: PresetFiles, manifest: OwnedPresetManifest): string {
  const staging = join(root, `.${AGENT_RP_PRESET_ID}.install-${process.pid}-${randomUUID()}`)
  mkdirSync(staging)
  try {
    writeFileSync(join(staging, PRESET_FILES[0]), files[0], { encoding: 'utf8', mode: 0o600 })
    writeFileSync(join(staging, PRESET_FILES[1]), files[1], { encoding: 'utf8', mode: 0o600 })
    writeFileSync(join(staging, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    return staging
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

/**
 * Install or upgrade the package-owned preset without overwriting local work.
 * @param options - optional filesystem roots used by focused tests.
 * @returns whether the managed preset was created, updated, or already current.
 */
export function installBundledAgentRpPreset(options: PresetInstallOptions = {}): PresetInstallResult {
  const source = resolve(options.sourceDir ?? fileURLToPath(new URL('../preset/', import.meta.url)))
  const root = resolve(options.presetRoot ?? dshHomePath('.agent-presets'))
  const target = join(root, AGENT_RP_PRESET_ID)
  const files = readPresetFiles(source)
  const sourceDigest = digest(files)
  const nextManifest: OwnedPresetManifest = { owner: OWNER, format: 0, digest: sourceDigest }

  mkdirSync(root, { recursive: true, mode: 0o700 })
  if (existsSync(target)) {
    const current = readOwnedManifest(target)
    assertUnmodified(target, current)
    if (current.owner === OWNER && current.digest === sourceDigest) return 'unchanged'
  }

  const staging = stagePreset(root, files, nextManifest)
  if (!existsSync(target)) {
    try {
      renameSync(staging, target)
      return 'created'
    } catch (error) {
      rmSync(staging, { recursive: true, force: true })
      throw error
    }
  }

  const backup = join(root, `.${AGENT_RP_PRESET_ID}.backup-${process.pid}-${randomUUID()}`)
  renameSync(target, backup)
  try {
    renameSync(staging, target)
  } catch (error) {
    renameSync(backup, target)
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
  rmSync(backup, { recursive: true, force: true })
  return 'updated'
}
