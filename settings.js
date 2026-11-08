/**
 * Persistent settings for the "new-session preset" half of this plugin (v1.1).
 *
 * The connector row's own config (clientId/secret/access policy) stays in the
 * DSH profile patch; these settings are plugin-owned and live next to the
 * connector's state directory so a user can inspect or delete them:
 *
 *   %USERPROFILE%\.dsh-dingtalk\plugin-settings.json      (mode 0600)
 *   %USERPROFILE%\.dsh-dingtalk\persona\<name>.md         (uploaded personas)
 *
 * `DSH_DINGTALK_STATE_DIR` overrides the directory (the connector honours the
 * same variable, which is also what the isolated verification harness uses).
 */
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'

/** Default persona file offered by the settings page ('' = not configured). */
export const DEFAULT_PERSONA_PATH = ''

/** Model requested by default for new sessions. */
export const DEFAULT_MODEL = 'deepseek-v4.1-flash'

/** Permission preset requested by default for new sessions ("工作区可修改"). */
export const DEFAULT_PERMISSION = 'workspace-write'

/** Agent preset requested by default for new sessions ("标准模式"). */
export const DEFAULT_AGENT_PRESET = 'standard'

/** Reasoning effort requested by default for new sessions. */
export const DEFAULT_REASONING = 'high'

/** Persona files larger than this are refused rather than truncated silently. */
export const MAX_PERSONA_BYTES = 256 * 1024

/** Locate the connector/plugin state directory (honours `DSH_DINGTALK_STATE_DIR`). */
export function stateDir() {
  const override = process.env.DSH_DINGTALK_STATE_DIR
  if (typeof override === 'string' && override.trim() !== '') return resolve(override.trim())
  const home = process.env.USERPROFILE || process.env.HOME || ''
  return home === '' ? '' : join(home, '.dsh-dingtalk')
}

/** Absolute path of the settings file, or '' when no home directory is known. */
export function settingsFile() {
  const dir = stateDir()
  return dir === '' ? '' : join(dir, 'plugin-settings.json')
}

/** Directory holding uploaded persona copies. */
export function personaDir() {
  const dir = stateDir()
  return dir === '' ? '' : join(dir, 'persona')
}

/** A fresh settings object carrying every documented default. */
export function defaultSettings() {
  return {
    version: 1,
    preset: {
      enabled: false,
      workspace: '',
      agentPreset: DEFAULT_AGENT_PRESET,
      permission: DEFAULT_PERMISSION,
      model: DEFAULT_MODEL,
      reasoning: DEFAULT_REASONING,
    },
    persona: {
      enabled: false,
      choice: 'default',
      customPath: '',
      customName: '',
    },
    intro: {
      enabled: true,
    },
  }
}

function text(value, fallback = '', max = 4096) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed === '' ? fallback : trimmed.slice(0, max)
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Merge a persisted/incoming object onto the defaults, dropping anything the
 * page is not allowed to set (unknown enum values fall back to the default).
 */
export function normalizeSettings(raw) {
  const base = defaultSettings()
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const preset = source.preset !== null && typeof source.preset === 'object' ? source.preset : {}
  const persona = source.persona !== null && typeof source.persona === 'object' ? source.persona : {}
  const intro = source.intro !== null && typeof source.intro === 'object' ? source.intro : {}
  const choice = typeof persona.choice === 'string' && /^(default|custom)$/u.test(persona.choice) ? persona.choice : 'default'
  return {
    version: 1,
    preset: {
      enabled: bool(preset.enabled, base.preset.enabled),
      workspace: text(preset.workspace, ''),
      agentPreset: text(preset.agentPreset, base.preset.agentPreset, 128),
      permission: text(preset.permission, base.preset.permission, 128),
      model: text(preset.model, base.preset.model, 256),
      reasoning: text(preset.reasoning, base.preset.reasoning, 128),
    },
    persona: {
      enabled: bool(persona.enabled, base.persona.enabled),
      choice,
      customPath: text(persona.customPath, '', 4096),
      customName: text(persona.customName, '', 256),
    },
    intro: {
      enabled: bool(intro.enabled, base.intro.enabled),
    },
  }
}

