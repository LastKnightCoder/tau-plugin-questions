/**
 * 问题页的展示规则：状态、分段排序、材料类型、轨迹文案与统计、相对时间。
 */
import {
  File,
  FileText,
  FolderKanban,
  Globe,
  Highlighter,
  Layers,
  MessageCircle,
  PenLine,
  Presentation,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import type { PluginSidebarTone, TranslationValues } from "@tau/plugins";
import type { CompositionKind, Question, QuestionEvent, QuestionStatus } from "../data/model";
import zhCN from "../locales/zh-CN.json";
import { messages } from "../i18n";

/** 词典 key；组件内由 useI18n 提供翻译，非 React 模块用 context.i18n */
export type MessageKey = Parameters<typeof messages.ref>[0];
export type Translate = (key: MessageKey, values?: TranslationValues) => string;

/** 回退语言（zh-CN）直出的翻译：AI 数据与协议输出保留中文时使用 */
export const zhT: Translate = (key, values) => {
  let text = (zhCN as Record<string, string>)[key as string] ?? key;
  for (const [name, value] of Object.entries(values ?? {}))
    text = text.replaceAll(`{{${name}}}`, String(value));
  return text;
};

/** AI 数据与协议输出里的类型名：发给 AI 或进入持久化协议的文案保留中文 */
export const KIND_LABEL_ZH: Record<CompositionKind, string> = {
  card: "卡片",
  article: "文章",
  document: "项目文档",
  project: "项目",
  whiteboard: "白板",
  answer: "独立答案",
  excerpt: "划线",
  "pdf-annotation": "PDF 标注",
  "web-clip": "剪藏",
  "chat-session": "对话",
};

export const DAY_MS = 86_400_000;

/** 列表行拖到侧边栏分组上移动问题（context.sidebar.dragType 的局部 ID） */
export const QUESTION_DRAG = "question";

export const STATUS_META: Record<QuestionStatus, { key: MessageKey; hintKey: MessageKey }> = {
  in_progress: { key: "status.in_progress", hintKey: "status.in_progress.hint" },
  not_started: { key: "status.not_started", hintKey: "status.not_started.hint" },
  resolved: { key: "status.resolved", hintKey: "status.resolved.hint" },
};

export const statusLabel = (t: Translate, status: QuestionStatus) => t(STATUS_META[status].key);
export const statusHint = (t: Translate, status: QuestionStatus) => t(STATUS_META[status].hintKey);

/** 列表分段顺序：正在做的在最前 */
export const SECTION_ORDER: QuestionStatus[] = ["in_progress", "not_started", "resolved"];
/** 状态条 / 数字键 1-3 的顺序：按学习阶段 */
export const STATUS_STEPS: QuestionStatus[] = ["not_started", "in_progress", "resolved"];

export const TARGET_META: Record<CompositionKind, { key: MessageKey; icon: LucideIcon }> = {
  card: { key: "kind.card", icon: Layers },
  article: { key: "kind.article", icon: FileText },
  document: { key: "kind.document", icon: File },
  project: { key: "kind.project", icon: FolderKanban },
  whiteboard: { key: "kind.whiteboard", icon: Presentation },
  answer: { key: "kind.answer", icon: PenLine },
  excerpt: { key: "kind.excerpt", icon: Highlighter },
  "pdf-annotation": { key: "kind.pdfAnnotation", icon: ScrollText },
  "web-clip": { key: "kind.webClip", icon: Globe },
  "chat-session": { key: "kind.chat", icon: MessageCircle },
};

export const kindLabel = (t: Translate, kind: CompositionKind) => t(TARGET_META[kind].key);

/** 构成计数的展示顺序 */
export const COMPOSITION_ORDER: CompositionKind[] = [
  "card",
  "article",
  "document",
  "project",
  "whiteboard",
  "excerpt",
  "pdf-annotation",
  "web-clip",
  "chat-session",
  "answer",
];

/** 分组色点（Tailwind 需要完整类名字面量） */
export const TONE_DOT: Record<PluginSidebarTone, string> = {
  rose: "qs:bg-tag-5",
  orange: "qs:bg-accent",
  yellow: "qs:bg-tag-4",
  green: "qs:bg-tag-1",
  blue: "qs:bg-tag-2",
  purple: "qs:bg-tag-3",
  gray: "qs:bg-ink-3",
};

export interface QuestionSection {
  status: QuestionStatus;
  items: Question[];
}

/** 按状态分段；已解答按解答时间倒序，其余按最近活动倒序 */
export function sectionize(list: readonly Question[]): QuestionSection[] {
  return SECTION_ORDER.map(status => ({
    status,
    items: list
      .filter(q => q.status === status)
      .sort((a, b) =>
        status === "resolved"
          ? (b.resolvedTime ?? b.updatedAt) - (a.resolvedTime ?? a.updatedAt)
          : b.activityAt - a.activityAt
      ),
  })).filter(section => section.items.length > 0);
}

export function statusCounts(list: readonly { status: QuestionStatus }[]) {
  const counts: Record<QuestionStatus, number> = { not_started: 0, in_progress: 0, resolved: 0 };
  list.forEach(q => counts[q.status]++);
  return counts;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 今天 / 昨天 / N 天前 / M月D日 */
export function relativeDay(ts: number, now: number, t: Translate): string {
  const diff = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS);
  if (diff <= 0) return t("date.today");
  if (diff === 1) return t("date.yesterday");
  if (diff < 7) return t("date.daysAgo", { count: diff });
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const values = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  return sameYear ? t("date.monthDay", values) : t("date.monthDayYear", values);
}

export function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 自然日跨度（至少 1 天） */
export function daySpan(from: number, to: number): number {
  return Math.max(1, Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS) + 1);
}

