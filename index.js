/**
 * DingTalk for DSH Desktop — Host half (v1.1.261022).
 *
 * One plugin, two rows (see `cordis.patch.yml`):
 *
 *   1. `dingtalk-channel` — the official `@dingtalk-real-ai/dsh-dingtalk`
 *      connector, inserted with a preset that makes Client ID + Client Secret
 *      enough to start talking (no `npx … setup`, no `/bind`).
 *   2. `dsh-dingtalk-plugin` — this file. It owns:
 *        - the Settings page's routes (connector config read/write, credential
 *          probe, reconnect, and the new "per-session preset" settings);
 *        - the new-session preset hook that seeds every DingTalk Session with
 *          the configured Agent preset / permission / model / reasoning effort
 *          and a personality markdown, and makes the first reply introduce the
 *          six seeded facts (see `session-preset.js`).
 *
 * The page never receives the Client Secret. Only a `hasSecret` flag and the
 * non-secret fields cross the HTTP boundary.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import {
  DEFAULT_PERSONA_PATH,
  acceptPersonaPath,
  listUploadedPersonas,
  loadSettings,
  normalizeSettings,
  personaName,
  resolvePersona,
  savePersonaUpload,
  saveSettings,
  stateDir,
} from './settings.js'
import {
  BUILT_IN_AGENT_PRESETS,
  BUILT_IN_PERMISSIONS,
  installSessionPresets,
} from './session-preset.js'

export const name = 'dsh-dingtalk-plugin'

/** Version shown in the settings page footer and in Host logs. */
export const VERSION = '1.1.261022'

/** Owner line required by the settings page footer. */
export const COPYRIGHT = '©snowwolf03'

/** The connector row inserted by `cordis.patch.yml`. */
const CONNECTOR_ID = 'dingtalk-channel'
const CONNECTOR_PACKAGE = '@dingtalk-real-ai/dsh-dingtalk'
const PREFIX = '/.dsh-dingtalk'
const PROBE_URL = 'https://api.dingtalk.com/v1.0/gateway/connections/open'
/** OAuth access-token exchange: the same call the official connector's diagnostics uses. */
const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken'
/** The robot message topic a Stream connection must subscribe to. */
const PROBE_TOPIC = '/v1.0/im/bot/messages/get'
const MAX_BODY_BYTES = 1024 * 1024

/** Attachment defaults: the connector's own defaults, mirrored for display. */
const FALLBACK = {
  senderAccess: 'all',
  groupAccess: 'all',
}

/** Default session workspace the connector uses when the row has no `workspace`. */
function defaultConnectorWorkspace() {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  return home === '' ? '' : join(home, 'dsh-dingtalk-workspace')
}

/** Last credential probe, kept in memory for the page. */
let lastProbe

function json(res, code, value) {
  const body = JSON.stringify(value)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
}

function fail(error) {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

/** The connector row, or undefined while the bundle has not mounted it yet. */
function findEntry(editor) {
  if (editor === undefined || typeof editor.entries !== 'function') return undefined
  return editor.entries().find(row => row?.options?.id === CONNECTOR_ID)
}

/** Raw configuration of the connector row as the Loader composed it. */
function rawConfig(entry) {
  if (entry === undefined) return {}
  const config = entry.options?.config
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return {}
  return config
}

function text(value, max = 512) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length > max) throw new Error(`字段长度超过 ${max}`)
  return trimmed
}

function stringList(value) {
  if (!Array.isArray(value)) return undefined
  const list = []
  for (const item of value) {
    if (typeof item !== 'string') throw new Error('白名单只能包含字符串')
    const clean = item.trim()
    if (clean !== '') list.push(clean)
  }
  return list.slice(0, 200)
}

function oneOf(value, allowed) {
  if (typeof value !== 'string') return undefined
  if (!allowed.includes(value)) throw new Error(`取值必须是 ${allowed.join(' / ')} 之一`)
  return value
}

