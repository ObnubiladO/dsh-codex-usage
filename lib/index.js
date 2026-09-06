import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { createUsageReader } from "./usage.js";

let markRead;
Remote("read")(undefined, { private: false, static: false, name: "read", addInitializer(fn) { markRead = fn; } });

/** Read-only companion; dsh-codex-provider retains sole ownership of OAuth refresh. */
export default class CodexUsage extends TypertRemoteService {
  static inject = ["credentials", "codexProvider"];
  constructor(ctx) {
    super(ctx, "codexUsage");
    markRead.call(this);
    this.reader = createUsageReader({ resolveCredential: () => ctx.credentials.resolve("OPENAI_CODEX_API_KEY") });
    ctx.effect(() => () => this.reader.dispose());
  }
  async read() { return this.reader.read(); }
}
