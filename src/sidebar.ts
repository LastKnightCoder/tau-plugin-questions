/**
 * 侧边栏「问题管理」：角标为探究中的问题数；问题页显示时展开各分组（色点 + 未解答数）与「新建分组」。
 * 点分组经页面参数 groupId 收窄，再点回到全部；问题行拖到分组上即移动。
 * 编辑、新建分组要填名称与颜色，打开问题页的分组弹窗（editGroup / createGroup 参数）。
 * 问题数据变化（含同步下载、AI 工具写入）时重新读取。
 */
import { CircleHelp } from "lucide-react";
import { SIDEBAR_GROUPS, type PluginPageHandle } from "@tau/plugins";
import { toast } from "@tau/ui";
import type { QuestionsRuntime } from "./runtime";
import { QUESTIONS_KEY } from "./runtime";
import { QUESTION_DRAG } from "./ui/model";

const REFRESH_DELAY = 200;

export function registerQuestionsSidebar(runtime: QuestionsRuntime, page: PluginPageHandle) {
  const { context, data, queryClient } = runtime;
  const item = context.sidebar.registerItem({
    id: "questions",
    title: "问题管理",
    icon: CircleHelp,
    group: SIDEBAR_GROUPS.learning,
    page,
  });

  const refreshPage = () => queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY });

  async function refresh() {
    const [questions, groups] = await Promise.all([data.listQuestions(), data.listGroups()]);
    const open = new Map<string, number>();
    questions.forEach(q => {
      if (q.status !== "resolved") open.set(q.groupId, (open.get(q.groupId) ?? 0) + 1);
    });
    item.update({
      badge: questions.filter(q => q.status === "in_progress").length,
      children: groups.map(group => ({
        id: group.id,
        title: group.title,
        params: { groupId: group.id },
        tone: group.tone,
        count: open.get(group.id) ?? 0,
        menu: [
          { title: "编辑分组", run: () => page.open({ groupId: group.id, editGroup: group.id }) },
          ...(group.isDefault
            ? []
            : [
                {
                  title: "删除分组",
                  danger: true,
                  run: async () => {
                    await data.deleteGroup(group.id);
                    await refreshPage();
                    toast.success(`已删除分组「${group.title}」，其中的问题移到「未分类」`);
                  },
                },
              ]),
        ],
        onDrop: {
          type: QUESTION_DRAG,
          run: async (questionId: string) => {
            const question = questions.find(q => q.id === questionId);
            if (!question || question.groupId === group.id) return;
            await data.moveToGroup(questionId, group.id);
            await refreshPage();
            toast.success(`已移到「${group.title}」`);
          },
        },
      })),
      action: { title: "新建分组", run: () => page.open({ createGroup: true }) },
    });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh().catch(() => undefined), REFRESH_DELAY);
  };
  context.events.on(
    [
      "entity.created",
      "entity.updated",
      "entity.deleted",
      "record.created",
      "record.updated",
      "record.deleted",
      "workspace.reset",
    ],
    schedule
  );
  context.register({ dispose: () => clearTimeout(timer) });
  schedule();
}