/** Non-secret view of the row handed to the browser. */
function publicConfig(entry) {
  const config = rawConfig(entry)
  const secret = typeof config.clientSecret === 'string' ? config.clientSecret.trim() : ''
  const clientId = typeof config.clientId === 'string' ? config.clientId : ''
  const workspace = typeof config.workspace === 'string' ? config.workspace : ''
  return {
    clientId,
    hasSecret: secret !== '',
    clientSecretHint: secret === '' ? '' : `已保存（尾号 ${secret.slice(-4)}）`,
    ownerStaffId: typeof config.ownerStaffId === 'string' ? config.ownerStaffId : '',
    workspace,
    effectiveWorkspace: workspace.trim() !== '' ? workspace.trim() : defaultConnectorWorkspace(),
    senderAccess: typeof config.senderAccess === 'string' ? config.senderAccess : FALLBACK.senderAccess,
    groupAccess: typeof config.groupAccess === 'string' ? config.groupAccess : FALLBACK.groupAccess,
    allowedSenders: Array.isArray(config.allowedSenders) ? config.allowedSenders : [],
    groupAllowlist: Array.isArray(config.groupAllowlist) ? config.groupAllowlist : [],
  }
}

function connectorState(entry) {
  if (entry === undefined) {
    return { installed: connectorInstalled(), present: false, active: false, error: '连接器行尚未挂载' }
  }
  const state = entry.fiber?.state
  // cordis fiber states: 0 pending, 1 loading, 2 active, 3 failed, 4 disposed.
  const active = state === 2
  return {
    installed: connectorInstalled(),
    present: true,
    active,
    fiberState: typeof state === 'number' ? state : -1,
    error: active ? '' : state === 3 ? '连接器插件加载失败，请查看 DSH 启动日志' : '连接器尚未就绪',
  }
}

let installedCache

/** The connector's state directory (single-account mode). */
function connectorStateDir() {
  return stateDir()
}

/**
 * The connector records its live Stream verdict in `.dsh-dingtalk/runtime.json`
 * (`{stream:{status,observedAt}}`, fresh for 30 s). Reporting a stale record as
 * "connected" would lie, so freshness is part of the answer.
 */
function readStreamStatus() {
  const dir = connectorStateDir()
  if (dir === '') return undefined
  try {
    const data = JSON.parse(readFileSync(join(dir, 'runtime.json'), 'utf8'))
    const status = typeof data?.stream?.status === 'string' ? data.stream.status : ''
    const observedAt = typeof data?.stream?.observedAt === 'number' ? data.stream.observedAt : 0
    if (status === '' || observedAt === 0) return undefined
    return {
      status,
      fresh: Date.now() - observedAt <= 30_000,
      observedAt: new Date(observedAt).toISOString(),
    }
  } catch {
    return undefined
  }
}

/** Whether the connector package resolves from this plugin's install tree. */
function connectorInstalled() {
  if (installedCache !== undefined) return installedCache
  try {
    const resolved = import.meta.resolve(CONNECTOR_PACKAGE)
    installedCache = typeof resolved === 'string' && resolved !== ''
  } catch {
    installedCache = false
  }
  return installedCache
}

/** Effective workspace path of the connector row (what a new DingTalk session gets as cwd). */
export function connectorWorkspace(editor) {
  const entry = findEntry(editor)
  const configured = rawConfig(entry).workspace
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim()
  return defaultConnectorWorkspace()
}

/** The DSH Agent-preset registry row: the default preset new sessions resolve. */
function presetRegistryEntry(editor) {
  if (editor === undefined || typeof editor.entries !== 'function') return undefined
  return editor.entries().find(row => row?.options?.id === 'agent-preset-registry'
    || row?.options?.name === '@deepseek-ai/dsh-agent-preset-registry')
}

/** The preset id new Agents currently get by default ('' when unknown). */
function currentDefaultAgentPreset(editor) {
  const config = rawConfig(presetRegistryEntry(editor))
  if (typeof config.selectedDefault === 'string' && config.selectedDefault !== '') return config.selectedDefault
  if (typeof config.default === 'string') return config.default
  return ''
}

