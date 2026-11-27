/**
 * 材料预览：点卡片、文章、项目文档的行，在弹窗里只读看正文，不离开问题页；要编辑再「打开」。
 * 需要读取权限（摘要获准后才有正文引用），其余类型直接打开。
 */
import { ExternalLink } from "lucide-react";
import { ContentEditor, useI18n, type PluginLink } from "@tau/plugins";
import { Button, Dialog } from "@tau/ui";
import { messages } from "../i18n";
import { compositionOf } from "../data/model";
import { kindLabel } from "./model";

export interface MaterialPreviewState {
  link: PluginLink;
  contentRef: string;
  title: string;
}

export function MaterialPreview({
  state,
  onClose,
  onOpen,
}: {
  state: MaterialPreviewState | null;
  onClose(): void;
  onOpen(link: PluginLink): void;
}) {
  const { t } = useI18n(messages);
  const label = state ? kindLabel(t, compositionOf(state.link.to) ?? "card") : "";
  return (
    <Dialog
      open={state !== null}
      onOpenChange={next => !next && onClose()}
      title={state?.title ?? ""}
      context={label}
      width={760}
      height={760}
      footer={
        state && (
          <Button
            variant="primary"
            size="sm"
            icon={ExternalLink}
            onClick={() => {
              onClose();
              onOpen(state.link);
            }}
          >
            {t("ref.openKind", { kind: label })}
          </Button>
        )
      }
    >
      <div className="qs:border-line-2 qs:mt-[14px] qs:min-h-0 qs:flex-1 qs:overflow-y-auto qs:border-t qs:px-6 qs:py-4">
        {state && <ContentEditor key={state.contentRef} contentRef={state.contentRef} readonly />}
      </div>
    </Dialog>
  );
}
