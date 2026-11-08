/**
 * Unit tests for the new-session preset hook (`session-preset.js`).
 *
 * A fake Host context exposes only what the hook touches: the Agent preset
 * roster, the permission presets, the session model selection and the per-agent
 * scoped context. No DSH process is started.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { saveSettings, stateDir } from '../settings.js';
import {
  BUILT_IN_AGENT_PRESETS,
  applyNewSessionPreset,
  buildIntroText,
  buildPersonaText,
  isChannelSession,
} from '../session-preset.js';

const STATE_HOME = mkdtempSync(join(tmpdir(), 'dsh-dingtalk-preset-'));
process.env.DSH_DINGTALK_STATE_DIR = STATE_HOME;
const WORKSPACE = mkdtempSync(join(tmpdir(), 'dsh-dingtalk-preset-ws-'));
const PERSONA_PATH = join(STATE_HOME, 'persona-项目经理.md');

const CATALOG = {
  workspaces: [],
  agentPresets: [{ id: 'standard', name: '标准模式' }, { id: 'ptc', name: 'PTC 模式' }],
  permissions: [{ value: 'workspace-write', name: '工作区可修改' }],
  models: [
    {
      provider: 'deepseek-official',
      providerName: 'DeepSeek',
      id: 'deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      reasoning: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }],
      defaultReasoning: 'high',
    },
  ],
  personas: { defaultPath: 'C:\\personas\\example.md', defaultExists: false, uploaded: [] },
};

/** Fake Host context with the services the hook reads. */
function fakeHost({ catalog = CATALOG } = {}) {
  const calls = { select: [], permissionApply: [], approvalPolicy: [], selection: [], sections: [] };
  const services = {
    agentPresets: {
      async select(agent, id) {
        calls.select.push({ agentId: agent.id, id });
        return id;
      },
    },
    permissionPresets: {
      current: () => 'custom',
      apply(session, name, setApproval) {
        calls.permissionApply.push({ sessionId: session.header.id, name });
        setApproval('ask');
      },
    },
    approval: {
      setPolicy(agent, policy) {
        calls.approvalPolicy.push({ agentId: agent.id, policy });
      },
    },
    sessionController: {
      selectForNextRequest(agent, selection) {
        calls.selection.push({ agentId: agent.id, selection });
      },
    },
    workspaceRegistry: { list: () => [] },
  };
  const ctx = {
    get(name) {
      return services[name];
    },
    on() {
      return () => {};
    },
    effect(fn) {
      return fn();
    },
  };
  return {
    ctx,
    calls,
    services,
    deps: {
      log: () => {},
      getSettings: () => {
        throw new Error('getSettings must be overridden');
      },
      getConnectorWorkspace: () => WORKSPACE,
      getCatalog: async () => catalog,
    },
  };
}

