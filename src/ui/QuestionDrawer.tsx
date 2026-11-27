/**
 * 问题详情抽屉（非模态，盖在列表右侧；Esc 经页面浮层登记关闭）。
 * 头部：标题（即改即存）→ 分组 + 提出时间 · 更多菜单；正文：状态三段 → 背景 → 我的答案 →
 * 探究材料 → 探究对话 → 动作（写卡片 / 新建 ▾ / 围绕它聊 / 关联已有）→ 探究轨迹。
 * 材料的标题与是否已删除不需要权限；摘要要读取权限，用户点「显示摘要」时才询问。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ExternalLink,
  Eye,
  FileText,
  FlaskConical,
  FolderKanban,
  Layers,
  Link2,
  MessageCircle,
  MoreHorizontal,
  PanelRight,
  PenLine,
  Plus,
  Presentation,
  Unlink,
} from "lucide-react";
import {
  ContentEditor,
  useI18n,
  type PluginEntityDescription,
  type PluginEntityRef,
  type PluginLink,
  type PluginPageContext,
} from "@tau/plugins";
import { Button, Drawer, IconButton, Loading, Menu, toast, useRetainedValue } from "@tau/ui";
import { useRuntime } from "../runtime";
import { messages } from "../i18n";
import { compositionOf, type Composition as Counts, type Question, type QuestionGroup, type QuestionStatus } from "../data/model";
import type { QuestionAnswer } from "../data/questions";
import type { CreatableKind, QuestionActions } from "./actions";
import { Composition, GroupDot, Hint, MENU_ICON, SectionTitle, StatusRing } from "./bits";
import { RefRow } from "./RefRow";
import { Trajectory } from "./Trajectory";
import {
  STATUS_STEPS,
  TARGET_META,
  cx,
  kindLabel,
  relativeDay,
  statusLabel,
  summaryMeta,
  trajectoryStats,
} from "./model";
import {
  refKey,
  useDescriptions,
  useSummaries,
  useSummaryAccess,
  type QuestionDetail,
  type RefSummary,
} from "./queries";

export function QuestionDrawer({
  open,
  detail,
  groups,
  hidden,
  now,
  pageContext,
  actions,
  onSetStatus,
  onMove,
  onPreview,
  onUnlink,
  onEditAnswer,
  onWriteAnswer,
  renderMenu,
  onClose,
}: {
  /** 有选中问题即打开（详情可能还在加载） */
  open: boolean;
  detail: QuestionDetail | null;
  groups: readonly QuestionGroup[];
  /** 撤销窗口内暂存删除的关联（先从视图隐藏） */
  hidden: ReadonlySet<string>;
  now: number;
  pageContext: PluginPageContext;
  actions: QuestionActions;
  onSetStatus(question: Question, status: QuestionStatus): void;
  onMove(question: Question, groupId: string): void;
  onPreview(link: PluginLink, contentRef: string, title: string): void;
  onUnlink(link: PluginLink, title: string | undefined): void;
  onEditAnswer(answer: QuestionAnswer): void;
  onWriteAnswer(): void;
  renderMenu(question: Question): ReactNode;
  onClose(): void;
}) {
  const { t } = useI18n(messages);
  useEffect(() => {
    if (!open) return;
    const registration = pageContext.registerDismiss(onClose);
    return () => void registration.dispose();
  }, [open, pageContext, onClose]);
  /* 关闭时保留最后一条内容做退场动画 */
  const retained = useRetainedValue(detail);
  const current = open ? detail : retained;
  const question = current?.question;
  const group = question ? groups.find(g => g.id === question.groupId) : undefined;

  return (
    <Drawer
      modal={false}
      open={open}
      onOpenChange={next => !next && onClose()}
      size="md"
      label={t("drawer.label")}
      className="qs:top-0"
      title={question && <TitleEditor key={question.id} question={question} />}
      subtitle={
        question && (
          <span className="qs:flex qs:items-center qs:gap-2 qs:text-[11.5px]">
            <Menu
              trigger={
                <button
                  type="button"
                  className="qs:text-ink-2 qs:hover:bg-hover qs:-ml-1 qs:flex qs:h-[22px] qs:items-center qs:gap-1.5 qs:rounded-[6px] qs:px-1 qs:outline-none qs:focus-visible:shadow-[var(--tau-focus-ring)]"
                >
                  <GroupDot tone={group?.tone} />
                  {group?.title ?? t("group.ungrouped")}
                  <ChevronDown className="qs:text-ink-3 qs:size-3" strokeWidth={1.75} />
                </button>
              }
            >
              <Menu.Group>{t("drawer.moveToGroup")}</Menu.Group>
              {groups.map(g => (
                <Menu.Item
                  key={g.id}
                  icon={<GroupDot tone={g.tone} />}
                  onSelect={() => g.id !== question.groupId && onMove(question, g.id)}
                >
                  {g.title}
                </Menu.Item>
              ))}
            </Menu>
            <span>{t("date.asked", { day: relativeDay(question.createdAt, now, t) })}</span>
          </span>
        )
      }
      actions={
        question && (
          <Menu
            align="end"
            trigger={
              <IconButton title={t("common.more")}>
                <MoreHorizontal className="qs:size-[15px]" strokeWidth={1.75} />
              </IconButton>
            }
          >
            {renderMenu(question)}
          </Menu>
        )
      }
    >
      {current ? (
        <DetailBody
          key={current.question.id}
          detail={current}
          hidden={hidden}
          now={now}
          actions={actions}
          onSetStatus={status => onSetStatus(current.question, status)}
          onPreview={onPreview}
          onUnlink={onUnlink}
          onEditAnswer={onEditAnswer}
          onWriteAnswer={onWriteAnswer}
        />
      ) : (
        <Loading />
      )}
    </Drawer>
  );
}