/** Which model providers/models and reasoning efforts the running Host can route. */
async function buildCatalog(ctx) {
  const catalog = {
    workspaces: [],
    agentPresets: [],
    permissions: [],
    models: [],
    defaultModel: undefined,
    personas: {
      defaultPath: DEFAULT_PERSONA_PATH,
      defaultName: personaName(DEFAULT_PERSONA_PATH),
      defaultExists: existsSync(DEFAULT_PERSONA_PATH),
      uploaded: listUploadedPersonas().map(item => ({ path: item.path, name: item.name, bytes: item.bytes })),
    },
  }
  const get = service => (typeof ctx?.get === 'function' ? ctx.get(service) : undefined)
  try {
    const registry = get('workspaceRegistry')
    for (const workspace of registry?.list?.() ?? []) {
      catalog.workspaces.push({
        id: String(workspace?.id ?? ''),
        title: typeof workspace?.title === 'string' ? workspace.title : '',
        path: typeof workspace?.path === 'string' ? workspace.path : '',
      })
    }
  } catch {
    /* catalog is best effort */
  }
  try {
    const presets = get('agentPresets')
    for (const row of (await presets?.list?.()) ?? []) {
      const id = typeof row?.id === 'string' ? row.id : ''
      if (id === '') continue
      const builtIn = BUILT_IN_AGENT_PRESETS[id]
      catalog.agentPresets.push({
        id,
        name: typeof row?.name === 'string' && row.name !== '' ? row.name : builtIn?.name ?? id,
        description: typeof row?.description === 'string' ? row.description : builtIn?.description ?? '',
        builtin: builtIn !== undefined,
      })
    }
  } catch {
    /* preset roster unavailable */
  }
  try {
    const permissions = get('permissionPresets')?.catalog?.()
    for (const option of permissions?.options ?? []) {
      const value = typeof option?.value === 'string' ? option.value : ''
      if (value === '') continue
      const builtIn = BUILT_IN_PERMISSIONS[value]
      catalog.permissions.push({
        value,
        name: builtIn?.name ?? (typeof option?.name === 'string' ? option.name : value),
        description: builtIn?.description ?? (typeof option?.description === 'string' ? option.description : ''),
      })
    }
  } catch {
    /* permission catalog unavailable */
  }
  try {
    const modelCatalog = await get('sessionController')?.modelCatalog?.()
    for (const group of modelCatalog?.groups ?? []) {
      const provider = typeof group?.id === 'string' ? group.id : ''
      if (provider === '') continue
      for (const model of group?.models ?? []) {
        const id = typeof model?.id === 'string' ? model.id : ''
        if (id === '') continue
        const efforts = Array.isArray(model?.reasoning?.efforts) ? model.reasoning.efforts : []
        catalog.models.push({
          provider,
          providerName: typeof group?.name === 'string' ? group.name : provider,
          id,
          name: typeof model?.name === 'string' ? model.name : id,
          description: typeof model?.description === 'string' ? model.description : '',
          defaultReasoning: typeof model?.reasoning?.defaultEffort === 'string' ? model.reasoning.defaultEffort : '',
          reasoning: efforts.map(effort => ({
            id: String(effort?.id ?? ''),
            name: typeof effort?.name === 'string' ? effort.name : String(effort?.id ?? ''),
          })),
        })
      }
    }
    if (modelCatalog?.default !== undefined) catalog.defaultModel = modelCatalog.default
  } catch {
    /* model catalog unavailable */
  }
  return catalog
}

/** Settings + resolved persona view handed to the settings page. */
function settingsSnapshot(editor) {
  const settings = loadSettings()
  const persona = resolvePersona(settings)
  return {
    settings,
    persona: {
      choice: settings.persona.choice,
      enabled: settings.persona.enabled,
      path: persona.path,
      name: persona.name,
      exists: persona.exists === true,
      bytes: persona.bytes,
      error: persona.error ?? '',
    },
    effectiveWorkspace: connectorWorkspace(editor),
    defaultAgentPreset: currentDefaultAgentPreset(editor),
  }
}