export function formatWords(words: number, t: Translate): string {
  if (words <= 0) return "";
  return words >= 1000
    ? t("words.k", { value: (words / 1000).toFixed(1) })
    : t("words.count", { count: words });
}

const CREATED_VERB: Partial<Record<CompositionKind, MessageKey>> = {
  card: "event.created.card",
  article: "event.created.article",
  document: "event.created.document",
  project: "event.created.project",
  whiteboard: "event.created.whiteboard",
  answer: "event.created.answer",
};

export interface EventView {
  /** 视觉档：自动事件轻、手动记录重 */
  tone: "start" | "made" | "plain" | "muted" | "done" | "note";
  verb: string;
  target?: CompositionKind;
  title?: string;
  text?: string;
  estimated: boolean;
}

export function describeEvent(event: QuestionEvent, t: Translate): EventView {
  const estimated = "estimated" in event && Boolean(event.estimated);
  switch (event.type) {
    case "create":
      return { tone: "start", verb: t("event.create"), estimated };
    case "status":
      if (event.to === "resolved") return { tone: "done", verb: t("event.markedResolved"), estimated };
      return {
        tone: "plain",
        verb: event.auto
          ? t("event.statusAuto")
          : t("event.statusChanged", { label: statusLabel(t, event.to) }),
        estimated,
      };
    case "link":
      return {
        tone: event.created ? "made" : "plain",
        verb:
          event.created && CREATED_VERB[event.target]
            ? t(CREATED_VERB[event.target]!)
            : t("event.linked", { kind: kindLabel(t, event.target) }),
        target: event.target,
        title: event.title,
        estimated,
      };
    case "unlink":
      return {
        tone: "muted",
        verb: t("event.unlinked", { kind: kindLabel(t, event.target) }),
        target: event.target,
        title: event.title,
        estimated,
      };
    case "note":
      return { tone: "note", verb: "", text: event.text, estimated: false };
  }
}

/** 「第 N 天 · M 份材料 · K 条记录」/ 已解答为「用时 N 天」 */
export function trajectoryStats(
  question: Pick<Question, "status" | "createdAt" | "resolvedTime">,
  materials: number,
  events: readonly QuestionEvent[],
  now: number,
  t: Translate
): string {
  const days = daySpan(question.createdAt, question.resolvedTime ?? now);
  const notes = events.filter(e => e.type === "note").length;
  const values = {
    days,
    materials: t("stats.materials", { count: materials }),
    notes: t("stats.notes", { count: notes }),
  };
  return question.status === "resolved" ? t("stats.resolved", values) : t("stats.active", values);
}

/** 摘要的原始数据；展示文案由 summaryMeta 按语言拼装 */
export interface SummaryFields {
  excerpt?: string;
  contentRef?: string;
  dockable?: boolean;
  source?: string;
  wordCount?: number;
  pageCount?: number;
  documentCount?: number;
  chat?: { scene?: "pdf" | "video-note" | "notebook"; messageCount?: number };
}

/** 摘要的次要信息段（字数、页数、文档数、消息数），在渲染时按当前语言拼装 */
export function summaryMeta(t: Translate, summary: SummaryFields | undefined): string {
  if (!summary) return "";
  if (summary.wordCount != null && summary.wordCount > 0)
    return summary.wordCount >= 1000
      ? t("words.k", { value: (summary.wordCount / 1000).toFixed(1) })
      : t("words.count", { count: summary.wordCount });
  if (summary.pageCount != null && summary.pageCount > 1)
    return t("summary.pages", { count: summary.pageCount });
  if (summary.documentCount != null) return t("summary.documents", { count: summary.documentCount });
  if (summary.chat) {
    // 对话场景按宿主协议值记录（video-note），词典 key 用驼峰
    const sceneKey = summary.chat.scene === "pdf"
      ? "summary.scene.pdf"
      : summary.chat.scene === "video-note"
        ? "summary.scene.videoNote"
        : summary.chat.scene === "notebook"
          ? "summary.scene.notebook"
          : null;
    const scene = sceneKey ? t(sceneKey) : "";
    const count = summary.chat.messageCount
      ? t("summary.messages", { count: summary.chat.messageCount })
      : "";
    return [scene, count].filter(Boolean).join(" · ");
  }
  return summary.source ?? "";
}

/** 拼接类名；插件的 Tailwind 类都带 qs: 前缀，不经 @tau/ui 的 cn 合并 */
export const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).join(" ");
