/**
 * 独立答案：只属于这个问题的结论，正文实时保存。新写的答案先建好再编辑，关闭时仍为空则撤掉。
 * 「创建为」把答案同时变成卡片、文章或项目文档，与答案共用正文，在哪里改都同步。
 * 答案的标题取正文第一行。
 */
import { useState } from "react";
import { FilePlus2, FileText, FolderOpen, Layers } from "lucide-react";
import { ContentEditor } from "@tau/plugins";
import { Button, Dialog, DialogBody, Input, Menu, toast } from "@tau/ui";
import { useRuntime } from "../runtime";
import type { QuestionAnswer } from "../data/questions";
import { MENU_ICON } from "./bits";
import type { QuestionActions } from "./actions";
import { relativeDay } from "./model";

const TITLE_LENGTH = 40;

export interface AnswerDialogState {
  questionId: string;
  questionTitle: string;
  answer: QuestionAnswer;
  /** 刚写的新答案：关闭时为空就撤掉 */
  fresh: boolean;
}

type TitleTarget = "article" | "document";
const TARGET_LABEL: Record<TitleTarget, string> = { article: "文章", document: "项目文档" };

export function AnswerDialog({
  state,
  actions,
  now,
  onClose,
}: {
  state: AnswerDialogState | null;
  actions: QuestionActions;
  now: number;
  onClose(): void;
}) {
  const { context, data } = useRuntime();
  const [closing, setClosing] = useState(false);
  const [titleTarget, setTitleTarget] = useState<TitleTarget | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const firstLine = async () => {
    if (!state) return "";
    const snapshot = await context.content.read(state.answer.entity.contentRef);
    return (snapshot?.markdown ?? "")
      .split("\n")
      .map(line => line.replace(/^[#>*\-\s\d.]+/, "").trim())
      .find(Boolean) ?? "";
  };

  const close = async () => {
    if (!state || closing) return;
    setClosing(true);
    try {
      const line = await firstLine();
      if (!line && state.fresh) await data.discardAnswer(state.questionId, state.answer);
      else await data.renameAnswer(state.answer, line.slice(0, TITLE_LENGTH));
      await actions.refresh();
    } catch {
      toast.error("保存答案失败");
    } finally {
      setClosing(false);
      onClose();
    }
  };

  const openTitle = async (target: TitleTarget) => {
    setDraftTitle((await firstLine()).slice(0, TITLE_LENGTH) || state?.questionTitle || "");
    setTitleTarget(target);
  };

  const confirmTitle = async () => {
    const target = titleTarget;
    const title = draftTitle.trim();
    if (!target || !state) return;
    if (!title) return void toast.warning(`请输入${TARGET_LABEL[target]}标题`);
    setTitleTarget(null);
    await actions.shareAnswer(state.answer, target, title);
  };

  const projected = new Set(state?.answer.meta.projections.map(ref => ref.kind));

  return (
    <Dialog
      open={state !== null}
      onOpenChange={next => {
        if (!next) void close();
      }}
      title={state?.fresh ? "写答案" : "编辑答案"}
      subtitle={state?.questionTitle}
      locked={closing}
      width={760}
      height={760}
      footer={
        <>
          <span className="qs:text-ink-3 qs:mr-auto qs:text-[12px]">
            独立答案只属于这个问题，可以随时另存为卡片或文章
          </span>
          <Button variant="primary" size="sm" loading={closing} onClick={() => void close()}>
            完成
          </Button>
        </>
      }
    >
      {state && (
        <>
          <div className="qs:text-ink-3 qs:flex qs:shrink-0 qs:items-center qs:gap-3.5 qs:px-6 qs:pt-[8px]">
            <span className="qs:min-w-0 qs:flex-1 qs:truncate qs:tabular-nums">
              {relativeDay(state.answer.entity.createdAt, now)}写下
            </span>
            <Menu
              align="end"
              trigger={
                <Button variant="ghost" size="sm" icon={FilePlus2}>
                  创建为
                </Button>
              }
            >
              {!projected.has("card") && (
                <Menu.Item
                  icon={<Layers className={MENU_ICON} strokeWidth={1.75} />}
                  onSelect={() => void actions.shareAnswer(state.answer, "card")}
                >
                  卡片
                </Menu.Item>
              )}
              {!projected.has("article") && (
                <Menu.Item
                  icon={<FileText className={MENU_ICON} strokeWidth={1.75} />}
                  onSelect={() => void openTitle("article")}
                >
                  文章…
                </Menu.Item>
              )}
              <Menu.Item
                icon={<FolderOpen className={MENU_ICON} strokeWidth={1.75} />}
                onSelect={() => void openTitle("document")}
              >
                项目文档…
              </Menu.Item>
            </Menu>
          </div>
          <div className="qs:border-line-2 qs:mt-[14px] qs:min-h-0 qs:flex-1 qs:overflow-y-auto qs:border-t qs:px-6 qs:py-4">
            <ContentEditor
              key={state.answer.entity.id}
              contentRef={state.answer.entity.contentRef}
              placeholder="用自己的话回答这个问题…"
            />
          </div>
        </>
      )}
      <Dialog
        open={titleTarget !== null}
        onOpenChange={next => !next && setTitleTarget(null)}
        title={`创建${titleTarget ? TARGET_LABEL[titleTarget] : ""}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setTitleTarget(null)}>
              取消
            </Button>
            <Button variant="primary" size="sm" onClick={() => void confirmTitle()}>
              创建
            </Button>
          </>
        }
      >
        <DialogBody>
          <Input
            data-autofocus
            placeholder="标题"
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void confirmTitle();
              }
            }}
          />
        </DialogBody>
      </Dialog>
    </Dialog>
  );
}