/** Read the persisted settings (defaults when absent or unreadable). */
export function loadSettings() {
  const file = settingsFile()
  if (file === '' || !existsSync(file)) return defaultSettings()
  try {
    return normalizeSettings(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return defaultSettings()
  }
}

/** Atomically persist settings; returns the normalized value that was written. */
export function saveSettings(next) {
  const normalized = normalizeSettings(next)
  const file = settingsFile()
  if (file === '') throw new Error('没有可用的用户目录，无法保存插件设置')
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.tmp.${process.pid}.${Date.now()}`
  writeFileSync(temporary, JSON.stringify(normalized, null, 2), { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, file)
  chmodSync(file, 0o600)
  return normalized
}

/** Identity of a persona file: its display name without the `.md` suffix. */
export function personaName(path) {
  if (typeof path !== 'string' || path.trim() === '') return ''
  const base = basename(path)
  return extname(base).toLowerCase() === '.md' ? base.slice(0, -3) : base
}

/** Uploaded persona copies, newest first. */
export function listUploadedPersonas() {
  const dir = personaDir()
  if (dir === '' || !existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter(name => extname(name).toLowerCase() === '.md')
      .map(name => {
        const path = join(dir, name)
        try {
          const stats = statSync(path)
          return { path, name: personaName(path), bytes: stats.size, modifiedAt: stats.mtimeMs }
        } catch {
          return undefined
        }
      })
      .filter(item => item !== undefined)
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
  } catch {
    return []
  }
}

/**
 * Store an uploaded markdown copy under the plugin's state directory.
 * The stored name is deterministic for the same content, so repeated uploads of
 * an unchanged file do not accumulate copies.
 */
export function savePersonaUpload(name, text) {
  const content = typeof text === 'string' ? text : ''
  if (content.trim() === '') throw new Error('上传的文件是空的')
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_PERSONA_BYTES) throw new Error(`文件过大（${bytes} 字节，上限 ${MAX_PERSONA_BYTES}）`)
  const dir = personaDir()
  if (dir === '') throw new Error('没有可用的用户目录，无法保存 md 文件')
  const rawName = typeof name === 'string' ? name : ''
  const displayName = (personaName(rawName) || 'persona').trim().slice(0, 64) || 'persona'
  const safe = (personaName(rawName) || 'persona')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 64) || 'persona'
  const hash = createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 8)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = join(dir, `${safe}·${hash}.md`)
  writeFileSync(target, content, { mode: 0o600 })
  chmodSync(target, 0o600)
  return { path: target, name: displayName, bytes }
}

/** Accept an absolute `.md` path from the page after checking it exists. */
export function acceptPersonaPath(path) {
  const value = text(path, '', 4096)
  if (value === '') throw new Error('路径为空')
  if (!isAbsolute(value)) throw new Error('请填写绝对路径')
  if (!existsSync(value)) throw new Error('文件不存在')
  const stats = statSync(value)
  if (!stats.isFile()) throw new Error('不是一个文件')
  if (extname(value).toLowerCase() !== '.md') throw new Error('只支持 .md 文件')
  if (stats.size > MAX_PERSONA_BYTES) throw new Error(`文件过大（${stats.size} 字节，上限 ${MAX_PERSONA_BYTES}）`)
  return { path: resolve(value), name: personaName(value), bytes: stats.size }
}

/**
 * Resolve the persona the settings currently select.
 * @returns `{ path, name, text, bytes, exists, error }`; `error` explains a
 * missing/unreadable file without throwing, so the settings page can show it.
 */
export function resolvePersona(settings) {
  const input = settings !== null && typeof settings === 'object' ? settings : defaultSettings()
  const persona = input.persona !== null && typeof input.persona === 'object' ? input.persona : {}
  const choice = persona.choice === 'custom' ? 'custom' : 'default'
  const path = choice === 'default' ? DEFAULT_PERSONA_PATH : text(persona.customPath, '')
  const storedName = personaName(path)
  const name = choice === 'custom' ? text(persona.customName, storedName, 256) : storedName
  if (path === '') return { path: '', name, text: '', bytes: 0, exists: false, error: '尚未选择 md 文件' }
  try {
    const stats = statSync(path)
    if (!stats.isFile()) return { path, name, text: '', bytes: 0, exists: false, error: '不是一个文件' }
    if (stats.size > MAX_PERSONA_BYTES) return { path, name, text: '', bytes: stats.size, exists: false, error: '文件过大' }
    const raw = readFileSync(path, 'utf8')
    if (raw.trim() === '') return { path, name, text: '', bytes: stats.size, exists: false, error: '文件内容为空' }
    return { path, name, text: raw, bytes: stats.size, exists: true, error: undefined }
  } catch (error) {
    return {
      path,
      name,
      text: '',
      bytes: 0,
      exists: false,
      error: existsSync(path) ? '文件读取失败' : '文件不存在',
      cause: error instanceof Error ? error.message : String(error),
    }
  }
}
