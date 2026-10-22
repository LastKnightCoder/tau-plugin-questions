/**
 * 问题插件的数据形状：实体、记录与关联的名称、字段和纯函数。
 * 这里的名称与字段是持久化契约（随笔记库保存），改动前先确认已有数据如何处理，见 DEVELOPMENT.md。
 */
import type {
  JsonValue,
  PluginEntityRef,
  PluginIndexes,
  PluginSidebarTone,
} from "@tau/plugins";

/** 实体类型：问题（标题 + 背景描述）与独立答案 */
export const QUESTION_KIND = "question";
export const ANSWER_KIND = "answer";

/** 记录集合：分组与探究轨迹 */
export const GROUPS = "groups";
export const EVENTS = "events";

/** 问题指向其他内容的关联角色 */
export const MATERIAL_ROLE = "material";
export const ANSWER_ROLE = "answer";
export const CHAT_ROLE = "chat";
/** 由问题立项出的 Notebook */
export const NOTEBOOK_ROLE = "notebook";

export const QUESTION_INDEXES: PluginIndexes = {
  status: "string",
  groupId: "string",
  sortIndex: "number",
  resolvedTime: "number",
  activityAt: "number",
};
export const ANSWER_INDEXES: PluginIndexes = { questionId: "string" };
export const GROUP_INDEXES: PluginIndexes = { sortIndex: "number", isDefault: "boolean" };
export const EVENT_INDEXES: PluginIndexes = { questionId: "string" };

export const SORT_STEP = 1024;
export const DEFAULT_GROUP = { title: "未分类", tone: "gray" } as const;

/** 分组色，与侧边栏子项的色点同一套 */
export const GROUP_TONES: readonly PluginSidebarTone[] = [
  "rose",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "gray",
];

export type QuestionStatus = "not_started" | "in_progress" | "resolved";
export const QUESTION_STATUSES: readonly QuestionStatus[] = [
  "not_started",
  "in_progress",
  "resolved",
];

/** 材料构成里区分的类型：外部材料按划线、PDF 标注、剪藏分开计数 */
export type CompositionKind =
  | "card"
  | "article"
  | "document"
  | "project"
  | "whiteboard"
  | "excerpt"
  | "pdf-annotation"
  | "web-clip"
  | "chat-session"
  | "answer";
export type Composition = Partial<Record<CompositionKind, number>>;

const MATERIAL_KINDS = new Set(["excerpt", "pdf-annotation", "web-clip"]);
const DIRECT_KINDS = new Set(["card", "article", "document", "project", "whiteboard"]);

/** 可以挂到问题上的探究材料；其余类型返回 null */
export function compositionOf(ref: PluginEntityRef): CompositionKind | null {
  if (DIRECT_KINDS.has(ref.kind)) return ref.kind as CompositionKind;
  if (ref.kind === "chat-session") return "chat-session";
  if (ref.kind === "material") {
    const prefix = ref.id.split(":", 1)[0];
    return MATERIAL_KINDS.has(prefix) ? (prefix as CompositionKind) : null;
  }
  return null;
}

/** 问题实体的 meta；activityAt 为最近一次标题、状态、材料或记录变动的时间 */
export interface QuestionMeta {
  status: QuestionStatus;
  groupId: string;
  sortIndex: number;
  resolvedTime: number | null;
  activityAt: number;
  composition: Composition;
}

export interface Question extends QuestionMeta {
  id: string;
  key: string;
  title: string;
  /** 交给 ContentEditor 读写背景描述 */
  contentRef: string;
  createdAt: number;
  updatedAt: number;
  revision: string;
}

export interface QuestionGroup {
  id: string;
  title: string;
  tone: PluginSidebarTone;
  sortIndex: number;
  isDefault: boolean;
  createdAt: number;
  revision: string;
}

/** 轨迹：create / status / link / unlink 由写操作自动记录，note 为手动「记一笔」 */
export type QuestionEventPayload =
  | { type: "create"; estimated?: boolean }
  | { type: "status"; to: QuestionStatus; auto?: boolean; estimated?: boolean }
  | {
      type: "link";
      target: CompositionKind;
      ref?: PluginEntityRef;
      /** 从问题里直接新建的材料（轨迹记为「写下 / 新建」而非「关联」） */
      created?: boolean;
      title?: string;
      estimated?: boolean;
    }
  | {
      type: "unlink";
      target: CompositionKind;
      ref?: PluginEntityRef;
      title?: string;
      estimated?: boolean;
    }
  | { type: "note"; text: string };

