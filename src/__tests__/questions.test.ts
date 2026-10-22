import { beforeEach, describe, expect, it } from "vitest";
import type { PluginEntityRef } from "@tau/plugins";
import { compositionOf, EVENTS, parseCapture, readEvent } from "../data/model";
import { createQuestionData, type QuestionData } from "../data/questions";
import { registerQuestionSchema } from "../data/schema";
import { createMemoryStore } from "./memory-store";

const Icon = () => null;
const card = (id: string): PluginEntityRef => ({ kind: "card", id });

describe("问题数据", () => {
  let memory: ReturnType<typeof createMemoryStore>;
  let data: QuestionData;
  let time: number;

  beforeEach(() => {
    time = 10_000;
    const now = () => (time += 10);
    memory = createMemoryStore({ now });
    registerQuestionSchema(memory.store, { page: "questions", questionIcon: Icon, answerIcon: Icon });
    data = createQuestionData(memory.store, now);
  });

  const events = async (questionId: string) =>
    (await data.listEvents(questionId)).map(event =>
      event.type === "status" ? `status:${event.to}${event.auto ? ":auto" : ""}` : event.type
    );

  it("默认分组只建一次，不可改名、不可删除", async () => {
    const [a, b] = await Promise.all([data.ensureDefaultGroup(), data.ensureDefaultGroup()]);
    expect(a.id).toBe(b.id);
    expect((await data.listGroups()).map(g => g.title)).toEqual(["未分类"]);
    expect((await data.updateGroup(a.id, { title: "改名", tone: "rose" })).title).toBe("未分类");
    await expect(data.deleteGroup(a.id)).rejects.toThrow("默认分组不可删除");
  });

  it("新建问题落默认分组、排在末尾并记下「提出问题」", async () => {
    const first = await data.createQuestion({ title: "  B+ 树为什么适合索引？ " });
    const second = await data.createQuestion({ title: "第二个" });
    const fallback = await data.ensureDefaultGroup();
    expect(first).toMatchObject({
      title: "B+ 树为什么适合索引？",
      status: "not_started",
      groupId: fallback.id,
      resolvedTime: null,
      composition: {},
    });
    expect(second.sortIndex).toBeGreaterThan(first.sortIndex);
    expect(await events(first.id)).toEqual(["create"]);
    await expect(data.createQuestion({ title: "  " })).rejects.toThrow("问题不能为空");
  });

  it("快速收集按「#分组」的全名或前缀归组，找不到落默认分组", async () => {
    const reading = await data.createGroup({ title: "Reading", tone: "blue" });
    expect(parseCapture("为什么 #rea 会这样")).toEqual({ title: "为什么 会这样", groupHint: "rea" });
    expect((await data.captureQuestion("为什么 #rea 会这样")).group.id).toBe(reading.id);
    expect((await data.captureQuestion("C# 的泛型 #不存在")).group.title).toBe("未分类");
  });

  it("挂上第一份材料自动进入探究中，重复的跳过，材料构成随关联增减", async () => {
    const question = await data.createQuestion({ title: "问题" });
    const added = await data.linkMaterials(question.id, [
      { ref: card("1"), title: "卡片一" },
      { ref: { kind: "material", id: "excerpt:7" }, title: "一条划线" },
      { ref: card("1") },
    ]);
    expect(added).toBe(2);
    expect(await data.linkMaterials(question.id, [{ ref: card("1") }])).toBe(0);
    let current = (await data.getQuestion(question.id))!;
    expect(current.status).toBe("in_progress");
    expect(current.composition).toEqual({ card: 1, excerpt: 1 });
    expect(await events(question.id)).toEqual(["create", "link", "link", "status:in_progress:auto"]);
    const [link] = await data.listMaterials(question.id);
    await data.unlink(question.id, link, "卡片一");
    current = (await data.getQuestion(question.id))!;
    expect(current.composition).toEqual({ excerpt: 1 });
    const unlinked = (await data.listEvents(question.id)).at(-1);
    expect(unlinked).toMatchObject({ type: "unlink", target: "card", title: "卡片一", ref: card("1") });
    await expect(
      data.linkMaterials(question.id, [{ ref: { kind: "diary", id: "1" } }])
    ).rejects.toThrow("这类内容不能作为材料");
  });

  it("关联对话记下消息位置，已关联的不覆盖", async () => {
    const question = await data.createQuestion({ title: "问题" });
    expect(await data.linkChat(question.id, "s-1", { messageIds: ["m1"], title: "对话" })).toBe(true);
    expect(await data.linkChat(question.id, "s-1", { messageIds: ["m2"] })).toBe(false);
    const [chat] = await data.listChats(question.id);
    expect(chat).toMatchObject({ to: { kind: "chat-session", id: "s-1" }, data: { messageIds: ["m1"] } });
    expect((await data.getQuestion(question.id))!.composition).toEqual({ "chat-session": 1 });
  });

  it("标为已解答记下解答时刻；撤销删除那条事件，撤销回已解答时恢复原时刻", async () => {
    const question = await data.createQuestion({ title: "问题" });
    const { eventId } = await data.setStatus(question.id, "resolved");
    expect((await data.getQuestion(question.id))!.resolvedTime).not.toBeNull();
    const { eventId: reopened } = await data.setStatus(question.id, "in_progress");
    expect((await data.getQuestion(question.id))!.resolvedTime).toBeNull();
    await data.setStatus(question.id, "resolved", { revertEventId: reopened });
    const first = (await data.listEvents(question.id)).find(event => event.id === eventId);
    expect((await data.getQuestion(question.id))!.resolvedTime).toBe(first?.createdAt);
    expect(await events(question.id)).toEqual(["create", "status:resolved"]);
    expect(await data.setStatus(question.id, "resolved")).toEqual({});
  });

  it("删除分组把其中的问题移到默认分组", async () => {
    const group = await data.createGroup({ title: "数据库" });
    const question = await data.createQuestion({ title: "问题", groupId: group.id });
    await data.deleteGroup(group.id);
    const fallback = await data.ensureDefaultGroup();
    expect((await data.getQuestion(question.id))!.groupId).toBe(fallback.id);
    expect((await data.listGroups()).map(g => g.title)).toEqual(["未分类"]);
    await expect(data.moveToGroup(question.id, group.id)).rejects.toThrow("分组不存在");
  });

  it("排序按给定顺序重写 sortIndex，分组与问题列表随之排序", async () => {
    await data.ensureDefaultGroup();
    const a = await data.createGroup({ title: "甲" });
    const b = await data.createGroup({ title: "乙" });
    await data.reorderGroups([b.id, a.id]);
    expect((await data.listGroups()).map(g => g.title)).toEqual(["未分类", "乙", "甲"]);
    const q1 = await data.createQuestion({ title: "一" });
    const q2 = await data.createQuestion({ title: "二" });
    await data.reorderQuestions([q2.id, q1.id]);
    expect((await data.listQuestions()).map(q => q.title)).toEqual(["二", "一"]);
  });

  it("独立答案：写下记为「写下结论」，删除记为移除；删除问题连带答案与轨迹", async () => {
    const question = await data.createQuestion({ title: "问题" });
    const answerId = await data.createAnswer(question.id, {
      title: "结论",
      content: { markdown: "因为扇出大" },
    });
    const [answer] = await data.listAnswers(question.id);
    expect(answer.entity).toMatchObject({ id: answerId, kind: "answer", meta: { questionId: question.id } });
    expect((await data.listEvents(question.id)).at(1)).toMatchObject({
      type: "link",
      target: "answer",
      created: true,
      title: "结论",
    });
    await data.deleteAnswer(question.id, answer);
    expect(await data.listAnswers(question.id)).toEqual([]);
    expect((await data.getQuestion(question.id))!.composition).toEqual({});

    await data.createAnswer(question.id, { title: "第二份" });
    await data.addNote(question.id, "记一笔");
    await data.deleteQuestion(question.id);
    const rows = memory.rows();
    expect(rows.entities.filter(row => row.kind !== "question" || row.id === question.id)).toEqual([]);
    expect(rows.records.filter(row => row.collection === EVENTS)).toEqual([]);
    expect(rows.links).toEqual([]);
  });

  it("放弃空答案：撤掉「写下结论」与它带来的自动进入探究中，不记移除", async () => {
    const question = await data.createQuestion({ title: "问题" });
    await data.createAnswer(question.id, { title: "" });
    expect((await data.getQuestion(question.id))!.status).toBe("in_progress");
    const [answer] = await data.listAnswers(question.id);
    await data.discardAnswer(question.id, answer);
    const current = (await data.getQuestion(question.id))!;
    expect(current).toMatchObject({ status: "not_started", composition: {} });
    expect(await events(question.id)).toEqual(["create"]);
    expect(await data.listAnswers(question.id)).toEqual([]);
  });

  it("答案记下共用正文的卡片；立项的 Notebook 与由此发起的对话可以读回", async () => {
    const question = await data.createQuestion({ title: "问题" });
    const answerId = await data.createAnswer(question.id, { title: "结论" });
    await data.addProjection(answerId, card("9"));
    await data.addProjection(answerId, card("9"));
    const [answer] = await data.listAnswers(question.id);
    expect(answer.meta).toEqual({ questionId: question.id, projections: [card("9")] });
    await data.renameAnswer(answer, "新结论");
    expect((await data.listAnswers(question.id))[0].entity.title).toBe("新结论");
    await data.linkNotebook(question.id, { kind: "notebook", id: "3" });
    expect((await data.getNotebook(question.id))?.to).toEqual({ kind: "notebook", id: "3" });
    await data.linkChat(question.id, "s-2", { initiated: true });
    expect((await data.listChats(question.id))[0].data).toEqual({ initiated: true });
  });

  it("探究中的问题按最近活动倒序，附分组与最近一条轨迹", async () => {
    const group = await data.createGroup({ title: "数据库", tone: "blue" });
    const older = await data.createQuestion({ title: "旧的", groupId: group.id });
    const newer = await data.createQuestion({ title: "新的" });
    await data.createQuestion({ title: "没动过" });
    await data.linkMaterials(older.id, [{ ref: card("1") }]);
    await data.linkMaterials(newer.id, [{ ref: card("2") }]);
    await data.addNote(older.id, "有进展");
    const active = await data.listActive();
    expect(active.map(item => item.question.title)).toEqual(["旧的", "新的"]);
    expect(active[0].group?.title).toBe("数据库");
    expect(active[0].lastEvent).toMatchObject({ type: "note", text: "有进展" });
  });

  it("事务里任一写入失败时全部不生效", async () => {
    const question = await data.createQuestion({ title: "问题" });
    const before = memory.rows();
    await expect(
      memory.store.transaction(async tx => {
        await tx.records.insert(EVENTS, { questionId: question.id, type: "note", text: "半份" });
        await tx.entities.update(question.id, { title: "改" }, { expectedRevision: "过期" });
      })
    ).rejects.toThrow();
    expect(memory.rows()).toEqual(before);
  });
});

describe("数据形状", () => {
  it("外部材料按 ID 前缀区分，其余不支持的类型返回 null", () => {
    expect(compositionOf({ kind: "material", id: "pdf-annotation:3" })).toBe("pdf-annotation");
    expect(compositionOf({ kind: "material", id: "unknown:3" })).toBeNull();
    expect(compositionOf({ kind: "whiteboard", id: "2" })).toBe("whiteboard");
    expect(compositionOf({ kind: "notebook", id: "2" })).toBeNull();
  });

  it("读不懂的轨迹记录不展示", () => {
    const base = { id: "1", createdAt: 1 };
    expect(readEvent({ ...base, data: { questionId: "q", type: "status", to: "done" } })).toBeNull();
    expect(readEvent({ ...base, data: { type: "note", text: "无主" } })).toBeNull();
    expect(readEvent({ ...base, data: { questionId: "q", type: "link", target: "card", created: true } }))
      .toEqual({ ...base, questionId: "q", type: "link", target: "card", created: true });
  });
});
