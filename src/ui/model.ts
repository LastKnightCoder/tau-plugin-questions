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
import type { PluginSidebarTone } from "@tau/plugins";
import type { CompositionKind, Question, QuestionEvent, QuestionStatus } from "../data/model";

export const DAY_MS = 86_400_000;

export const STATUS_META: Record<QuestionStatus, { label: string; hint: string }> = {
  in_progress: { label: "探究中", hint: "正在积累材料" },
  not_started: { label: "待探究", hint: "收集来还没动" },
  resolved: { label: "已解答", hint: "已有答案" },
};

/** 列表分段顺序：正在做的在最前 */
export const SECTION_ORDER: QuestionStatus[] = ["in_progress", "not_started", "resolved"];
/** 状态条 / 数字键 1-3 的顺序：按学习阶段 */
export const STATUS_STEPS: QuestionStatus[] = ["not_started", "in_progress", "resolved"];

export const TARGET_META: Record<CompositionKind, { label: string; icon: LucideIcon }> = {
  card: { label: "卡片", icon: Layers },
  article: { label: "文章", icon: FileText },
  document: { label: "项目文档", icon: File },
  project: { label: "项目", icon: FolderKanban },
  whiteboard: { label: "白板", icon: Presentation },
  answer: { label: "独立答案", icon: PenLine },
  excerpt: { label: "划线", icon: Highlighter },
  "pdf-annotation": { label: "PDF 标注", icon: ScrollText },
  "web-clip": { label: "剪藏", icon: Globe },
  "chat-session": { label: "对话", icon: MessageCircle },
};

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
export function relativeDay(ts: number, now: number): string {
  const diff = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff < 7) return `${diff} 天前`;
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${sameYear ? "" : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日`;
}

export function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 自然日跨度（至少 1 天） */
export function daySpan(from: number, to: number): number {
  return Math.max(1, Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS) + 1);
}

export function formatWords(words: number): string {
  if (words <= 0) return "";
  return words >= 1000 ? `${(words / 1000).toFixed(1)}k 字` : `${words} 字`;
}

const CREATED_VERB: Partial<Record<CompositionKind, string>> = {
  card: "写下卡片",
  article: "写了文章",
  document: "写了项目文档",
  project: "新建项目",
  whiteboard: "画了白板",
  answer: "写下结论",
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

export function describeEvent(event: QuestionEvent): EventView {
  const estimated = "estimated" in event && Boolean(event.estimated);
  switch (event.type) {
    case "create":
      return { tone: "start", verb: "提出问题", estimated };
    case "status":
      if (event.to === "resolved") return { tone: "done", verb: "标为已解答", estimated };
      return {
        tone: "plain",
        verb: event.auto ? "挂上第一份材料，进入探究中" : `改为「${STATUS_META[event.to].label}」`,
        estimated,
      };
    case "link":
      return {
        tone: event.created ? "made" : "plain",
        verb:
          event.created && CREATED_VERB[event.target]
            ? CREATED_VERB[event.target]!
            : `关联${TARGET_META[event.target].label}`,
        target: event.target,
        title: event.title,
        estimated,
      };
    case "unlink":
      return {
        tone: "muted",
        verb: `移除${TARGET_META[event.target].label}`,
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
  now: number
): string {
  const days = daySpan(question.createdAt, question.resolvedTime ?? now);
  const notes = events.filter(e => e.type === "note").length;
  const head = question.status === "resolved" ? `用时 ${days} 天` : `第 ${days} 天`;
  return `${head} · ${materials} 份材料 · ${notes} 条记录`;
}

/** 拼接类名；插件的 Tailwind 类都带 qs: 前缀，不经 @tau/ui 的 cn 合并 */
export const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).join(" ");
