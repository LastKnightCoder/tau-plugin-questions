import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { PluginSidebarItemUpdate } from "@tau/plugins";
import { createQuestionData } from "../data/questions";
import { registerQuestionSchema } from "../data/schema";
import type { QuestionsRuntime } from "../runtime";
import { registerQuestionsSidebar } from "../sidebar";
import { createMemoryStore } from "./memory-store";

vi.mock("@tau/ui", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const Icon = () => null;

describe("侧边栏", () => {
  let updates: PluginSidebarItemUpdate[];
  let emit: () => void;
  let opened: unknown[];
  let runtime: QuestionsRuntime;

  beforeEach(async () => {
    vi.useFakeTimers();
    updates = [];
    opened = [];
    const memory = createMemoryStore();
    registerQuestionSchema(memory.store, { page: "questions", questionIcon: Icon, answerIcon: Icon });
    const context = {
      sidebar: {
        registerItem: () => ({ update: (patch: PluginSidebarItemUpdate) => updates.push(patch) }),
      },
      events: { on: (_types: unknown, listener: () => void) => (emit = listener) },
      register: () => undefined,
    };
    runtime = {
      context: context as unknown as QuestionsRuntime["context"],
      data: createQuestionData(memory.store),
      queryClient: new QueryClient(),
      pages: {},
    };
    // 与 activate 一致：先有默认分组
    await runtime.data.ensureDefaultGroup();
    const page = { id: "questions", open: async (params?: unknown) => void opened.push(params) };
    registerQuestionsSidebar(runtime, page as never);
  });

  afterEach(() => vi.useRealTimers());

  const settle = async () => {
    await vi.advanceTimersByTimeAsync(300);
    return updates.at(-1)!;
  };

  it("角标是探究中的问题数，子项是分组与未解答数", async () => {
    const { data } = runtime;
    const group = await data.createGroup({ title: "数据库", tone: "blue" });
    const a = await data.createQuestion({ title: "A", groupId: group.id });
    await data.createQuestion({ title: "B", groupId: group.id });
    await data.setStatus(a.id, "in_progress");
    const c = await data.createQuestion({ title: "C" });
    await data.setStatus(c.id, "resolved");
    emit();
    const state = await settle();
    expect(state.badge).toBe(1);
    expect(state.children?.map(child => [child.title, child.tone, child.count])).toEqual([
      ["未分类", "gray", 0],
      ["数据库", "blue", 2],
    ]);
    expect(state.children?.[1].params).toEqual({ groupId: group.id });
    expect(state.children?.[0].menu?.map(entry => entry.title)).toEqual(["编辑分组"]);
    expect(state.children?.[1].menu?.map(entry => entry.title)).toEqual(["编辑分组", "删除分组"]);
  });

  it("拖到分组上移动问题；新建、编辑分组打开问题页的弹窗", async () => {
    const { data } = runtime;
    const group = await data.createGroup({ title: "数据库" });
    const question = await data.createQuestion({ title: "A" });
    emit();
    const state = await settle();
    await state.children![1].onDrop!.run(question.id);
    expect((await data.getQuestion(question.id))?.groupId).toBe(group.id);
    await state.action!.run();
    await state.children![1].menu![0].run();
    expect(opened).toEqual([{ createGroup: true }, { groupId: group.id, editGroup: group.id }]);
  });

  it("删除分组后其中的问题回到未分类", async () => {
    const { data } = runtime;
    const group = await data.createGroup({ title: "数据库" });
    const question = await data.createQuestion({ title: "A", groupId: group.id });
    emit();
    const state = await settle();
    await state.children![1].menu![1].run();
    const fallback = await data.ensureDefaultGroup();
    expect((await data.getQuestion(question.id))?.groupId).toBe(fallback.id);
    expect((await data.listGroups()).map(g => g.title)).toEqual(["未分类"]);
  });
});
