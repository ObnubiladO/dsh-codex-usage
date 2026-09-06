import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

/** Small hook host isolates the UI's Remote-result and collapsed-props contracts. */
async function fixture(response, initialSelection = null) {
  let plugin, descriptor, stateIndex = 0;
  let selection = initialSelection;
  let currentSession = "test-session";
  const state = [], effects = [], registrations = [], cleanups = [];
  const react = {
    Fragment: "fragment", createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) { const index = stateIndex++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; },
    useRef(value) { return { current: value }; }, useEffect(callback) { effects.push(callback); },
    useMemo(fn) { return fn(); }, useCallback(fn) { return fn; }, useSyncExternalStore(_, get) { return get(); },
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
    sessions: { binding: () => ({}) },
    modelDirectories: { directoryFor: () => ({ store: { getSnapshot: () => ({ current: selection }), subscribe: () => () => {} } }) },
    slots: { inject(_, fn) { cleanups.push(fn()); }, register(spec, component) { registrations.push({ spec, component }); return () => { registrations.splice(registrations.findIndex(r => r.spec === spec), 1); }; } },
  };
  const unmount = await plugin.apply(ctx);
  const summary = registrations.find(r => r.spec.name === "sidebar.footer.action").component;
  const render = (wide = false) => {
    stateIndex = 0;
    return summary({ api, t: key => key, wide, useSessions: fn => fn({ current: currentSession }), models: ctx.modelDirectories, sessions: ctx.sessions });
  };
  render();
  const cleanup = effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  stateIndex = 0;
  const rendered = render();
  return { rendered, descriptor, registrations, render, select(value) { selection = value; }, clearSession() { currentSession = undefined; }, dispose() { cleanup(); cleanups.reverse().forEach(fn => fn?.()); unmount(); } };
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

test("switching between Spark and Astra switches both percentages and allowance label", async () => {
  const data = { ...quota, limits: [...quota.limits, { id: "codex_bengalfox", name: "GPT-5.3-Codex-Spark", fiveHour: { remainingPercent: 91, resetsAt: null }, weekly: { remainingPercent: 62, resetsAt: null } }] };
  const f = await fixture({ ok: true, value: data }, { provider: "openai-codex", model: "gpt-6-astra" });
  assert.match(JSON.stringify(f.render()), /73%/);
  f.select({ provider: "openai-codex", model: "gpt-5.3-codex-spark" });
  const spark = JSON.stringify(f.render(true));
  assert.match(spark, /GPT-5.3-Codex-Spark/); assert.match(spark, /91%/); assert.match(spark, /62%/); assert.doesNotMatch(spark, /73%/);
  assert.match(JSON.stringify(f.render(false)), /Spark/);
  f.select({ provider: "openai-codex", model: "gpt-6-astra" });
  const astra = JSON.stringify(f.render());
  assert.match(astra, /73%/); assert.doesNotMatch(astra, /91%/);
  f.dispose();
});
test("missing Spark bucket never falls back to the main allowance", async () => {
  const f = await fixture({ ok: true, value: quota }, { provider: "openai-codex", model: "gpt-5.3-codex-spark" });
  const text = JSON.stringify(f.render());
  assert.match(text, /Spark/); assert.match(text, /—/); assert.doesNotMatch(text, /73%/);
  f.clearSession(); assert.match(JSON.stringify(f.render()), /73%/);
  f.dispose();
});
test("a Spark-shaped model ID on another provider does not select the Codex Spark allowance", async () => {
  const f = await fixture({ ok: true, value: quota }, { provider: "other", model: "gpt-5.3-codex-spark" });
  assert.match(JSON.stringify(f.render()), /73%/);
  assert.doesNotMatch(JSON.stringify(f.render()), /Spark/);
  f.dispose();
});
