/**
 * 问题页小件：状态环（待探究 = 虚线空圈 / 探究中 = 半满 / 已解答 = 实心勾）、分组色点、
 * 材料构成计数、分区标题、提示框、快捷键提示。
 */
import type { ReactNode } from "react";
import { Check, Lightbulb } from "lucide-react";
import type { PluginSidebarTone } from "@tau/plugins";
import type { Composition as CompositionCounts, QuestionStatus } from "../data/model";
import { COMPOSITION_ORDER, STATUS_META, TARGET_META, TONE_DOT, cx } from "./model";

export function StatusRing({
  status,
  size = "md",
  className,
}: {
  status: QuestionStatus;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      aria-label={STATUS_META[status].label}
      className={cx(
        "qs:inline-grid qs:shrink-0 qs:place-items-center qs:rounded-full",
        size === "md" ? "qs:size-4" : "qs:size-[13px]",
        status === "not_started" && "qs:border-ink-3 qs:border-[1.5px] qs:border-dashed",
        status === "in_progress" &&
          "qs:border-accent qs:border-[1.5px] qs:bg-clip-content qs:bg-[conic-gradient(var(--tau-accent)_0_50%,transparent_50%_100%)]",
        status === "in_progress" && (size === "md" ? "qs:p-[2px]" : "qs:p-[1.5px]"),
        status === "resolved" && "qs:bg-ok qs:text-ink-inverse",
        className
      )}
    >
      {status === "resolved" && (
        <Check className={size === "md" ? "qs:size-2.5" : "qs:size-2"} strokeWidth={3} />
      )}
    </span>
  );
}

export function GroupDot({ tone, className }: { tone?: PluginSidebarTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("qs:size-[7px] qs:shrink-0 qs:rounded-[2.5px]", TONE_DOT[tone ?? "gray"], className)}
    />
  );
}

export function Composition({
  counts,
  className,
}: {
  counts: CompositionCounts;
  className?: string;
}) {
  const entries = COMPOSITION_ORDER.filter(type => counts[type]);
  if (!entries.length) return null;
  return (
    <span className={cx("qs:inline-flex qs:items-center qs:gap-2.5", className)}>
      {entries.map(type => {
        const Icon = TARGET_META[type].icon;
        return (
          <span
            key={type}
            title={`${TARGET_META[type].label} ${counts[type]}`}
            className="qs:text-ink-3 qs:inline-flex qs:items-center qs:gap-[3px] qs:text-[11.5px] qs:tabular-nums"
          >
            <Icon className="qs:size-3" strokeWidth={1.75} />
            {counts[type]}
          </span>
        );
      })}
    </span>
  );
}

export function SectionTitle({
  children,
  action,
  count,
}: {
  children: ReactNode;
  action?: ReactNode;
  count?: number;
}) {
  return (
    <div className="qs:text-ink-2 qs:mb-2 qs:mt-[18px] qs:flex qs:min-h-6 qs:items-center qs:gap-2 qs:text-[12px] qs:font-semibold">
      {children}
      {count != null && (
        <span className="qs:text-ink-3 qs:font-normal qs:tabular-nums">{count}</span>
      )}
      <span className="qs:flex-1" />
      {action}
    </div>
  );
}

export function Hint({ children, icon = false }: { children: ReactNode; icon?: boolean }) {
  return (
    <div className="qs:border-line-1 qs:text-ink-3 qs:flex qs:items-start qs:gap-2 qs:rounded-[12px] qs:border qs:border-dashed qs:px-3.5 qs:py-3 qs:text-[12.5px] qs:leading-[1.7]">
      {icon && <Lightbulb className="qs:mt-[3px] qs:size-[14px] qs:shrink-0" strokeWidth={1.75} />}
      <span>{children}</span>
    </div>
  );
}

export function KeyHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="qs:inline-flex qs:items-center qs:gap-1">
      {keys.map(k => (
        <kbd
          key={k}
          className="qs:bg-hover qs:text-ink-2 qs:rounded-[5px] qs:px-[5px] qs:py-px qs:font-mono qs:text-[10.5px]"
        >
          {k}
        </kbd>
      ))}
      {label}
    </span>
  );
}

export const MENU_ICON = "qs:size-[15px]";
