/**
 * 问题的读写：分组、问题、材料、对话、独立答案与探究轨迹。
 * 一次操作的多条写入（改 meta、记轨迹、建关联）放在同一个 transaction 里，全部生效或全部不生效。
 */
import type {
  PluginContentInput,
  PluginContext,
  PluginEntityRef,
  PluginLink,
  PluginOwnEntity,
  PluginPage,
  PluginTransaction,
} from "@tau/plugins";
import {
  ANSWER_KIND,
  ANSWER_ROLE,
  CHAT_ROLE,
  compositionOf,
  DEFAULT_GROUP,
  EVENTS,
  GROUPS,
  MATERIAL_ROLE,
  matchGroup,
  parseCapture,
  QUESTION_KIND,
  QUESTION_STATUSES,
  readEvent,
  readGroup,
  readQuestionMeta,
  SORT_STEP,
  writeEvent,
  writeQuestionMeta,
  type CompositionKind,
  type Question,
  type QuestionEvent,
  type QuestionEventPayload,
  type QuestionGroup,
  type QuestionMeta,
  type QuestionStatus,
} from "./model";

export type QuestionStore = Pick<PluginContext, "entities" | "records" | "links" | "transaction">;

/** 一次 transaction 最多 500 条写入；批量移动、删除按批提交 */
const BATCH = 400;
const PAGE = 200;

export interface MaterialInput {
  ref: PluginEntityRef;
  /** 轨迹里显示的标题（取选择时或 describe 的标题） */
  title?: string;
  /** 从问题里直接新建的材料 */
  created?: boolean;
}

export interface QuestionAnswer {
  link: PluginLink;
  entity: PluginOwnEntity;
}

export interface ActiveQuestion {
  question: Question;
  group: QuestionGroup | null;
  lastEvent: QuestionEvent | null;
}

export function toQuestion(entity: PluginOwnEntity): Question {
  return {
    id: entity.id,
    key: entity.key,
    title: entity.title,
    contentRef: entity.contentRef,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    revision: entity.revision,
    ...readQuestionMeta(entity.meta, entity.createdAt),
  };
}

async function readAll<T>(load: (cursor?: string) => Promise<PluginPage<T>>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await load(cursor);
    items.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return items;
}

const chunks = <T>(list: readonly T[], size = BATCH): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, index) =>
    list.slice(index * size, (index + 1) * size)
  );

const newKey = () => globalThis.crypto.randomUUID();

const requireTitle = (title: string, label: string) => {
  const text = title.trim();
  if (!text) throw new Error(`${label}不能为空`);
  return text;
};

