/**
 * "New-session preset" hooks for the DingTalk channel (v1.1).
 *
 * The official connector creates one DSH Session per DingTalk conversation and
 * mounts its own default Agent preset. This module lets the desktop plugin seed
 * each *new* DingTalk Session from the settings page instead:
 *
 *   - Agent preset (标准/PTC/极简/创造…)  -> the DSH default Agent preset
 *     (`agent-preset-registry.selectedDefault`, synced when settings are saved
 *     and on boot; the connector mounts it once at creation)
 *   - Permission preset (只读/工作区可修改/完全权限) -> permissionPresets.apply(...)
 *   - Model + reasoning effort            -> sessionController.selectForNextRequest(...)
 *   - Personality markdown                -> a scoped system-prompt section
 *   - Self introduction on the first turn -> a scoped system-prompt section
 *
 * All of it is best-effort: a failing step is logged and skipped, never thrown,
 * because `agent/created` listeners share the creation lifetime and a throw
 * would fail the Agent (and therefore the DingTalk reply).
 *
 * The hooks only touch sessions whose creation cwd is the connector's workspace
 * (or whose id is already bound in the connector's `bindings.json`), so ordinary
 * DSH sessions created in other directories are untouched.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolvePersona, stateDir } from './settings.js'

/** Display copy for the shipped agent presets (their ids are stable). */
export const BUILT_IN_AGENT_PRESETS = {
  standard: { name: '标准模式', description: '直接调用工具读写文件、检索资料、执行终端命令。' },
  ptc: { name: 'PTC 模式', description: '用 run_code 程序化编排工具调用，适合批量与复杂流程。' },
  minimal: { name: '极简模式', description: '只保留最小工具集，适合轻量问答。' },
  cordis: { name: '创造模式', description: '可在对话中编写 Cordis 插件与组合。' },
}

/** Display copy for the shipped permission presets. */
export const BUILT_IN_PERMISSIONS = {
  'read-only': { name: '只读', description: '只允许读取，不写入。' },
  'workspace-write': { name: '工作区可修改', description: '只允许在工作区与临时目录内写入，超范围需要审批。' },
  'danger-full-access': { name: '完全权限', description: '不做沙箱限制、不再弹审批。' },
  auto: { name: '自动', description: '由自动审批策略决定。' },
  custom: { name: '自定义', description: '当前沙箱与审批策略不匹配任何预设。' },
}

/**
 * Compatible model ids: the settings page's default asks for the marketing name
 * `deepseek-v4.1-flash`, while the running provider routes it as
 * `deepseek-flash` (display name "DeepSeek-V4.1-Flash").
 */
export const MODEL_ALIASES = {
  'deepseek-v4.1-flash': 'deepseek-flash',
}

/** Section order: right after the deployment persona prefix (order 0). */
const PERSONA_ORDER = 100
const INTRO_ORDER = 110

/** How much persona markdown is handed to the model. */
const MAX_PERSONA_CHARS = 60000

/** Agents already seeded by this plugin instance (one `agent/created` per agent object). */
const seeded = new WeakSet()

/** Names a section uniquely per plugin; DSH rejects duplicate section names in one scope. */
const PERSONA_SECTION = 'dingtalk:persona'
const INTRO_SECTION = 'dingtalk:intro'

function normalizePath(value) {
  return typeof value === 'string' ? value.replace(/[\\/]+$/u, '').toLowerCase() : ''
}

/** Read the connector's conversation→session binding ids (best effort). */
export function boundSessionIds() {
  const dir = stateDir()
  if (dir === '') return []
  const file = join(dir, 'bindings.json')
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? Object.values(parsed).filter(value => typeof value === 'string') : []
  } catch {
    return []
  }
}

/** Whether this Agent belongs to the DingTalk channel. */
export function isChannelSession(agent, connectorWorkspace) {
  const header = agent?.session?.header
  if (header === undefined || header === null) return false
  if (header.origin === 'subagent') return false
  const cwd = normalizePath(header.cwd)
  const workspace = normalizePath(connectorWorkspace)
  if (cwd !== '' && workspace !== '' && cwd === workspace) return true
  const id = typeof header.id === 'string' ? header.id : ''
  return id !== '' && boundSessionIds().includes(id)
}

