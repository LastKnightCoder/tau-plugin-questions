import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginMCPTool } from "@tau/plugins";
import { createQuestionTools } from "../ai/tools";
import { createQuestionData, type QuestionData } from "../data/questions";
import { registerQuestionSchema } from "../data/schema";
import { createMemoryStore } from "./memory-store";

const Icon = () => null;

describe("MCP 工具", () => {
  let data: QuestionData;
  let tools: Map<string, PluginMCPTool>;
  let edits: unknown[];
  let time: number;

  beforeEach(async () => {
    time = 10_000;
    const now = () => (time += 10);
    const memory = createMemoryStore({ now });
    registerQuestionSchema(memory.store, { page: "questions", questionIcon: Icon, answerIcon: Icon });
    data = createQuestionData(memory.store, now);
    await data.ensureDefaultGroup();
    edits = [];
    const context = {
      content: {
        read: vi.fn(async () => ({ markdown: "已有背景", revision: "r1" })),
        edit: vi.fn(async (...args: unknown[]) => {
          edits.push(args);
          return { revision: "r2" };
        }),
      },
      app: { describe: vi.fn(async () => []) },
    };
    tools = new Map(
      createQuestionTools(data, context as never).map(tool => [tool.name, tool])
    );
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await tools.get(name)!.execute(args as never, {
      signal: new AbortController().signal,
    });
    return { ...result, json: JSON.parse(result.content) };
  };

  it("列出问题：按状态与关键词筛选，最近有进展的在前，附问题行", async () => {
    const a = await data.createQuestion({ title: "B+ 树为什么矮？" });
    await data.createQuestion({ title: "LSM 树怎么合并？" });
    const c = await data.createQuestion({ title: "B 树和 B+ 树的区别？" });
    await data.setStatus(a.id, "in_progress");
    await data.setStatus(c.id, "in_progress");
    const result = await call("list_questions", { status: "in_progress", keyword: "b+" });
    expect(result.json.questions.map((q: { title: string }) => q.title)).toEqual([
      "B 树和 B+ 树的区别？",
      "B+ 树为什么矮？",
    ]);
    expect(result.render?.data).toMatchObject({
      questions: [{ id: c.id, status: "in_progress", groupTitle: "未分类", groupTone: "gray" }, { id: a.id }],
    });
    await expect(call("list_questions", { status: "done" })).rejects.toThrow("status 只能是");
  });

  it("记问题核对分组；改状态、分组并在背景末尾追加", async () => {
    await expect(call("create_question", { title: "Q？", groupId: "nope" })).rejects.toThrow(
      "分组不存在"
    );
    const group = await call("create_question_group", { title: "数据库", tone: "blue" });
    const created = await call("create_question", { title: "Q？" });
    const id = created.json.created.id;
    const updated = await call("update_question", {
      id,
      status: "resolved",
      groupId: group.json.id,
      appendBackground: "补充",
    });
    expect(updated.json.updated).toMatchObject({ status: "resolved", group: "数据库" });
    expect(edits).toEqual([
      [expect.any(String), { op: "append", content: { markdown: "补充" } }, { expectedRevision: "r1" }],
    ]);
    await expect(call("update_question", { id })).rejects.toThrow("没有要修改的内容");
  });

  it("答案标题取正文第一行，详情里能读到答案与轨迹", async () => {
    const question = await data.createQuestion({ title: "Q？" });
    await call("write_question_answer", { id: question.id, markdown: "## 结论\n\n因为扇出大" });
    await call("add_question_note", { id: question.id, text: "还没想通合并" });
    const [answer] = await data.listAnswers(question.id);
    expect(answer.entity.title).toBe("结论");
    const detail = await call("get_question", { id: question.id });
    expect(detail.json.answers).toHaveLength(1);
    expect(detail.json.recentEvents.map((e: { text: string }) => e.text)).toEqual([
      "提出问题",
      "写下结论「结论」",
      "挂上第一份材料，进入探究中",
      "记一笔：还没想通合并",
    ]);
  });
});
