/**
 * 问题页里由用户点击触发的操作：关联已有、新建材料、围绕问题对话、立项、答案另存。
 * 都要在点击后调用（Tau 的选择窗口、新建窗口与打开需要用户操作）；失败时提示，不抛给界面。
 */
import { PluginPermissionError, type PluginEntityRef } from "@tau/plugins";
import { toast } from "@tau/ui";
import type { QuestionsRuntime } from "../runtime";
import { QUESTIONS_KEY } from "../runtime";
import { compositionOf, type Question } from "../data/model";
import type { QuestionAnswer } from "../data/questions";
import type { QuestionDetail } from "./queries";
import { TARGET_META } from "./model";

/** 「关联已有」可选的类型：我的笔记在前，外部材料与对话在后 */
const PICK_KINDS = [
  "card",
  "article",
  "document",
  "project",
  "whiteboard",
  "material",
  "chat-session",
] as const;

export type CreatableKind = "article" | "whiteboard" | "project";

const MAX_CHAT_CONTEXT = 20;
const MAX_SEED_MATERIALS = 30;
const MAX_BACKGROUND = 600;

const failure = (error: unknown, fallback: string) => {
  if (error instanceof PluginPermissionError)
    toast.error(
      error.reason === "blocked"
        ? "权限已被阻止，可在插件详情页解除"
        : error.reason === "unavailable"
          ? "请回到 Tau 后在插件详情页处理权限请求"
          : "没有获得所需的权限"
    );
  else toast.error(error instanceof Error && error.message ? error.message : fallback);
};

const clip = (text: string, max = 40) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function questionActions(runtime: QuestionsRuntime) {
  const { context, data, queryClient } = runtime;
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY });

  const titleOf = async (ref: PluginEntityRef) => {
    const [description] = await context.app.describe([ref]);
    return description?.status === "ok" ? description.title : undefined;
  };

  async function open(ref: PluginEntityRef, placement?: "dock") {
    try {
      await context.app.open(ref, placement ? { placement } : undefined);
    } catch (error) {
      failure(error, "打开失败");
    }
  }

  async function linkExisting(question: Question) {
    try {
      const picked = await context.app.pick({
        kinds: PICK_KINDS,
        multiple: true,
        title: "关联已有材料",
      });
      if (!picked.length) return;
      const chats = picked.filter(item => item.ref.kind === "chat-session");
      const materials = picked.filter(
        item => item.ref.kind !== "chat-session" && compositionOf(item.ref)
      );
      let added = await data.linkMaterials(
        question.id,
        materials.map(item => ({ ref: item.ref, title: item.title }))
      );
      for (const chat of chats)
        if (await data.linkChat(question.id, chat.ref.id, { title: chat.title })) added++;
      await refresh();
      toast.success(added ? `已关联 ${added} 份材料` : "这些材料已经关联过了");
    } catch (error) {
      failure(error, "关联失败");
    }
  }

  /** 写一张卡片：Tau 的新建卡片窗口，保存后挂到问题上 */
  async function writeCard(question: Question) {
    try {
      const ref = await context.app.run("card.create", {});
      if (!ref) return;
      await data.linkMaterials(question.id, [{ ref, created: true, title: await titleOf(ref) }]);
      await refresh();
    } catch (error) {
      failure(error, "卡片已保存，但挂到问题上失败");
    }
  }

  /** 新建文章、白板或项目并挂到问题上，然后打开它；第一次会询问写入权限 */
  async function createMaterial(question: Question, kind: CreatableKind) {
    const title = clip(question.title);
    try {
      const created =
        kind === "article"
          ? await context.data.articles.create({ title })
          : kind === "whiteboard"
            ? await context.data.whiteboards.create({ title })
            : await context.data.projects.create({ title });
      const ref: PluginEntityRef = { kind, id: created.id };
      await data.linkMaterials(question.id, [{ ref, created: true, title }]);
      await refresh();
      await open(ref);
    } catch (error) {
      failure(error, `新建${TARGET_META[kind].label}失败`);
    }
  }

  /** 围绕问题发起对话：首条消息带上问题、背景与材料清单，用户发出后挂成探究对话 */
  async function discuss(detail: QuestionDetail) {
    try {
      const { question, materials } = detail;
      const background = (await context.content.read(question.contentRef))?.markdown ?? "";
      const described = materials.length
        ? await context.app.describe(materials.map(link => link.to))
        : [];
      const live = described.flatMap(item =>
        item.status === "ok"
          ? [`- ${TARGET_META[compositionOf(item.ref) ?? "card"].label} · ${item.title}`]
          : []
      );
      const lines = [
        `围绕问题：${question.title}`,
        background.trim()
          ? `背景：${background.replace(/\s+/g, " ").trim().slice(0, MAX_BACKGROUND)}`
          : "",
        live.length ? "已有材料：" : "",
        ...live.slice(0, MAX_SEED_MATERIALS),
        live.length > MAX_SEED_MATERIALS ? `- …另有 ${live.length - MAX_SEED_MATERIALS} 份` : "",
      ].filter(Boolean);
      const contextRefs = materials
        .map(link => link.to)
        .filter(ref => ["card", "article", "document"].includes(ref.kind))
        .slice(0, MAX_CHAT_CONTEXT);
      const chat = await context.app.run("chat.start", {
        prompt: `${lines.map(line => `> ${line}`).join("\n")}\n\n`,
        context: contextRefs,
      });
      if (!chat) return;
      await data.linkChat(question.id, chat.id, { initiated: true });
      await refresh();
    } catch (error) {
      failure(error, "发起对话失败");
    }
  }

  /** 以此立项：Tau 确认后新建 Notebook，材料与答案作为资料带入；已立项的直接打开 */
  async function upgrade(detail: QuestionDetail) {
    if (detail.notebook) return open(detail.notebook.to);
    try {
      const sources = [
        ...detail.answers.map(answer => answer.link.to),
        ...detail.materials.map(link => link.to),
      ].slice(0, 200);
      const notebook = await context.app.run("notebook.create", {
        title: detail.question.title,
        sources,
        from: { kind: "plugin-entity", id: detail.question.id },
      });
      if (!notebook) return;
      await data.linkNotebook(detail.question.id, notebook);
      await refresh();
      await open(notebook);
    } catch (error) {
      failure(error, "立项失败");
    }
  }

  /** 答案另存为卡片、文章或项目文档：与答案共用正文，在哪里改都同步 */
  async function shareAnswer(
    answer: QuestionAnswer,
    target: "card" | "article" | "document",
    title?: string
  ) {
    const shareOf = answer.entity.contentRef;
    try {
      const ref: PluginEntityRef | null =
        target === "card"
          ? { kind: "card", id: (await context.data.cards.create({ content: { shareOf } })).id }
          : target === "article"
            ? {
                kind: "article",
                id: (await context.data.articles.create({ title: title ?? "", content: { shareOf } }))
                  .id,
              }
            : await context.app.run("project.insertDocument", {
                content: { shareOf },
                ...(title ? { title } : {}),
              });
      if (!ref) return;
      await data.addProjection(answer.entity.id, ref);
      await refresh();
      toast.success(`已创建${TARGET_META[target].label}`);
    } catch (error) {
      failure(error, `创建${TARGET_META[target].label}失败`);
    }
  }

  return { open, linkExisting, writeCard, createMaterial, discuss, upgrade, shareAnswer, refresh };
}

export type QuestionActions = ReturnType<typeof questionActions>;