async function stateSnapshot(ctx, editor) {
  const entry = findEntry(editor)
  return {
    ok: true,
    marker: 'dsh-dingtalk-plugin',
    version: VERSION,
    copyright: COPYRIGHT,
    connector: { ...connectorState(entry), package: CONNECTOR_PACKAGE },
    config: publicConfig(entry),
    stream: readStreamStatus() ?? null,
    lastProbe: lastProbe ?? null,
    ...settingsSnapshot(editor),
    catalog: await buildCatalog(ctx),
  }
}

/** POST JSON to a DingTalk Open Platform endpoint; never throws. */
async function postDingtalk(url, body) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    let payload
    try {
      payload = await response.json()
    } catch {
      payload = undefined
    }
    return { response, payload }
  } catch (error) {
    return { error }
  }
}

function dingtalkCode(result) {
  return typeof result.payload?.code === 'string' ? result.payload.code : `HTTP_${result.response?.status ?? 0}`
}

function dingtalkError(result, fallback) {
  if (typeof result.payload?.message === 'string' && result.payload.message !== '') return result.payload.message
  return fallback
}

/**
 * Probe the credentials twice: first the plain access-token exchange (the same
 * call the official connector's `doctor` makes, and the clearest verdict on the
 * Client ID / Secret pair), then the Stream gateway open call that proves the
 * application really has Stream mode / the robot enabled.
 */
async function probeCredentials(editor, body) {
  const entry = findEntry(editor)
  const stored = rawConfig(entry)
  const clientId = typeof body.clientId === 'string' && body.clientId.trim() !== ''
    ? body.clientId.trim()
    : typeof stored.clientId === 'string' ? stored.clientId.trim() : ''
  const clientSecret = typeof body.clientSecret === 'string' && body.clientSecret.trim() !== ''
    ? body.clientSecret.trim()
    : typeof stored.clientSecret === 'string' ? stored.clientSecret.trim() : ''
  if (clientId === '') return { ok: false, stage: 'input', code: 'MISSING_CLIENT_ID', message: '请先填写 Client ID（AppKey）' }
  if (clientSecret === '') return { ok: false, stage: 'input', code: 'MISSING_CLIENT_SECRET', message: '请先填写 Client Secret（AppSecret）' }
  if (/\s/u.test(clientId) || /\s/u.test(clientSecret)) {
    return { ok: false, stage: 'input', code: 'WHITESPACE', message: 'Client ID 和 Client Secret 中不应包含空格，请检查是否复制了整个单元格' }
  }

  const token = await postDingtalk(TOKEN_URL, { appKey: clientId, appSecret: clientSecret })
  if (token.error !== undefined) {
    return {
      ok: false,
      stage: 'network',
      code: 'NETWORK',
      message: `无法连接钉钉开放平台（api.dingtalk.com）：${token.error instanceof Error ? token.error.message : String(token.error)}`,
    }
  }
  if (!token.response.ok) {
    const code = dingtalkCode(token)
    const rawMessage = dingtalkError(token, `钉钉拒绝了凭据（HTTP ${token.response.status}）`)
    const friendly = /authFailed|invalidClientIdOrSecret|InvalidAuthentication/u.test(code) || token.response.status === 401 || token.response.status === 400
      ? 'Client ID 或 Client Secret 不正确（钉钉返回：无效的 clientId 或 clientSecret）'
      : rawMessage
    return { ok: false, stage: 'credentials', code, message: friendly, rawMessage, status: token.response.status }
  }

  const stream = await postDingtalk(PROBE_URL, {
    clientId,
    clientSecret,
    subscriptions: [{ type: 'CALLBACK', topic: PROBE_TOPIC }],
    ua: `dsh-dingtalk-plugin/${VERSION}`,
  })
  if (stream.error !== undefined) {
    return {
      ok: false,
      stage: 'network',
      code: 'NETWORK',
      message: `凭据有效，但无法连接 Stream 网关：${stream.error instanceof Error ? stream.error.message : String(stream.error)}`,
    }
  }
  if (!stream.response.ok) {
    const code = dingtalkCode(stream)
    const rawMessage = dingtalkError(stream, `Stream 网关拒绝了连接（HTTP ${stream.response.status}）`)
    const friendly = `凭据有效，但应用无法建立 Stream 连接：${rawMessage}。请在钉钉开放平台确认应用已添加机器人、消息接收方式为 Stream 模式，并已发布/开通权限。`
    return { ok: false, stage: 'stream', code, message: friendly, rawMessage, status: stream.response.status }
  }
  // The ticket is intentionally not redeemed: the connector owns the real
  // WebSocket, and this probe only answers "would it be able to connect?".
  return {
    ok: true,
    stage: 'stream',
    code: 'OK',
    message: '凭据有效，钉钉已接受 Stream 连接请求',
    endpoint: typeof stream.payload?.endpoint === 'string' ? stream.payload.endpoint : '',
  }
}

