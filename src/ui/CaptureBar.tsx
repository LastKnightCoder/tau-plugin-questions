/**
 * 快速收集：一行输入，回车收集；「#分组」指定分组（全名或前缀），不写落当前分组。
 * 右侧实时预览将落入的分组，输入框聚焦时显示回车提示。
 */
import { useState, type Ref } from "react";
import { Plus } from "lucide-react";
import { toast } from "@tau/ui";
import { matchGroup, parseCapture, type QuestionGroup } from "../data/model";
import { GroupDot } from "./bits";

export function CaptureBar({
  groups,
  fallbackGroup,
  onSubmit,
  inputRef,
}: {
  groups: readonly QuestionGroup[];
  /** 未写 #分组 时落入的分组（当前筛选的分组，全部时为默认分组） */
  fallbackGroup: QuestionGroup | undefined;
  onSubmit(title: string, group: QuestionGroup | undefined): Promise<void>;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = parseCapture(text);
  const target = matchGroup([...groups], parsed.groupHint) ?? fallbackGroup;

  const submit = async () => {
    if (!parsed.title || busy) return;
    setBusy(true);
    try {
      await onSubmit(parsed.title, target);
      setText("");
    } catch {
      toast.error("收集失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="qs:bg-surface qs:border-line-1 qs:group/cap qs:flex qs:h-10 qs:flex-none qs:items-center qs:gap-2.5 qs:rounded-[12px] qs:border qs:pl-3 qs:pr-2.5 qs:ease-tau-out qs:transition-[border-color,box-shadow] qs:duration-150 qs:focus-within:border-accent qs:focus-within:shadow-[var(--tau-focus-ring)]">
      <Plus
        className="qs:text-ink-3 qs:group-focus-within/cap:text-accent-text qs:size-[15px] qs:shrink-0"
        strokeWidth={1.75}
      />
      <input
        ref={inputRef}
        value={text}
        disabled={busy}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape" && text) {
            e.preventDefault();
            e.stopPropagation();
            setText("");
          }
        }}
        placeholder="记下一个问题… 回车收集，#分组 指定分组"
        aria-label="快速收集问题"
        className="qs:text-tau-body qs:placeholder:text-ink-3 qs:min-w-0 qs:flex-1 qs:bg-transparent qs:outline-none"
      />
      {target && (
        <span className="qs:text-ink-2 qs:flex qs:shrink-0 qs:items-center qs:gap-1.5 qs:whitespace-nowrap qs:text-[12px]">
          <GroupDot tone={target.tone} />
          {target.title}
        </span>
      )}
      <kbd className="qs:bg-hover qs:text-ink-2 qs:rounded-[5px] qs:px-[5px] qs:py-0.5 qs:font-mono qs:text-[11px] qs:opacity-0 qs:transition-opacity qs:duration-150 qs:group-focus-within/cap:opacity-100">
        ⏎
      </kbd>
    </div>
  );
}