function DetailBody({
  detail,
  hidden,
  now,
  actions,
  onSetStatus,
  onPreview,
  onUnlink,
  onEditAnswer,
  onWriteAnswer,
}: {
  detail: QuestionDetail;
  hidden: ReadonlySet<string>;
  now: number;
  actions: QuestionActions;
  onSetStatus(status: QuestionStatus): void;
  onPreview(link: PluginLink, contentRef: string, title: string): void;
  onUnlink(link: PluginLink, title: string | undefined): void;
  onEditAnswer(answer: QuestionAnswer): void;
  onWriteAnswer(): void;
}) {
  const { t } = useI18n(messages);
  const { question, events } = detail;
  const materials = detail.materials.filter(link => !hidden.has(link.id));
  const chats = detail.chats.filter(link => !hidden.has(link.id));
  const answers = detail.answers.filter(answer => !hidden.has(answer.link.id));
  const eventRefs = events.flatMap(event =>
    (event.type === "link" || event.type === "unlink") && event.ref ? [event.ref] : []
  );
  const refs = [...materials.map(link => link.to), ...chats.map(link => link.to)];
  const allRefs = uniqueRefs([
    ...refs,
    ...eventRefs,
    ...(detail.notebook ? [detail.notebook.to] : []),
  ]);
  const descriptions = useDescriptions(allRefs).data;
  const access = useSummaryAccess();
  const summaries = useSummaries(refs, access.granted).data;
  const counts: Counts = {};
  materials.forEach(link => {
    const kind = compositionOf(link.to);
    if (kind) counts[kind] = (counts[kind] ?? 0) + 1;
  });
  const notebookTitle =
    detail.notebook && descriptions?.get(refKey(detail.notebook.to))?.status === "ok"
      ? (descriptions.get(refKey(detail.notebook.to)) as { title: string }).title
      : null;

  return (
    <>
      <div role="radiogroup" aria-label={t("menu.status")} className="qs:grid qs:grid-cols-3 qs:gap-1">
        {STATUS_STEPS.map((status, idx) => {
          const on = question.status === status;
          return (
            <button
              key={status}
              type="button"
              role="radio"
              aria-checked={on}
              title={t("drawer.statusHotkey", { label: statusLabel(t, status), index: idx + 1 })}
              onClick={() => !on && onSetStatus(status)}
              className={cx(
                "qs:ease-tau-out qs:flex qs:h-8 qs:items-center qs:gap-[7px] qs:rounded-[9px] qs:border qs:px-2.5 qs:text-[12.5px] qs:outline-none qs:transition-[background,color,border-color] qs:duration-150 qs:focus-visible:shadow-[var(--tau-focus-ring)]",
                !on && "qs:border-line-1 qs:text-ink-3 qs:hover:bg-hover qs:hover:text-ink-1",
                on && "qs:border-transparent qs:font-semibold",
                on && status === "not_started" && "qs:bg-hover qs:text-ink-1",
                on && status === "in_progress" && "qs:bg-accent-soft qs:text-accent-text",
                on && status === "resolved" && "qs:bg-ok-soft qs:text-ok"
              )}
            >
              <StatusRing status={status} size="sm" />
              {statusLabel(t, status)}
            </button>
          );
        })}
      </div>

      {detail.notebook && (
        <button
          type="button"
          onClick={() => void actions.open(detail.notebook!.to)}
          className="qs:text-ink-2 qs:hover:text-ink-1 qs:hover:bg-hover qs:mt-2.5 qs:flex qs:w-full qs:items-center qs:gap-2 qs:rounded-[9px] qs:px-2.5 qs:py-1.5 qs:text-left qs:text-[12.5px] qs:outline-none qs:focus-visible:shadow-[var(--tau-focus-ring)]"
        >
          <FlaskConical className="qs:size-[14px] qs:shrink-0" strokeWidth={1.75} />
          <span className="qs:min-w-0 qs:truncate">
            {notebookTitle
              ? t("drawer.notebookLinked", { title: notebookTitle })
              : t("drawer.notebookDeleted")}
          </span>
        </button>
      )}

      <SectionTitle>{t("drawer.background")}</SectionTitle>
      <div className="qs:border-line-1 qs:focus-within:border-ink-3 qs:min-h-16 qs:rounded-[10px] qs:border qs:px-3 qs:py-1.5 qs:transition-[border-color] qs:duration-150">
        <ContentEditor
          contentRef={question.contentRef}
          kit="compact"
          placeholder={t("drawer.backgroundPlaceholder")}
        />
      </div>

      <SectionTitle
        action={
          <Button
            variant="ghost"
            size="sm"
            icon={answers.length ? Plus : PenLine}
            onClick={onWriteAnswer}
          >
            {answers.length ? t("drawer.writeAnother") : t("drawer.writeAnswer")}
          </Button>
        }
      >
        {t("drawer.answers")}
      </SectionTitle>
      {answers.length ? (
        <div className="qs:flex qs:flex-col qs:gap-1.5">
          {answers.map(answer => (
            <RefRow
              key={answer.link.id}
              icon={TARGET_META.answer.icon}
              title={answer.entity.title || t("answer.untitled")}
              meta={[
                kindLabel(t, "answer"),
                relativeDay(answer.entity.updatedAt, now, t),
                ...answer.meta.projections.map(ref =>
                  t("answer.alsoKind", { kind: kindLabel(t, compositionOf(ref) ?? "card") })
                ),
              ].join(" · ")}
              onClick={() => onEditAnswer(answer)}
              actions={[
                { title: t("common.edit"), icon: PenLine, onClick: () => onEditAnswer(answer) },
                {
                  title: t("answer.delete"),
                  icon: Unlink,
                  onClick: () => onUnlink(answer.link, answer.entity.title),
                },
              ]}
            />
          ))}
        </div>
      ) : (
        <Hint>
          {question.status === "resolved"
            ? t("drawer.hintResolved")
            : materials.length >= 2
              ? t("drawer.hintMaterials", { count: materials.length })
              : t("drawer.hintEmpty")}
        </Hint>
      )}

      <SectionTitle
        action={
          <span className="qs:flex qs:items-center qs:gap-2">
            {refs.length > 0 && !access.granted && (
              <Button variant="ghost" size="sm" icon={Eye} onClick={() => void access.request()}>
                {t("drawer.showSummaries")}
              </Button>
            )}
            <Composition counts={counts} />
          </span>
        }
        count={materials.length || undefined}
      >
        {t("drawer.materials")}
      </SectionTitle>
      {materials.length ? (
        <div className="qs:flex qs:flex-col qs:gap-1.5">
          {materials.map(link => (
            <MaterialRow
              key={link.id}
              link={link}
              description={descriptions?.get(refKey(link.to))}
              summary={summaries?.get(refKey(link.to))}
              now={now}
              actions={actions}
              onPreview={onPreview}
              onUnlink={onUnlink}
            />
          ))}
        </div>
      ) : (
        <Hint icon>{t("drawer.materialsEmpty")}</Hint>
      )}
      {chats.length > 0 && (
        <>
          <SectionTitle count={chats.length}>{t("drawer.chats")}</SectionTitle>
          <div className="qs:flex qs:flex-col qs:gap-1.5">
            {chats.map(link => (
              <ChatRow
                key={link.id}
                link={link}
                description={descriptions?.get(refKey(link.to))}
                summary={summaries?.get(refKey(link.to))}
                now={now}
                actions={actions}
                onUnlink={onUnlink}
              />
            ))}
          </div>
        </>
      )}
      <div className="qs:mt-2.5 qs:flex qs:flex-wrap qs:gap-1.5">
        <Button variant="secondary" size="sm" icon={Layers} onClick={() => void actions.writeCard(question)}>
          {t("menu.writeCard")}
        </Button>
        <Menu
          trigger={
            <Button variant="secondary" size="sm" icon={Plus}>
              {t("drawer.create")}
              <ChevronDown className="qs:size-3" strokeWidth={1.75} />
            </Button>
          }
        >
          <Menu.Group>{t("drawer.createMenu")}</Menu.Group>
          {(
            [
              ["article", FileText],
              ["whiteboard", Presentation],
              ["project", FolderKanban],
            ] as [CreatableKind, typeof FileText][]
          ).map(([kind, Icon]) => (
            <Menu.Item
              key={kind}
              icon={<Icon className={MENU_ICON} strokeWidth={1.75} />}
              onSelect={() => void actions.createMaterial(question, kind)}
            >
              {kindLabel(t, kind)}
            </Menu.Item>
          ))}
          <Menu.Separator />
          <Menu.Item icon={<PenLine className={MENU_ICON} strokeWidth={1.75} />} onSelect={onWriteAnswer}>
            {t("kind.answer")}
          </Menu.Item>
        </Menu>
        <Button variant="secondary" size="sm" icon={MessageCircle} onClick={() => void actions.discuss(detail)}>
          {t("drawer.discuss")}
        </Button>
        <Button variant="secondary" size="sm" icon={Link2} onClick={() => void actions.linkExisting(question)}>
          {t("drawer.linkExisting")}
          <kbd className="qs:bg-hover qs:text-ink-2 qs:ml-0.5 qs:rounded-[4px] qs:px-1 qs:font-mono qs:text-[10px]">
            L
          </kbd>
        </Button>
      </div>

      <SectionTitle
        action={
          <span className="qs:text-ink-3 qs:text-[11.5px] qs:font-normal">
            {trajectoryStats(
              question,
              materials.length + chats.length + answers.length,
              events,
              now,
              t
            )}
          </span>
        }
      >
        {t("drawer.trajectory")}
      </SectionTitle>
      <TrajectoryWithNotes detail={detail} descriptions={descriptions} now={now} actions={actions} />
    </>
  );
}

