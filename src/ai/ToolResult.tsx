/**
 * 聊天里问题工具的结果：问题行（状态环 + 标题 + 分组），点开进问题页并选中。
 * 失败、进行中或不认识的版本交给默认展示。
 */
import { useI18n, type PluginPageHandle, type PluginSidebarTone, type PluginToolRendererProps } from "@tau/plugins";
import { messages } from "../i18n";
import { GroupDot, StatusRing } from "../ui/bits";
import { statusLabel } from "../ui/model";
import { RENDER_VERSION, type QuestionsRender } from "./tools";

const MAX_ROWS = 8;

export function createToolResult(page: PluginPageHandle) {
  return function QuestionsToolResult({
    execution,
    data,
    dataVersion,
    renderDefault,
  }: PluginToolRendererProps) {
    const { t } = useI18n(messages);
    const questions = (data as QuestionsRender | null)?.questions;
    if (execution.status !== "success" || dataVersion !== RENDER_VERSION || !Array.isArray(questions))
      return renderDefault();
    if (!questions.length)
      return (
        <div className="qs:text-ink-3 qs:px-1 qs:py-1 qs:text-[12.5px]">{t("tool.noResults")}</div>
      );
    return (
      <div className="qs:flex qs:flex-col">
        {questions.slice(0, MAX_ROWS).map(question => (
          <button
            key={question.id}
            type="button"
            onClick={() => void page.open({ selectedId: question.id })}
            className="qs:hover:bg-hover qs:flex qs:w-full qs:items-start qs:gap-2.5 qs:rounded-[8px] qs:px-2 qs:py-1.5 qs:text-left qs:outline-none qs:focus-visible:shadow-[var(--tau-focus-ring)]"
          >
            <StatusRing status={question.status} size="sm" className="qs:mt-[4px]" />
            <span className="qs:min-w-0 qs:flex-1">
              <span className="qs:text-ink-1 qs:block qs:truncate qs:text-[13px]">{question.title}</span>
              <span className="qs:text-ink-3 qs:flex qs:items-center qs:gap-2 qs:text-[11px]">
                {question.groupTitle && (
                  <span className="qs:inline-flex qs:items-center qs:gap-[5px]">
                    <GroupDot tone={question.groupTone as PluginSidebarTone} />
                    {question.groupTitle}
                  </span>
                )}
                {statusLabel(t, question.status)}
              </span>
            </span>
          </button>
        ))}
        {questions.length > MAX_ROWS && (
          <div className="qs:text-ink-3 qs:px-2 qs:pt-1 qs:text-[11.5px]">
            {t("tool.more", { count: questions.length - MAX_ROWS })}
          </div>
        )}
      </div>
    );
  };
}