/** Validate and persist the "new-session preset" section. */
function savePresetSection(body) {
  const input = body !== null && typeof body === 'object' && body.settings !== null && typeof body.settings === 'object'
    ? body.settings
    : body
  const current = loadSettings()
  const patch = input !== null && typeof input === 'object' ? input : {}
  const next = normalizeSettings({
    ...current,
    ...patch,
    preset: { ...current.preset, ...(patch.preset !== null && typeof patch.preset === 'object' ? patch.preset : {}) },
    persona: { ...current.persona, ...(patch.persona !== null && typeof patch.persona === 'object' ? patch.persona : {}) },
    intro: { ...current.intro, ...(patch.intro !== null && typeof patch.intro === 'object' ? patch.intro : {}) },
  })
  if (next.preset.enabled && next.preset.workspace !== '') {
    if (!isAbsolute(next.preset.workspace)) throw new Error('工作空间必须是绝对路径')
    if (!existsSync(next.preset.workspace)) throw new Error(`工作空间不存在：${next.preset.workspace}`)
    if (!statSync(next.preset.workspace).isDirectory()) throw new Error('工作空间不是一个目录')
    next.preset.workspace = resolve(next.preset.workspace)
  }
  if (next.persona.enabled && next.persona.choice === 'custom' && next.persona.customPath !== '') {
    acceptPersonaPath(next.persona.customPath)
  }
  return saveSettings(next)
}

/** Store an uploaded personality markdown or accept an existing absolute path. */
function savePersona(body) {
  let saved
  if (typeof body.text === 'string') {
    saved = savePersonaUpload(typeof body.name === 'string' ? body.name : '', body.text)
  } else if (typeof body.path === 'string') {
    saved = acceptPersonaPath(body.path)
  } else {
    throw new Error('需要 { name, text } 或 { path }')
  }
  const settings = loadSettings()
  settings.persona.customPath = saved.path
  settings.persona.customName = saved.name
  settings.persona.choice = 'custom'
  saveSettings(settings)
  return saved
}

/**
 * Keep the DSH default Agent preset in sync with the settings.
 *
 * The Agent preset can only be chosen when an Agent is created, and the DingTalk
 * connector resolves it from the registry default (`agentPresets.resolve(undefined)`).
 * Re-selecting a preset on a live Agent duplicates tool registrations inside the
 * shared preset realm, after which every later session fails with
 * `tool "subagent" is already registered in this scope` — so the preset is
 * written here, as the registry's default, instead.
 *
 * @returns warnings to show in the settings page; empty when nothing went wrong.
 */
