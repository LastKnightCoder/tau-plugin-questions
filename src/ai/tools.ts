/**
 * 问题管理的 MCP 工具：AI 读问题与轨迹、记下问题、改状态与分组、记一笔、写下用户的答案。
 * 不提供删除（问题页里删除可撤销）；关联材料留在问题页，由用户在选择窗口里挑。
 * 返回给 AI 的是 JSON 文本；列出问题的工具另带 render，供工具渲染器显示可点开的问题行。
 */
import type { JsonValue, PluginContext, PluginMCPTool, PluginMCPToolResult } from "@tau/plugins";
import {
  compositionOf,
  GROUP_TONES,
  QUESTION_STATUSES,
  type Question,
  type QuestionGroup,
  type QuestionStatus,
} from "../data/model";
import type { QuestionData } from "../data/questions";
import { TARGET_META, describeEvent } from "../ui/model";

export const MCP_ID = "questions";
export const RENDER_VERSION = 1;

/** 渲染器收到的问题行 */
export interface QuestionRow {
  id: string;
  title: string;
  status: QuestionStatus;
  groupTitle: string;
  groupTone: string;
}

export interface QuestionsRender {
  questions: QuestionRow[];
}

/** 返回问题行的工具，注册渲染器时按它列出 */
export const ROW_TOOLS = ["list_questions", "create_question", "update_question"] as const;

const LIST_DEFAULT = 30;
const LIST_MAX = 100;
const BACKGROUND_MAX = 4000;
const ANSWER_MAX = 2000;
const RECENT_EVENTS = 20;

type ToolContext = Pick<PluginContext, "content" | "app">;

const text = (value: unknown, field: string, required = true) => {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`请提供 ${field}`);
  return value.trim();
};

const optionalText = (value: unknown, field: string) =>
  value === undefined || value === null || value === "" ? undefined : text(value, field);

