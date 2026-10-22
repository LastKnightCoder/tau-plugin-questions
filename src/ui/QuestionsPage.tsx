/**
 * 问题页：一整张纸，纸顶是标题、状态计数与快速收集，纸内三段列表占满宽度；
 * 点问题在右侧打开非模态详情抽屉，再点同一行或 Esc 关闭。
 * 参数：groupId 按分组筛选（侧栏子项）；selectedId 定位到问题，answer 同时打开它的独立答案。
 *
 * 删除问题、解除关联、删除答案不二次确认：立即隐藏并给撤销提示，提示关闭后落库；改状态可撤销。
 * 键盘（本页显示、焦点不在输入框与浮层内）：↑↓ 切换、1/2/3 设状态、L 关联材料。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ArrowRightLeft, FlaskConical, Layers, Link2, PenLine, Plus, Trash2 } from "lucide-react";
import type { PluginLink, PluginPageProps } from "@tau/plugins";
import { Button, Loading, Menu, isEditableTarget, toast } from "@tau/ui";
import { useRuntime } from "../runtime";
import { ANSWER_ROLE, CHAT_ROLE, type Question, type QuestionStatus } from "../data/model";
import { questionActions } from "./actions";
import { AnswerDialog, type AnswerDialogState } from "./AnswerDialog";
import { CaptureBar } from "./CaptureBar";
import { GroupDot, KeyHint, MENU_ICON, StatusRing } from "./bits";
import { MaterialPreview, type MaterialPreviewState } from "./MaterialPreview";
import { QuestionDrawer } from "./QuestionDrawer";
import { QuestionList } from "./QuestionList";
import { SECTION_ORDER, STATUS_META, STATUS_STEPS, sectionize, statusCounts } from "./model";
import {
  detailKey,
  loadQuestionDetail,
  useQuestionDetail,
  useQuestionsSnapshot,
  type QuestionDetail,
} from "./queries";
import { useDeferredActions } from "./useDeferredActions";

/** 列表行拖到侧栏分组上移动问题 */
export const QUESTION_DRAG = "question";

const param = (value: unknown) => (typeof value === "string" && value ? value : null);

