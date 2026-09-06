import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

/** Small hook host isolates the UI's Remote-result and collapsed-props contracts. */
async function fixture(response) {
  let plugin, descriptor, stateIndex = 0;
  const state = [], effects = [], registrations = [], cleanups = [];
  const react = {
    Fragment: "fragment", createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) { const index = stateIndex++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; },
    useRef(value) { return { current: value }; }, useEffect(callback) { effects.push(callback); },
  };
  const window = { __ModuleLoader__: { load(entry) { plugin = entry.factory(() => react); } }, addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), {
    window, document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    setInterval: () => 1, clearInterval() {}, Date, Set,
  });
  const api = { read: async () => response };
  const ctx = {
    remote: { $mount: async value => { descriptor = value; return () => {}; }, codexUsage: api },
    locale: { register: () => () => {}, bind: () => key => key },
    effect(fn) { cleanups.push(fn()); },
    inject(_, fn) { fn(ctx); },
    slots: { inject(_, fn) { cleanups.push(fn()); }, register(spec, component) { registrations.push({ spec, component }); return () => { registrations.splice(registrations.findIndex(r => r.spec === spec), 1); }; } },
  };
  const unmount = await plugin.apply(ctx);
  const summary = registrations.find(r => r.spec.name === "sidebar.footer.action").component;
  summary({ api, t: key => key, wide: false });
  const cleanup = effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  stateIndex = 0;
  const rendered = summary({ api, t: key => key, wide: false });
  return { rendered, descriptor, registrations, dispose() { cleanup(); cleanups.reverse().forEach(fn => fn?.()); unmount(); } };
}
const quota = { state: "ready", fetchedAt: Date.now(), limits: [{ id: "codex", name: "Codex", fiveHour: { remainingPercent: 73, resetsAt: null }, weekly: { remainingPercent: 37.5, resetsAt: null } }] };

test("client unwraps the actual Remote Result and renders percentages in the collapsed sidebar", async () => {
  const f = await fixture({ ok: true, value: quota });
  const text = JSON.stringify(f.rendered);
  assert.match(text, /73%/); assert.match(text, /37.5%/);
  assert.doesNotMatch(text, /title · remaining/);
  assert.equal(f.registrations.length, 2);
  f.dispose(); assert.equal(f.registrations.length, 0);
});
test("transport errors do not leave an apparently valid quota", async () => {
  const f = await fixture({ ok: false, error: { message: "private transport diagnostic" } });
  const text = JSON.stringify(f.rendered);
  assert.match(text, /unavailable/); assert.doesNotMatch(text, /private transport/);
  f.dispose();
});
test("browser schema rejects invalid percentages before rendering", async () => {
  const f = await fixture({ ok: true, value: quota });
  assert.throws(() => f.descriptor.descriptors[0].result.schema.parse({ ...quota, limits: [{ ...quota.limits[0], fiveHour: { remainingPercent: 101, resetsAt: null } }] }));
  f.dispose();
});
