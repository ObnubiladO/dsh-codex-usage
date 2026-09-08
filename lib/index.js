import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { createUsageReader } from "./usage.js";
import z from "@deepseek-ai/schemastery";

let markRead;
Remote("read")(undefined, { private: false, static: false, name: "read", addInitializer(fn) { markRead = fn; } });

/** Read-only companion; dsh-codex-provider retains sole ownership of OAuth refresh. */
export default class CodexUsage extends TypertRemoteService {
  static inject = ["credentials", "codexProvider", "settings"];
  constructor(ctx) {
    super(ctx, "codexUsage");
    markRead.call(this);
    this.preferences = ctx.settings.register("codex-usage", z.object({ sidebarHeight: z.number().min(140).max(400).default(220) }));
    this.reader = createUsageReader({ resolveCredential: () => ctx.credentials.resolve("OPENAI_CODEX_API_KEY") });
    ctx.effect(() => () => this.reader.dispose());
  }
  async read() { return { ...await this.reader.read(), sidebarHeight: this.preferences.get().sidebarHeight }; }
}