export function createQuestionData(store: QuestionStore, now: () => number = Date.now) {
  const { entities, records, links, transaction } = store;

  /* ── 分组 ── */

  async function listGroups(): Promise<QuestionGroup[]> {
    const items = await readAll(cursor =>
      records.query(GROUPS, {
        orderBy: [{ field: "sortIndex" }, { field: "createdAt" }],
        limit: PAGE,
        cursor,
      })
    );
    return items.map(readGroup);
  }

  let defaultGroup: Promise<QuestionGroup> | null = null;
  /** 默认分组「未分类」：不可改名、不可删除，删除分组时其中的问题移到这里 */
  function ensureDefaultGroup(): Promise<QuestionGroup> {
    defaultGroup ??= (async () => {
      const page = await records.query(GROUPS, { where: { isDefault: true }, limit: 1 });
      if (page.items[0]) return readGroup(page.items[0]);
      return readGroup(
        await records.insert(GROUPS, { ...DEFAULT_GROUP, sortIndex: 0, isDefault: true })
      );
    })().catch(error => {
      defaultGroup = null;
      throw error;
    });
    return defaultGroup;
  }

  async function requireGroup(id: string): Promise<QuestionGroup> {
    const record = await records.get(GROUPS, id);
    if (!record) throw new Error("分组不存在");
    return readGroup(record);
  }

  async function createGroup(input: { title: string; color?: string | null }) {
    const title = requireTitle(input.title, "分组名称");
    const last = await records.query(GROUPS, {
      orderBy: { field: "sortIndex", direction: "desc" },
      limit: 1,
    });
    const sortIndex = (last.items[0] ? readGroup(last.items[0]).sortIndex : 0) + SORT_STEP;
    return readGroup(
      await records.insert(GROUPS, {
        title,
        color: input.color ?? null,
        sortIndex,
        isDefault: false,
      })
    );
  }

  async function updateGroup(id: string, patch: { title?: string; color?: string | null }) {
    const group = await requireGroup(id);
    const title =
      group.isDefault || patch.title === undefined ? group.title : requireTitle(patch.title, "分组名称");
    const color = patch.color === undefined ? group.color : patch.color;
    return readGroup(
      await records.update(
        GROUPS,
        id,
        { title, color, sortIndex: group.sortIndex, isDefault: group.isDefault },
        { expectedRevision: group.revision }
      )
    );
  }

  /** 删除分组，其中的问题移到默认分组 */
  async function deleteGroup(id: string) {
    const group = await requireGroup(id);
    if (group.isDefault) throw new Error("默认分组不可删除");
    const fallback = await ensureDefaultGroup();
    const members = await listQuestions({ groupId: id });
    for (const batch of chunks(members))
      await transaction(async tx => {
        for (const question of batch)
          await tx.entities.update(
            question.id,
            { meta: writeQuestionMeta({ ...question, groupId: fallback.id }) },
            { expectedRevision: question.revision }
          );
      });
    await records.delete(GROUPS, id, { expectedRevision: group.revision });
  }

  async function reorderGroups(orderedIds: readonly string[]) {
    const groups = new Map((await listGroups()).map(group => [group.id, group]));
    const updates = orderedIds.flatMap((id, index) => {
      const group = groups.get(id);
      const sortIndex = (index + 1) * SORT_STEP;
      return group && group.sortIndex !== sortIndex ? [{ group, sortIndex }] : [];
    });
    for (const batch of chunks(updates))
      await transaction(async tx => {
        for (const { group, sortIndex } of batch)
          await tx.records.update(GROUPS, group.id, {
            title: group.title,
            color: group.color,
            sortIndex,
            isDefault: group.isDefault,
          });
      });
  }

  /* ── 问题 ── */

  async function listQuestions(filter: { groupId?: string; status?: QuestionStatus } = {}) {
    const where = {
      ...(filter.groupId ? { groupId: filter.groupId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const items = await readAll(cursor =>
      entities.query({
        kind: QUESTION_KIND,
        where,
        orderBy: [{ field: "sortIndex" }, { field: "createdAt" }],
        limit: PAGE,
        cursor,
      })
    );
    return items.map(toQuestion);
  }

  async function getQuestion(id: string): Promise<Question | null> {
    const entity = await entities.get(id);
    return entity?.kind === QUESTION_KIND ? toQuestion(entity) : null;
  }

  async function requireQuestion(id: string): Promise<Question> {
    const question = await getQuestion(id);
    if (!question) throw new Error("问题不存在");
    return question;
  }

  /** 改 meta 并刷新最近活动时间 */
  const touch = (tx: PluginTransaction, question: Question, patch: Partial<QuestionMeta> = {}) =>
    tx.entities.update(
      question.id,
      { meta: writeQuestionMeta({ ...question, ...patch, activityAt: now() }) },
      { expectedRevision: question.revision }
    );

  const log = (tx: PluginTransaction, questionId: string, payload: QuestionEventPayload) =>
    tx.records.insert(EVENTS, writeEvent(questionId, payload));

  async function createQuestion(input: {
    title: string;
    groupId?: string;
    content?: PluginContentInput;
  }): Promise<Question> {
    const title = requireTitle(input.title, "问题");
    const groupId = input.groupId ?? (await ensureDefaultGroup()).id;
    const last = await entities.query({
      kind: QUESTION_KIND,
      orderBy: { field: "sortIndex", direction: "desc" },
      limit: 1,
    });
    const sortIndex = (last.items[0] ? toQuestion(last.items[0]).sortIndex : 0) + SORT_STEP;
    const meta: QuestionMeta = {
      status: "not_started",
      groupId,
      sortIndex,
      resolvedTime: null,
      activityAt: now(),
      composition: {},
    };
    const { id } = await transaction(async tx => {
      const created = await tx.entities.create({
        kind: QUESTION_KIND,
        key: newKey(),
        title,
        meta: writeQuestionMeta(meta),
        ...(input.content ? { content: input.content } : {}),
      });
      await log(tx, created.id, { type: "create" });
      return created;
    });
    return requireQuestion(id);
  }

  /** 快速收集：「#分组」按全名、再按前缀匹配，找不到落默认分组 */
  async function captureQuestion(raw: string, content?: PluginContentInput) {
    const { title, groupHint } = parseCapture(raw);
    const group = matchGroup(await listGroups(), groupHint) ?? (await ensureDefaultGroup());
    const question = await createQuestion({ title, groupId: group.id, content });
    return { question, group };
  }

  async function renameQuestion(id: string, title: string) {
    const question = await requireQuestion(id);
    await entities.update(
      id,
      {
        title: requireTitle(title, "问题"),
        meta: writeQuestionMeta({ ...question, activityAt: now() }),
      },
      { expectedRevision: question.revision }
    );
  }

  /**
   * 设置状态并记入轨迹；resolvedTime 为标为已解答的时刻，离开已解答时清空。
   * revertEventId：撤销上一次状态修改，删除那条事件而不是再记一条；撤销回已解答时恢复原解答时刻。
   */
  async function setStatus(
    id: string,
    status: QuestionStatus,
    options: { revertEventId?: string } = {}
  ): Promise<{ eventId?: string }> {
    if (!QUESTION_STATUSES.includes(status)) throw new Error("状态无效");
    const question = await requireQuestion(id);
    if (question.status === status) return {};
    let resolvedTime = status === "resolved" ? now() : null;
    if (options.revertEventId != null && status === "resolved") {
      const previous = (await listEvents(id))
        .filter(event => event.type === "status" && event.to === "resolved")
        .at(-1);
      if (previous) resolvedTime = previous.createdAt;
    }
    return transaction(async tx => {
      await touch(tx, question, { status, resolvedTime });
      if (options.revertEventId != null) {
        await tx.records.delete(EVENTS, options.revertEventId);
        return {};
      }
      return { eventId: (await log(tx, id, { type: "status", to: status })).id };
    });
  }

  async function moveToGroup(id: string, groupId: string) {
    const question = await requireQuestion(id);
    if (question.groupId === groupId) return;
    await requireGroup(groupId);
    await entities.update(
      id,
      { meta: writeQuestionMeta({ ...question, groupId }) },
      { expectedRevision: question.revision }
    );
  }

  async function reorderQuestions(orderedIds: readonly string[]) {
    const questions = new Map((await listQuestions()).map(question => [question.id, question]));
    const updates = orderedIds.flatMap((id, index) => {
      const question = questions.get(id);
      const sortIndex = (index + 1) * SORT_STEP;
      return question && question.sortIndex !== sortIndex ? [{ question, sortIndex }] : [];
    });
    for (const batch of chunks(updates))
      await transaction(async tx => {
        for (const { question, sortIndex } of batch)
          await tx.entities.update(question.id, {
            meta: writeQuestionMeta({ ...question, sortIndex }),
          });
      });
  }

  /**
   * 删除问题及其独立答案与轨迹。问题在「最近删除」里恢复时，材料与对话的关联随之恢复，
   * 答案需要单独恢复，轨迹不再保留。
   */
  async function deleteQuestion(id: string) {
    const question = await requireQuestion(id);
    const answers = await listAnswers(id);
    const events = await listEvents(id);
    const eventBatches = chunks(events.map(event => event.id));
    for (const batch of eventBatches.slice(0, -1))
      await transaction(async tx => {
        for (const eventId of batch) await tx.records.delete(EVENTS, eventId);
      });
    await transaction(async tx => {
      for (const eventId of eventBatches.at(-1) ?? []) await tx.records.delete(EVENTS, eventId);
      for (const answer of answers) await tx.entities.delete(answer.entity.id);
      await tx.entities.delete(id, { expectedRevision: question.revision });
    });
  }

  /** 探究中的问题，按最近活动倒序，附分组与最近一条轨迹 */
  async function listActive(limit = 6): Promise<ActiveQuestion[]> {
    const page = await entities.query({
      kind: QUESTION_KIND,
      where: { status: "in_progress" },
      orderBy: { field: "activityAt", direction: "desc" },
      limit: Math.min(Math.max(limit, 1), 20),
    });
    const groups = new Map((await listGroups()).map(group => [group.id, group]));
    return Promise.all(
      page.items.map(async entity => {
        const question = toQuestion(entity);
        const latest = await records.query(EVENTS, {
          where: { questionId: question.id },
          orderBy: { field: "createdAt", direction: "desc" },
          limit: 1,
        });
        return {
          question,
          group: groups.get(question.groupId) ?? null,
          lastEvent: latest.items[0] ? readEvent(latest.items[0]) : null,
        };
      })
    );
  }

  /* ── 材料与对话 ── */

  const count = (composition: Question["composition"], kind: CompositionKind, delta: number) => {
    const next = { ...composition };
    const value = (next[kind] ?? 0) + delta;
    if (value > 0) next[kind] = value;
    else delete next[kind];
    return next;
  };

  /** 第一份材料挂上时，待探究自动进入探究中（记一条 auto 状态事件） */
  async function attach(
    tx: PluginTransaction,
    question: Question,
    added: { kind: CompositionKind; payload: QuestionEventPayload }[]
  ) {
    let composition = question.composition;
    for (const item of added) {
      composition = count(composition, item.kind, 1);
      await log(tx, question.id, item.payload);
    }
    const autoStart = question.status === "not_started";
    await touch(tx, question, {
      composition,
      ...(autoStart ? { status: "in_progress" as const } : {}),
    });
    if (autoStart) await log(tx, question.id, { type: "status", to: "in_progress", auto: true });
  }

  const sameRef = (a: PluginEntityRef, b: PluginEntityRef) => a.kind === b.kind && a.id === b.id;

  async function listMaterials(questionId: string) {
    return links.list(questionId, { role: MATERIAL_ROLE });
  }

  /** 关联材料，已关联的跳过；返回新增的数量 */
  async function linkMaterials(questionId: string, items: readonly MaterialInput[]) {
    const question = await requireQuestion(questionId);
    const existing = await listMaterials(questionId);
    const seen: PluginEntityRef[] = existing.map(link => link.to);
    const added = items.flatMap(item => {
      const kind = compositionOf(item.ref);
      if (!kind || kind === "chat-session") throw new Error("这类内容不能作为材料");
      if (seen.some(ref => sameRef(ref, item.ref))) return [];
      seen.push(item.ref);
      return [{ item, kind }];
    });
    if (!added.length) return 0;
    await transaction(async tx => {
      for (const { item } of added) await tx.links.add(questionId, item.ref, { role: MATERIAL_ROLE });
      await attach(
        tx,
        question,
        added.map(({ item, kind }) => ({
          kind,
          payload: {
            type: "link",
            target: kind,
            ref: item.ref,
            ...(item.created ? { created: true } : {}),
            ...(item.title ? { title: item.title } : {}),
          },
        }))
      );
    });
    return added.length;
  }

  /** 解除一条材料或对话的关联，材料本身不受影响 */
  async function unlink(questionId: string, link: PluginLink, title?: string) {
    const question = await requireQuestion(questionId);
    const kind = compositionOf(link.to);
    await transaction(async tx => {
      await tx.links.remove(link.id);
      if (!kind) return;
      await touch(tx, question, { composition: count(question.composition, kind, -1) });
      await log(tx, questionId, {
        type: "unlink",
        target: kind,
        ref: link.to,
        ...(title ? { title } : {}),
      });
    });
  }

  async function reorderMaterials(questionId: string, linkIds: readonly string[]) {
    await links.reorder(questionId, linkIds);
  }

  async function listChats(questionId: string) {
    return links.list(questionId, { role: CHAT_ROLE });
  }

  /** 关联对话；messageIds 记下问题从哪几条消息转来。已关联的返回 false，不覆盖原来的消息位置 */
  async function linkChat(
    questionId: string,
    sessionId: string,
    options: { messageIds?: readonly string[]; title?: string } = {}
  ) {
    const question = await requireQuestion(questionId);
    const ref: PluginEntityRef = { kind: "chat-session", id: sessionId };
    if ((await listChats(questionId)).some(link => sameRef(link.to, ref))) return false;
    await transaction(async tx => {
      await tx.links.add(questionId, ref, {
        role: CHAT_ROLE,
        ...(options.messageIds?.length ? { data: { messageIds: [...options.messageIds] } } : {}),
      });
      await attach(tx, question, [
        {
          kind: "chat-session",
          payload: {
            type: "link",
            target: "chat-session",
            ref,
            ...(options.title ? { title: options.title } : {}),
          },
        },
      ]);
    });
    return true;
  }

  /* ── 独立答案 ── */

  async function listAnswers(questionId: string): Promise<QuestionAnswer[]> {
    const answerLinks = await links.list(questionId, { role: ANSWER_ROLE });
    const answers = await Promise.all(
      answerLinks.map(async link => {
        const entity = link.to.kind === "plugin-entity" ? await entities.get(link.to.id) : null;
        return entity?.kind === ANSWER_KIND ? { link, entity } : null;
      })
    );
    return answers.filter((answer): answer is QuestionAnswer => answer != null);
  }

  /** 在问题下写一份独立答案，轨迹记为「写下结论」 */
  async function createAnswer(
    questionId: string,
    input: { title: string; content?: PluginContentInput }
  ): Promise<string> {
    const question = await requireQuestion(questionId);
    return transaction(async tx => {
      const { id } = await tx.entities.create({
        kind: ANSWER_KIND,
        key: newKey(),
        title: input.title.trim(),
        meta: { questionId },
        ...(input.content ? { content: input.content } : {}),
      });
      const ref: PluginEntityRef = { kind: "plugin-entity", id };
      await tx.links.add(questionId, ref, { role: ANSWER_ROLE });
      await attach(tx, question, [
        {
          kind: "answer",
          payload: {
            type: "link",
            target: "answer",
            ref,
            created: true,
            ...(input.title.trim() ? { title: input.title.trim() } : {}),
          },
        },
      ]);
      return id;
    });
  }

  /** 删除独立答案（进「最近删除」），轨迹记为「移除独立答案」 */
  async function deleteAnswer(questionId: string, answer: QuestionAnswer) {
    const question = await requireQuestion(questionId);
    await transaction(async tx => {
      await tx.links.remove(answer.link.id);
      await tx.entities.delete(answer.entity.id, { expectedRevision: answer.entity.revision });
      await touch(tx, question, { composition: count(question.composition, "answer", -1) });
      await log(tx, questionId, {
        type: "unlink",
        target: "answer",
        ref: answer.link.to,
        ...(answer.entity.title ? { title: answer.entity.title } : {}),
      });
    });
  }

  /* ── 轨迹 ── */

  async function listEvents(questionId: string): Promise<QuestionEvent[]> {
    const items = await readAll(cursor =>
      records.query(EVENTS, {
        where: { questionId },
        orderBy: { field: "createdAt" },
        limit: PAGE,
        cursor,
      })
    );
    return items.map(readEvent).filter((event): event is QuestionEvent => event != null);
  }

  async function addNote(questionId: string, text: string) {
    const note = requireTitle(text, "记录内容");
    const question = await requireQuestion(questionId);
    return transaction(async tx => {
      await touch(tx, question);
      return (await log(tx, questionId, { type: "note", text: note })).id;
    });
  }

  async function deleteEvent(eventId: string) {
    const record = await records.get(EVENTS, eventId);
    if (record) await records.delete(EVENTS, eventId, { expectedRevision: record.revision });
  }

  return {
    listGroups,
    ensureDefaultGroup,
    createGroup,
    updateGroup,
    deleteGroup,
    reorderGroups,
    listQuestions,
    getQuestion,
    createQuestion,
    captureQuestion,
    renameQuestion,
    setStatus,
    moveToGroup,
    reorderQuestions,
    deleteQuestion,
    listActive,
    listMaterials,
    linkMaterials,
    unlink,
    reorderMaterials,
    listChats,
    linkChat,
    listAnswers,
    createAnswer,
    deleteAnswer,
    listEvents,
    addNote,
    deleteEvent,
  };
}

export type QuestionData = ReturnType<typeof createQuestionData>;
