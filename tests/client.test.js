import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

/** Small hook host isolates the UI's Remote-result and collapsed-props contracts. */
async function fixture(response, initialSelection = null) {
  let plugin, descriptor, stateIndex = 0;
  let selection = initialSelection;
  let currentSession = "test-session";
  let poll;
  let reads = 0;
  const savedHeights = [];
  const state = [], effects = [], registrations = [], cleanups = [];
  const react = {
    Fragment: "fragment", createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) { const index = stateIndex++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; },
    useRef(value) { const index = stateIndex++; if (!(index in state)) state[index] = { current: value }; return state[index]; }, useEffect(callback) { effects.push(callback); },
    useMemo(fn) { return fn(); }, useCallback(fn) { return fn; }, useSyncExternalStore(_, get) { return get(); },
  };
  const window = { __ModuleLoader__: { load(entry) { plugin = entry.factory(() => react); } }, addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), {
    window, document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    setInterval: (fn, delay) => { assert.equal(delay, 60000); poll = fn; return 1; }, clearInterval() {}, Date, Set,
  });
  const api = { read: async () => { reads++; return response; } };
  const ctx = {
    remote: { $mount: async value => { descriptor = value; return () => {}; }, codexUsage: api, settings: { mutate: async (ns, ops) => { assert.equal(ns, "codex-usage"); savedHeights.push(ops[0].value); return { ok: true }; } } },
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
    return summary({ api, t: key => key, wide, useSessions: fn => fn({ current: currentSession }), models: ctx.modelDirectories, sessions: ctx.sessions, settings: ctx.remote.settings });
  };
  render();
  const cleanup = effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  stateIndex = 0;
  const rendered = render();
  return { rendered, descriptor, registrations, render, savedHeights, get reads() { return reads; }, async tick() { poll(); await new Promise(resolve => setImmediate(resolve)); }, renderPanel() { stateIndex = 0; return registrations.find(r => r.spec.name === "settings.section").component({ api, t: key => key }); }, select(value) { selection = value; }, clearSession() { currentSession = undefined; }, dispose() { cleanup(); cleanups.reverse().forEach(fn => fn?.()); unmount(); } };
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

test("expanded meters expose exact values and label low and critical thresholds", async () => {
  for (const [value, warning] of [[26, null], [25, "low"], [10, "critical"], [0, "critical"]]) {
    const data = { ...quota, limits: [{ ...quota.limits[0], weekly: { remainingPercent: value, resetsAt: null } }] };
    const f = await fixture({ ok: true, value: data });
    const tree = f.render(true);
    const nodes = [];
    function visit(node) { if (!node || typeof node !== "object") return; nodes.push(node); node.children?.flat(Infinity).forEach(visit); }
    visit(tree);
    assert.deepEqual(nodes.filter(n => n.props?.role === "progressbar").map(n => n.props["aria-valuenow"]), [73, value]);
    const text = JSON.stringify(tree);
    if (warning) assert.ok(nodes.some(n => n.children?.includes(warning)));
    else assert.ok(!nodes.some(n => n.children?.includes("low") || n.children?.includes("critical")));
    assert.match(text, /remainingFiveHour/); assert.match(text, /remainingWeekly/);
    assert.doesNotMatch(text, /fiveHourLimit|weeklyLimit/);
    f.dispose();
  }
});

test("weekly-only accounts hide five-hour rows everywhere and expose no refresh buttons", async () => {
  const f = await fixture({ ok: true, value: { ...quota, limits: [{ ...quota.limits[0], fiveHour: null }] } });
  for (const tree of [f.render(true), f.render(false), f.renderPanel()]) {
    const text = JSON.stringify(tree);
    assert.doesNotMatch(text, /fiveHour|5h|"type":"button"|Refresh usage/);
    assert.match(text, /37.5%/);
  }
  f.dispose();
});
test("usage polls automatically every minute and stops after unmount", async () => {
  const f = await fixture({ ok: true, value: quota });
  assert.equal(f.reads, 1);
  await f.tick(); assert.equal(f.reads, 2);
  f.dispose(); await f.tick(); assert.equal(f.reads, 2);
});

test("top grip resizes upward, clamps height, and saves only completed interactions", async () => {
  const f = await fixture({ ok: true, value: quota });
  const grip = f.render(true).children.find(n => n?.props?.role === "separator").props;
  const target = { focus() {}, setPointerCapture() {}, releasePointerCapture() {} };
  grip.onPointerDown({ button: 0, clientY: 300, pointerId: 1, currentTarget: target, preventDefault() {} });
  grip.onPointerMove({ clientY: 240 });
  assert.equal(f.render(true).children[0].props["aria-valuenow"], 240);
  assert.deepEqual(f.savedHeights, []);
  grip.onPointerUp({ pointerId: 1, currentTarget: target });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.savedHeights, [240]);
  grip.onKeyDown({ key: "Home", preventDefault() {} });
  assert.equal(f.render(true).children[0].props["aria-valuenow"], 180);
  grip.onKeyDown({ key: "ArrowDown", preventDefault() {} });
  assert.equal(f.render(true).children[0].props["aria-valuenow"], 180);
  grip.onKeyUp({ key: "ArrowDown" });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.savedHeights, [240, 180]);
  assert.match(JSON.stringify(f.render(true)), /remaining/);
  assert.doesNotMatch(JSON.stringify(f.render(true)), /progressbar/);
  grip.onKeyDown({ key: "End", preventDefault() {} });
  assert.match(JSON.stringify(f.render(true)), /progressbar/);
  assert.equal(f.render(true).props.style.height, undefined);
  assert.doesNotMatch(JSON.stringify(f.render(true)), /overflowY/);
  f.dispose();
});