const status = (value: unknown) => {
  if (value === undefined) return undefined;
  if (!QUESTION_STATUSES.includes(value as QuestionStatus))
    throw new Error(`status 只能是 ${QUESTION_STATUSES.join(" / ")}`);
  return value as QuestionStatus;
};

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max)}…（已截断）` : value;

const iso = (ts: number | null) => (ts == null ? null : new Date(ts).toISOString());

const json = (value: unknown, render?: QuestionsRender): PluginMCPToolResult => ({
  content: JSON.stringify(value),
  ...(render
    ? { render: { version: RENDER_VERSION, data: render as unknown as JsonValue } }
    : {}),
});

const STATUS_SCHEMA = {
  type: "string",
  enum: [...QUESTION_STATUSES],
  description: "not_started 待探究、in_progress 探究中、resolved 已解答",
};

export function createQuestionTools(data: QuestionData, context: ToolContext): PluginMCPTool[] {
  async function groupsById() {
    return new Map((await data.listGroups()).map(group => [group.id, group]));
  }

  const row = (question: Question, groups: Map<string, QuestionGroup>): QuestionRow => {
    const group = groups.get(question.groupId);
    return {
      id: question.id,
      title: question.title,
      status: question.status,
      groupTitle: group?.title ?? "",
      groupTone: group?.tone ?? "gray",
    };
  };

  const summary = (question: Question, groups: Map<string, QuestionGroup>) => ({
    id: question.id,
    title: question.title,
    status: question.status,
    group: groups.get(question.groupId)?.title ?? null,
    groupId: question.groupId,
    materials: Object.fromEntries(
      Object.entries(question.composition).map(([kind, count]) => [
        TARGET_META[kind as keyof typeof TARGET_META]?.label ?? kind,
        count,
      ])
    ),
    createdAt: iso(question.createdAt),
    lastActivityAt: iso(question.activityAt),
    resolvedAt: iso(question.resolvedTime),
  });

  async function requireGroupId(value: unknown) {
    const id = optionalText(value, "groupId");
    if (id === undefined) return undefined;
    if (!(await groupsById()).has(id)) throw new Error("分组不存在，先用 list_question_groups 查看分组");
    return id;
  }

  return [
    {
      name: "list_questions",
      description:
        "列出用户在问题管理里记下的问题（学习时的疑问），可按状态、分组、关键词筛选。最近有进展的在前。需要问题 ID 时先调用它。",
      inputSchema: {
        type: "object",
        properties: {
          status: STATUS_SCHEMA,
          groupId: { type: "string", description: "分组 ID，见 list_question_groups" },
          keyword: { type: "string", description: "按问题标题包含的文字筛选" },
          limit: { type: "integer", minimum: 1, maximum: LIST_MAX, description: `默认 ${LIST_DEFAULT}` },
        },
        additionalProperties: false,
      },
      async execute(args) {
        const filterStatus = status(args.status);
        const groupId = await requireGroupId(args.groupId);
        const keyword = optionalText(args.keyword, "keyword")?.toLowerCase();
        const limit =
          typeof args.limit === "number" && Number.isFinite(args.limit)
            ? Math.min(Math.max(Math.trunc(args.limit), 1), LIST_MAX)
            : LIST_DEFAULT;
        const groups = await groupsById();
        const all = (
          await data.listQuestions({
            ...(groupId ? { groupId } : {}),
            ...(filterStatus ? { status: filterStatus } : {}),
          })
        )
          .filter(q => !keyword || q.title.toLowerCase().includes(keyword))
          .sort((a, b) => b.activityAt - a.activityAt);
        const items = all.slice(0, limit);
        return json(
          { total: all.length, questions: items.map(q => summary(q, groups)) },
          { questions: items.map(q => row(q, groups)) }
        );
      },
    },
    {
      name: "get_question",
      description:
        "读取一个问题的详情：背景、挂上的材料与对话、用户写下的答案、最近的探究轨迹。",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "问题 ID" } },
        required: ["id"],
        additionalProperties: false,
      },
      async execute(args, { signal }) {
        const id = text(args.id, "id")!;
        const question = await data.getQuestion(id);
        if (!question) throw new Error("问题不存在");
        const [groups, materials, chats, answers, notebook, events, background] = await Promise.all([
          groupsById(),
          data.listMaterials(id),
          data.listChats(id),
          data.listAnswers(id),
          data.getNotebook(id),
          data.listEvents(id),
          context.content.read(question.contentRef),
        ]);
        signal.throwIfAborted();
        const refs = [...materials, ...chats].map(link => link.to);
        const described = refs.length ? await context.app.describe(refs) : [];
        const titleOf = (index: number) => {
          const item = described[index];
          return item?.status === "ok" ? item.title : item?.status === "missing" ? "（已删除）" : null;
        };
        const answerTexts = await Promise.all(
          answers.map(answer => context.content.read(answer.entity.contentRef))
        );
        signal.throwIfAborted();
        return json({
          ...summary(question, groups),
          background: clip(background?.markdown ?? "", BACKGROUND_MAX),
          materials: materials.map((link, index) => ({
            type: TARGET_META[compositionOf(link.to) ?? "card"].label,
            ref: link.to,
            title: titleOf(index),
          })),
          chats: chats.map((link, index) => ({
            ref: link.to,
            title: titleOf(materials.length + index),
          })),
          answers: answers.map((answer, index) => ({
            id: answer.entity.id,
            markdown: clip(answerTexts[index]?.markdown ?? "", ANSWER_MAX),
            updatedAt: iso(answer.entity.updatedAt),
          })),
          notebook: notebook ? notebook.to : null,
          recentEvents: events.slice(-RECENT_EVENTS).map(event => {
            const view = describeEvent(event);
            return {
              at: iso(event.createdAt),
              text:
                view.tone === "note"
                  ? `记一笔：${view.text ?? ""}`
                  : `${view.verb}${view.title ? `「${view.title}」` : ""}`,
            };
          }),
        });
      },
    },
    {
      name: "list_question_groups",
      description: "列出问题分组及每组未解答的问题数。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        const [groups, questions] = await Promise.all([data.listGroups(), data.listQuestions()]);
        return json(
          groups.map(group => ({
            id: group.id,
            title: group.title,
            isDefault: group.isDefault,
            open: questions.filter(q => q.groupId === group.id && q.status !== "resolved").length,
          }))
        );
      },
    },
    {
      name: "create_question",
      description:
        "替用户记下一个问题。只在用户明确要记下问题时调用；标题写成问句，保留用户的原意。背景可以写用户在哪里遇到、已经知道什么。",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "问题，写成一句问句" },
          groupId: { type: "string", description: "分组 ID；不填落入「未分类」" },
          background: { type: "string", description: "背景说明，Markdown" },
        },
        required: ["title"],
        additionalProperties: false,
      },
      async execute(args) {
        const title = text(args.title, "title")!;
        const groupId = await requireGroupId(args.groupId);
        const background = optionalText(args.background, "background");
        const question = await data.createQuestion({
          title,
          ...(groupId ? { groupId } : {}),
          ...(background ? { content: { markdown: background } } : {}),
        });
        const groups = await groupsById();
        return json({ created: summary(question, groups) }, { questions: [row(question, groups)] });
      },
    },
    {
      name: "update_question",
      description:
        "修改问题的标题、状态或分组，或在背景末尾补充内容。改状态前确认用户的意思，例如用户说「这个问题弄明白了」再标为 resolved。",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "问题 ID" },
          title: { type: "string" },
          status: STATUS_SCHEMA,
          groupId: { type: "string", description: "移动到的分组 ID" },
          appendBackground: { type: "string", description: "追加到背景末尾的内容，Markdown" },
        },
        required: ["id"],
        additionalProperties: false,
      },
      async execute(args) {
        const id = text(args.id, "id")!;
        if (!(await data.getQuestion(id))) throw new Error("问题不存在");
        const title = optionalText(args.title, "title");
        const nextStatus = status(args.status);
        const groupId = await requireGroupId(args.groupId);
        const appendix = optionalText(args.appendBackground, "appendBackground");
        if (!title && !nextStatus && !groupId && !appendix) throw new Error("没有要修改的内容");
        if (title) await data.renameQuestion(id, title);
        if (nextStatus) await data.setStatus(id, nextStatus);
        if (groupId) await data.moveToGroup(id, groupId);
        if (appendix) {
          const question = (await data.getQuestion(id))!;
          const snapshot = await context.content.read(question.contentRef);
          if (!snapshot) throw new Error("问题背景不存在");
          await context.content.edit(
            question.contentRef,
            { op: "append", content: { markdown: appendix } },
            { expectedRevision: snapshot.revision }
          );
        }
        const question = (await data.getQuestion(id))!;
        const groups = await groupsById();
        return json({ updated: summary(question, groups) }, { questions: [row(question, groups)] });
      },
    },
    {
      name: "add_question_note",
      description: "在问题的探究轨迹里记一笔：用户此刻的想法、卡住的地方或下一步打算。",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "问题 ID" },
          text: { type: "string", description: "一两句话" },
        },
        required: ["id", "text"],
        additionalProperties: false,
      },
      async execute(args) {
        const id = text(args.id, "id")!;
        await data.addNote(id, text(args.text, "text")!);
        return json({ ok: true });
      },
    },
    {
      name: "write_question_answer",
      description:
        "把用户自己的结论记为这个问题的一份独立答案。答案应是用户的话：只在用户口述或确认了结论后调用，不要替用户编写答案。",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "问题 ID" },
          markdown: { type: "string", description: "答案正文，Markdown" },
        },
        required: ["id", "markdown"],
        additionalProperties: false,
      },
      async execute(args) {
        const id = text(args.id, "id")!;
        const markdown = text(args.markdown, "markdown")!;
        const title =
          markdown
            .split("\n")
            .map(line => line.replace(/^[#>*\-\s\d.]+/, "").trim())
            .find(Boolean)
            ?.slice(0, 40) ?? "";
        const answerId = await data.createAnswer(id, { title, content: { markdown } });
        return json({ answerId, questionId: id });
      },
    },
    {
      name: "create_question_group",
      description: "新建问题分组。",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          tone: { type: "string", enum: [...GROUP_TONES], description: "色点颜色，默认 gray" },
        },
        required: ["title"],
        additionalProperties: false,
      },
      async execute(args) {
        const tone = GROUP_TONES.find(item => item === args.tone);
        const group = await data.createGroup({
          title: text(args.title, "title")!,
          ...(tone ? { tone } : {}),
        });
        return json({ id: group.id, title: group.title, tone: group.tone });
      },
    },
  ];
}
