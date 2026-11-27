import { vi } from "vitest";

/** SDK 的运行时由 Tau 提供，测试里只给出用到的值 */
vi.mock("@tau/plugins", () => {
  class PluginConflictError extends Error {
    override readonly name = "PluginConflictError";
    constructor(message = "数据已被修改，请重新读取后再试") {
      super(message);
    }
  }
  const SIDEBAR_GROUPS = { daily: "daily", knowledge: "knowledge", learning: "learning" };
  // 最小 defineI18n：冻结词典，ref 产出宿主可序列化的消息引用；词典校验由宿主运行时负责
  const defineI18n = (config: {
    fallbackLocale: string;
    resources: Record<string, Record<string, string>>;
  }) =>
    Object.freeze({
      fallbackLocale: config.fallbackLocale,
      resources: Object.fromEntries(
        Object.entries(config.resources).map(([locale, dictionary]) => [
          locale,
          Object.freeze({ ...dictionary }),
        ])
      ),
      ref: (key: string, values?: Record<string, string | number | boolean>) =>
        Object.freeze({ kind: "i18n", key, ...(values ? { values: { ...values } } : {}) }),
    });
  return {
    PluginConflictError,
    SIDEBAR_GROUPS,
    definePlugin: (definition: unknown) => definition,
    defineI18n,
  };
});
