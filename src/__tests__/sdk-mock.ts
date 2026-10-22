import { vi } from "vitest";

/** SDK 的运行时由 Tau 提供，测试里只给出用到的值 */
vi.mock("@tau/plugins", () => {
  class PluginConflictError extends Error {
    override readonly name = "PluginConflictError";
    constructor(message = "数据已被修改，请重新读取后再试") {
      super(message);
    }
  }
  return { PluginConflictError, definePlugin: (definition: unknown) => definition };
});
