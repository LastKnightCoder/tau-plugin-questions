/**
 * 问题列表：按「探究中 / 待探究 / 已解答」三段，段头可折叠（已解答默认折叠）。
 * 行 = 状态环（点击弹状态菜单）+ 问题 + 元信息（分组 · 材料构成 · 时间）；右键 / 更多为问题菜单。
 */
import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { ContextMenu, IconButton, Menu } from "@tau/ui";
import type { Question, QuestionGroup, QuestionStatus } from "../data/model";
import { Composition, GroupDot, StatusRing } from "./bits";
import { STATUS_META, cx, relativeDay, type QuestionSection } from "./model";

export function QuestionList({
  sections,
  groups,
  showGroup,
  selectedId,
  collapsed,
  now,
  onToggleSection,
  onSelect,
  renderStatusMenu,
  renderMenu,
  rowProps,
  empty,
}: {
  sections: QuestionSection[];
  groups: ReadonlyMap<string, QuestionGroup>;
  showGroup: boolean;
  selectedId: string | null;
  collapsed: ReadonlySet<QuestionStatus>;
  now: number;
  onToggleSection(status: QuestionStatus): void;
  onSelect(question: Question): void;
  renderStatusMenu(question: Question): ReactNode;
  renderMenu(question: Question): ReactNode;
  /** 行上的额外属性（如拖到侧边栏分组） */
  rowProps?(question: Question): Record<string, unknown>;
  empty: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  /* 键盘切换选中后滚入视野 */
  useEffect(() => {
    if (selectedId == null) return;
    listRef.current
      ?.querySelector(`[data-question="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="问题"
      className="qs:-mr-1.5 qs:mt-2 qs:min-h-0 qs:flex-1 qs:overflow-y-auto qs:pb-2 qs:pr-1.5"
    >
      {sections.length === 0
        ? empty
        : sections.map(section => {
            const folded = collapsed.has(section.status);
            return (
              <div key={section.status}>
                <button
                  type="button"
                  onClick={() => onToggleSection(section.status)}
                  aria-expanded={!folded}
                  className="qs:text-ink-2 qs:flex qs:w-full qs:items-center qs:gap-2 qs:px-2 qs:pb-1.5 qs:pt-3.5 qs:text-left qs:text-[12.5px] qs:font-semibold"
                >
                  <ChevronDown
                    className={cx(
                      "qs:text-ink-3 qs:ease-tau-out qs:size-[13px] qs:transition-transform qs:duration-200",
                      folded && "qs:-rotate-90"
                    )}
                    strokeWidth={1.75}
                  />
                  {STATUS_META[section.status].label}
                  <span className="qs:text-ink-3 qs:font-normal qs:tabular-nums">
                    {section.items.length}
                  </span>
                  <span className="qs:text-ink-3 qs:ml-1 qs:text-[12px] qs:font-normal">
                    {STATUS_META[section.status].hint}
                  </span>
                </button>
                {!folded &&
                  section.items.map(question => (
                    <div key={question.id} className="qs:pb-1">
                      <QuestionRow
                        question={question}
                        group={groups.get(question.groupId)}
                        showGroup={showGroup}
                        selected={question.id === selectedId}
                        now={now}
                        onSelect={() => onSelect(question)}
                        statusMenu={renderStatusMenu(question)}
                        menu={renderMenu(question)}
                        extra={rowProps?.(question)}
                      />
                    </div>
                  ))}
              </div>
            );
          })}
    </div>
  );
}

function QuestionRow({
  question,
  group,
  showGroup,
  selected,
  now,
  onSelect,
  statusMenu,
  menu,
  extra,
}: {
  question: Question;
  group: QuestionGroup | undefined;
  showGroup: boolean;
  selected: boolean;
  now: number;
  onSelect(): void;
  statusMenu: ReactNode;
  menu: ReactNode;
  extra?: Record<string, unknown>;
}) {
  const time =
    question.status === "resolved"
      ? `${relativeDay(question.resolvedTime ?? question.updatedAt, now)}解答`
      : relativeDay(question.activityAt, now);
  return (
    <ContextMenu content={menu}>
      <div
        {...extra}
        data-question={question.id}
        role="option"
        aria-selected={selected}
        tabIndex={-1}
        onClick={onSelect}
        className={cx(
          "qs:group/row qs:flex qs:cursor-default qs:items-start qs:gap-[11px] qs:rounded-[11px] qs:px-2.5 qs:py-[9px] qs:outline-none",
          selected ? "qs:bg-selected" : "qs:hover:bg-hover"
        )}
      >
        <Menu
          trigger={
            <button
              type="button"
              title="设置状态"
              onClick={e => e.stopPropagation()}
              className="qs:mt-[3px] qs:rounded-full qs:outline-none qs:hover:shadow-[0_0_0_3px_var(--tau-bg-hover)] qs:focus-visible:shadow-[var(--tau-focus-ring)]"
            >
              <StatusRing status={question.status} />
            </button>
          }
        >
          {statusMenu}
        </Menu>
        <div className="qs:min-w-0 qs:flex-1">
          <div
            className={cx(
              "qs:text-[13.5px] qs:leading-[1.55]",
              question.status === "resolved" ? "qs:text-ink-2" : "qs:text-ink-1"
            )}
          >
            {question.title}
          </div>
          <div className="qs:text-ink-3 qs:mt-[3px] qs:flex qs:items-center qs:gap-2.5 qs:text-[11.5px]">
            {showGroup && group && (
              <span className="qs:inline-flex qs:items-center qs:gap-[5px]">
                <GroupDot tone={group.tone} />
                {group.title}
              </span>
            )}
            <Composition counts={question.composition} />
            <span>{time}</span>
          </div>
        </div>
        <Menu
          align="end"
          trigger={
            <IconButton
              title="更多"
              onClick={e => e.stopPropagation()}
              className={cx(
                "qs:size-[22px] qs:shrink-0 qs:rounded-[6px] qs:opacity-0 qs:focus-visible:opacity-100 qs:group-hover/row:opacity-100",
                selected && "qs:opacity-100"
              )}
            >
              <MoreHorizontal className="qs:size-[13px]" strokeWidth={1.75} />
            </IconButton>
          }
        >
          {menu}
        </Menu>
      </div>
    </ContextMenu>
  );
}
