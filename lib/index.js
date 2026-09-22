import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { createUsageReader } from "./usage.js";
import z from "@deepseek-ai/schemastery";

let markRead;
Remote("read")(undefined, { private: false, static: false, name: "read", addInitializer(fn) { markRead = fn; } });

/**
 * Read-only companion; dsh-codex-provider retains sole ownership of OAuth refresh.
 *
 * DSH 0.1.7 projects a plugin's own Config schema into settings forms keyed by the
 * profile entry id, so the sidebar height is declared here instead of being
 * registered as a namespace: `configure({ auto: false })` keeps the generated form
 * out of Settings, and the client's own panel writes the field through
 * `settings.mutate("codex-usage", ...)`.
 */
export default class CodexUsage extends TypertRemoteService {
  static inject = ["credentials", "codexProvider", "settings"];
  static Config = z.object({ sidebarHeight: z.number().min(140).max(400).default(220).volatile() });
  constructor(ctx, config) {
    super(ctx, "codexUsage");
    markRead.call(this);
    this.config = config;
    ctx.inject(["settings"], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)); });
    this.reader = createUsageReader({ resolveCredential: () => ctx.credentials.resolve("OPENAI_CODEX_API_KEY") });
    ctx.effect(() => () => this.reader.dispose());
  }
  async read() { return { ...await this.reader.read(), sidebarHeight: this.config.sidebarHeight.get() }; }
}