/** Fake agent whose scoped context records prompt sections and event listeners. */
function fakeAgent({ cwd = WORKSPACE, id = 'session-dingtalk', resumed = false, agentPreset = 'standard' } = {}) {
  const sections = [];
  const listeners = [];
  const agent = {
    id,
    session: {
      header: { id, cwd, agentPreset, origin: 'web' },
      requestHeader: () => (resumed ? { config: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'medium' } } : undefined),
    },
    ctx: {
      effect(fn) {
        return fn();
      },
      on(event, handler) {
        listeners.push({ event, handler });
        return () => {
          const index = listeners.findIndex(entry => entry.handler === handler);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
      systemPrompt: {
        section(section) {
          sections.push(section);
          return () => {};
        },
      },
    },
  };
  return { agent, sections, listeners };
}

function enablePreset(overrides = {}) {
  const settings = saveSettings({
    version: 1,
    preset: {
      enabled: true,
      workspace: WORKSPACE,
      agentPreset: 'ptc',
      permission: 'workspace-write',
      model: 'deepseek-v4.1-flash',
      reasoning: 'high',
      ...overrides,
    },
    persona: { enabled: true, choice: 'custom', customPath: PERSONA_PATH },
    intro: { enabled: true },
  });
  return settings;
}

test('the settings module honours DSH_DINGTALK_STATE_DIR', () => {
  assert.equal(stateDir(), STATE_HOME);
});

test('a fresh channel session receives the preset, permission and model', async () => {
  writeFileSync(PERSONA_PATH, '# 项目经理\n\n你是资深项目经理，先结论后依据。');
  enablePreset();
  const host = fakeHost();
  host.deps.getSettings = () => ({
    version: 1,
    preset: { enabled: true, workspace: WORKSPACE, agentPreset: 'ptc', permission: 'workspace-write', model: 'deepseek-v4.1-flash', reasoning: 'high' },
    persona: { enabled: true, choice: 'custom', customPath: PERSONA_PATH },
    intro: { enabled: true },
  });
  const { agent, sections } = fakeAgent({ agentPreset: 'ptc' });
  await applyNewSessionPreset(host.ctx, agent, host.deps);

  assert.equal(host.calls.select.length, 0, 'the preset is never re-selected on a live Agent');
  assert.equal(host.calls.permissionApply.length, 1);
  assert.equal(host.calls.permissionApply[0].name, 'workspace-write');
  assert.deepEqual(host.calls.approvalPolicy, [{ agentId: agent.id, policy: 'ask' }]);
  assert.deepEqual(host.calls.selection, [
    { agentId: agent.id, selection: { provider: 'deepseek-official', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' } },
  ]);

  const persona = sections.find(section => section.name === 'dingtalk:persona');
  assert.ok(persona, 'persona section registered');
  assert.match(persona.text, /资深项目经理/u, 'markdown body is injected');
  assert.match(persona.text, /项目经理/u, 'persona name is in the heading');

  const intro = sections.find(section => section.name === 'dingtalk:intro');
  assert.ok(intro, 'intro section registered');
  assert.match(intro.text, /项目经理/u, 'intro names the md');
  assert.match(intro.text, new RegExp(WORKSPACE.replace(/\\/gu, '\\\\'), 'u'), 'intro reports the workspace');
  assert.match(intro.text, /PTC 模式/u, 'intro reports the agent preset');
  assert.match(intro.text, /工作区可修改/u, 'intro reports the permission');
  assert.match(intro.text, /deepseek-official\/deepseek-v4\.1-flash/u, 'intro reports the model');
  assert.match(intro.text, /high/u, 'intro reports the reasoning effort');
});

test('a session outside the connector workspace is left alone', async () => {
  writeFileSync(PERSONA_PATH, '# 项目经理');
  enablePreset();
  const host = fakeHost();
  host.deps.getSettings = () => ({
    version: 1,
    preset: { enabled: true, workspace: WORKSPACE, agentPreset: 'ptc', permission: 'workspace-write', model: 'deepseek-v4.1-flash', reasoning: 'high' },
    persona: { enabled: true, choice: 'custom', customPath: PERSONA_PATH },
    intro: { enabled: true },
  });
  const { agent, sections } = fakeAgent({ cwd: join(tmpdir(), 'some-other-dir') });
  await applyNewSessionPreset(host.ctx, agent, host.deps);
  assert.equal(host.calls.select.length, 0);
  assert.equal(sections.length, 0);
});

test('disabling both features is a no-op', async () => {
  saveSettings({ version: 1, preset: { enabled: false }, persona: { enabled: false }, intro: { enabled: false } });
  const host = fakeHost();
  host.deps.getSettings = () => ({ version: 1, preset: { enabled: false }, persona: { enabled: false }, intro: { enabled: false } });
  const { agent, sections } = fakeAgent();
  await applyNewSessionPreset(host.ctx, agent, host.deps);
  assert.equal(host.calls.select.length, 0);
  assert.equal(sections.length, 0);
});

test('the introduction alone does not change the default behaviour', async () => {
  // intro defaults to on, but with neither preset nor persona ticked the session
  // must stay untouched (v0.1.0 parity).
  saveSettings({ version: 1, preset: { enabled: false }, persona: { enabled: false }, intro: { enabled: true } });
  const host = fakeHost();
  host.deps.getSettings = () => ({ version: 1, preset: { enabled: false }, persona: { enabled: false }, intro: { enabled: true } });
  const { agent, sections } = fakeAgent();
  await applyNewSessionPreset(host.ctx, agent, host.deps);
  assert.equal(host.calls.select.length, 0);
  assert.equal(sections.length, 0, 'no prompt sections without an enabled preset or persona');
});

test('a resumed session keeps its preset/permission/model but still gets the persona', async () => {
  writeFileSync(PERSONA_PATH, '# 项目经理\n\n保持角色。');
  const host = fakeHost();
  host.deps.getSettings = () => ({
    version: 1,
    preset: { enabled: true, workspace: WORKSPACE, agentPreset: 'ptc', permission: 'workspace-write', model: 'deepseek-v4.1-flash', reasoning: 'high' },
    persona: { enabled: true, choice: 'custom', customPath: PERSONA_PATH },
    intro: { enabled: true },
  });
  const { agent, sections } = fakeAgent({ id: 'session-resumed', resumed: true });
  await applyNewSessionPreset(host.ctx, agent, host.deps);
  assert.equal(host.calls.select.length, 0, 'agent presets are locked once a session started');
  assert.equal(host.calls.selection.length, 0, 'the running selection is not overwritten');
  assert.equal(sections.filter(section => section.name === 'dingtalk:persona').length, 1);
  assert.equal(sections.filter(section => section.name === 'dingtalk:intro').length, 0, 'no second introduction');
});

test('an unavailable model is skipped and the introduction reports the effective one', async () => {
  writeFileSync(PERSONA_PATH, '# 项目经理');
  const host = fakeHost();
  host.deps.getSettings = () => ({
    version: 1,
    preset: { enabled: true, workspace: WORKSPACE, agentPreset: 'standard', permission: 'workspace-write', model: 'deepseek-v4.1-flash', reasoning: 'high' },
    persona: { enabled: true, choice: 'custom', customPath: PERSONA_PATH },
    intro: { enabled: true },
  });
  host.deps.getCatalog = async () => ({ ...CATALOG, models: [] });
  const { agent, sections } = fakeAgent();
  await applyNewSessionPreset(host.ctx, agent, host.deps);
  assert.equal(host.calls.selection.length, 0, 'no selection is recorded for a missing model');
  const intro = sections.find(section => section.name === 'dingtalk:intro');
  assert.ok(intro);
  assert.doesNotMatch(intro.text, /deepseek-v4\.1-flash/u, 'the intro does not claim a model that was not applied');
});

test('the marketing model name resolves to the routed model from the runtime default', async () => {
  writeFileSync(PERSONA_PATH, '# 项目经理');
  const host = fakeHost();
  host.deps.getSettings = () => ({
    version: 1,
    preset: { enabled: true, workspace: WORKSPACE, agentPreset: 'standard', permission: 'workspace-write', model: 'deepseek-v4.1-flash', reasoning: 'high' },
    persona: { enabled: true, choice: 'custom', customPath: PERSONA_PATH },
    intro: { enabled: true },
  });
  // A deployment with no routable provider directory but a published default model.
  host.deps.getCatalog = async () => ({
    ...CATALOG,
    models: [],
    defaultModel: { provider: 'deepseek-official', model: 'deepseek-flash' },
  });
  const { agent, sections } = fakeAgent();
  await applyNewSessionPreset(host.ctx, agent, host.deps);
  assert.deepEqual(host.calls.selection, [
    { agentId: agent.id, selection: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' } },
  ]);
  const intro = sections.find(section => section.name === 'dingtalk:intro');
  assert.match(intro.text, /deepseek-official\/deepseek-flash/u);
});

test('the persona markdown is capped and empty files are ignored', () => {
  assert.equal(buildPersonaText({ exists: false }), '');
  assert.equal(buildPersonaText({ exists: true, name: 'x', text: '   ' }), '');
  const text = buildPersonaText({ exists: true, name: 'x', text: 'a'.repeat(70000) });
  assert.ok(text.length <= 60000 + 200, 'long persona text is truncated');
});

test('the introduction template always carries all six facts', () => {
  const text = buildIntroText({
    personaName: '无',
    workspace: 'D:\\ws',
    agentPreset: '标准模式',
    permission: '工作区可修改',
    model: 'deepseek-official/deepseek-v4.1-flash',
    reasoning: 'high',
  });
  for (const expected of ['1. 性格预设 md：无', '2. 工作空间：D:\\ws', '3. Agent 预设：标准模式', '4. 权限：工作区可修改', '5. 模型：deepseek-official/deepseek-v4.1-flash', '6. 推理等级：high']) {
    assert.ok(text.includes(expected), `intro includes ${expected}`);
  }
});

test('isChannelSession matches the connector workspace and rejects subagents', () => {
  assert.equal(isChannelSession({ session: { header: { cwd: WORKSPACE, id: 's1' } } }, WORKSPACE), true);
  assert.equal(isChannelSession({ session: { header: { cwd: WORKSPACE, id: 's1', origin: 'subagent' } } }, WORKSPACE), false);
  assert.equal(isChannelSession({ session: { header: { cwd: 'C:\\other', id: 's1' } } }, WORKSPACE), false);
});

test('a rejected durable model selection falls back to a one-shot request override', async () => {
  writeFileSync(PERSONA_PATH, '# 项目经理');
  const host = fakeHost();
  host.services.sessionController.selectForNextRequest = () => {
    throw new Error('Select an available model before sending a message.');
  };
  host.deps.getSettings = () => ({
    version: 1,
    preset: { enabled: true, workspace: WORKSPACE, agentPreset: 'ptc', permission: 'workspace-write', model: 'deepseek-v4.1-flash', reasoning: 'high' },
    persona: { enabled: true, choice: 'custom', customPath: PERSONA_PATH },
    intro: { enabled: true },
  });
  const { agent, listeners } = fakeAgent({ agentPreset: 'ptc' });
  await applyNewSessionPreset(host.ctx, agent, host.deps);
  const override = listeners.find(entry => entry.event === 'agent/request');
  assert.ok(override, 'a request waterfall listener was armed');
  const config = await override.handler({}, async () => ({ provider: 'default-provider', model: 'default-model' }));
  assert.equal(config.provider, 'deepseek-official');
  assert.equal(config.model, 'deepseek-v4.1-flash');
  assert.equal(config.reasoningEffort, 'high');
  assert.equal(listeners.filter(entry => entry.event === 'agent/request').length, 0, 'the override removes itself after one request');
  const untouched = await override.handler({}, async () => ({ provider: 'user-provider', model: 'user-model' }));
  assert.equal(untouched.model, 'user-model', 'a later user model change is not overwritten');
});

test('the built-in preset and permission labels are the Chinese UI copy', () => {
  assert.equal(BUILT_IN_AGENT_PRESETS.standard.name, '标准模式');
  assert.equal(BUILT_IN_AGENT_PRESETS.ptc.name, 'PTC 模式');
  assert.equal(BUILT_IN_AGENT_PRESETS.cordis.name, '创造模式');
});
