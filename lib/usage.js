/** Normalize only known quota fields; never return account identifiers or credentials. */
export function parseUsage(payload) {
  if (!payload || typeof payload !== "object" || !("rate_limit" in payload)) {
    throw new TypeError("Unexpected usage response");
  }
  const limits = [{ id: "codex", name: "Codex", rate: payload.rate_limit }];
  if (Array.isArray(payload.additional_rate_limits)) {
    for (const item of payload.additional_rate_limits) {
      if (item && typeof item.metered_feature === "string") {
        limits.push({ id: item.metered_feature, name: typeof item.limit_name === "string" ? item.limit_name : item.metered_feature, rate: item.rate_limit });
      }
    }
  }
  return limits.map(({ id, name, rate }) => {
    const windows = [rate?.primary_window, rate?.secondary_window].filter(Boolean);
    const read = (seconds) => {
      const window = windows.find(value => value.limit_window_seconds === seconds);
      if (!window || typeof window.used_percent !== "number" || !Number.isFinite(window.used_percent)) return null;
      return {
        remainingPercent: Math.max(0, Math.min(100, 100 - window.used_percent)),
        resetsAt: Number.isSafeInteger(window.reset_at) && window.reset_at > 0 ? window.reset_at : null,
      };
    };
    return { id, name, fiveHour: read(18000), weekly: read(604800) };
  });
}

/** The JWT account claim scopes the request to the same account as inference. */
export function accountId(access) {
  try {
    const claims = JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString("utf8"));
    const id = claims?.["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null; // A non-JWT or incomplete credential cannot identify a Codex account.
  }
}

/** Coalesce requests, cache briefly, and discard results when the credential changes. */
export function createUsageReader({ resolveCredential, fetchUsage = fetch, now = Date.now, cacheMs = 30000, timeoutMs = 10000 }) {
  const lifetime = new AbortController();
  let pending = null;
  let cached = null;
  let cachedToken = null;
  let nextRead = 0;
  const empty = (state) => ({ state, fetchedAt: null, limits: [] });
  async function readOnce() {
    let token;
    try { token = (await resolveCredential())?.value; }
    catch { return empty("unavailable"); }
    if (!token) { cached = null; cachedToken = null; return empty("signed-out"); }
    if (token === cachedToken && cached && now() < nextRead) return cached;
    cachedToken = token;
    cached = null;
    const account = accountId(token);
    if (!account) return empty("sign-in-required");
    let result;
    try {
      const response = await fetchUsage("https://chatgpt.com/backend-api/wham/usage", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "ChatGPT-Account-Id": account, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(timeoutMs)]),
      });
      if (response.status === 401 || response.status === 403) result = empty("sign-in-required");
      else if (response.status === 429) result = empty("rate-limited");
      else if (!response.ok) result = empty("unavailable");
      else result = { state: "ready", fetchedAt: now(), limits: parseUsage(await response.json()) };
    } catch {
      result = empty("unavailable"); // Do not forward upstream error bodies, URLs, or secrets to the browser.
    }
    if (lifetime.signal.aborted) return empty("unavailable");
    let current;
    try { current = (await resolveCredential())?.value; }
    catch { return empty("unavailable"); }
    if (current !== token) return empty(current ? "unavailable" : "signed-out");
    cached = result;
    nextRead = now() + (result.state === "rate-limited" ? Math.max(cacheMs, 60000) : cacheMs);
    return result;
  }
  return {
    read() {
      if (lifetime.signal.aborted) return Promise.resolve(empty("unavailable"));
      if (!pending) pending = readOnce().finally(() => { pending = null; });
      return pending;
    },
    async dispose() { lifetime.abort(); await pending; cached = null; cachedToken = null; },
  };
}