export function QuestionsPage({ params, pageContext }: PluginPageProps) {
  const runtime = useRuntime();
  const { context, data } = runtime;
  const actions = useMemo(() => questionActions(runtime), [runtime]);
  const snapshotQuery = useQuestionsSnapshot();
  const snapshot = snapshotQuery.data;
  const now = useMinuteNow();
  const deferred = useDeferredActions();

  // 分组已被删除（含其他窗口删除）时视同「全部」
  const groupParam = param(params.groupId);
  const groupFilter =
    groupParam && snapshot?.groups.some(g => g.id === groupParam) ? groupParam : null;
  const [selectedId, setSelectedId] = useState<string | null>(param(params.selectedId));
  const [collapsed, setCollapsed] = useState<ReadonlySet<QuestionStatus>>(
    () => new Set<QuestionStatus>(["resolved"])
  );
  const [answerDialog, setAnswerDialog] = useState<AnswerDialogState | null>(null);
  const [preview, setPreview] = useState<MaterialPreviewState | null>(null);
  const captureRef = useRef<HTMLInputElement>(null);

  const detailQuery = useQuestionDetail(selectedId);
  const detail = detailQuery.data?.question.id === selectedId ? detailQuery.data : null;

  /* 带 selectedId 进入（或再次进入）时定位：展开所在分段；带 answer 时打开那份答案 */
  const located = useRef<string | null>(null);
  useEffect(() => {
    const id = param(params.selectedId);
    const key = `${id}:${param(params.answer) ?? ""}`;
    if (id == null || !snapshot || located.current === key) return;
    const target = snapshot.questions.find(q => q.id === id);
    if (!target) return;
    located.current = key;
    setSelectedId(id);
    setCollapsed(prev => {
      if (!prev.has(target.status)) return prev;
      const next = new Set(prev);
      next.delete(target.status);
      return next;
    });
  }, [params.selectedId, params.answer, snapshot]);

  const openedAnswer = useRef<string | null>(null);
  useEffect(() => {
    const answerId = param(params.answer);
    if (!answerId || !detail || openedAnswer.current === answerId) return;
    const answer = detail.answers.find(item => item.entity.id === answerId);
    if (!answer) return;
    openedAnswer.current = answerId;
    setAnswerDialog({
      questionId: detail.question.id,
      questionTitle: detail.question.title,
      answer,
      fresh: false,
    });
  }, [params.answer, detail]);

  const derived = useMemo(() => {
    if (!snapshot) return null;
    const live = snapshot.questions.filter(q => !deferred.pending.has(`q:${q.id}`));
    const visible = groupFilter == null ? live : live.filter(q => q.groupId === groupFilter);
    const sections = sectionize(visible);
    return {
      sections,
      counts: statusCounts(visible),
      order: sections.filter(s => !collapsed.has(s.status)).flatMap(s => s.items),
      groupMap: new Map(snapshot.groups.map(g => [g.id, g])),
      byId: new Map(live.map(q => [q.id, q])),
    };
  }, [snapshot, groupFilter, collapsed, deferred.pending]);

  /* 不默认选中；选中项消失（删除 / 筛走）时清空 */
  useEffect(() => {
    if (!derived || selectedId == null) return;
    const q = derived.byId.get(selectedId);
    if (q && (groupFilter == null || q.groupId === groupFilter)) return;
    setSelectedId(null);
  }, [derived, selectedId, groupFilter]);

  /* 告诉 AI 用户正在看哪个问题 */
  useEffect(() => {
    const registration = pageContext.register(() => ({
      groupId: groupFilter,
      selectedQuestion: detail ? { id: detail.question.id, title: detail.question.title } : null,
    }));
    return () => void registration.dispose();
  }, [pageContext, groupFilter, detail]);

  /* ---------- 操作 ---------- */

  const setStatus = async (question: Question, status: QuestionStatus) => {
    if (question.status === status) return;
    const previous = question.status;
    try {
      const { eventId } = await data.setStatus(question.id, status);
      await actions.refresh();
      toast.success(`已标为「${STATUS_META[status].label}」`, {
        action: {
          label: "撤销",
          onClick: () =>
            void data
              .setStatus(question.id, previous, eventId ? { revertEventId: eventId } : {})
              .then(actions.refresh)
              .catch(() => toast.error("撤销失败")),
        },
      });
    } catch {
      toast.error("修改状态失败");
    }
  };

  const move = (question: Question, groupId: string) => {
    data
      .moveToGroup(question.id, groupId)
      .then(async () => {
        await actions.refresh();
        toast.success(`已移到「${derived?.groupMap.get(groupId)?.title ?? ""}」`);
      })
      .catch(() => toast.error("移动失败"));
  };

  const remove = (question: Question) =>
    deferred.schedule(`q:${question.id}`, "已删除问题（材料本身不受影响）", async () => {
      await data.deleteQuestion(question.id);
      await actions.refresh();
    });

  const unlink = (link: PluginLink, title: string | undefined) => {
    if (!detail) return;
    const questionId = detail.question.id;
    const answer =
      link.role === ANSWER_ROLE ? detail.answers.find(item => item.link.id === link.id) : undefined;
    const message = answer
      ? "已删除答案"
      : link.role === CHAT_ROLE
        ? "已解除关联（对话仍保留）"
        : "已解除关联（材料仍保留在库中）";
    deferred.schedule(`l:${link.id}`, message, async () => {
      if (answer) await data.deleteAnswer(questionId, answer);
      else await data.unlink(questionId, link, title);
      await actions.refresh();
    });
  };

  /** 先建好空答案再打开编辑，关闭时仍为空就撤掉 */
  const writeAnswer = async (question: Question) => {
    try {
      const id = await data.createAnswer(question.id, { title: "" });
      const answer = (await data.listAnswers(question.id)).find(item => item.entity.id === id);
      await actions.refresh();
      if (answer)
        setAnswerDialog({ questionId: question.id, questionTitle: question.title, answer, fresh: true });
    } catch {
      toast.error("新建答案失败");
    }
  };

  const capture = async (title: string, group: { id: string; title: string } | undefined) => {
    const question = await data.createQuestion({ title, ...(group ? { groupId: group.id } : {}) });
    // 等列表重新拉取后再选中，避免「选中项不在列表」被清空
    await runtime.queryClient.refetchQueries({ queryKey: ["questions", "snapshot"] });
    setSelectedId(question.id);
    setCollapsed(prev => {
      const next = new Set(prev);
      next.delete("not_started");
      return next;
    });
    toast.success(`已收集到「${group?.title ?? "未分类"}」`);
  };

  /** 菜单里对非当前问题的操作要用它的详情：先选中，再从缓存或重新读取 */
  const withDetail = async (question: Question, run: (detail: QuestionDetail) => unknown) => {
    setSelectedId(question.id);
    const loaded = await runtime.queryClient.fetchQuery({
      queryKey: detailKey(question.id),
      queryFn: () => loadQuestionDetail(data, question.id),
    });
    if (loaded) await run(loaded);
  };

  const renderStatusMenu = (question: Question) => (
    <>
      <Menu.Group>状态</Menu.Group>
      {STATUS_STEPS.map(status => (
        <Menu.Item
          key={status}
          icon={<StatusRing status={status} size="sm" />}
          onSelect={() => void setStatus(question, status)}
        >
          {STATUS_META[status].label}
        </Menu.Item>
      ))}
    </>
  );

  const renderMenu = (question: Question) => (
    <>
      <Menu.Item
        icon={<Layers className={MENU_ICON} strokeWidth={1.75} />}
        onSelect={() => {
          setSelectedId(question.id);
          void actions.writeCard(question);
        }}
      >
        写一张卡片
      </Menu.Item>
      <Menu.Item
        icon={<PenLine className={MENU_ICON} strokeWidth={1.75} />}
        onSelect={() => {
          setSelectedId(question.id);
          void writeAnswer(question);
        }}
      >
        写答案
      </Menu.Item>
      <Menu.Item
        icon={<Link2 className={MENU_ICON} strokeWidth={1.75} />}
        kbd="L"
        onSelect={() => {
          setSelectedId(question.id);
          void actions.linkExisting(question);
        }}
      >
        关联已有材料…
      </Menu.Item>
      <Menu.Item
        icon={<FlaskConical className={MENU_ICON} strokeWidth={1.75} />}
        onSelect={() => void withDetail(question, actions.upgrade)}
      >
        以此立项…
      </Menu.Item>
      <Menu.Separator />
      <Menu.Submenu label="状态" icon={<StatusRing status={question.status} size="sm" />}>
        {renderStatusMenu(question)}
      </Menu.Submenu>
      {(snapshot?.groups.length ?? 0) > 1 && (
        <Menu.Submenu
          label="移动到"
          icon={<ArrowRightLeft className={MENU_ICON} strokeWidth={1.75} />}
        >
          {snapshot!.groups
            .filter(g => g.id !== question.groupId)
            .map(g => (
              <Menu.Item key={g.id} icon={<GroupDot tone={g.tone} />} onSelect={() => move(question, g.id)}>
                {g.title}
              </Menu.Item>
            ))}
        </Menu.Submenu>
      )}
      <Menu.Separator />
      <Menu.Item
        danger
        icon={<Trash2 className={MENU_ICON} strokeWidth={1.75} />}
        onSelect={() => remove(question)}
      >
        删除问题
      </Menu.Item>
    </>
  );

  /* ---------- 键盘 ---------- */
  const keyState = useRef({ derived, selectedId, detail });
  keyState.current = { derived, selectedId, detail };
  const setStatusRef = useRef(setStatus);
  setStatusRef.current = setStatus;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.defaultPrevented) return;
      if (!pageContext.isActive()) return;
      const target = e.target;
      if (
        isEditableTarget(target) ||
        (target instanceof Element &&
          target.closest("[role=menu], [role=dialog], [contenteditable=true]"))
      )
        return;
      const { derived: d, selectedId: selected, detail: current } = keyState.current;
      if (!d) return;
      const index = d.order.findIndex(q => q.id === selected);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next =
          d.order[Math.max(0, Math.min(d.order.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) setSelectedId(next.id);
      } else if (current && /^[1-3]$/.test(e.key)) {
        void setStatusRef.current(current.question, STATUS_STEPS[Number(e.key) - 1]);
      } else if (current && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        void actions.linkExisting(current.question);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pageContext, actions]);

  const closeDrawer = useCallback(() => setSelectedId(null), []);

  if (snapshotQuery.isError)
    return (
      <div className="qs:text-ink-3 qs:grid qs:h-full qs:place-items-center qs:text-[13px]">
        问题数据读取失败
      </div>
    );
  if (!snapshot || !derived) return <Loading />;

  const groups = snapshot.groups;
  const defaultGroup = groups.find(g => g.isDefault) ?? groups[0];
  const fallbackGroup =
    groupFilter != null ? (derived.groupMap.get(groupFilter) ?? defaultGroup) : defaultGroup;
  const filterTitle = groupFilter != null ? derived.groupMap.get(groupFilter)?.title : null;
  const hidden = new Set(
    [...(detail?.materials ?? []), ...(detail?.chats ?? []), ...(detail?.answers.map(a => a.link) ?? [])]
      .filter(link => deferred.pending.has(`l:${link.id}`))
      .map(link => link.id)
  );

  return (
    <div className="qs:mx-auto qs:flex qs:h-full qs:min-h-0 qs:w-full qs:max-w-[1720px] qs:flex-col qs:px-4 qs:pb-4 qs:pt-1">
      <div className="qs:bg-surface qs:shadow-card qs:rounded-tau-lg qs:flex qs:min-h-0 qs:flex-1 qs:flex-col qs:overflow-hidden">
        <div className="qs:flex qs:flex-none qs:flex-col qs:px-8 qs:pt-5">
          <div className="qs:mb-3 qs:flex qs:h-10 qs:flex-none qs:items-center qs:gap-3">
            <h1 className="qs:text-tau-title-lg qs:shrink-0 qs:whitespace-nowrap qs:font-semibold qs:tracking-[-0.01em]">
              {filterTitle ?? "问题"}
            </h1>
            <span className="qs:text-ink-2 qs:text-tau-meta qs:w-0 qs:flex-1 qs:truncate qs:whitespace-nowrap qs:tabular-nums">
              {SECTION_ORDER.map((status, i) => (
                <span key={status}>
                  {i > 0 && " · "}
                  {STATUS_META[status].label}{" "}
                  <b className="qs:text-ink-1 qs:font-semibold">{derived.counts[status]}</b>
                </span>
              ))}
            </span>
            <Button
              variant="primary"
              size="sm"
              icon={Plus}
              className="qs:shrink-0 qs:whitespace-nowrap"
              onClick={() => captureRef.current?.focus()}
            >
              新建问题
            </Button>
          </div>
          <CaptureBar
            groups={groups}
            fallbackGroup={fallbackGroup}
            inputRef={captureRef}
            onSubmit={capture}
          />
        </div>

        <div className="qs:relative qs:grid qs:min-h-0 qs:flex-1 qs:grid-cols-[minmax(0,1fr)]">
          <div className="qs:flex qs:min-h-0 qs:flex-col qs:px-[22px] qs:pb-4">
            <QuestionList
              sections={derived.sections}
              groups={derived.groupMap}
              showGroup={groupFilter == null}
              selectedId={selectedId}
              collapsed={collapsed}
              now={now}
              onToggleSection={status =>
                setCollapsed(prev => {
                  const next = new Set(prev);
                  if (next.has(status)) next.delete(status);
                  else next.add(status);
                  return next;
                })
              }
              onSelect={q => setSelectedId(prev => (prev === q.id ? null : q.id))}
              renderStatusMenu={renderStatusMenu}
              renderMenu={renderMenu}
              rowProps={question => ({
                draggable: true,
                onDragStart: (e: DragEvent) => {
                  e.dataTransfer.setData(context.sidebar.dragType(QUESTION_DRAG), question.id);
                  e.dataTransfer.effectAllowed = "move";
                },
              })}
              empty={
                <p className="qs:text-ink-3 qs:py-10 qs:text-center qs:text-[12.5px]">
                  {groupFilter == null
                    ? "还没有问题。学习时冒出的疑问，在上面记下来。"
                    : "这个分组还没有问题。"}
                </p>
              }
            />
            <div className="qs:text-ink-3 qs:flex qs:flex-none qs:flex-wrap qs:gap-3 qs:px-2.5 qs:pt-2 qs:text-[11.5px]">
              <KeyHint keys={["↑", "↓"]} label="切换" />
              <KeyHint keys={["1", "2", "3"]} label="设状态" />
              <KeyHint keys={["L"]} label="关联材料" />
              <KeyHint keys={["Esc"]} label="关闭详情" />
            </div>
          </div>

          <QuestionDrawer
            open={selectedId != null}
            detail={detail}
            groups={groups}
            hidden={hidden}
            now={now}
            pageContext={pageContext}
            actions={actions}
            onSetStatus={(question, status) => void setStatus(question, status)}
            onMove={move}
            onPreview={(link, contentRef, title) => setPreview({ link, contentRef, title })}
            onUnlink={unlink}
            onEditAnswer={answer =>
              detail &&
              setAnswerDialog({
                questionId: detail.question.id,
                questionTitle: detail.question.title,
                answer,
                fresh: false,
              })
            }
            onWriteAnswer={() => detail && void writeAnswer(detail.question)}
            renderMenu={renderMenu}
            onClose={closeDrawer}
          />
        </div>
      </div>

      <MaterialPreview
        state={preview}
        onClose={() => setPreview(null)}
        onOpen={link => void actions.open(link.to)}
      />
      <AnswerDialog
        state={answerDialog}
        actions={actions}
        now={now}
        onClose={() => setAnswerDialog(null)}
      />
    </div>
  );
}

/** 相对时间（今天 / 昨天）跨零点后自动刷新 */
function useMinuteNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