export type QuestionEvent = QuestionEventPayload & {
  id: string;
  questionId: string;
  createdAt: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isStatus = (value: unknown): value is QuestionStatus =>
  QUESTION_STATUSES.includes(value as QuestionStatus);

const isComposition = (value: unknown): value is CompositionKind =>
  typeof value === "string" &&
  (DIRECT_KINDS.has(value) ||
    MATERIAL_KINDS.has(value) ||
    value === "chat-session" ||
    value === "answer");

/** 读 meta：笔记库里的数据可能被同步或旧版本写坏，逐项校验并给出缺省值 */
export function readQuestionMeta(meta: Record<string, JsonValue>, fallbackTime: number): QuestionMeta {
  const composition: Composition = {};
  if (isRecord(meta.composition))
    for (const [kind, count] of Object.entries(meta.composition))
      if (isComposition(kind) && typeof count === "number" && count > 0) composition[kind] = count;
  return {
    status: isStatus(meta.status) ? meta.status : "not_started",
    groupId: typeof meta.groupId === "string" ? meta.groupId : "",
    sortIndex: typeof meta.sortIndex === "number" ? meta.sortIndex : 0,
    resolvedTime: typeof meta.resolvedTime === "number" ? meta.resolvedTime : null,
    activityAt: typeof meta.activityAt === "number" ? meta.activityAt : fallbackTime,
    composition,
  };
}

export const writeQuestionMeta = (meta: QuestionMeta): Record<string, JsonValue> => ({
  status: meta.status,
  groupId: meta.groupId,
  sortIndex: meta.sortIndex,
  resolvedTime: meta.resolvedTime,
  activityAt: meta.activityAt,
  composition: { ...meta.composition },
});

export function readGroup(record: {
  id: string;
  data: Record<string, JsonValue>;
  createdAt: number;
  revision: string;
}): QuestionGroup {
  const { data } = record;
  return {
    id: record.id,
    title: typeof data.title === "string" ? data.title : "",
    tone: GROUP_TONES.includes(data.tone as PluginSidebarTone)
      ? (data.tone as PluginSidebarTone)
      : "gray",
    sortIndex: typeof data.sortIndex === "number" ? data.sortIndex : 0,
    isDefault: data.isDefault === true,
    createdAt: record.createdAt,
    revision: record.revision,
  };
}

export const readRef = (value: unknown): PluginEntityRef | undefined =>
  isRecord(value) && typeof value.kind === "string" && typeof value.id === "string"
    ? ({ kind: value.kind, id: value.id } as PluginEntityRef)
    : undefined;

/** 独立答案的 meta：所属问题，以及与答案共用正文的卡片、文章、项目文档 */
export interface AnswerMeta {
  questionId: string;
  projections: PluginEntityRef[];
}

export function readAnswerMeta(meta: Record<string, JsonValue>): AnswerMeta {
  const projections = Array.isArray(meta.projections)
    ? meta.projections.map(readRef).filter((ref): ref is PluginEntityRef => ref != null)
    : [];
  return { questionId: typeof meta.questionId === "string" ? meta.questionId : "", projections };
}

export const writeAnswerMeta = (meta: AnswerMeta): Record<string, JsonValue> => ({
  questionId: meta.questionId,
  projections: meta.projections.map(ref => ({ kind: ref.kind, id: ref.id })),
});

/** 读轨迹记录；无法识别的返回 null，页面不展示 */
export function readEvent(record: {
  id: string;
  data: Record<string, JsonValue>;
  createdAt: number;
}): QuestionEvent | null {
  const { data } = record;
  if (typeof data.questionId !== "string") return null;
  const base = { id: record.id, questionId: data.questionId, createdAt: record.createdAt };
  const estimated = data.estimated === true ? { estimated: true } : {};
  const title = typeof data.title === "string" ? { title: data.title } : {};
  const ref = readRef(data.ref);
  switch (data.type) {
    case "create":
      return { ...base, type: "create", ...estimated };
    case "status":
      return isStatus(data.to)
        ? { ...base, type: "status", to: data.to, ...(data.auto === true ? { auto: true } : {}), ...estimated }
        : null;
    case "link":
    case "unlink":
      if (!isComposition(data.target)) return null;
      return {
        ...base,
        type: data.type,
        target: data.target,
        ...(ref ? { ref } : {}),
        ...(data.type === "link" && data.created === true ? { created: true } : {}),
        ...title,
        ...estimated,
      };
    case "note":
      return typeof data.text === "string" ? { ...base, type: "note", text: data.text } : null;
    default:
      return null;
  }
}

/** 轨迹记录的 data：questionId 加上事件本身 */
export const writeEvent = (
  questionId: string,
  payload: QuestionEventPayload
): Record<string, JsonValue> => JSON.parse(JSON.stringify({ questionId, ...payload }));

/**
 * 快速收集的输入解析：第一个「#分组」记号作为分组提示（按全名或前缀匹配），其余文字为问题。
 * 「#」后须紧跟非空白字符，「C#」这类词内的井号不算分组记号。
 */
const GROUP_TOKEN = /(^|\s)#(\S+)/;

export function parseCapture(raw: string): { title: string; groupHint: string | null } {
  const match = raw.match(GROUP_TOKEN);
  if (!match) return { title: raw.trim(), groupHint: null };
  const start = match.index ?? 0;
  const title = (raw.slice(0, start) + match[1] + raw.slice(start + match[0].length))
    .replace(/\s{2,}/g, " ")
    .trim();
  return { title, groupHint: match[2] };
}

export function matchGroup<G extends { title: string }>(groups: G[], hint: string | null): G | null {
  if (!hint) return null;
  const key = hint.toLowerCase();
  return (
    groups.find(g => g.title.toLowerCase() === key) ??
    groups.find(g => g.title.toLowerCase().startsWith(key)) ??
    null
  );
}
