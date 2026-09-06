import assert from "node:assert/strict";
import test from "node:test";
import { accountId, createUsageReader, parseUsage } from "../lib/usage.js";

const token = (id) => `e30.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: id } })).toString("base64url")}.test`;
const window = (duration, used) => ({ limit_window_seconds: duration, used_percent: used, reset_at: 2000000000 });
const payload = { rate_limit: { primary_window: window(18000, 27), secondary_window: window(604800, 62.5) } };
const response = (data = payload) => ({ ok: true, status: 200, json: async () => data });

test("remaining percentages and reset timestamps are normalized", () => {
  const [limit] = parseUsage(payload);
  assert.equal(limit.fiveHour.remainingPercent, 73);
  assert.equal(limit.weekly.remainingPercent, 37.5);
  assert.equal(limit.weekly.resetsAt, 2000000000);
});
test("windows are identified by duration, including a weekly-only primary", () => {
  const [limit] = parseUsage({ rate_limit: { primary_window: window(604800, 0) } });
  assert.equal(limit.fiveHour, null);
  assert.equal(limit.weekly.remainingPercent, 100);
  assert.equal(parseUsage({ rate_limit: { primary_window: window(2628000, 40) } })[0].weekly, null);
});
test("missing and invalid percentages are unavailable, never interpreted as unused", () => {
  assert.equal(parseUsage({ rate_limit: null })[0].fiveHour, null);
  for (const used of [null, undefined, "10", NaN, Infinity]) {
    assert.equal(parseUsage({ rate_limit: { primary_window: window(18000, used) } })[0].fiveHour, null);
  }
  assert.throws(() => parseUsage({ error: "wrong shape" }));
});
test("out-of-range percentages are clamped and extra buckets remain separate", () => {
  const limits = parseUsage({ ...payload, additional_rate_limits: [{ metered_feature: "codex_other", limit_name: "Other models", rate_limit: { primary_window: window(18000, 120), secondary_window: window(604800, -5) } }] });
  assert.equal(limits[0].fiveHour.remainingPercent, 73);
  assert.equal(limits[1].fiveHour.remainingPercent, 0);
  assert.equal(limits[1].weekly.remainingPercent, 100);
});
test("invalid credential does not cause an HTTP request", async () => {
  assert.equal(accountId("bad"), null);
  for (const value of [null, "bad"]) {
    const reader = createUsageReader({ resolveCredential: async () => ({ value }), fetchUsage: () => assert.fail("must not fetch") });
    assert.equal((await reader.read()).state, value ? "sign-in-required" : "signed-out");
    await reader.dispose();
  }
});
test("requests use only the fixed usage endpoint, coalesce, cache and hide secrets", async () => {
  let calls = 0;
  let clock = 100;
  const access = token("account-test");
  const reader = createUsageReader({ now: () => clock, resolveCredential: async () => ({ value: access }), fetchUsage: async (url, init) => {
    calls++;
    assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
    assert.equal(init.headers.Authorization, `Bearer ${access}`);
    assert.equal(init.headers["ChatGPT-Account-Id"], "account-test");
    assert.equal(init.redirect, "error");
    return response();
  } });
  const results = await Promise.all([reader.read(), reader.read()]);
  assert.equal(calls, 1);
  assert.equal(results[0].state, "ready");
  assert.equal(JSON.stringify(results).includes("account-test"), false);
  await reader.read(); assert.equal(calls, 1);
  clock += 31000; await reader.read(); assert.equal(calls, 2);
  await reader.dispose();
});
test("logout during a request discards the old account snapshot", async () => {
  let value = token("first");
  const reader = createUsageReader({ resolveCredential: async () => ({ value }), fetchUsage: async () => { value = null; return response(); } });
  assert.deepEqual(await reader.read(), { state: "signed-out", fetchedAt: null, limits: [] });
  await reader.dispose();
});
test("switching accounts invalidates a fresh cache", async () => {
  let value = token("first"); let calls = 0;
  const reader = createUsageReader({ resolveCredential: async () => ({ value }), fetchUsage: async () => { calls++; return response(); } });
  await reader.read(); value = token("second"); await reader.read();
  assert.equal(calls, 2); await reader.dispose();
});
test("HTTP errors and malformed bodies never expose an upstream error body", async () => {
  for (const [status, state] of [[401, "sign-in-required"], [403, "sign-in-required"], [429, "rate-limited"], [500, "unavailable"]]) {
    const reader = createUsageReader({ resolveCredential: async () => ({ value: token("x") }), fetchUsage: async () => ({ status, ok: false, json: () => assert.fail("must not expose error body") }) });
    assert.deepEqual(await reader.read(), { state, fetchedAt: null, limits: [] });
    await reader.dispose();
  }
  const reader = createUsageReader({ resolveCredential: async () => ({ value: token("x") }), fetchUsage: async () => response({ secret: "private" }) });
  assert.equal((await reader.read()).state, "unavailable"); await reader.dispose();
});
test("unloading aborts in-flight work and waits for completion", async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const reader = createUsageReader({ resolveCredential: async () => ({ value: token("x") }), fetchUsage: async (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true }); started();
  }) });
  const pending = reader.read(); await ready; await reader.dispose();
  assert.equal((await pending).state, "unavailable");
  assert.equal((await reader.read()).state, "unavailable");
});