function TrajectoryWithNotes({
  detail,
  descriptions,
  now,
  actions,
}: {
  detail: QuestionDetail;
  descriptions: ReadonlyMap<string, PluginEntityDescription> | undefined;
  now: number;
  actions: QuestionActions;
}) {
  const { data } = useRuntime();
  return (
    <Trajectory
      events={detail.events}
      descriptions={descriptions}
      now={now}
      onOpen={ref => void actions.open(ref, ref.kind === "chat-session" ? "dock" : undefined)}
      onAddNote={async text => {
        await data.addNote(detail.question.id, text);
        await actions.refresh();
      }}
    />
  );
}

const uniqueRefs = (refs: PluginEntityRef[]) => {
  const seen = new Set<string>();
  return refs.filter(ref => {
    const key = refKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function MaterialRow({
  link,
  description,
  summary,
  now,
  actions,
  onPreview,
  onUnlink,
}: {
  link: PluginLink;
  description: PluginEntityDescription | undefined;
  summary: ReturnType<typeof useSummaries>["data"] extends Map<string, infer S> | undefined ? S | undefined : never;
  now: number;
  actions: QuestionActions;
  onPreview(link: PluginLink, contentRef: string, title: string): void;
  onUnlink(link: PluginLink, title: string | undefined): void;
}) {
  const { t } = useI18n(messages);
  const kind = compositionOf(link.to) ?? "card";
  const meta = TARGET_META[kind];
  const label = kindLabel(t, kind);
  const missing = description?.status === "missing";
  const title = description?.status === "ok" ? description.title || t("ref.untitledKind", { kind: label }) : label;
  const info = [
    label,
    summaryMeta(t, summary),
    t("date.linked", { day: relativeDay(link.createdAt, now, t) }),
  ]
    .filter(Boolean)
    .join(" · ");
  const openIt = () => void actions.open(link.to);
  return (
    <RefRow
      icon={meta.icon}
      title={missing ? t("ref.kindDeleted", { kind: label }) : title}
      excerpt={summary?.excerpt}
      meta={missing ? t("ref.missingHint") : info}
      missing={missing}
      onClick={summary?.contentRef ? () => onPreview(link, summary.contentRef!, title) : openIt}
      actions={[
        ...(missing ? [] : [{ title: t("ref.openKind", { kind: label }), icon: ExternalLink, onClick: openIt }]),
        { title: t("ref.unlink"), icon: Unlink, onClick: () => onUnlink(link, title) },
      ]}
    />
  );
}

function ChatRow({
  link,
  description,
  summary,
  now,
  actions,
  onUnlink,
}: {
  link: PluginLink;
  description: PluginEntityDescription | undefined;
  summary: RefSummary | undefined;
  now: number;
  actions: QuestionActions;
  onUnlink(link: PluginLink, title: string | undefined): void;
}) {
  const { t } = useI18n(messages);
  const missing = description?.status === "missing";
  const title =
    description?.status === "ok" ? description.title || t("chat.untitled") : t("kind.chat");
  const info = [
    link.data.initiated === true ? t("chat.initiatedHere") : "",
    summaryMeta(t, summary),
    t("date.linked", { day: relativeDay(link.createdAt, now, t) }),
  ]
    .filter(Boolean)
    .join(" · ");
  const dockable = summary?.dockable !== false;
  const messageIds = Array.isArray(link.data.messageIds) ? link.data.messageIds : [];
  return (
    <RefRow
      icon={MessageCircle}
      title={missing ? t("chat.deleted") : title}
      meta={missing ? t("chat.missingHint") : info}
      missing={missing}
      onClick={dockable ? () => void actions.open(link.to, "dock") : undefined}
      actions={[
        ...(missing || !dockable
          ? []
          : [
              { title: t("chat.openDock"), icon: PanelRight, onClick: () => void actions.open(link.to, "dock") },
              {
                title: messageIds.length ? t("chat.openAtMessage") : t("chat.open"),
                icon: ExternalLink,
                onClick: () => void actions.open(link.to),
              },
            ]),
        { title: t("ref.unlink"), icon: Unlink, onClick: () => onUnlink(link, title) },
      ]}
    />
  );
}

/** 标题即改即存：失焦或回车提交，Esc 放弃 */
function TitleEditor({ question }: { question: Question }) {
  const { t } = useI18n(messages);
  const { data, queryClient } = useRuntime();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(question.title);
  useEffect(() => setText(question.title), [question.title]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const commit = () => {
    const next = text.trim();
    if (!next) return setText(question.title);
    if (next === question.title) return;
    data
      .renameQuestion(question.id, next)
      .then(() => queryClient.invalidateQueries({ queryKey: ["questions"] }))
      .catch(() => toast.error(t("toast.titleSaveFailed")));
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      value={text}
      spellCheck={false}
      aria-label={t("page.title")}
      onChange={e => setText(e.target.value.replace(/\n/g, ""))}
      onBlur={commit}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.stopPropagation();
          setText(question.title);
          requestAnimationFrame(() => ref.current?.blur());
        }
      }}
      className="qs:block qs:min-w-0 qs:flex-1 qs:resize-none qs:overflow-hidden qs:bg-transparent qs:text-[16px] qs:font-semibold qs:leading-[1.5] qs:tracking-[-0.005em] qs:outline-none"
    />
  );
}
