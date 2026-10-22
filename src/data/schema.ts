/**
 * 在 activate 中声明问题插件的实体类型与记录集合；停用时由宿主自动撤销。
 */
import type { PluginContext, PluginIcon } from "@tau/plugins";
import {
  ANSWER_INDEXES,
  ANSWER_KIND,
  EVENT_INDEXES,
  EVENTS,
  GROUP_INDEXES,
  GROUPS,
  QUESTION_INDEXES,
  QUESTION_KIND,
} from "./model";

export function registerQuestionSchema(
  context: Pick<PluginContext, "entities" | "records">,
  options: { page: string; questionIcon: PluginIcon; answerIcon: PluginIcon }
) {
  context.entities.registerKind({
    kind: QUESTION_KIND,
    label: "问题",
    icon: options.questionIcon,
    open: { page: options.page, params: entity => ({ selectedId: entity.id }) },
    indexes: QUESTION_INDEXES,
  });
  context.entities.registerKind({
    kind: ANSWER_KIND,
    label: "独立答案",
    icon: options.answerIcon,
    open: {
      page: options.page,
      params: (entity): Record<string, string> =>
        typeof entity.meta.questionId === "string" ? { selectedId: entity.meta.questionId } : {},
    },
    indexes: ANSWER_INDEXES,
  });
  context.records.registerCollection({ name: GROUPS, indexes: GROUP_INDEXES });
  context.records.registerCollection({ name: EVENTS, indexes: EVENT_INDEXES });
}
