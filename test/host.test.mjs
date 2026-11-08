/**
 * Host-half unit tests with a fake cordis context (v1.1).
 *
 * These exercise the request/response contract of `/.dsh-dingtalk/*` without a
 * running DSH Host: the connector row is faked, the configuration editor records
 * the callback it receives, `fetch` is stubbed for the credential probe, and the
 * plugin's state directory is redirected to a temporary directory.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../index.js';

const STATE_HOME = mkdtempSync(join(tmpdir(), 'dsh-dingtalk-state-'));
process.env.DSH_DINGTALK_STATE_DIR = STATE_HOME;

const CONNECTOR_ROW = {
  options: {
    id: 'dingtalk-channel',
    name: '@dingtalk-real-ai/dsh-dingtalk',
    config: {
      clientId: 'ding_example_app',
      clientSecret: 'sup3r-secret-value',
      ownerStaffId: '',
      senderAccess: 'all',
      groupAccess: 'all',
      allowedSenders: [],
      groupAllowlist: [],
    },
  },
  fiber: { state: 2 },
};

const REGISTRY_ROW = {
  options: {
    id: 'agent-preset-registry',
    name: '@deepseek-ai/dsh-agent-preset-registry',
    config: { default: 'standard' },
  },
  fiber: { state: 2 },
};

/** Fake cordis context: captures the routes the plugin registers. */
function fakeContext(rows = [structuredClone(CONNECTOR_ROW), structuredClone(REGISTRY_ROW)]) {
  const routes = new Map();
  const edits = [];
  const ctx = {
    inject(deps, callback) {
      assert.deepEqual(deps, ['webServer']);
      callback({
        get(name) {
          if (name !== 'configEditor') return undefined;
          return editor;
        },
        webServer: {
          register(route) {
            if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`);
            routes.set(route.path, route);
            return () => routes.delete(route.path);
          },
        },
        effect(fn) {
          fn();
        },
      });
      return () => {};
    },
  };
  const editor = {
    configuration() {
      return rows.map(row => ({ entry: row, inherited: {}, override: row.options.config }));
    },
    entries() {
      return rows;
    },
    async edit(entry, change) {
      const next = change(entry.options.config, {});
      edits.push(structuredClone(next));
      entry.options.config = next;
      return next;
    },
  };
  return { ctx, routes, edits, rows, editor };
}

/** Collect the response a route handler writes. */
function call(route, { method = 'GET', path, body, contentType = 'application/json' } = {}) {
  const target = path ?? route.path;
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = {
    method,
    url: target,
    headers: body === undefined ? {} : { 'content-type': contentType },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
  const captured = { status: 0, headers: {}, body: undefined };
  const res = {
    writeHead(status, headers) {
      captured.status = status;
      captured.headers = headers;
    },
    end(payload) {
      captured.body = payload === undefined ? undefined : JSON.parse(payload);
    },
  };
  return route.handler(req, res).then(() => captured);
}

function start() {
  const fake = fakeContext();
  apply(fake.ctx);
  const route = fake.routes.get('/.dsh-dingtalk');
  assert.ok(route, 'the prefix route is registered');
  return { ...fake, route };
}

function stateFile() {
  return join(STATE_HOME, 'plugin-settings.json');
}

function writeStateFile(value) {
  writeFileSync(stateFile(), JSON.stringify(value, null, 2));
}

function readStateFile() {
  return JSON.parse(readFileSync(stateFile(), 'utf8'));
}

test('registers exactly one prefix route and logs boot', () => {
  const fake = fakeContext();
  const original = console.log;
  const lines = [];
  console.log = message => lines.push(String(message));
  try {
    apply(fake.ctx);
  } finally {
    console.log = original;
  }
  assert.deepEqual([...fake.routes.keys()], ['/.dsh-dingtalk']);
  assert.equal(fake.routes.get('/.dsh-dingtalk').kind, 'prefix');
  assert.ok(lines.some(line => line.includes('dsh-dingtalk-plugin')));
});

test('GET /state reports the connector and never leaks the secret', async () => {
  const { route } = start();
  const response = await call(route, { path: '/.dsh-dingtalk/state' });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.connector.present, true);
  assert.equal(response.body.connector.active, true);
  assert.equal(response.body.config.clientId, 'ding_example_app');
  assert.equal(response.body.config.hasSecret, true);
  assert.equal(JSON.stringify(response.body).includes('sup3r-secret-value'), false, 'secret must not reach the page');
});

test('GET /state carries the v1.1 settings block, copyright and catalog', async () => {
  const { route } = start();
  const response = await call(route, { path: '/.dsh-dingtalk/state' });
  assert.equal(response.body.version, '1.1.261022');
  assert.equal(response.body.copyright, '©snowwolf03');
  assert.equal(response.body.settings.version, 1);
  assert.equal(response.body.settings.preset.enabled, false, 'the preset feature is opt-in');
  assert.equal(response.body.settings.preset.agentPreset, 'standard');
  assert.equal(response.body.settings.preset.permission, 'workspace-write');
  assert.equal(response.body.settings.preset.model, 'deepseek-v4.1-flash');
  assert.equal(response.body.settings.preset.reasoning, 'high');
  assert.equal(response.body.settings.intro.enabled, true);
  assert.equal(response.body.catalog.personas.defaultPath, '', 'no author machine path is compiled in');
  assert.equal(response.body.catalog.personas.defaultExists, false);
  assert.ok(Array.isArray(response.body.catalog.agentPresets));
  assert.ok(Array.isArray(response.body.catalog.permissions));
  assert.ok(Array.isArray(response.body.catalog.models));
  assert.equal(typeof response.body.effectiveWorkspace, 'string');
  assert.equal(response.body.defaultAgentPreset, 'standard', 'the registry default preset is reported');
});

test('POST /settings persists the new-session preset section', async () => {
  const { route, edits } = start();
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-dingtalk-ws-'));
  const response = await call(route, {
    method: 'POST',
    path: '/.dsh-dingtalk/settings',
    body: {
      preset: {
        enabled: true,
        workspace,
        agentPreset: 'ptc',
        permission: 'danger-full-access',
        model: 'deepseek-v4-flash',
        reasoning: 'low',
      },
      persona: { enabled: true, choice: 'default', customPath: '' },
      intro: { enabled: true },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  const saved = readStateFile();
  assert.equal(saved.preset.enabled, true);
  assert.equal(saved.preset.workspace, workspace);
  assert.equal(saved.preset.agentPreset, 'ptc');
  assert.equal(saved.preset.permission, 'danger-full-access');
  assert.equal(saved.preset.model, 'deepseek-v4-flash');
  assert.equal(saved.preset.reasoning, 'low');
  assert.equal(saved.persona.enabled, true);
  assert.equal(response.body.state.settings.preset.agentPreset, 'ptc');
  // The workspace is written into the connector row so new sessions get it as cwd…
  assert.equal(edits.length, 2, 'connector row + agent-preset registry row were recomposed');
  const connectorEdit = edits.find(entry => entry.workspace === workspace);
  assert.ok(connectorEdit, 'the connector row got the workspace');
  // …and the chosen Agent preset becomes the DSH default preset new Agents resolve.
  const registryEdit = edits.find(entry => entry.selectedDefault === 'ptc');
  assert.ok(registryEdit, 'the agent-preset registry got selectedDefault');
  assert.equal(registryEdit.default, 'standard', 'the deployment default is preserved');
});

test('disabling the preset restores the deployment default Agent preset', async () => {
  const registry = structuredClone(REGISTRY_ROW);
  registry.options.config.selectedDefault = 'ptc';
  const fake = fakeContext([structuredClone(CONNECTOR_ROW), registry]);
  apply(fake.ctx);
  const route = fake.routes.get('/.dsh-dingtalk');
  writeStateFile({
    version: 1,
    preset: { enabled: false, workspace: '', agentPreset: 'ptc', permission: 'workspace-write', model: '', reasoning: '' },
    persona: { enabled: false },
    intro: { enabled: true },
  });
  const response = await call(route, {
    method: 'POST',
    path: '/.dsh-dingtalk/settings',
    body: { preset: { enabled: false } },
  });
  assert.equal(response.status, 200);
  const registryEdit = fake.edits.find(entry => entry.selectedDefault === undefined && entry.default === 'standard');
  assert.ok(registryEdit, 'selectedDefault is removed when the feature is disabled');
});

test('POST /settings rejects a missing workspace instead of saving', async () => {
  writeStateFile({ version: 1 });
  const { route } = start();
  const response = await call(route, {
    method: 'POST',
    path: '/.dsh-dingtalk/settings',
    body: { preset: { enabled: true, workspace: join(STATE_HOME, 'does-not-exist') } },
  });
  assert.equal(response.status, 500);
  assert.match(response.body.error, /工作空间不存在/u);
  assert.equal(readStateFile().preset?.enabled ?? false, false, 'nothing was persisted');
});

test('POST /settings rejects a non-absolute workspace path', async () => {
  const { route } = start();
  const response = await call(route, {
    method: 'POST',
    path: '/.dsh-dingtalk/settings',
    body: { preset: { enabled: true, workspace: 'relative/path' } },
  });
  assert.equal(response.status, 500);
  assert.match(response.body.error, /绝对路径/u);
});

test('POST /persona uploads a markdown copy and selects it as custom', async () => {
  writeStateFile({ version: 1 });
  const { route } = start();
  const response = await call(route, {
    method: 'POST',
    path: '/.dsh-dingtalk/persona',
    body: { name: 'persona.md', text: '# Persona\n\nYou are a helpful project manager.' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.ok(response.body.uploaded.path.startsWith(join(STATE_HOME, 'persona')), 'stored under the state dir');
  assert.equal(existsSync(response.body.uploaded.path), true);
  assert.equal(response.body.uploaded.name, 'persona');
  const saved = readStateFile();
  assert.equal(saved.persona.choice, 'custom');
  assert.equal(saved.persona.customPath, response.body.uploaded.path);
  assert.equal(response.body.state.persona.exists, true);
  assert.equal(response.body.state.persona.name, 'persona');
});

test('POST /persona rejects a non-markdown path', async () => {
  const { route } = start();
  const plain = join(STATE_HOME, 'notes.txt');
  writeFileSync(plain, 'hello');
  const response = await call(route, { method: 'POST', path: '/.dsh-dingtalk/persona', body: { path: plain } });
  assert.equal(response.status, 500);
  assert.match(response.body.error, /只支持 \.md/u);
});

test('POST /config merges drafts into the connector row through configEditor.edit', async () => {
  const { route, edits } = start();
  const response = await call(route, {
    method: 'POST',
    path: '/.dsh-dingtalk/config',
    body: {
      clientId: 'ding_new_app',
      clientSecret: 'new-secret',
      ownerStaffId: 'manager-1',
      senderAccess: 'owner',
      groupAccess: 'none',
      allowedSenders: [],
      groupAllowlist: [],
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(edits.length, 1);
  const next = edits[0];
  assert.equal(next.clientId, 'ding_new_app');
  assert.equal(next.clientSecret, 'new-secret');
  assert.equal(next.ownerStaffId, 'manager-1');
  assert.equal(next.senderAccess, 'owner');
  assert.equal(next.groupAccess, 'none');
  // The preset/other fields survive the merge.
  assert.equal(next.replyMode, undefined, 'unknown fields are untouched, absence stays absence');
  assert.equal(response.body.state.config.hasSecret, true);
  assert.equal(JSON.stringify(response.body).includes('new-secret'), false);
});

test('POST /config keeps a stored secret when the secret field is blank', async () => {
  const { route, edits } = start();
  const response = await call(route, {
    method: 'POST',
    path: '/.dsh-dingtalk/config',
    body: { clientId: 'ding_other_app', clientSecret: '', ownerStaffId: '' },
  });
  assert.equal(response.status, 200);
  assert.equal(edits[0].clientSecret, 'sup3r-secret-value', 'blank secret means keep');
  assert.equal(edits[0].ownerStaffId, 'dsh-user', 'blank owner falls back to the sentinel that opens the connector gate');
});

test('POST /config rejects an unknown enum value', async () => {
  const { route, edits } = start();
  const response = await call(route, {
    method: 'POST',
    path: '/.dsh-dingtalk/config',
    body: { senderAccess: 'anyone' },
  });
  assert.equal(response.status, 500);
  assert.match(response.body.error, /all \/ owner \/ allowlist/u);
  assert.equal(edits.length, 0);
});

test('POST /config rejects a non-JSON content type', async () => {
  const { route } = start();
  const response = await call(route, {
    method: 'POST',
    path: '/.dsh-dingtalk/config',
    body: { clientId: 'x' },
    contentType: 'text/plain',
  });
  assert.equal(response.status, 415);
});

test('POST /test reports a rejected credential probe', async () => {
  const { route } = start();
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    async json() {
      return { code: 'invalidClientSecret', message: 'Invalid clientSecret' };
    },
  });
  try {
    const response = await call(route, { method: 'POST', path: '/.dsh-dingtalk/test', body: {} });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.probe.code, 'invalidClientSecret');
    assert.equal(response.body.probe.stage, 'credentials');
  } finally {
    globalThis.fetch = original;
  }
});

test('POST /test reports a successful probe without redeeming the ticket', async () => {
  const { route } = start();
  const original = globalThis.fetch;
  let calledWith;
  globalThis.fetch = async (url, init) => {
    calledWith = { url, body: JSON.parse(init.body) };
    return {
      ok: true,
      status: 200,
      async json() {
        return { endpoint: 'wss://example.invalid/connect', ticket: 'ticket-value' };
      },
    };
  };
  try {
    const response = await call(route, { method: 'POST', path: '/.dsh-dingtalk/test', body: {} });
    assert.equal(response.body.ok, true);
    assert.equal(response.body.probe.stage, 'stream');
    assert.equal(response.body.probe.endpoint, 'wss://example.invalid/connect');
    assert.equal(calledWith.url, 'https://api.dingtalk.com/v1.0/gateway/connections/open');
    assert.equal(calledWith.body.subscriptions[0].topic, '/v1.0/im/bot/messages/get');
    assert.equal(calledWith.body.clientId, 'ding_example_app');
  } finally {
    globalThis.fetch = original;
  }
});

test('POST /test needs both credentials', async () => {
  const fake = fakeContext([{ options: { id: 'dingtalk-channel', config: {} }, fiber: { state: 2 } }]);
  apply(fake.ctx);
  const route = fake.routes.get('/.dsh-dingtalk');
  const response = await call(route, { method: 'POST', path: '/.dsh-dingtalk/test', body: {} });
  assert.equal(response.body.probe.code, 'MISSING_CLIENT_ID');
  const next = await call(route, { method: 'POST', path: '/.dsh-dingtalk/test', body: { clientId: 'ding_x' } });
  assert.equal(next.body.probe.code, 'MISSING_CLIENT_SECRET');
});
