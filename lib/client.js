window.__ModuleLoader__.load({
  id: "dsh-codex-usage",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const NS = "codexUsage";
    const en = {
      title: "Codex usage", remaining: "remaining", fiveHour: "5h", weekly: "Weekly", refresh: "Refresh usage",
      loading: "Loading usage…", unavailable: "Usage unavailable", "signed-out": "Sign in through Codex Provider",
      "sign-in-required": "Check your Codex Provider sign-in", "rate-limited": "Usage check rate-limited; retrying shortly",
      resets: "Resets", updated: "Updated", hint: "Account-wide remaining allowance. Refreshes every minute. A dash means the window is unavailable.",
    };
    const zh = {
      title: "Codex 额度", remaining: "剩余", fiveHour: "5小时", weekly: "每周", refresh: "刷新额度",
      loading: "正在加载额度…", unavailable: "额度暂不可用", "signed-out": "请通过 Codex Provider 登录",
      "sign-in-required": "请检查 Codex Provider 登录状态", "rate-limited": "额度查询受限，稍后自动重试",
      resets: "重置时间", updated: "更新时间", hint: "账号共享的剩余额度，每分钟刷新一次。横线表示该额度窗口不可用。",
    };
    const states = new Set(["ready", "unavailable", "signed-out", "sign-in-required", "rate-limited"]);
    const schema = { parse(value) {
      if (!value || !states.has(value.state) || !Array.isArray(value.limits) ||
          !(value.fetchedAt === null || Number.isFinite(value.fetchedAt))) throw new TypeError("Invalid usage result");
      for (const limit of value.limits) {
        if (!limit || typeof limit.id !== "string" || typeof limit.name !== "string") throw new TypeError("Invalid usage limit");
        for (const window of [limit.fiveHour, limit.weekly]) {
          if (window === null) continue;
          if (!window || !Number.isFinite(window.remainingPercent) || window.remainingPercent < 0 || window.remainingPercent > 100 ||
              !(window.resetsAt === null || (Number.isSafeInteger(window.resetsAt) && window.resetsAt > 0))) throw new TypeError("Invalid usage window");
        }
      }
      return value;
    } };
    const descriptor = {
      package: "dsh-codex-usage",
      descriptors: [{ id: "dsh-codex-usage#codexUsage/read", service: "codexUsage", namespace: "codexUsage", method: "read",
        invocation: { kind: "direct" }, parameters: [],
        result: { mode: "strict", typeSymbol: "dsh-codex-usage#codexUsage/read:result", schema } }],
    };
    function useUsage(api) {
      const [data, setData] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const refreshRef = React.useRef(() => {});
      React.useEffect(() => {
        let active = true;
        let running = false;
        const refresh = async () => {
          if (!active || running) return;
          running = true;
          setBusy(true);
          try {
            const response = await api.read();
            if (!response?.ok) throw new Error("Usage request failed");
            const result = schema.parse(response.value);
            if (active) setData(result);
          } catch {
            if (active) setData({ state: "unavailable", fetchedAt: null, limits: [] });
          } finally {
            running = false;
            if (active) setBusy(false);
          }
        };
        refreshRef.current = refresh;
        const visible = () => { if (document.visibilityState === "visible") void refresh(); };
        const interval = setInterval(visible, 60000);
        document.addEventListener("visibilitychange", visible);
        window.addEventListener("online", visible);
        void refresh();
        return () => {
          active = false;
          clearInterval(interval);
          document.removeEventListener("visibilitychange", visible);
          window.removeEventListener("online", visible);
          refreshRef.current = () => {};
        };
      }, [api]);
      return { data, busy, refresh: () => refreshRef.current() };
    }
    const color = "var(--dsw-alias-label-primary)";
    const muted = "var(--dsw-alias-label-tertiary)";
    function amount(window, data) {
      if (!window || !data?.fetchedAt || Date.now() - data.fetchedAt > 90000 ||
          (window.resetsAt && window.resetsAt * 1000 <= Date.now())) return "—";
      return `${Math.round(window.remainingPercent * 10) / 10}%`;
    }
    const date = (seconds) => new Date(seconds * 1000).toLocaleString();
    function Summary({ api, t, wide }) {
      const { data, busy, refresh } = useUsage(api);
      const quota = data?.limits.find(limit => limit.id === "codex");
      const line = `${t("fiveHour")} ${amount(quota?.fiveHour, data)} · ${t("weekly")} ${amount(quota?.weekly, data)}`;
      const title = [t("title"), data?.state === "ready" ? `${line} ${t("remaining")}` : t(data?.state ?? "loading"),
        ...[quota?.fiveHour, quota?.weekly].filter(window => window?.resetsAt).map(window => `${t("resets")}: ${date(window.resetsAt)}`)].join("\n");
      return h("button", { type: "button", onClick: refresh, disabled: busy, title, "aria-label": `${title}. ${t("refresh")}`,
        style: { color, background: "transparent", border: 0, borderRadius: 6, padding: "8px 6px", cursor: "pointer", width: "100%", minWidth: 0, fontSize: 11, textAlign: "left" } },
        wide === false ? h("span", null, "C", h("br"), amount(quota?.fiveHour, data), h("br"), amount(quota?.weekly, data)) :
          h(React.Fragment, null, h("div", { style: { fontWeight: 600 } }, `${t("title")} · ${t("remaining")}`),
            h("div", { style: { color: muted, marginTop: 3 } }, data?.state === "ready" ? line : t(data?.state ?? "loading"))));
    }
    function Panel({ api, t }) {
      const { data, busy, refresh } = useUsage(api);
      return h("section", { style: { color, padding: 16, fontSize: 13 } },
        h("h2", null, t("title")), h("p", { style: { color: muted } }, t("hint")),
        data?.state !== "ready" ? h("p", { role: "status" }, t(data?.state ?? "loading")) :
          data.limits.map(limit => h("div", { key: limit.id, style: { margin: "16px 0", padding: 12, border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8 } },
            h("strong", null, limit.name),
            ...[["fiveHour", limit.fiveHour], ["weekly", limit.weekly]].map(([key, window]) =>
              h("div", { key, style: { marginTop: 10 } },
                h("div", null, `${t(key)}: ${amount(window, data)} ${t("remaining")}`),
                amount(window, data) !== "—" && h("progress", { max: 100, value: window.remainingPercent, "aria-label": `${limit.name} ${t(key)} ${t("remaining")}`, style: { width: "100%", accentColor: "var(--dsw-alias-brand-primary)" } }),
                window?.resetsAt && h("small", { style: { color: muted } }, `${t("resets")}: ${date(window.resetsAt)}`))))),
        data?.fetchedAt && h("p", { style: { color: muted } }, `${t("updated")}: ${new Date(data.fetchedAt).toLocaleTimeString()}`),
        h("button", { type: "button", onClick: refresh, disabled: busy }, t("refresh")));
    }
    async function apply(ctx) {
      const unmount = await ctx.remote.$mount(descriptor);
      ctx.effect(() => ctx.locale.register(NS, { en, zh }));
      const t = ctx.locale.bind(NS);
      ctx.inject(["remote.codexUsage"], scope => {
        const inject = () => ({ api: scope.remote.codexUsage });
        scope.slots.inject("sidebar.footer.action", () => scope.slots.register({ name: "sidebar.footer.action", id: "codex-usage", order: 30, locale: NS, inject }, Summary));
        scope.slots.inject("settings.section", () => scope.slots.register({ name: "settings.section", id: "codex-usage", order: 15, label: () => t("title"), locale: NS, inject }, Panel));
      });
      return unmount;
    }
    return { apply, inject: ["slots", "locale", "remote"] };
  },
});
