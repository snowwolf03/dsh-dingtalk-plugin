/**
 * DingTalk for DSH Desktop — Client half.
 *
 * The page under Settings → 钉钉. This is a client plugin bundle: the shell
 * evaluates it as an external classic script and it registers itself through
 * `window.__ModuleLoader__.load({ id, factory })`. Everything lives inside one
 * IIFE so a hot reload can evaluate the file again without redeclaring
 * top-level bindings.
 *
 * All work happens over the Host half's own routes (`/.dsh-dingtalk/…`), which
 * is also where the Client Secret stays: the page only ever sees `hasSecret`.
 */

(function () {
  'use strict'

  const PREFIX = '/.dsh-dingtalk'
  const CONSOLE_URL = 'https://open-dev.dingtalk.com/'

  const copy = {
    zh: {
      nav: '钉钉',
      title: '钉钉机器人',
      intro: '在钉钉里和这台电脑上的 DSH Agent 对话。填入钉钉应用的 Client ID 和 Client Secret，保存后连接器会立即重连。',
      loading: '正在读取连接器状态…',
      loadFailed: '读取失败',
      retry: '重试',
      statusTitle: '连接状态',
      stateMissing: '未配置凭据',
      stateMissingHint: '填写下面的 Client ID 与 Client Secret 并保存。',
      stateSaved: '已保存凭据，等待连接',
      stateSavedHint: '点击“测试连接”确认钉钉是否接受，或在钉钉里给机器人发一条消息试试。',
      stateOk: '凭据有效',
      stateOkHint: '钉钉已接受 Stream 连接请求，连接器会自行维持长连接。',
      stateBad: '凭据或网络有问题',
      connectorActive: '连接器运行中',
      connectorInactive: '连接器未就绪',
      connectorMissing: '连接器依赖未安装',
      connectorMissingHint: '当前安装里找不到 @dingtalk-real-ai/dsh-dingtalk，请用插件面板或命令行重新安装本插件（会自动拉取依赖）。',
      showLog: '查看 DSH 启动日志里的 dsh-dingtalk 相关行。',
      sectionCred: '应用凭据',
      sectionCredHint: '在钉钉开放平台 → 应用开发 → 企业内部应用里找到。密钥只写不显示。',
      clientId: 'Client ID（原 AppKey / SuiteKey）',
      clientIdHint: '形如 ding 开头的应用标识。',
      clientSecret: 'Client Secret（原 AppSecret / SuiteSecret）',
      clientSecretHint: '只写不显示；留空表示保留已保存的密钥。',
      secretSet: '已保存，留空不修改',
      secretUnset: '尚未保存',
      sectionAccess: '访问范围',
      sectionAccessHint: '决定谁能通过钉钉驱动这台电脑。默认放开，建议按需收紧。',
      ownerStaffId: '管理员 staffId（可选）',
      ownerStaffIdHint: '填写后只有该钉钉用户可用；留空表示按下面的发送者策略放行。',
      senderAccess: '私聊策略',
      senderAccessAll: '所有人',
      senderAccessOwner: '仅管理员',
      senderAccessAllowlist: '管理员 + 白名单',
      senderAccessHint: '“所有人”意味着任何能私聊机器人的人都能驱动本机 Agent。',
      allowedSenders: '额外允许的 staffId',
      allowedSendersHint: '逗号或空格分隔，仅在“管理员 + 白名单”时生效。',
      groupAccess: '群聊策略',
      groupAccessAll: '所有群',
      groupAccessNone: '禁止群聊',
      groupAccessAllowlist: '仅白名单群',
      groupAllowlist: '群 openConversationId 白名单',
      groupAllowlistHint: '逗号或空格分隔。群 ID 可用 dws 或钉钉开放平台接口查询。',
      sectionRuntime: '运行',
      workspace: '会话工作目录（可选）',
      workspaceHint: '绝对路径；留空使用 ~/dsh-dingtalk-workspace。',
      save: '保存并连接',
      saving: '保存中…',
      saved: '已保存，连接器已重新加载。',
      savedHint: '若状态仍显示未连接，稍等几秒后点“测试连接”或“重新连接”。',
      test: '测试连接',
      testing: '测试中…',
      reconnect: '重新连接',
      reload: '刷新状态',
      warnTitle: '安全提示',
      warnBody: '钉钉消息会在本机以你的身份执行。放开给所有人或所有群时，任何能私聊或 @ 机器人的人都能让 Agent 读写文件、执行命令。建议填写管理员 staffId，或至少把私聊策略改为“仅管理员”。',
      docs: '钉钉开放平台',
      errorTitle: '出错了',
      dirty: '有未保存的修改',
      notDirty: '没有未保存的修改',
      sectionPreset: '新会话预设（可选）',
      sectionPresetHint: '为每次新建的钉钉会话预置 Agent 性格 md、工作空间、Agent 预设、权限、模型与推理等级，并让 Agent 在第一条回复里自我介绍。不勾选时与旧版行为完全一致。',
      presetEnable: '启用「新会话预设」',
      presetEnableHint: '只影响新建会话；已有钉钉对话请先在钉钉里发 /new 重开。',
      presetWorkspace: '工作空间',
      presetWorkspaceDefault: '默认（连接器的工作目录）',
      presetAgentPreset: 'Agent 预设',
      presetAgentPresetHint: '保存后会写为 DSH 新会话的默认 Agent 预设（对所有新会话生效，不只是钉钉）。',
      presetPermission: '权限',
      presetModel: '模型',
      presetReasoning: '推理等级',
      presetReasoningDefault: '模型默认',
      presetSave: '保存预设',
      presetSaving: '保存中…',
      presetSaved: '预设已保存，将应用于之后新建的会话。',
      presetHint: '说明：Agent 预设只能在会话尚未开始时切换；权限、模型与推理等级会作为新会话的初始值。保存时若填了工作空间，会同时写入连接器的「会话工作目录」（Stream 会短暂重连），新会话就以它为 cwd。新会话首条回复会按实际生效值自我介绍。',
      presetCatalogHint: '下拉选项来自当前 DSH 运行时；找不到的值会保留但不会生效（以实际生效值自我介绍）。',
      personaEnable: '注入 Agent 性格 md',
      personaEnableHint: '勾选后，把 md 全文写入该会话的 system prompt，作为性格约束。',
      personaDefault: '使用默认文件',
      personaCustom: '使用我上传的 md',
      personaUpload: '选择 md 文件…',
      personaUploading: '上传中…',
      personaNone: '（未选择 md 文件，自我介绍中显示“无”）',
      personaExists: '可用',
      personaMissing: '不可用',
      personaPickPath: '或填写本机 md 绝对路径',
      personaUsePath: '使用该路径',
      introEnable: '新会话首条回复自我介绍（6 项）',
      introHint: '让 Agent 在每条新会话的第一条回复开头报告：性格 md、工作空间、Agent 预设、权限、模型、推理等级。需先勾选上面的「新会话预设」或「注入 Agent 性格 md」，否则不会改变现有行为。',
      copyright: '©snowwolf03',
    },
    en: {
      nav: 'DingTalk',
      title: 'DingTalk bot',
      intro: 'Chat with the DSH agent on this PC from DingTalk. Enter the app Client ID and Client Secret; saving reconnects the connector immediately.',
      loading: 'Reading connector state…',
      loadFailed: 'Could not read the state',
      retry: 'Retry',
      statusTitle: 'Connection',
      stateMissing: 'Credentials not set',
      stateMissingHint: 'Fill in Client ID and Client Secret below, then save.',
      stateSaved: 'Saved; waiting for the connection',
      stateSavedHint: 'Click “Test connection”, or send the bot a message in DingTalk.',
      stateOk: 'Credentials accepted',
      stateOkHint: 'DingTalk accepted the Stream request; the connector keeps the long connection alive.',
      stateBad: 'Credentials or network problem',
      connectorActive: 'Connector running',
      connectorInactive: 'Connector not ready',
      connectorMissing: 'Connector dependency missing',
      connectorMissingHint: 'The installed tree has no @dingtalk-real-ai/dsh-dingtalk. Reinstall this plugin so its dependency is installed.',
      sectionCred: 'Application credentials',
      sectionCredHint: 'From the DingTalk Open Platform app console. The secret is write-only.',
      clientId: 'Client ID (formerly AppKey / SuiteKey)',
      clientIdHint: 'The app identifier, usually starting with “ding”.',
      clientSecret: 'Client Secret (formerly AppSecret / SuiteSecret)',
      clientSecretHint: 'Write-only; leave blank to keep the stored value.',
      secretSet: 'Stored; leave blank to keep it',
      secretUnset: 'Not stored yet',
      sectionAccess: 'Access',
      sectionAccessHint: 'Who may drive this PC through DingTalk. Open by default; tighten as needed.',
      ownerStaffId: 'Owner staffId (optional)',
      ownerStaffIdHint: 'When set, only this DingTalk user is allowed.',
      senderAccess: 'Direct message policy',
      senderAccessAll: 'Everyone',
      senderAccessOwner: 'Owner only',
      senderAccessAllowlist: 'Owner + allowlist',
      senderAccessHint: '“Everyone” lets anyone who can DM the bot drive the local agent.',
      allowedSenders: 'Extra allowed staffIds',
      allowedSendersHint: 'Comma or space separated; used with “Owner + allowlist”.',
      groupAccess: 'Group policy',
      groupAccessAll: 'Every group',
      groupAccessNone: 'No groups',
      groupAccessAllowlist: 'Allowlisted groups',
      groupAllowlist: 'Group openConversationId allowlist',
      groupAllowlistHint: 'Comma or space separated.',
      sectionRuntime: 'Runtime',
      workspace: 'Session workspace (optional)',
      workspaceHint: 'Absolute path; empty means ~/dsh-dingtalk-workspace.',
      save: 'Save and connect',
      saving: 'Saving…',
      saved: 'Saved; the connector reloaded.',
      savedHint: 'If the status still shows disconnected, wait a few seconds and try “Reconnect”.',
      test: 'Test connection',
      testing: 'Testing…',
      reconnect: 'Reconnect',
      reload: 'Refresh',
      warnTitle: 'Security',
      warnBody: 'DingTalk messages run as you on this machine. With “everyone” or “every group”, anyone who can reach the bot can make the agent read files and run commands.',
      docs: 'DingTalk Open Platform',
      errorTitle: 'Error',
      dirty: 'Unsaved changes',
      notDirty: 'No unsaved changes',
      sectionPreset: 'New-session preset (optional)',
      sectionPresetHint: 'Seed every new DingTalk session with a personality markdown, workspace, agent preset, permission, model and reasoning effort, and let the agent introduce itself in its first reply. Leave it unchecked for the old behaviour.',
      presetEnable: 'Enable “new-session preset”',
      presetEnableHint: 'Affects new sessions only; send /new inside DingTalk to restart an existing conversation.',
      presetWorkspace: 'Workspace',
      presetWorkspaceDefault: 'Default (the connector’s session directory)',
      presetAgentPreset: 'Agent preset',
      presetAgentPresetHint: 'Saved as the DSH default Agent preset for new sessions (affects every new session, not only DingTalk).',
      presetPermission: 'Permission',
      presetModel: 'Model',
      presetReasoning: 'Reasoning effort',
      presetReasoningDefault: 'Model default',
      presetSave: 'Save preset',
      presetSaving: 'Saving…',
      presetSaved: 'Saved; the preset applies to sessions created afterwards.',
      presetHint: 'The agent preset can only be switched before a session starts; permission, model and reasoning effort seed each new session. Saving a workspace also writes the connector’s session directory (the Stream reconnects briefly) so new sessions use it as cwd. The first reply reports the values that actually took effect.',
      presetCatalogHint: 'Options come from the running DSH runtime; an unavailable value is kept but not applied (the self introduction always reports the effective values).',
      personaEnable: 'Inject personality markdown',
      personaEnableHint: 'When checked, the whole markdown becomes a system-prompt section of the session.',
      personaDefault: 'Use the default file',
      personaCustom: 'Use an uploaded .md file',
      personaUpload: 'Choose .md file…',
      personaUploading: 'Uploading…',
      personaNone: '(no markdown selected; the introduction says “none”)',
      personaExists: 'available',
      personaMissing: 'unavailable',
      personaPickPath: '…or an absolute .md path on this machine',
      personaUsePath: 'Use this path',
      introEnable: 'Self introduction in the first reply (6 facts)',
      introHint: 'The agent opens each new session by reporting: personality md, workspace, agent preset, permission, model, reasoning effort. Requires “new-session preset” or “inject personality markdown” above; otherwise nothing changes.',
      copyright: '©snowwolf03',
    },
  }

  /** Follow the app's resolved locale, falling back to the browser's. */
  function text() {
    const lang = `${document.documentElement?.lang || ''}${navigator.language || ''}`
    return lang.toLowerCase().startsWith('zh') ? copy.zh : copy.en
  }

  /** One JSON request against this plugin's Host routes. */
  async function request(path, body) {
    const response = await fetch(path, {
      cache: 'no-store',
      method: body === undefined ? 'GET' : 'POST',
      headers:
        body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let payload
    try {
      payload = await response.json()
    } catch {
      payload = undefined
    }
    if (payload === undefined || typeof payload !== 'object') {
      throw new Error(`${text().loadFailed} (HTTP ${response.status})`)
    }
    return payload
  }

  const CSS = `
.dsh-dingtalk { max-width: 720px; color: var(--dsw-alias-label-primary, inherit); font-size: 13px; line-height: 1.55; }
.dsh-dingtalk h2 { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
.dsh-dingtalk h3 { font-size: 13px; font-weight: 600; margin: 22px 0 4px; }
.dsh-dingtalk p { margin: 0 0 10px; }
.dsh-dingtalk .dsh-dingtalk-muted { color: var(--dsw-alias-label-secondary, #6b7280); font-size: 12px; }
.dsh-dingtalk .dsh-dingtalk-card { border: 1px solid var(--dsw-alias-border-l, rgba(0,0,0,.12)); border-radius: var(--dsw-radius-md, 8px); padding: 14px 16px; margin: 12px 0; background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.04)); }
.dsh-dingtalk .dsh-dingtalk-status { display: flex; align-items: flex-start; gap: 10px; }
.dsh-dingtalk .dsh-dingtalk-dot { width: 9px; height: 9px; border-radius: 50%; margin-top: 7px; flex: none; background: var(--dsw-alias-label-tertiary, #9ca3af); }
.dsh-dingtalk .dsh-dingtalk-dot.ok { background: var(--dsw-alias-state-success-primary, #1a7f37); }
.dsh-dingtalk .dsh-dingtalk-dot.bad { background: var(--dsw-alias-state-error-primary, #d93025); }
.dsh-dingtalk .dsh-dingtalk-dot.warn { background: var(--dsw-alias-state-warn-primary, #b26a00); }
.dsh-dingtalk .dsh-dingtalk-field { margin: 0 0 12px; }
.dsh-dingtalk .dsh-dingtalk-label { display: block; font-weight: 500; margin-bottom: 4px; }
.dsh-dingtalk input[type=text], .dsh-dingtalk input[type=password], .dsh-dingtalk select { width: 100%; box-sizing: border-box; padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l, rgba(0,0,0,.18)); border-radius: var(--dsw-radius-sm, 6px); background: transparent; color: inherit; font: inherit; outline: none; }
.dsh-dingtalk input:focus, .dsh-dingtalk select:focus { border-color: var(--dsw-alias-brand-primary, #4d6bfe); box-shadow: 0 0 0 var(--dsw-focus-ring-width, 2px) var(--dsw-focus-ring-color, rgba(77,107,254,.2)); }
.dsh-dingtalk .dsh-dingtalk-hint { display: block; margin-top: 3px; color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 12px; }
.dsh-dingtalk .dsh-dingtalk-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 0; align-items: center; }
.dsh-dingtalk button { font: inherit; border-radius: var(--dsw-radius-sm, 6px); padding: 6px 14px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l, rgba(0,0,0,.18)); background: transparent; color: inherit; }
.dsh-dingtalk button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.08)); }
.dsh-dingtalk button:disabled { opacity: .55; cursor: default; }
.dsh-dingtalk button.primary { background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4d6bfe)); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, #fff); }
.dsh-dingtalk button.primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary, #4d6bfe)); filter: brightness(1.05); }
.dsh-dingtalk .dsh-dingtalk-notice { margin-top: 12px; font-size: 12px; }
.dsh-dingtalk .dsh-dingtalk-notice.ok { color: var(--dsw-alias-state-success-primary, #1a7f37); }
.dsh-dingtalk .dsh-dingtalk-notice.bad { color: var(--dsw-alias-state-error-primary, #d93025); }
.dsh-dingtalk .dsh-dingtalk-warn { margin-top: 18px; border-left: 3px solid var(--dsw-alias-state-warn-primary, #b26a00); padding: 8px 12px; border-radius: 0 var(--dsw-radius-sm, 6px) var(--dsw-radius-sm, 6px) 0; background: rgba(178,106,0,.08); }
.dsh-dingtalk .dsh-dingtalk-warn strong { display: block; margin-bottom: 2px; }
.dsh-dingtalk .dsh-dingtalk-foot { margin-top: 18px; font-size: 12px; color: var(--dsw-alias-label-tertiary, #8a8f98); }
.dsh-dingtalk a { color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary, #4d6bfe)); text-decoration: none; }
.dsh-dingtalk a:hover { text-decoration: underline; }
.dsh-dingtalk .dsh-dingtalk-check { display: flex; gap: 8px; align-items: flex-start; margin: 0 0 10px; }
.dsh-dingtalk .dsh-dingtalk-check input { margin: 2px 0 0; flex: none; }
.dsh-dingtalk .dsh-dingtalk-radio { display: inline-flex; gap: 6px; align-items: center; margin: 0 14px 0 0; }
.dsh-dingtalk .dsh-dingtalk-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0 12px; }
.dsh-dingtalk .dsh-dingtalk-persona { border: 1px dashed var(--dsw-alias-border-l, rgba(0,0,0,.18)); border-radius: var(--dsw-radius-sm, 6px); padding: 10px 12px; margin: 4px 0 12px; }
.dsh-dingtalk .dsh-dingtalk-persona-path { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; word-break: break-all; }
.dsh-dingtalk input[type=file] { font: inherit; max-width: 100%; }
.dsh-dingtalk .dsh-dingtalk-copy { margin-top: 22px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l, rgba(0,0,0,.12)); font-size: 12px; color: var(--dsw-alias-label-tertiary, #8a8f98); display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
`

  function installStyles() {
    if (document.getElementById('dsh-dingtalk-styles') !== null) return () => {}
    const style = document.createElement('style')
    style.id = 'dsh-dingtalk-styles'
    style.textContent = CSS
    document.head.appendChild(style)
    return () => style.remove()
  }

  window.__ModuleLoader__.load({
    id: 'dsh-dingtalk-plugin',
    factory(require) {
      const React = require('react')
      const h = React.createElement
      const { useCallback, useEffect, useMemo, useRef, useState } = React

      const EMPTY_CONFIG = {
        clientId: '',
        ownerStaffId: '',
        workspace: '',
        senderAccess: 'all',
        groupAccess: 'all',
        allowedSenders: [],
        groupAllowlist: [],
      }

      function configToDraft(config) {
        const source = config !== null && typeof config === 'object' ? config : EMPTY_CONFIG
        return {
          clientId: typeof source.clientId === 'string' ? source.clientId : '',
          clientSecret: '',
          ownerStaffId: typeof source.ownerStaffId === 'string' ? source.ownerStaffId : '',
          workspace: typeof source.workspace === 'string' ? source.workspace : '',
          senderAccess: typeof source.senderAccess === 'string' ? source.senderAccess : 'all',
          groupAccess: typeof source.groupAccess === 'string' ? source.groupAccess : 'all',
          allowedSenders: Array.isArray(source.allowedSenders) ? source.allowedSenders.join(', ') : '',
          groupAllowlist: Array.isArray(source.groupAllowlist) ? source.groupAllowlist.join(', ') : '',
        }
      }

      /** Split the two comma-separated allowlist drafts into the arrays the Host stores. */
      function splitList(value) {
        if (typeof value !== 'string') return []
        return value.split(/[\s,，;；]+/u).map(item => item.trim()).filter(item => item !== '')
      }

      function Field(props) {
        const t = text()
        const hint = props.hint
        const control = props.children
        return h(
          'div',
          { className: 'dsh-dingtalk-field' },
          h('label', { className: 'dsh-dingtalk-label' }, props.label),
          control,
          hint ? h('span', { className: 'dsh-dingtalk-hint' }, hint) : null,
        )
      }

      function StatusCard(props) {
        const t = text()
        const { snapshot, probe } = props
        const connector = snapshot?.connector ?? {}
        const config = snapshot?.config ?? {}
        const configured = typeof config.clientId === 'string' && config.clientId !== '' && config.hasSecret === true
        let dot = ''
        let label = t.stateMissing
        let hint = t.stateMissingHint
        if (connector.installed === false) {
          dot = 'bad'
          label = t.connectorMissing
          hint = t.connectorMissingHint
        } else if (configured) {
          if (probe !== undefined && probe !== null) {
            if (probe.ok === true) {
              dot = 'ok'
              label = t.stateOk
              hint = t.stateOkHint
            } else {
              dot = 'bad'
              label = t.stateBad
              hint = `${probe.message ?? ''}${probe.code ? ` [${probe.code}]` : ''}`
            }
          } else if (connector.active === true) {
            dot = 'warn'
            label = t.stateSaved
            hint = t.stateSavedHint
          } else {
            dot = 'warn'
            label = t.stateSaved
            hint = t.stateSavedHint
          }
        }
        const probeSuffix =
          probe !== undefined && probe !== null && probe.ok === true && typeof probe.endpoint === 'string' && probe.endpoint !== ''
            ? `${t.connectorActive} · ${probe.endpoint}`
            : ''
        return h(
          'div',
          { className: 'dsh-dingtalk-card' },
          h(
            'div',
            { className: 'dsh-dingtalk-status' },
            h('span', { className: `dsh-dingtalk-dot ${dot}` }),
            h(
              'div',
              null,
              h('p', { style: { margin: 0, fontWeight: 600 } }, label),
              h('p', { className: 'dsh-dingtalk-muted', style: { margin: '2px 0 0' } }, hint),
              probeSuffix !== '' ? h('p', { className: 'dsh-dingtalk-muted', style: { margin: '4px 0 0' } }, probeSuffix) : null,
            ),
          ),
        )
      }

      /** Fallback option lists when the Host catalog service is unavailable. */
      const FALLBACK_PRESETS = [
        { id: 'standard', name: '标准模式' },
        { id: 'ptc', name: 'PTC 模式' },
        { id: 'minimal', name: '极简模式' },
        { id: 'cordis', name: '创造模式' },
      ]
      const FALLBACK_PERMISSIONS = [
        { value: 'read-only', name: '只读' },
        { value: 'workspace-write', name: '工作区可修改' },
        { value: 'danger-full-access', name: '完全权限' },
      ]
      /** Marketing name → routed model id (see session-preset.js MODEL_ALIASES). */
      const MODEL_ALIASES = { 'deepseek-v4.1-flash': 'deepseek-flash' }

      /** Host settings object → editable draft (missing pieces filled from defaults). */
      function settingsToDraft(settings) {
        const source = settings !== null && typeof settings === 'object' ? settings : {}
        const preset = source.preset !== null && typeof source.preset === 'object' ? source.preset : {}
        const persona = source.persona !== null && typeof source.persona === 'object' ? source.persona : {}
        const intro = source.intro !== null && typeof source.intro === 'object' ? source.intro : {}
        return {
          preset: {
            enabled: preset.enabled === true,
            workspace: typeof preset.workspace === 'string' ? preset.workspace : '',
            agentPreset: typeof preset.agentPreset === 'string' ? preset.agentPreset : 'standard',
            permission: typeof preset.permission === 'string' ? preset.permission : 'workspace-write',
            model: typeof preset.model === 'string' ? preset.model : 'deepseek-v4.1-flash',
            reasoning: typeof preset.reasoning === 'string' ? preset.reasoning : 'high',
          },
          persona: {
            enabled: persona.enabled === true,
            choice: persona.choice === 'custom' ? 'custom' : 'default',
            customPath: typeof persona.customPath === 'string' ? persona.customPath : '',
            customName: typeof persona.customName === 'string' ? persona.customName : '',
          },
          intro: {
            enabled: intro.enabled !== false,
          },
        }
      }

      function CheckField(props) {
        return h(
          'label',
          { className: 'dsh-dingtalk-check' },
          h('input', { type: 'checkbox', checked: props.checked, disabled: props.disabled, onChange: props.onChange }),
          h(
            'span',
            null,
            h('span', { className: 'dsh-dingtalk-label', style: { margin: 0 } }, props.label),
            props.hint ? h('span', { className: 'dsh-dingtalk-hint' }, props.hint) : null,
          ),
        )
      }

      /**
       * The optional "new-session preset" block: personality markdown, workspace,
       * agent preset, permission, model and reasoning effort, plus the first-turn
       * self-introduction switch. Rendered only inside Settings → 钉钉.
       */
      function PresetPanel(props) {
        const t = text()
        const { catalog, draft, persona, onChange, onSave, onUpload, onUsePath, busy, notice, noticeBad } = props
        const defaultAgentPreset = props.defaultAgentPreset
        const [pathInput, setPathInput] = useState('')
        const [fileState, setFileState] = useState('')
        const preset = draft.preset
        const settingsPersona = draft.persona
        const catalogModels = Array.isArray(catalog?.models) ? catalog.models : []
        const catalogPresets = Array.isArray(catalog?.agentPresets) && catalog.agentPresets.length > 0 ? catalog.agentPresets : FALLBACK_PRESETS
        const catalogPermissions = Array.isArray(catalog?.permissions) && catalog.permissions.length > 0 ? catalog.permissions : FALLBACK_PERMISSIONS
        const workspaces = Array.isArray(catalog?.workspaces) ? catalog.workspaces : []
        /** Resolve a configured model name to a routed catalog id (alias aware). */
        const resolveModelId = value => {
          if (typeof value !== 'string' || value === '') return undefined
          if (catalogModels.some(item => item.id === value)) return value
          const alias = MODEL_ALIASES[value]
          if (alias !== undefined && catalogModels.some(item => item.id === alias)) return alias
          if (catalogModels.length === 0 && catalog?.defaultModel !== undefined && catalog?.defaultModel !== null) {
            const fallback = catalog.defaultModel.model
            if (value === fallback || alias === fallback) return fallback
          }
          return undefined
        }
        const matchedModel = catalogModels.find(item => item.id === resolveModelId(preset.model))
        const reasoningOptions = matchedModel !== undefined && Array.isArray(matchedModel.reasoning) ? matchedModel.reasoning : []
        const modelValueOf = model => {
          const resolved = resolveModelId(model)
          const match = resolved !== undefined ? catalogModels.find(item => item.id === resolved) : undefined
          return match !== undefined ? `${match.provider}::${match.id}` : model === '' ? '' : `::${model}`
        }
        const modelMissing = preset.model !== '' && resolveModelId(preset.model) === undefined && catalogModels.length > 0
        const catalogPersonas = catalog?.personas !== null && typeof catalog?.personas === 'object' ? catalog.personas : {}
        const personaMeta = persona ?? {}
        const personaAvailable = settingsPersona.choice === 'custom' ? personaMeta.exists === true : catalogPersonas.defaultExists === true

        const presetOptions = catalogPresets.map(item =>
          h('option', { key: item.id, value: item.id }, item.name !== undefined && item.name !== item.id ? `${item.name}（${item.id}）` : item.id),
        )
        if (!catalogPresets.some(item => item.id === preset.agentPreset) && preset.agentPreset !== '') {
          presetOptions.push(h('option', { key: 'custom-preset', value: preset.agentPreset }, preset.agentPreset))
        }
        const permissionOptions = catalogPermissions.map(item =>
          h('option', { key: item.value, value: item.value }, item.name !== undefined ? item.name : item.value),
        )
        if (!catalogPermissions.some(item => item.value === preset.permission) && preset.permission !== '') {
          permissionOptions.push(h('option', { key: 'custom-permission', value: preset.permission }, preset.permission))
        }
        const modelOptions = catalogModels.map(item =>
          h(
            'option',
            { key: `${item.provider}::${item.id}`, value: `${item.provider}::${item.id}` },
            `${item.providerName ?? item.provider} · ${item.name !== undefined ? item.name : item.id}`,
          ),
        )
        if (modelMissing) {
          modelOptions.push(h('option', { key: 'custom-model', value: `::${preset.model}` }, `${preset.model}（当前不可用）`))
        }
        if (modelOptions.length === 0 && catalog?.defaultModel !== undefined && catalog?.defaultModel !== null) {
          const fallback = catalog.defaultModel
          modelOptions.push(
            h('option', { key: 'runtime-default', value: `${fallback.provider}::${fallback.model}` }, `${fallback.model}（运行时默认）`),
          )
        }
        const workspaceOptions = [h('option', { key: 'default', value: '' }, t.presetWorkspaceDefault)]
        for (const workspace of workspaces) {
          workspaceOptions.push(
            h('option', { key: workspace.id !== '' ? workspace.id : workspace.path, value: workspace.path },
              `${workspace.title !== '' ? workspace.title : workspace.path}（${workspace.path}）`),
          )
        }
        if (preset.workspace !== '' && !workspaces.some(item => item.path === preset.workspace)) {
          workspaceOptions.push(h('option', { key: 'custom-workspace', value: preset.workspace }, preset.workspace))
        }
        const reasoningChoices = [h('option', { key: 'default', value: '' }, t.presetReasoningDefault)].concat(
          reasoningOptions.map(item => h('option', { key: item.id, value: item.id }, item.name !== undefined ? item.name : item.id)),
        )

        const upload = async file => {
          if (file === undefined || file === null) return
          setFileState(t.personaUploading)
          try {
            await onUpload(file)
            setFileState('')
          } catch (error) {
            setFileState(error instanceof Error ? error.message : String(error))
          }
        }

        return h(
          'div',
          { className: 'dsh-dingtalk-card', style: { marginTop: '18px' } },
          h('h3', { style: { marginTop: 0 } }, t.sectionPreset),
          h('p', { className: 'dsh-dingtalk-muted' }, t.sectionPresetHint),
          h(CheckField, {
            label: t.presetEnable,
            hint: t.presetEnableHint,
            checked: preset.enabled,
            disabled: busy !== '',
            onChange: event => onChange('preset', 'enabled', event.target.checked),
          }),

          preset.enabled
            ? h(
                'div',
                { className: 'dsh-dingtalk-grid' },
                h(
                  Field,
                  { label: t.presetWorkspace },
                  h(
                    'select',
                    { value: preset.workspace, disabled: busy !== '', onChange: event => onChange('preset', 'workspace', event.target.value) },
                    workspaceOptions,
                  ),
                ),
                h(
                  Field,
                  {
                    label: t.presetAgentPreset,
                    hint: `${t.presetAgentPresetHint}${defaultAgentPreset !== undefined && defaultAgentPreset !== '' ? `（当前默认：${defaultAgentPreset}）` : ''}`,
                  },
                  h(
                    'select',
                    { value: preset.agentPreset, disabled: busy !== '', onChange: event => onChange('preset', 'agentPreset', event.target.value) },
                    presetOptions,
                  ),
                ),
                h(
                  Field,
                  { label: t.presetPermission },
                  h(
                    'select',
                    { value: preset.permission, disabled: busy !== '', onChange: event => onChange('preset', 'permission', event.target.value) },
                    permissionOptions,
                  ),
                ),
                h(
                  Field,
                  { label: t.presetModel },
                  h(
                    'select',
                    { value: modelValueOf(preset.model), disabled: busy !== '', onChange: event => onChange('preset', 'model', event.target.value.split('::')[1] ?? '') },
                    modelOptions.length > 0 ? modelOptions : [h('option', { key: 'none', value: '' }, preset.model)],
                  ),
                ),
                h(
                  Field,
                  { label: t.presetReasoning },
                  h(
                    'select',
                    {
                      value: preset.reasoning,
                      disabled: busy !== '' || reasoningOptions.length === 0,
                      onChange: event => onChange('preset', 'reasoning', event.target.value),
                    },
                    reasoningChoices,
                  ),
                ),
              )
            : null,

          h('h3', { style: { marginTop: '18px' } }, t.personaEnable),
          h(CheckField, {
            label: t.personaEnable,
            hint: t.personaEnableHint,
            checked: settingsPersona.enabled,
            disabled: busy !== '',
            onChange: event => onChange('persona', 'enabled', event.target.checked),
          }),
          h(
            'div',
            { className: 'dsh-dingtalk-persona' },
            h(
              'label',
              { className: 'dsh-dingtalk-radio' },
              h('input', {
                type: 'radio',
                name: 'dsh-dingtalk-persona-choice',
                checked: settingsPersona.choice !== 'custom',
                disabled: busy !== '',
                onChange: () => onChange('persona', 'choice', 'default'),
              }),
              h('span', null, t.personaDefault),
            ),
            h(
              'label',
              { className: 'dsh-dingtalk-radio' },
              h('input', {
                type: 'radio',
                name: 'dsh-dingtalk-persona-choice',
                checked: settingsPersona.choice === 'custom',
                disabled: busy !== '',
                onChange: () => onChange('persona', 'choice', 'custom'),
              }),
              h('span', null, t.personaCustom),
            ),
            settingsPersona.choice === 'custom'
              ? h(
                  'div',
                  { style: { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' } },
                  h('input', {
                    type: 'file',
                    accept: '.md,text/markdown',
                    disabled: busy !== '',
                    onChange: event => {
                      const file = event.target.files !== null && event.target.files !== undefined ? event.target.files[0] : undefined
                      void upload(file)
                    },
                  }),
                  h(
                    'div',
                    { style: { display: 'flex', gap: '8px' } },
                    h('input', {
                      type: 'text',
                      value: pathInput,
                      placeholder: t.personaPickPath,
                      disabled: busy !== '',
                      onChange: event => setPathInput(event.target.value),
                    }),
                    h(
                      'button',
                      {
                        type: 'button',
                        disabled: busy !== '' || pathInput.trim() === '',
                        onClick: () => {
                          void onUsePath(pathInput.trim())
                          setPathInput('')
                        },
                      },
                      t.personaUsePath,
                    ),
                  ),
                  h(
                    'span',
                    { className: 'dsh-dingtalk-persona-path dsh-dingtalk-muted' },
                    settingsPersona.customPath !== ''
                      ? `${settingsPersona.customPath} · ${personaAvailable ? t.personaExists : t.personaMissing}${personaMeta.bytes ? ` · ${personaMeta.bytes} B` : ''}`
                      : t.personaNone,
                  ),
                  fileState !== '' ? h('span', { className: 'dsh-dingtalk-hint' }, fileState) : null,
                )
              : h(
                  'div',
                  { style: { marginTop: '8px' } },
                  h(
                    'span',
                    { className: 'dsh-dingtalk-persona-path dsh-dingtalk-muted' },
                    catalogPersonas.defaultPath !== undefined && catalogPersonas.defaultPath !== ''
                      ? `${catalogPersonas.defaultPath} · ${catalogPersonas.defaultExists === true ? t.personaExists : t.personaMissing}`
                      : t.personaNone,
                  ),
                  h(
                    'span',
                    { className: 'dsh-dingtalk-hint' },
                    catalogPersonas.defaultPath !== undefined && catalogPersonas.defaultPath !== '' && catalogPersonas.defaultExists !== true
                      ? t.personaNone
                      : '',
                  ),
                ),
          ),

          h(CheckField, {
            label: t.introEnable,
            hint: t.introHint,
            checked: draft.intro.enabled,
            disabled: busy !== '' || (!draft.preset.enabled && !draft.persona.enabled),
            onChange: event => onChange('intro', 'enabled', event.target.checked),
          }),
          h(
            'div',
            { className: 'dsh-dingtalk-actions' },
            h('button', { className: 'primary', disabled: busy !== '', onClick: () => void onSave() }, busy === 'preset-save' ? t.presetSaving : t.presetSave),
            h('span', { className: 'dsh-dingtalk-muted' }, t.presetHint),
          ),
          notice !== '' ? h('p', { className: `dsh-dingtalk-notice ${noticeBad ? 'bad' : 'ok'}` }, notice) : null,
          h('p', { className: 'dsh-dingtalk-muted', style: { marginTop: '8px' } }, t.presetCatalogHint),
        )
      }

      function DingTalkSettings() {
        const t = text()
        const initial = useMemo(() => ({ snapshot: undefined, probe: undefined }), [])
        const [loading, setLoading] = useState(true)
        const [loadError, setLoadError] = useState('')
        const [snapshot, setSnapshot] = useState(initial.snapshot)
        const [probe, setProbe] = useState(initial.probe)
        const [draft, setDraft] = useState(() => configToDraft(undefined))
        const [baseline, setBaseline] = useState(() => configToDraft(undefined))
        const [busy, setBusy] = useState('')
        const [notice, setNotice] = useState('')
        const [noticeBad, setNoticeBad] = useState(false)
        const [settingsDraft, setSettingsDraft] = useState(() => settingsToDraft(undefined))
        const [presetBusy, setPresetBusy] = useState('')
        const [presetNotice, setPresetNotice] = useState('')
        const [presetNoticeBad, setPresetNoticeBad] = useState(false)
        const alive = useRef(true)

        useEffect(() => {
          alive.current = true
          return () => {
            alive.current = false
          }
        }, [])

        const adopt = useCallback(payload => {
          if (payload === undefined || payload === null || payload.ok !== true) {
            throw new Error((payload && payload.error) || t.loadFailed)
          }
          const next = configToDraft(payload.config)
          setSnapshot(payload)
          setProbe(payload.lastProbe ?? undefined)
          setDraft(next)
          setBaseline(next)
          setSettingsDraft(settingsToDraft(payload.settings))
        }, [])

        const load = useCallback(async () => {
          setLoading(true)
          setLoadError('')
          try {
            const payload = await request(`${PREFIX}/state`)
            if (alive.current) adopt(payload)
          } catch (error) {
            if (alive.current) setLoadError(error instanceof Error ? error.message : String(error))
          } finally {
            if (alive.current) setLoading(false)
          }
        }, [adopt])

        useEffect(() => {
          void load()
        }, [load])

        const edit = useCallback((key, value) => {
          setDraft(previous => ({ ...previous, [key]: value }))
        }, [])

        const dirty = useMemo(() => {
          const keys = Object.keys(baseline)
          return keys.some(key => (draft[key] ?? '') !== (baseline[key] ?? ''))
        }, [baseline, draft])

        /** Re-read the state a few times so a row reload is reflected without a manual refresh. */
        const refreshUntilSettled = useCallback(async () => {
          for (let attempt = 0; attempt < 6; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 1200))
            if (!alive.current) return
            try {
              const payload = await request(`${PREFIX}/state`)
              if (!alive.current) return
              setSnapshot(payload)
              setProbe(payload.lastProbe ?? undefined)
            } catch {
              // Keep the previous view; the manual refresh stays available.
            }
          }
        }, [])

        const save = useCallback(async () => {
          if (busy !== '') return
          setBusy('save')
          setNotice('')
          setNoticeBad(false)
          try {
            const body = {
              clientId: draft.clientId,
              ownerStaffId: draft.ownerStaffId,
              workspace: draft.workspace,
              senderAccess: draft.senderAccess,
              groupAccess: draft.groupAccess,
              allowedSenders: splitList(draft.allowedSenders),
              groupAllowlist: splitList(draft.groupAllowlist),
            }
            if (draft.clientSecret.trim() !== '') body.clientSecret = draft.clientSecret.trim()
            const payload = await request(`${PREFIX}/config`, body)
            if (payload.ok !== true) throw new Error(payload.error || t.loadFailed)
            setNotice(`${t.saved} ${t.savedHint}`)
            setNoticeBad(false)
            setDraft(previous => ({ ...previous, clientSecret: '' }))
            setBaseline(configToDraft(payload.state?.config))
            if (payload.state !== undefined) {
              setSnapshot(payload.state)
              setProbe(payload.state.lastProbe ?? undefined)
            }
            void refreshUntilSettled()
          } catch (error) {
            setNotice(`${t.errorTitle}: ${error instanceof Error ? error.message : String(error)}`)
            setNoticeBad(true)
          } finally {
            if (alive.current) setBusy('')
          }
        }, [busy, draft, refreshUntilSettled, t])

        const test = useCallback(async () => {
          if (busy !== '') return
          setBusy('test')
          setNotice('')
          setNoticeBad(false)
          try {
            const body = {}
            if (draft.clientId.trim() !== '') body.clientId = draft.clientId.trim()
            if (draft.clientSecret.trim() !== '') body.clientSecret = draft.clientSecret.trim()
            const payload = await request(`${PREFIX}/test`, body)
            if (payload.probe !== undefined) setProbe(payload.probe)
            if (payload.ok === true) {
              setNotice(`${t.stateOk}${payload.probe?.endpoint ? ` · ${payload.probe.endpoint}` : ''}`)
            } else {
              setNotice(`${payload.probe?.message ?? t.stateBad}${payload.probe?.code ? ` [${payload.probe.code}]` : ''}`)
              setNoticeBad(true)
            }
          } catch (error) {
            setNotice(`${t.errorTitle}: ${error instanceof Error ? error.message : String(error)}`)
            setNoticeBad(true)
          } finally {
            if (alive.current) setBusy('')
          }
        }, [busy, draft, t])

        const reconnect = useCallback(async () => {
          if (busy !== '') return
          setBusy('reconnect')
          setNotice('')
          setNoticeBad(false)
          try {
            const payload = await request(`${PREFIX}/reconnect`, {})
            if (payload.ok !== true) throw new Error(payload.error || t.loadFailed)
            setNotice(`${t.saved} ${t.savedHint}`)
            if (payload.state !== undefined) setSnapshot(payload.state)
            void refreshUntilSettled()
          } catch (error) {
            setNotice(`${t.errorTitle}: ${error instanceof Error ? error.message : String(error)}`)
            setNoticeBad(true)
          } finally {
            if (alive.current) setBusy('')
          }
        }, [busy, refreshUntilSettled, t])

        const changeSetting = useCallback((section, key, value) => {
          setSettingsDraft(previous => ({ ...previous, [section]: { ...previous[section], [key]: value } }))
        }, [])

        const adoptPresetState = useCallback(payload => {
          if (payload === undefined || payload === null || payload.state === undefined) return
          setSnapshot(payload.state)
          setProbe(payload.state.lastProbe ?? undefined)
          setSettingsDraft(settingsToDraft(payload.state.settings))
        }, [])

        const savePreset = useCallback(async () => {
          if (presetBusy !== '') return
          setPresetBusy('preset-save')
          setPresetNotice('')
          setPresetNoticeBad(false)
          try {
            const payload = await request(`${PREFIX}/settings`, settingsDraft)
            if (payload.ok !== true) throw new Error(payload.error || t.loadFailed)
            adoptPresetState(payload)
            setPresetNotice(t.presetSaved)
            setPresetNoticeBad(false)
          } catch (error) {
            setPresetNotice(`${t.errorTitle}: ${error instanceof Error ? error.message : String(error)}`)
            setPresetNoticeBad(true)
          } finally {
            if (alive.current) setPresetBusy('')
          }
        }, [adoptPresetState, presetBusy, settingsDraft, t])

        const uploadPersona = useCallback(async file => {
          if (presetBusy !== '') return
          setPresetBusy('persona')
          setPresetNotice('')
          setPresetNoticeBad(false)
          try {
            const content = await file.text()
            const payload = await request(`${PREFIX}/persona`, { name: file.name, text: content })
            if (payload.ok !== true) throw new Error(payload.error || t.loadFailed)
            adoptPresetState(payload)
            setPresetNotice(`${t.personaUpload}: ${payload.uploaded?.name ?? ''}`)
            setPresetNoticeBad(false)
          } catch (error) {
            setPresetNotice(`${t.errorTitle}: ${error instanceof Error ? error.message : String(error)}`)
            setPresetNoticeBad(true)
          } finally {
            if (alive.current) setPresetBusy('')
          }
        }, [adoptPresetState, presetBusy, t])

        const usePersonaPath = useCallback(async value => {
          if (presetBusy !== '') return
          setPresetBusy('persona-path')
          setPresetNotice('')
          setPresetNoticeBad(false)
          try {
            const payload = await request(`${PREFIX}/persona`, { path: value })
            if (payload.ok !== true) throw new Error(payload.error || t.loadFailed)
            adoptPresetState(payload)
            setPresetNotice(`${t.personaUsePath}: ${payload.uploaded?.name ?? ''}`)
            setPresetNoticeBad(false)
          } catch (error) {
            setPresetNotice(`${t.errorTitle}: ${error instanceof Error ? error.message : String(error)}`)
            setPresetNoticeBad(true)
          } finally {
            if (alive.current) setPresetBusy('')
          }
        }, [adoptPresetState, presetBusy, t])

        if (loading && snapshot === undefined) {
          return h('div', { className: 'dsh-dingtalk' }, h('p', { className: 'dsh-dingtalk-muted' }, t.loading))
        }
        if (snapshot === undefined) {
          return h(
            'div',
            { className: 'dsh-dingtalk' },
            h('h2', null, t.title),
            h('p', { className: 'dsh-dingtalk-muted' }, `${t.loadFailed}: ${loadError}`),
            h('div', { className: 'dsh-dingtalk-actions' }, h('button', { onClick: () => void load() }, t.retry)),
          )
        }

        const config = snapshot.config ?? EMPTY_CONFIG
        const secretLabel = config.hasSecret === true ? t.secretSet : t.secretUnset
        const disabled = busy !== ''

        const textInput = (key, type, placeholder) =>
          h('input', {
            type,
            value: draft[key],
            placeholder: placeholder ?? '',
            disabled,
            spellCheck: false,
            autoComplete: type === 'password' ? 'new-password' : 'off',
            onChange: event => edit(key, event.target.value),
          })

        return h(
          'div',
          { className: 'dsh-dingtalk' },
          h('h2', null, t.title),
          h('p', { className: 'dsh-dingtalk-muted' }, t.intro),
          h(StatusCard, { snapshot, probe }),

          h('h3', null, t.sectionCred),
          h('p', { className: 'dsh-dingtalk-muted' }, t.sectionCredHint),
          h(Field, { label: t.clientId, hint: t.clientIdHint }, textInput('clientId', 'text')),
          h(
            Field,
            { label: t.clientSecret, hint: `${t.clientSecretHint} — ${secretLabel}` },
            textInput('clientSecret', 'password'),
          ),

          h('h3', null, t.sectionAccess),
          h('p', { className: 'dsh-dingtalk-muted' }, t.sectionAccessHint),
          h(Field, { label: t.ownerStaffId, hint: t.ownerStaffIdHint }, textInput('ownerStaffId', 'text')),
          h(
            Field,
            { label: t.senderAccess, hint: t.senderAccessHint },
            h(
              'select',
              { value: draft.senderAccess, disabled, onChange: event => edit('senderAccess', event.target.value) },
              h('option', { value: 'all' }, t.senderAccessAll),
              h('option', { value: 'owner' }, t.senderAccessOwner),
              h('option', { value: 'allowlist' }, t.senderAccessAllowlist),
            ),
          ),
          draft.senderAccess === 'allowlist'
            ? h(Field, { label: t.allowedSenders, hint: t.allowedSendersHint }, textInput('allowedSenders', 'text'))
            : null,
          h(
            Field,
            { label: t.groupAccess },
            h(
              'select',
              { value: draft.groupAccess, disabled, onChange: event => edit('groupAccess', event.target.value) },
              h('option', { value: 'all' }, t.groupAccessAll),
              h('option', { value: 'none' }, t.groupAccessNone),
              h('option', { value: 'allowlist' }, t.groupAccessAllowlist),
            ),
          ),
          draft.groupAccess === 'allowlist'
            ? h(Field, { label: t.groupAllowlist, hint: t.groupAllowlistHint }, textInput('groupAllowlist', 'text'))
            : null,

          h('h3', null, t.sectionRuntime),
          h(Field, { label: t.workspace, hint: t.workspaceHint }, textInput('workspace', 'text')),

          h(PresetPanel, {
            catalog: snapshot.catalog,
            draft: settingsDraft,
            persona: snapshot.persona,
            defaultAgentPreset: snapshot.defaultAgentPreset,
            onChange: changeSetting,
            onSave: savePreset,
            onUpload: uploadPersona,
            onUsePath: usePersonaPath,
            busy: presetBusy,
            notice: presetNotice,
            noticeBad: presetNoticeBad,
          }),

          h(
            'div',
            { className: 'dsh-dingtalk-actions' },
            h('button', { className: 'primary', disabled, onClick: () => void save() }, busy === 'save' ? t.saving : t.save),
            h('button', { disabled, onClick: () => void test() }, busy === 'test' ? t.testing : t.test),
            h('button', { disabled, onClick: () => void reconnect() }, t.reconnect),
            h('button', { disabled, onClick: () => void load() }, t.reload),
            h('span', { className: 'dsh-dingtalk-muted' }, dirty ? t.dirty : t.notDirty),
          ),
          notice !== '' ? h('p', { className: `dsh-dingtalk-notice ${noticeBad ? 'bad' : 'ok'}` }, notice) : null,

          h(
            'div',
            { className: 'dsh-dingtalk-warn' },
            h('strong', null, t.warnTitle),
            h('span', { className: 'dsh-dingtalk-muted' }, t.warnBody),
          ),

          h(
            'div',
            { className: 'dsh-dingtalk-copy' },
            h(
              'span',
              null,
              h('a', { href: CONSOLE_URL, target: '_blank', rel: 'noreferrer' }, t.docs),
              ' · ',
              h('span', null, `dsh-dingtalk-plugin v${snapshot.version ?? ''}`),
            ),
            h('span', null, snapshot.copyright ?? t.copyright),
          ),
        )
      }

      /**
       * The settings shell instantiates this component with no arguments; every
       * piece of state it needs comes from the Host routes above.
       */
      const inject = ['slots']

      function apply(ctx) {
        ctx.effect(() => {
          const removeStyles = installStyles()
          const disposeSection = ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'dingtalk',
                order: 40,
                label: () => text().nav,
                inject: () => ({}),
              },
              DingTalkSettings,
            ),
          )
          return () => {
            if (typeof disposeSection === 'function') disposeSection()
            removeStyles()
          }
        })
      }

      return { name: 'dsh-dingtalk-plugin', inject, apply }
    },
  })
})()
