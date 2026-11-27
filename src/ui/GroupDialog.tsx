/**
 * 新建或编辑分组：名称 + 色点。默认分组「未分类」只能改颜色。
 */
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useI18n, type PluginSidebarTone } from "@tau/plugins";
import { Button, Dialog, DialogBody, Input, toast } from "@tau/ui";
import { messages } from "../i18n";
import type { MessageKey } from "./model";
import { GROUP_TONES, type QuestionGroup } from "../data/model";
import { TONE_DOT, cx } from "./model";

const TONE_KEY: Record<PluginSidebarTone, MessageKey> = {
  rose: "color.rose",
  orange: "color.orange",
  yellow: "color.yellow",
  green: "color.green",
  blue: "color.blue",
  purple: "color.purple",
  gray: "color.gray",
};

export function GroupDialog({
  open,
  group,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** null 为新建 */
  group: QuestionGroup | null;
  onClose(): void;
  onSubmit(title: string, tone: PluginSidebarTone): Promise<void>;
}) {
  const { t } = useI18n(messages);
  const [title, setTitle] = useState("");
  const [tone, setTone] = useState<PluginSidebarTone>("blue");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(group?.title ?? "");
    setTone(group?.tone ?? "blue");
  }, [open, group]);

  const submit = async () => {
    const name = title.trim();
    if (!name) return void toast.warning(t("groupDialog.nameRequired"));
    setBusy(true);
    try {
      await onSubmit(name, tone);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t("groupDialog.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => !next && onClose()}
      title={group ? t("groupDialog.edit") : t("groupDialog.create")}
      size="sm"
      locked={busy}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="sm" loading={busy} onClick={() => void submit()}>
            {group ? t("common.save") : t("common.create")}
          </Button>
        </>
      }
    >
      <DialogBody>
        <Input
          data-autofocus
          placeholder={t("groupDialog.placeholder")}
          value={title}
          disabled={group?.isDefault}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div role="radiogroup" aria-label={t("groupDialog.color")} className="qs:mt-3 qs:flex qs:gap-2">
          {GROUP_TONES.map(item => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={tone === item}
              title={t(TONE_KEY[item])}
              onClick={() => setTone(item)}
              className={cx(
                "qs:text-ink-inverse qs:grid qs:size-6 qs:place-items-center qs:rounded-full qs:outline-none qs:focus-visible:shadow-[var(--tau-focus-ring)]",
                TONE_DOT[item],
                tone === item && "qs:shadow-[0_0_0_2px_var(--tau-bg-surface),0_0_0_4px_var(--tau-line-1)]"
              )}
            >
              {tone === item && <Check className="qs:size-3.5" strokeWidth={2.5} />}
            </button>
          ))}
        </div>
      </DialogBody>
    </Dialog>
  );
}
