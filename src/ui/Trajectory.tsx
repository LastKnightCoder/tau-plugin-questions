/**
 * 探究轨迹：一条连续的时间线，每步「做了什么」在上、「何时 · 第几天」在下。
 * 自动事件（提出 / 状态 / 关联 / 移除）视觉轻，手动「记一笔」视觉重；推算出的旧数据只有日期，标「约」。
 * 事件里的内容显示当前标题（关联那一刻的标题常常还是「新对话」），还在的可以点开。
 * 末尾输入框回车写入一条记录。
 */
import { useState } from "react";
import { NotebookPen } from "lucide-react";
import { toast } from "@tau/ui";
import type { PluginEntityDescription, PluginEntityRef } from "@tau/plugins";
import type { QuestionEvent } from "../data/model";
import {
  TARGET_META,
  clock,
  cx,
  daySpan,
  describeEvent,
  relativeDay,
  type EventView,
} from "./model";
import { refKey } from "./queries";

const DOT: Record<EventView["tone"], string> = {
  start: "qs:bg-surface qs:shadow-[inset_0_0_0_1.5px_var(--tau-accent)]",
  made: "qs:bg-ink-3",
  plain: "qs:bg-surface qs:shadow-[inset_0_0_0_1.5px_var(--tau-ink-3)]",
  muted: "qs:bg-surface qs:shadow-[inset_0_0_0_1.5px_var(--tau-ink-3)]",
  done: "qs:bg-ok",
  note: "qs:bg-accent qs:size-[9px] qs:-left-px qs:top-[5.5px] qs:shadow-[0_0_0_3px_var(--tau-bg-surface)]",
};

export function Trajectory({
  events,
  descriptions,
  now,
  onOpen,
  onAddNote,
}: {
  events: readonly QuestionEvent[];
  /** 事件里引用的当前标题与是否还在 */
  descriptions: ReadonlyMap<string, PluginEntityDescription> | undefined;
  now: number;
  onOpen(ref: PluginEntityRef): void;
  onAddNote(text: string): Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await onAddNote(value);
      setText("");
    } catch {
      toast.error("记录失败");
    } finally {
      setBusy(false);
    }
  };

  const origin = events[0]?.createdAt;

  return (
    <>
      <ol className="qs:flex qs:flex-col">
        {events.map(event => {
          const view = describeEvent(event);
          const ref = event.type === "link" || event.type === "unlink" ? event.ref : undefined;
          const current = ref ? descriptions?.get(refKey(ref)) : undefined;
          const title = (current?.status === "ok" && current.title) || view.title;
          const open =
            ref && current?.status === "ok" && view.tone !== "muted" ? () => onOpen(ref) : undefined;
          return (
            <li
              key={event.id}
              className="qs:relative qs:pb-4 qs:pl-5 qs:before:absolute qs:before:-bottom-2.5 qs:before:left-[3px] qs:before:top-2.5 qs:before:w-[1.5px] qs:before:bg-[var(--tau-bg-track)] qs:last:pb-0 qs:last:before:hidden"
            >
              <span
                aria-hidden
                className={cx(
                  "qs:absolute qs:left-0 qs:top-[6.5px] qs:z-[1] qs:size-[7px] qs:rounded-full",
                  DOT[view.tone]
                )}
              />
              {view.tone === "note" ? (
                <div className="qs:text-ink-1 qs:whitespace-pre-wrap qs:text-[13px] qs:leading-[20px]">
                  {view.text}
                </div>
              ) : (
                <div
                  className={cx(
                    "qs:text-[12.5px] qs:leading-[20px]",
                    view.tone === "muted" ? "qs:text-ink-3" : "qs:text-ink-2",
                    view.tone === "done" && "qs:text-ok qs:font-semibold"
                  )}
                >
                  {view.verb}
                </div>
              )}
              {view.tone !== "note" && title && (
                <EventRef target={view.target} title={title} muted={view.tone === "muted"} onClick={open} />
              )}
              <div className="qs:text-ink-3 qs:mt-1 qs:text-[11px] qs:tabular-nums">
                {when(event.createdAt, view.estimated, now)}
                {origin != null && event.createdAt > origin && (
                  <> · 第 {daySpan(origin, event.createdAt)} 天</>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <label className="qs:border-line-1 qs:text-ink-3 qs:focus-within:border-accent qs:mt-2.5 qs:flex qs:h-[34px] qs:cursor-text qs:items-center qs:gap-2 qs:rounded-[10px] qs:border qs:border-dashed qs:px-2.5 qs:focus-within:border-solid qs:focus-within:shadow-[var(--tau-focus-ring)]">
        <NotebookPen className="qs:size-[14px] qs:shrink-0" strokeWidth={1.75} />
        <input
          value={text}
          disabled={busy}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="记一笔：读到了什么、卡在哪、换了什么思路…"
          aria-label="记一笔"
          className="qs:text-ink-1 qs:placeholder:text-ink-3 qs:min-w-0 qs:flex-1 qs:bg-transparent qs:text-[12.5px] qs:outline-none"
        />
      </label>
    </>
  );
}

/** 「今天 12:15」「7月18日 12:15」；推算时间只到日期：「约 7月18日」 */
function when(ts: number, estimated: boolean, now: number): string {
  const day = relativeDay(ts, now);
  return estimated ? `约 ${day}` : `${day} ${clock(ts)}`;
}

function EventRef({
  target,
  title,
  muted,
  onClick,
}: {
  target?: keyof typeof TARGET_META;
  title: string;
  muted: boolean;
  onClick?: () => void;
}) {
  const Icon = target ? TARGET_META[target].icon : null;
  const className = cx(
    "qs:text-tau-meta qs:mt-1 qs:inline-flex qs:max-w-full qs:items-center qs:gap-1",
    muted ? "qs:text-ink-3 qs:line-through" : "qs:text-ink-2"
  );
  const body = (
    <>
      {Icon && <Icon className="qs:text-ink-3 qs:size-3 qs:shrink-0" strokeWidth={1.75} />}
      <span className="qs:truncate">{title}</span>
    </>
  );
  if (!onClick) return <span className={className}>{body}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        className,
        "qs:hover:text-accent-text qs:rounded-[4px] qs:text-left qs:outline-none qs:focus-visible:shadow-[var(--tau-focus-ring)]"
      )}
    >
      {body}
    </button>
  );
}