async function syncDefaultAgentPreset(editor, settings) {
  const warnings = []
  if (editor === undefined || typeof editor.edit !== 'function') return warnings
  const registry = presetRegistryEntry(editor)
  if (registry === undefined) {
    if (settings.preset.enabled) warnings.push('找不到 Agent 预设注册表行，Agent 预设未生效')
    return warnings
  }
  const current = rawConfig(registry).selectedDefault
  try {
    if (settings.preset.enabled) {
      if (settings.preset.agentPreset !== '' && current !== settings.preset.agentPreset) {
        await editor.edit(registry, value => ({
          ...(value !== null && typeof value === 'object' ? value : {}),
          selectedDefault: settings.preset.agentPreset,
        }))
      }
    } else if (current === settings.preset.agentPreset) {
      // Disabling the feature restores the deployment default preset.
      await editor.edit(registry, value => {
        const next = { ...(value !== null && typeof value === 'object' ? value : {}) }
        delete next.selectedDefault
        return next
      })
    }
  } catch (error) {
    warnings.push(`Agent 预设写入失败：${error instanceof Error ? error.message : String(error)}`)
  }
  return warnings
}

export function apply(ctx) {
  // New-session preset hooks: seed every DingTalk Session from the settings page.
  const hookDeps = {
    log: message => console.log(`[dsh-dingtalk-plugin] ${message}`),
    getSettings: () => loadSettings(),
    getConnectorWorkspace: () => {
      const editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined
      return connectorWorkspace(editor)
    },
    getCatalog: () => buildCatalog(ctx),
  }
  const install = () => installSessionPresets(ctx, hookDeps)
  if (typeof ctx.effect === 'function') ctx.effect(install)
  else install()

  // Keep the DSH default Agent preset aligned with the saved settings, so an
  // upgraded install needs no extra "save" click. Best effort: without a
  // configEditor (or with the feature disabled) the default stays untouched.
  if (typeof ctx.get === 'function' && typeof ctx.inject === 'function') {
    ctx.inject(['configEditor'], editorCtx => {
      const editor = editorCtx.get('configEditor')
      if (editor === undefined) return
      void syncDefaultAgentPreset(editor, loadSettings())
        .then(warnings => {
          for (const warning of warnings) console.log(`[dsh-dingtalk-plugin] ${warning}`)
        })
        .catch(() => {})
    })
  }

  // The settings page needs `configEditor`; the routes need `webServer`. Both
  // are looked up lazily so this plugin still activates (and the client section
  // still registers) if one of them arrives later or is missing.
  ctx.inject(['webServer'], webCtx => {
    const editor = () => webCtx.get('configEditor')
    const dispose = webCtx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const route = url.pathname
        try {
          // Reuse DSH's own localhost/browser-trust fence: loopback Host, not a
          // cross-site fetch, and a same-origin Origin when the browser sends
          // one. Undefined means "allowed".
          const connection = webCtx.get('connection')
          const rejection = connection === undefined || typeof connection.requestRejection !== 'function'
            ? undefined
            : connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end()
            return
          }
          if (req.method === 'GET' && (route === `${PREFIX}/state` || route === `${PREFIX}/config`)) {
            return json(res, 200, await stateSnapshot(webCtx, editor()))
          }
          if (req.method === 'GET' && route === `${PREFIX}/personas`) {
            return json(res, 200, { ok: true, personas: listUploadedPersonas() })
          }
          // Every mutating route requires a JSON body: a cross-origin form post
          // cannot set this content type without a CORS preflight, which this
          // server never grants.
          if (req.method !== 'POST') return json(res, 405, { ok: false, error: '方法不允许' })
          if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
            return json(res, 415, { ok: false, error: '需要 application/json 请求体' })
          }
          // A missing content-length is fine (chunked); an empty body means {}.
          const body = await readJson(req)

          if (route === `${PREFIX}/test`) {
            const result = await probeCredentials(editor(), body)
            lastProbe = { ...result, at: new Date().toISOString() }
            return json(res, 200, { ok: result.ok, probe: lastProbe })
          }

          if (route === `${PREFIX}/reconnect`) {
            const ce = editor()
            const entry = findEntry(ce)
            if (entry === undefined) return json(res, 409, { ok: false, error: '连接器还没挂载，请重启 DSH 后再试' })
            try {
              await ce.edit(entry, current => current)
            } catch (error) {
              return json(res, 409, { ok: false, error: `重新连接失败：${error instanceof Error ? error.message : String(error)}` })
            }
            return json(res, 200, { ok: true, state: await stateSnapshot(webCtx, ce) })
          }

          if (route === `${PREFIX}/persona`) {
            const saved = savePersona(body)
            return json(res, 200, {
              ok: true,
              uploaded: { path: saved.path, name: saved.name, bytes: saved.bytes },
              state: await stateSnapshot(webCtx, editor()),
            })
          }

          if (route === `${PREFIX}/settings`) {
            const saved = savePresetSection(body)
            const ce = editor()
            const warnings = []
            // The preset workspace is the directory new DingTalk sessions are
            // created in, so persist it into the connector row as well; the
            // Loader then recomposes the row and the Stream reconnects (the
            // same path "保存并连接" uses).
            const entry = findEntry(ce)
            if (saved.preset.enabled && saved.preset.workspace !== '' && entry !== undefined) {
              if (rawConfig(entry).workspace !== saved.preset.workspace) {
                await ce.edit(entry, current => ({ ...(current !== null && typeof current === 'object' ? current : {}), workspace: saved.preset.workspace }))
              }
            }
            warnings.push(...await syncDefaultAgentPreset(ce, saved))
            return json(res, 200, { ok: true, saved: true, warnings, state: await stateSnapshot(webCtx, ce) })
          }

          if (route === `${PREFIX}/config`) {
            const ce = editor()
            if (ce === undefined) return json(res, 503, { ok: false, error: '配置编辑器不可用' })
            const entry = findEntry(ce)
            if (entry === undefined) return json(res, 409, { ok: false, error: '连接器还没挂载，请重启 DSH 后再试' })

            const clientId = text(body.clientId, 256)
            const clientSecret = text(body.clientSecret, 512)
            const ownerStaffId = text(body.ownerStaffId, 256)
            const workspace = text(body.workspace, 4096)
            const senderAccess = oneOf(body.senderAccess, ['all', 'owner', 'allowlist'])
            const groupAccess = oneOf(body.groupAccess, ['all', 'none', 'allowlist'])
            const allowedSenders = stringList(body.allowedSenders)
            const groupAllowlist = stringList(body.groupAllowlist)
            await ce.edit(entry, current => {
              const next = current !== null && typeof current === 'object' ? { ...current } : {}
              if (clientId !== undefined) {
                if (clientId === '') delete next.clientId
                else next.clientId = clientId
              }
              // An empty secret field means "keep the stored one": it is never
              // echoed back to the page, so blank cannot mean "clear".
              if (clientSecret !== undefined && clientSecret !== '') next.clientSecret = clientSecret
              if (ownerStaffId !== undefined) {
                // The connector denies everything while its owner is empty, so a
                // blank field means "keep the sentinel", never "clear the owner".
                next.ownerStaffId = ownerStaffId === '' ? 'dsh-user' : ownerStaffId
              }
              if (workspace !== undefined) {
                if (workspace === '') delete next.workspace
                else next.workspace = workspace
              }
              if (senderAccess !== undefined) next.senderAccess = senderAccess
              if (groupAccess !== undefined) next.groupAccess = groupAccess
              if (allowedSenders !== undefined) next.allowedSenders = allowedSenders
              if (groupAllowlist !== undefined) next.groupAllowlist = groupAllowlist
              return next
            })
            return json(res, 200, {
              ok: true,
              // The saved config itself is never echoed: it contains the secret.
              saved: true,
              // The Loader recomposed the connector row; the next probe is the
              // page's job so the user sees a fresh result against the new config.
              state: await stateSnapshot(webCtx, ce),
            })
          }

          return json(res, 404, { ok: false, error: '未知路由' })
        } catch (error) {
          return json(res, 500, fail(error))
        }
      },
    })
    webCtx.effect(() => dispose)
  })

  console.log(`[${name}] host half ${VERSION} loaded (Settings → 钉钉) ${COPYRIGHT}`)
}
