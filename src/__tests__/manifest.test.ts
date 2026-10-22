import { describe, expect, it } from "vitest";
import manifest from "../../manifest.json";
import { REF_EVENTS } from "../runtime";

describe("manifest", () => {
  it("订阅的宿主事件都声明了对应的读取权限（未声明时启用即失败）", () => {
    const required = [
      ...new Set(REF_EVENTS.map((type) => `${type.split(".")[0]}s:read`)),
    ];
    expect(
      required.filter(
        (permission) => !manifest.permissions.includes(permission),
      ),
    ).toEqual([]);
  });
});
