/**
 * 材料、对话、答案共用的行：中性墨色类型图标 + 标题 + 摘要 + 元信息。
 * 点行执行主动作（预览 / 打开），悬停时右上角叠加次要操作（绝对定位，不改变行尺寸）；
 * 内容已删除的灰显，只保留移除。
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { IconButton } from "@tau/ui";
import { cx } from "./model";

export interface RefRowAction {
  title: string;
  icon: LucideIcon;
  onClick(): void;
}

export function RefRow({
  icon: Icon,
  title,
  excerpt,
  meta,
  missing = false,
  onClick,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  excerpt?: ReactNode;
  meta: ReactNode;
  missing?: boolean;
  onClick?: () => void;
  actions: RefRowAction[];
}) {
  const clickable = !missing && onClick != null;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={!clickable}
      onClick={clickable ? onClick : undefined}
      onKeyDown={e => {
        if (e.key === "Enter" && clickable && e.target === e.currentTarget) onClick();
      }}
      className={cx(
        "qs:bg-surface qs:border-line-1 qs:group/ref qs:relative qs:flex qs:gap-[11px] qs:rounded-[12px] qs:border qs:px-3 qs:py-[11px] qs:outline-none",
        "qs:ease-tau-out qs:transition-[border-color] qs:duration-150 qs:focus-visible:shadow-[var(--tau-focus-ring)]",
        missing ? "qs:opacity-60" : clickable && "qs:hover:border-ink-3 qs:cursor-pointer"
      )}
    >
      <span className="qs:text-ink-2 qs:grid qs:size-[26px] qs:shrink-0 qs:place-items-center qs:rounded-[8px] qs:shadow-[inset_0_0_0_1px_var(--tau-line-1)]">
        <Icon className="qs:size-[14px]" strokeWidth={1.75} />
      </span>
      <div className="qs:min-w-0 qs:flex-1">
        <div className="qs:text-[13px] qs:font-medium qs:leading-normal">{title}</div>
        {!missing && excerpt && (
          <div className="qs:text-ink-2 qs:mt-[3px] qs:line-clamp-2 qs:text-[12.5px] qs:leading-[1.65]">
            {excerpt}
          </div>
        )}
        <div className="qs:text-ink-3 qs:mt-1 qs:text-[11.5px]">{meta}</div>
      </div>
      <div className="qs:bg-surface qs:absolute qs:right-2 qs:top-2 qs:flex qs:gap-0.5 qs:rounded-[8px] qs:opacity-0 qs:transition-opacity qs:duration-150 qs:group-focus-within/ref:opacity-100 qs:group-hover/ref:opacity-100">
        {actions.map(action => (
          <IconButton
            key={action.title}
            title={action.title}
            onClick={e => {
              e.stopPropagation();
              action.onClick();
            }}
            className="qs:size-[22px] qs:rounded-[6px]"
          >
            <action.icon className="qs:size-[13px]" strokeWidth={1.75} />
          </IconButton>
        ))}
      </div>
    </div>
  );
}
