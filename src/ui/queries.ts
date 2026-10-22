/**
 * 问题页的数据：列表快照、单个问题的详情、引用的标题与材料摘要。
 * 写入后由调用方 invalidate QUESTIONS_KEY；同步下载、AI 工具写入经运行时的事件订阅刷新。
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PluginEntityDescription,
  PluginEntityRef,
  PluginPermission,
} from "@tau/plugins";
import type { PluginLink } from "@tau/plugins";
import { QUESTIONS_KEY, REFS_KEY, useRuntime, type QuestionsRuntime } from "../runtime";
import type { QuestionAnswer } from "../data/questions";
import type { Question, QuestionEvent, QuestionGroup } from "../data/model";

export interface QuestionsSnapshot {
  questions: Question[];
  groups: QuestionGroup[];
}

export function useQuestionsSnapshot() {
  const { data } = useRuntime();
  return useQuery({
    queryKey: [...QUESTIONS_KEY, "snapshot"],
    queryFn: async (): Promise<QuestionsSnapshot> => {
      await data.ensureDefaultGroup();
      const [questions, groups] = await Promise.all([data.listQuestions(), data.listGroups()]);
      return { questions, groups };
    },
  });
}

export interface QuestionDetail {
  question: Question;
  materials: PluginLink[];
  chats: PluginLink[];
  answers: QuestionAnswer[];
  notebook: PluginLink | null;
  events: QuestionEvent[];
}

export const detailKey = (id: string | null) => [...QUESTIONS_KEY, "detail", id] as const;

export async function loadQuestionDetail(
  data: QuestionsRuntime["data"],
  id: string
): Promise<QuestionDetail | null> {
  const question = await data.getQuestion(id);
  if (!question) return null;
  const [materials, chats, answers, notebook, events] = await Promise.all([
    data.listMaterials(question.id),
    data.listChats(question.id),
    data.listAnswers(question.id),
    data.getNotebook(question.id),
    data.listEvents(question.id),
  ]);
  return { question, materials, chats, answers, notebook, events };
}

export function useQuestionDetail(id: string | null) {
  const { data } = useRuntime();
  return useQuery({
    queryKey: detailKey(id),
    enabled: id != null,
    queryFn: () => loadQuestionDetail(data, id!),
  });
}

export const refKey = (ref: PluginEntityRef) => `${ref.kind}:${ref.id}`;

/** 引用的最新标题与是否已删除；不需要权限（关联的内容都是用户选择过或请 Tau 新建的） */
export function useDescriptions(refs: readonly PluginEntityRef[]) {
  const { context } = useRuntime();
  const keys = refs.map(refKey);
  return useQuery({
    queryKey: [...REFS_KEY, "describe", ...keys],
    enabled: refs.length > 0,
    queryFn: async () => {
      const map = new Map<string, PluginEntityDescription>();
      for (let index = 0; index < refs.length; index += 200) {
        const batch = await context.app.describe(refs.slice(index, index + 200));
        batch.forEach(item => map.set(refKey(item.ref), item));
      }
      return map;
    },
  });
}

/** 材料摘要要读取正文与信息：声明在 manifest 里，用户点「显示摘要」时才询问 */
export const SUMMARY_PERMISSIONS: readonly PluginPermission[] = [
  "cards:read",
  "articles:read",
  "documents:read",
  "whiteboards:read",
  "projects:read",
  "materials:read",
  "chats:read",
];

export function useSummaryAccess() {
  const { context } = useRuntime();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: [...REFS_KEY, "summary-access"],
    queryFn: async () => {
      const states = await Promise.all(
        SUMMARY_PERMISSIONS.map(permission => context.permissions.query(permission))
      );
      return states.every(state => state === "granted");
    },
  });
  const request = async () => {
    await context.permissions.request(SUMMARY_PERMISSIONS);
    await client.invalidateQueries({ queryKey: REFS_KEY });
  };
  return { granted: query.data === true, request };
}

export interface RefSummary {
  /** 摘要：材料的原文与想法、白板说明 */
  excerpt?: string;
  /** 次要信息：字数、页数、文档数、出处、消息数等 */
  meta?: string;
  /** 卡片、文章、项目文档的正文，可以预览 */
  contentRef?: string;
  /** 对话能否在停靠栏打开（只有主对话可以） */
  dockable?: boolean;
}

/** 已获准时读取材料的摘要；读不到（权限、已删除）的项不返回 */
export function useSummaries(refs: readonly PluginEntityRef[], granted: boolean) {
  const { context } = useRuntime();
  return useQuery({
    queryKey: [...REFS_KEY, "summary", ...refs.map(refKey)],
    enabled: granted && refs.length > 0,
    queryFn: async () => {
      const map = new Map<string, RefSummary>();
      await Promise.all(
        refs.map(async ref => {
          const summary = await readSummary(context, ref).catch(() => null);
          if (summary) map.set(refKey(ref), summary);
        })
      );
      return map;
    },
  });
}

async function readSummary(
  context: ReturnType<typeof useRuntime>["context"],
  ref: PluginEntityRef
): Promise<RefSummary | null> {
  const { data } = context;
  const words = (count: number) =>
    count >= 1000 ? `${(count / 1000).toFixed(1)}k 字` : count > 0 ? `${count} 字` : "";
  switch (ref.kind) {
    case "card":
    case "article":
    case "document": {
      const reader =
        ref.kind === "card" ? data.cards : ref.kind === "article" ? data.articles : data.documents;
      const item = await reader.get(ref.id);
      if (!item) return null;
      return {
        meta: ref.kind === "card" ? "" : words(item.wordCount),
        ...(item.contentRef ? { contentRef: item.contentRef } : {}),
      };
    }
    case "whiteboard": {
      const board = await data.whiteboards.get(ref.id);
      if (!board) return null;
      return {
        excerpt: board.description,
        meta: board.pageCount > 1 ? `${board.pageCount} 页` : "",
      };
    }
    case "project": {
      const project = await data.projects.get(ref.id);
      return project ? { meta: `${project.documentCount} 篇文档` } : null;
    }
    case "material": {
      const material = await data.materials.get(ref.id);
      if (!material) return null;
      return {
        excerpt: [material.quote, material.note].filter(Boolean).join(" · "),
        meta: material.source,
      };
    }
    case "chat-session": {
      const chat = await data.chats.get(ref.id);
      if (!chat) return null;
      const scene = { main: "", pdf: "PDF 对话", "video-note": "视频笔记对话", notebook: "Notebook 对话" }[
        chat.scene
      ];
      return {
        meta: [scene, chat.messageCount ? `${chat.messageCount} 条消息` : ""]
          .filter(Boolean)
          .join(" · "),
        dockable: chat.scene === "main",
      };
    }
    default:
      return null;
  }
}