/** Resolve the Agent preset display name for a preset id. */
export function agentPresetLabel(id, catalog) {
  if (typeof id !== 'string' || id === '') return '无'
  const builtIn = BUILT_IN_AGENT_PRESETS[id]
  if (builtIn !== undefined) return builtIn.name
  const match = Array.isArray(catalog?.agentPresets) ? catalog.agentPresets.find(item => item.id === id) : undefined
  return match?.name ?? id
}

/** Resolve the permission display name for a preset id. */
export function permissionLabel(id, catalog) {
  if (typeof id !== 'string' || id === '') return '无'
  const builtIn = BUILT_IN_PERMISSIONS[id]
  if (builtIn !== undefined) return builtIn.name
  const match = Array.isArray(catalog?.permissions) ? catalog.permissions.find(item => item.value === id) : undefined
  return match?.name ?? id
}

/** A short model label for the intro (`display name (provider/id)` when known). */
function modelLabel(provider, model, catalog) {
  if (typeof model !== 'string' || model === '') return '无'
  const routed = typeof provider === 'string' && provider !== '' ? `${provider}/${model}` : model
  const match = Array.isArray(catalog?.models) ? catalog.models.find(item => item.id === model && (provider === undefined || item.provider === provider)) : undefined
  if (match === undefined || typeof match.name !== 'string' || match.name === '' || match.name === model) return routed
  return `${match.name}（${routed}）`
}

/** The current model selection recorded on a Session, when one was logged. */
function loggedSelection(agent) {
  try {
    const header = agent?.session?.requestHeader?.()
    const config = header?.config
    if (config !== undefined && config !== null && typeof config.model === 'string') {
      return { provider: config.provider, model: config.model, reasoningEffort: config.reasoningEffort }
    }
  } catch {
    /* requestHeader() is optional on older Sessions. */
  }
  return undefined
}

/**
 * Build the first-turn self-introduction instruction. The six facts are baked
 * in so the model reports what the plugin actually applied instead of guessing.
 */
export function buildIntroText(values) {
  const lines = [
    '## 钉钉会话初始化信息（由 DSH 钉钉插件提供，仅供自我介绍使用）',
    '本会话由 DSH 桌面版的钉钉渠道创建。请在**本次会话的第一条回复**开头，用简洁的 6 行项目符号向用户自我介绍；介绍完再正常回答用户的问题。',
    '',
    '自我介绍必须包含且只包含以下 6 项，使用给定值：',
    `1. 性格预设 md：${values.personaName}`,
    `2. 工作空间：${values.workspace}`,
    `3. Agent 预设：${values.agentPreset}`,
    `4. 权限：${values.permission}`,
    `5. 模型：${values.model}`,
    `6. 推理等级：${values.reasoning}`,
    '',
    '规则：',
    '- 这些是会话创建时的初始设置。之后用户都可能在对话里要求调整；能自行完成的（例如切换工作目录、读写文件）直接照做，需要改权限、模型、Agent 预设或推理等级的，告诉用户到 DSH 桌面版「设置 → 钉钉 → 会话预设」修改后重开会话。',
    '- 若用户没有主动询问设置，不要反复重复这些信息；仅在第一条回复里介绍一次。',
    '- 回答保持用户的提问语言。',
  ]
  return lines.join('\n')
}

/** Build the personality section text (persona markdown wrapped with a short preface). */
export function buildPersonaText(persona) {
  if (persona === undefined || persona === null || persona.exists !== true) return ''
  const text = String(persona.text ?? '').slice(0, MAX_PERSONA_CHARS).trim()
  if (text === '') return ''
  return [
    `## 会话性格预设：${persona.name}（用户提供的 md 文件，本会话必须遵循）`,
    '',
    text,
  ].join('\n')
}

