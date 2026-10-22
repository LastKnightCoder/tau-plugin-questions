/**
 * 撤销窗口内暂存的破坏性操作（删除问题、解除关联、删除答案）：立即从视图隐藏，撤销提示关闭时才落库；
 * 点撤销即取消；页面隐藏或卸载时立刻落库。
 * 落库挂在提示的 onClose 上：悬停暂停自动关闭时撤销窗口随之延长，不会出现提示还在、已经落库的情况。
 * run 要等受影响的查询重新拉取后再 resolve，否则放开隐藏时旧数据会让条目闪回。
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "@tau/ui";

const UNDO_MS = 5000;

export function useDeferredActions() {
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const commits = useRef(new Map<string, () => Promise<unknown>>());

  const drop = (key: string) =>
    setPending(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

  const commit = (key: string) => {
    const run = commits.current.get(key);
    if (!run) return;
    commits.current.delete(key);
    run()
      .catch(() => toast.error("操作失败"))
      .finally(() => drop(key));
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(
    () => () => {
      for (const key of [...commits.current.keys()]) commitRef.current(key);
    },
    []
  );

  const schedule = (key: string, message: string, run: () => Promise<unknown>) => {
    if (commits.current.has(key)) return;
    setPending(prev => new Set(prev).add(key));
    commits.current.set(key, run);
    toast.info(message, {
      duration: UNDO_MS,
      onClose: () => commitRef.current(key),
      action: {
        label: "撤销",
        onClick: () => {
          // 撤销先于 onClose 触发：摘掉待落库的操作后，随后的 onClose 不再执行
          if (!commits.current.has(key)) return;
          commits.current.delete(key);
          drop(key);
        },
      },
    });
  };

  return { pending, schedule };
}
