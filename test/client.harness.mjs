/**
 * Client-half harness: evaluates `client.js` exactly the way the DSH shell does
 * (an external classic script that calls `window.__ModuleLoader__.load`) and
 * checks that it registers the Settings → DingTalk section.
 *
 * Run with: node dsh-dingtalk-plugin/test/client.harness.mjs
 * Exit code 0 = the bundle loads, returns `{ name, inject, apply }`, and `apply`
 * registers a `settings.section` entry when handed a slot registry.
 */
import assert from 'node:assert/strict';

const loaded = [];
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      assert.equal(typeof spec.id, 'string');
      assert.equal(typeof spec.factory, 'function');
      loaded.push(spec);
    },
  },
};
const styles = [];
globalThis.document = {
  documentElement: { lang: 'zh-CN' },
  getElementById: id => (id === 'dsh-dingtalk-styles' && styles.length > 0 ? styles[0] : null),
  createElement: tag => {
    if (tag !== 'style') return {};
    const node = {
      id: '',
      textContent: '',
      removed: false,
      remove() {
        node.removed = true;
        const index = styles.indexOf(node);
        if (index >= 0) styles.splice(index, 1);
      },
    };
    return node;
  },
  head: {
    appendChild(node) {
      styles.push(node);
    },
  },
};
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });
globalThis.fetch = async () => ({ status: 503, async json() { return { ok: false, error: 'offline harness' }; } });

await import(new URL('../client.js', import.meta.url).href);

assert.equal(loaded.length, 1, 'the bundle registers exactly one module');
const spec = loaded[0];
assert.equal(spec.id, 'dsh-dingtalk-plugin', 'module id matches the package name');

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'fragment',
  useEffect() {},
  useLayoutEffect() {},
  useMemo(factory) {
    return factory();
  },
  useCallback(fn) {
    return fn;
  },
  useRef(value) {
    return { current: value };
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}];
  },
};
const requireStub = name => {
  if (name === 'react') return React;
  throw new Error(`client bundle required an unexpected module: ${name}`);
};

const mod = spec.factory(requireStub);
assert.equal(mod.name, 'dsh-dingtalk-plugin');
assert.deepEqual(mod.inject, ['slots']);
assert.equal(typeof mod.apply, 'function');

const registrations = [];
const injectedSlots = [];
const ctx = {
  effect(fn) {
    const dispose = fn();
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  },
  slots: {
    inject(slot, contributor) {
      injectedSlots.push(slot);
      return contributor();
    },
    register(slotSpec, component) {
      registrations.push({ slotSpec, component });
      return () => {};
    },
  },
};

mod.apply(ctx);

assert.deepEqual(injectedSlots, ['settings.section'], 'contributes to the settings section slot');
assert.equal(registrations.length, 1, 'registers one settings section');
const { slotSpec, component } = registrations[0];
assert.equal(slotSpec.name, 'settings.section');
assert.equal(slotSpec.id, 'dingtalk');
assert.equal(typeof slotSpec.order, 'number');
assert.equal(typeof slotSpec.label, 'function');
assert.equal(slotSpec.label(), '钉钉');
assert.equal(typeof component, 'function');
assert.ok(styles.length === 1 && styles[0].textContent.includes('.dsh-dingtalk'), 'page styles injected');

console.log('PASS client.harness: bundle loads, factory returns {name,inject,apply}, apply registers Settings → 钉钉');
