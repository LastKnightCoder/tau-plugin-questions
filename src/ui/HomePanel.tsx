/**
 * 首页「探究中的问题」：最近有进展的在前，每行显示分组、材料构成与最近一步进展；点开进问题页并选中。
 */
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { QUESTIONS_KEY, useRuntime } from "../runtime";
import type { ActiveQuestion } from "../data/questions";
import { Composition, GroupDot, StatusRing } from "./bits";
import { cx, describeEvent, relativeDay } from "./model";

const LIMIT = 6;

export function HomePanel() {
  const { data, pages } = useRuntime();
  const query = useQuery({
    queryKey: [...QUESTIONS_KEY, "active", LIMIT],
    queryFn: () => data.listActive(LIMIT),
  });
  if (!query.data) return null;
  const items = query.data;
  const now = Date.now();
  return (
    <div>
      {items.length > 0 ? (
        // 只有 1 条时占满整行，避免右半边留空
        <div
          className={cx(
            "qs:grid qs:gap-x-6",
            items.length > 1 ? "qs:@max-[860px]:grid-cols-1 qs:grid-cols-2" : "qs:grid-cols-1"
          )}
        >
          {items.map(item => (
            <QuestionRow
              key={item.question.id}
              item={item}
              now={now}
              onClick={() => void pages.questions?.open({ selectedId: item.question.id })}
            />
          ))}
        </div>
      ) : (
        <p className="qs:text-ink-3 qs:px-2.5 qs:py-2 qs:text-[12.5px]">
          没有正在探究的问题。学习时冒出的疑问，记到问题页里。
        </p>
      )}
      <button
        type="button"
        onClick={() => void pages.questions?.open()}
        className="qs:text-ink-3 qs:hover:text-ink-1 qs:mt-1 qs:inline-flex qs:items-center qs:gap-0.5 qs:rounded-[6px] qs:px-2.5 qs:py-1 qs:text-[12px] qs:outline-none qs:focus-visible:shadow-[var(--tau-focus-ring)]"
      >
        前往问题
        <ChevronRight className="qs:size-[13px]" strokeWidth={1.75} />
      </button>
    </div>
  );
}

function QuestionRow({
  item,
  now,
  onClick,
}: {
  item: ActiveQuestion;
  now: number;
  onClick(): void;
}) {
  const { question, group, lastEvent } = item;
  const progress = lastEvent ? describeEvent(lastEvent) : null;
  const progressText = progress
    ? progress.tone === "note"
      ? progress.text
      : `${progress.verb}${progress.title && progress.tone !== "start" ? `「${progress.title}」` : ""}`
    : "";
  return (
    <button
      type="button"
      onClick={onClick}
      className="qs:rounded-tau-sm qs:ease-tau-out qs:hover:bg-hover qs:flex qs:w-full qs:items-start qs:gap-2.5 qs:px-2.5 qs:py-[9px] qs:text-left qs:transition-[background] qs:duration-[160ms]"
    >
      <StatusRing status={question.status} className="qs:mt-[3px]" />
      <span className="qs:min-w-0 qs:flex-1">
        <b className="qs:text-tau-meta qs:block qs:truncate qs:font-medium">{question.title}</b>
        <span className="qs:text-ink-3 qs:mt-0.5 qs:flex qs:min-w-0 qs:items-center qs:gap-2.5 qs:text-[11px]">
          {group && (
            <span className="qs:inline-flex qs:shrink-0 qs:items-center qs:gap-[5px]">
              <GroupDot tone={group.tone} />
              {group.title}
            </span>
          )}
          <Composition counts={question.composition} className="qs:shrink-0" />
          <span className="qs:min-w-0 qs:truncate">
            {relativeDay(question.activityAt, now)}
            {progressText ? ` · ${progressText}` : ""}
          </span>
        </span>
      </span>
    </button>
  );
}
