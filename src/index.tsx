import { CircleHelp, PenLine } from "lucide-react";
import { definePlugin } from "@tau/plugins";
import { createQuestionData } from "./data/questions";
import { registerQuestionSchema } from "./data/schema";

declare const __PLUGIN_META__: { id: string; name: string; version: string };

export const QUESTIONS_PAGE = "questions";

export default definePlugin({
  ...__PLUGIN_META__,
  create: () => ({
    async activate(context) {
      registerQuestionSchema(context, {
        page: QUESTIONS_PAGE,
        questionIcon: CircleHelp,
        answerIcon: PenLine,
      });
      await createQuestionData(context).ensureDefaultGroup();
    },
  }),
});