/** Apply the permission preset; returns the effective preset name. */
function applyPermission(ctx, agent, presetId, log) {
  const permissionPresets = ctx.get?.('permissionPresets')
  if (permissionPresets === undefined || typeof permissionPresets.apply !== 'function') {
    log(`permission: preset service unavailable; keeping "${presetId}" unapplied`)
    return undefined
  }
  const session = agent?.session
  try {
    if (permissionPresets.current?.(session) === presetId) return presetId
    permissionPresets.apply(session, presetId, policy => {
      try {
        ctx.get?.('approval')?.setPolicy(agent, policy)
      } catch (error) {
        log(`permission: approval policy update failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
    return presetId
  } catch (error) {
    log(`permission: cannot apply "${presetId}": ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/**
 * Apply a per-session model + reasoning-effort selection. Uses the durable
 * `model/selection` path (`selectForNextRequest`) so the process-wide default
 * model is NOT rewritten; falls back to the public `selectModel` Remote only if
 * the internal method is absent.
 */
async function applyModel(ctx, agent, preset, catalog, log) {
  const wanted = typeof preset?.model === 'string' ? preset.model.trim() : ''
  if (wanted === '') return undefined
  const models = Array.isArray(catalog?.models) ? catalog.models : []
  const candidates = [wanted, MODEL_ALIASES[wanted]].filter(value => typeof value === 'string' && value !== '')
  const none = models.find(item => candidates.includes(item.id))
  const fallback = catalog?.defaultModel
  // A deployment whose provider directory is not routable yet (or a harness
  // without provider credentials) still publishes the effective default model;
  // accept the requested alias when it resolves to that default.
  const match = none ?? (models.length === 0 && fallback !== undefined && fallback !== null && candidates.includes(fallback.model)
    ? { provider: fallback.provider, id: fallback.model, reasoning: undefined }
    : undefined)
  if (match === undefined) {
    log(`model: "${wanted}" is not in the current model catalog; keeping the session default`)
    return undefined
  }
  const reasoning = typeof preset?.reasoning === 'string' ? preset.reasoning.trim() : ''
  const KNOWN_EFFORTS = ['off', 'low', 'high', 'max']
  const efforts = Array.isArray(match.reasoning) && match.reasoning.length > 0
    ? match.reasoning.map(effort => effort.id)
    : KNOWN_EFFORTS
  const selection = {
    provider: match.provider,
    model: match.id,
    ...(reasoning !== '' && efforts.includes(reasoning) ? { reasoningEffort: reasoning } : {}),
  }
  const controller = ctx.get?.('sessionController')
  // Preferred: the internal durable-selection path (writes `model/selection`
  // without touching the deployment default). It is not exposed by every build.
  if (controller !== undefined && typeof controller.selectForNextRequest === 'function') {
    try {
      controller.selectForNextRequest(agent, selection)
      log(`model: session ${agent.id} -> ${selection.provider}/${selection.model}${selection.reasoningEffort !== undefined ? ` (${selection.reasoningEffort})` : ''}`)
      return selection
    } catch (error) {
      log(`model: durable selection rejected (${error instanceof Error ? error.message : String(error)})`)
    }
  }
  // Public Remote: validated and durable, but it also saves the deployment
  // default model; put the previous default back so only this Session changes.
  if (controller !== undefined && typeof controller.selectModel === 'function') {
    try {
      const defaults = ctx.get?.('agentDefaultModel')
      const previous = typeof defaults?.currentSelection === 'function' ? defaults.currentSelection() : undefined
      const value = await controller.selectModel({ sessionId: agent.id, ...selection })
      if (previous !== undefined && typeof defaults?.saveSelection === 'function') {
        setTimeout(() => {
          try {
            void defaults.saveSelection(previous).catch(() => {})
          } catch {
            /* best effort restore */
          }
        }, 50)
      }
      const selected = value?.selected ?? selection
      log(`model: session ${agent.id} -> ${selected.provider}/${selected.model}`)
      return { provider: selected.provider, model: selected.model, reasoningEffort: selected.reasoningEffort }
    } catch (error) {
      log(`model: selectModel rejected (${error instanceof Error ? error.message : String(error)}); arming a one-shot request override`)
    }
  }
  // Last resort: force the configuration through the per-Agent request waterfall.
  if (typeof agent?.ctx?.on === 'function') return armRequestOverride(agent, selection, log)
  log('model: session controller unavailable; keeping the session default')
  return undefined
}

/**
 * Force one model configuration through the per-agent `agent/request` waterfall.
 * Removes itself after the first request so a later user-initiated model change
 * is not overwritten.
 */
function armRequestOverride(agent, selection, log) {
  let fired = false
  let remove
  const handler = async (payload, next) => {
    const config = await next()
    if (fired) return config
    fired = true
    try {
      if (typeof remove === 'function') remove()
    } catch {
      /* the agent scope may already be unwinding */
    }
    return {
      ...config,
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {}),
    }
  }
  try {
    remove = agent.ctx.on('agent/request', handler)
  } catch (error) {
    log(`model: cannot arm the request override: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
  log(`model: armed a one-shot request override -> ${selection.provider}/${selection.model}`)
  return selection
}

/** Values reported by the first-turn self introduction (actual, not desired). */
function introValues({ agent, settings, catalog, applied }) {
  const persona = resolvePersona(settings)
  const header = agent?.session?.header
  const workspace = typeof header?.cwd === 'string' && header.cwd !== '' ? header.cwd : '（默认工作空间）'
  const permissionId = applied.permission ?? settings.preset?.permission
  const model = applied.selection ?? loggedSelection(agent)
  return {
    personaName: settings.persona?.enabled === true && persona.exists === true && persona.name !== '' ? persona.name : '无',
    workspace,
    agentPreset: agentPresetLabel(header?.agentPreset ?? settings.preset?.agentPreset, catalog),
    permission: permissionLabel(permissionId, catalog),
    model: modelLabel(model?.provider, model?.model, catalog),
    reasoning: typeof model?.reasoningEffort === 'string' && model.reasoningEffort !== '' ? model.reasoningEffort : 'high（模型默认）',
  }
}

/**
 * Seed one Agent from the current settings; safe to call on every `agent/created`.
 */
export async function applyNewSessionPreset(ctx, agent, deps) {
  const { log, getSettings, getConnectorWorkspace, getCatalog } = deps
  if (seeded.has(agent)) return
  const settings = getSettings()
  const preset = settings?.preset ?? {}
  const wantPreset = preset.enabled === true
  const wantPersona = settings?.persona?.enabled === true
  // The whole block is opt-in: with neither switch ticked the plugin behaves
  // exactly like v0.1.0, even though the introduction preference defaults to on.
  if (!wantPreset && !wantPersona) return
  const wantIntro = settings?.intro?.enabled === true
  if (!isChannelSession(agent, getConnectorWorkspace())) return
  seeded.add(agent)

  const fresh = loggedSelection(agent) === undefined
  const catalog = await getCatalog()
  const applied = { permission: undefined, selection: undefined }

  // The Agent preset is NOT switched per Agent here: the connector mounts its
  // preset while creating the Agent, and re-selecting a preset on top of that
  // mount duplicates tool registrations in the shared preset realm — after that
  // every later session fails with `tool "subagent" is already registered in
  // this scope`. The chosen preset is written as the DSH default preset when the
  // settings are saved (see the /settings route), which is exactly what the
  // connector's own `agentPresets.resolve(undefined)` reads at creation time.
  if (wantPreset && fresh) {
    if (typeof preset.permission === 'string' && preset.permission !== '') {
      applied.permission = applyPermission(ctx, agent, preset.permission, log)
    }
    applied.selection = await applyModel(ctx, agent, preset, catalog, log)
  }

  const persona = resolvePersona(settings)
  const personaText = wantPersona ? buildPersonaText(persona) : ''
  const introText = wantIntro && fresh ? buildIntroText(introValues({ agent, settings, catalog, applied })) : ''

  if (personaText !== '' || introText !== '') {
    try {
      agent.ctx.effect(() => {
        const disposers = []
        if (personaText !== '') {
          disposers.push(agent.ctx.systemPrompt.section({ name: PERSONA_SECTION, order: PERSONA_ORDER, text: personaText }))
        }
        if (introText !== '') {
          disposers.push(agent.ctx.systemPrompt.section({ name: INTRO_SECTION, order: INTRO_ORDER, text: introText }))
        }
        return () => {
          for (const dispose of disposers.reverse()) {
            try {
              dispose()
            } catch {
              /* a disposed scope is already clean */
            }
          }
        }
      }, 'dingtalk.session-preset()')
      log(`preset: session ${agent.id} seeded (persona=${personaText !== '' ? persona.name : 'none'}, intro=${introText !== ''})`)
    } catch (error) {
      log(`preset: cannot register prompt sections for session ${agent.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (wantPersona && persona.exists !== true) {
    log(`persona: md not available (${persona.error ?? 'unknown'}); session ${agent.id} starts without it`)
  }
}

/**
 * Install the hooks. Returns the disposer; call it from the plugin's own effect.
 */
export function installSessionPresets(ctx, deps) {
  if (typeof ctx?.on !== 'function') return () => {}
  return ctx.on('agent/created', async ({ agent }) => {
    try {
      await applyNewSessionPreset(ctx, agent, deps)
    } catch (error) {
      deps.log(`preset: seeding session failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}
