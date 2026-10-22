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
  type PluginEntityDescription,
  type PluginEntityRef,
  type PluginLink,
  type PluginPageContext,
} from "@tau/plugins";
import { Button, Drawer, IconButton, Loading, Menu, toast, useRetainedValue } from "@tau/ui";
import { useRuntime } from "../runtime";
import { compositionOf, type Composition as Counts, type Question, type QuestionGroup, type QuestionStatus } from "../data/model";
import type { QuestionAnswer } from "../data/questions";
import type { CreatableKind, QuestionActions } from "./actions";
import { Composition, GroupDot, Hint, MENU_ICON, SectionTitle, StatusRing } from "./bits";
import { RefRow } from "./RefRow";
import { Trajectory } from "./Trajectory";
import { STATUS_META, STATUS_STEPS, TARGET_META, cx, relativeDay, trajectoryStats } from "./model";
import {
  refKey,
  useDescriptions,
  useSummaries,
  useSummaryAccess,
  type QuestionDetail,
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
      label="问题详情"
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
                  {group?.title ?? "未分组"}
                  <ChevronDown className="qs:text-ink-3 qs:size-3" strokeWidth={1.75} />
                </button>
              }
            >
              <Menu.Group>移动到分组</Menu.Group>
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
            <span>{relativeDay(question.createdAt, now)}提出</span>
          </span>
        )
      }
      actions={
        question && (
          <Menu
            align="end"
            trigger={
              <IconButton title="更多">
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
      <div role="radiogroup" aria-label="状态" className="qs:grid qs:grid-cols-3 qs:gap-1">
        {STATUS_STEPS.map((status, idx) => {
          const on = question.status === status;
          return (
            <button
              key={status}
              type="button"
              role="radio"
              aria-checked={on}
              title={`${STATUS_META[status].label}（${idx + 1}）`}
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
              {STATUS_META[status].label}
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
            {notebookTitle ? `已立项 · Notebook「${notebookTitle}」` : "已立项 · Notebook 已删除"}
          </span>
        </button>
      )}

      <SectionTitle>背景</SectionTitle>
      <div className="qs:border-line-1 qs:focus-within:border-ink-3 qs:min-h-16 qs:rounded-[10px] qs:border qs:px-3 qs:py-1.5 qs:transition-[border-color] qs:duration-150">
        <ContentEditor
          contentRef={question.contentRef}
          kit="compact"
          placeholder="问题背景：在哪里遇到的、已经知道什么、卡在哪一步…"
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
            {answers.length ? "再写一段" : "写答案"}
          </Button>
        }
      >
        我的答案
      </SectionTitle>
      {answers.length ? (
        <div className="qs:flex qs:flex-col qs:gap-1.5">
          {answers.map(answer => (
            <RefRow
              key={answer.link.id}
              icon={TARGET_META.answer.icon}
              title={answer.entity.title || "未命名答案"}
              meta={[
                TARGET_META.answer.label,
                relativeDay(answer.entity.updatedAt, now),
                ...answer.meta.projections.map(ref => `也是${TARGET_META[compositionOf(ref) ?? "card"].label}`),
              ].join(" · ")}
              onClick={() => onEditAnswer(answer)}
              actions={[
                { title: "编辑", icon: PenLine, onClick: () => onEditAnswer(answer) },
                {
                  title: "删除答案",
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
            ? "已标为解答，但还没有用自己的话写下结论。"
            : materials.length >= 2
              ? `已经积累了 ${materials.length} 份材料。试着不看材料，用自己的话写下答案——写不出来的地方，就是还没弄懂的地方。`
              : "材料够了，就用自己的话把答案写下来。"}
        </Hint>
      )}

      <SectionTitle
        action={
          <span className="qs:flex qs:items-center qs:gap-2">
            {refs.length > 0 && !access.granted && (
              <Button variant="ghost" size="sm" icon={Eye} onClick={() => void access.request()}>
                显示摘要
              </Button>
            )}
            <Composition counts={counts} />
          </span>
        }
        count={materials.length || undefined}
      >
        探究材料
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
        <Hint icon>
          从这里开始探究：读到什么、想到什么，写成一张卡片挂上来；或者关联已有的卡片、文章、划线、对话。
        </Hint>
      )}
      {chats.length > 0 && (
        <>
          <SectionTitle count={chats.length}>探究对话</SectionTitle>
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
          写一张卡片
        </Button>
        <Menu
          trigger={
            <Button variant="secondary" size="sm" icon={Plus}>
              新建
              <ChevronDown className="qs:size-3" strokeWidth={1.75} />
            </Button>
          }
        >
          <Menu.Group>新建并挂到这个问题</Menu.Group>
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
              {TARGET_META[kind].label}
            </Menu.Item>
          ))}
          <Menu.Separator />
          <Menu.Item icon={<PenLine className={MENU_ICON} strokeWidth={1.75} />} onSelect={onWriteAnswer}>
            独立答案
          </Menu.Item>
        </Menu>
        <Button variant="secondary" size="sm" icon={MessageCircle} onClick={() => void actions.discuss(detail)}>
          围绕它聊
        </Button>
        <Button variant="secondary" size="sm" icon={Link2} onClick={() => void actions.linkExisting(question)}>
          关联已有
          <kbd className="qs:bg-hover qs:text-ink-2 qs:ml-0.5 qs:rounded-[4px] qs:px-1 qs:font-mono qs:text-[10px]">
            L
          </kbd>
        </Button>
      </div>

      <SectionTitle
        action={
          <span className="qs:text-ink-3 qs:text-[11.5px] qs:font-normal">
            {trajectoryStats(question, materials.length + chats.length + answers.length, events, now)}
          </span>
        }
      >
        探究轨迹
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
  const kind = compositionOf(link.to) ?? "card";
  const meta = TARGET_META[kind];
  const missing = description?.status === "missing";
  const title = description?.status === "ok" ? description.title || `无标题${meta.label}` : meta.label;
  const info = [meta.label, summary?.meta, `${relativeDay(link.createdAt, now)}关联`]
    .filter(Boolean)
    .join(" · ");
  const openIt = () => void actions.open(link.to);
  return (
    <RefRow
      icon={meta.icon}
      title={missing ? `${meta.label}已删除` : title}
      excerpt={summary?.excerpt}
      meta={missing ? "原内容已不存在，可解除关联" : info}
      missing={missing}
      onClick={summary?.contentRef ? () => onPreview(link, summary.contentRef!, title) : openIt}
      actions={[
        ...(missing ? [] : [{ title: `打开${meta.label}`, icon: ExternalLink, onClick: openIt }]),
        { title: "解除关联", icon: Unlink, onClick: () => onUnlink(link, title) },
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
  summary: { meta?: string; dockable?: boolean } | undefined;
  now: number;
  actions: QuestionActions;
  onUnlink(link: PluginLink, title: string | undefined): void;
}) {
  const missing = description?.status === "missing";
  const title = description?.status === "ok" ? description.title || "未命名对话" : "对话";
  const info = [
    link.data.initiated === true ? "由此发起" : "",
    summary?.meta,
    `${relativeDay(link.createdAt, now)}关联`,
  ]
    .filter(Boolean)
    .join(" · ");
  const dockable = summary?.dockable !== false;
  const messageIds = Array.isArray(link.data.messageIds) ? link.data.messageIds : [];
  return (
    <RefRow
      icon={MessageCircle}
      title={missing ? "对话已删除" : title}
      meta={missing ? "原对话已不存在，可解除关联" : info}
      missing={missing}
      onClick={dockable ? () => void actions.open(link.to, "dock") : undefined}
      actions={[
        ...(missing || !dockable
          ? []
          : [
              { title: "在侧栏打开", icon: PanelRight, onClick: () => void actions.open(link.to, "dock") },
              {
                title: messageIds.length ? "在对话页打开（定位到转出问题的消息）" : "在对话页打开",
                icon: ExternalLink,
                onClick: () => void actions.open(link.to),
              },
            ]),
        { title: "解除关联", icon: Unlink, onClick: () => onUnlink(link, title) },
      ]}
    />
  );
}

/** 标题即改即存：失焦或回车提交，Esc 放弃 */
function TitleEditor({ question }: { question: Question }) {
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
      .catch(() => toast.error("保存标题失败"));
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      value={text}
      spellCheck={false}
      aria-label="问题"
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
