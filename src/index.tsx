import { CircleHelp, PenLine } from "lucide-react";
import { definePlugin, type PluginPageProps } from "@tau/plugins";
import { registerQuestionSchema } from "./data/schema";
import { createRuntime, RuntimeProvider } from "./runtime";
import { QuestionsPage } from "./ui/QuestionsPage";

declare const __PLUGIN_META__: { id: string; name: string; version: string };

export const QUESTIONS_PAGE = "questions";

export default definePlugin({
  ...__PLUGIN_META__,
  create: () => ({
    async activate(context) {
      const runtime = createRuntime(context);
      registerQuestionSchema(context, {
        page: QUESTIONS_PAGE,
        questionIcon: CircleHelp,
        answerIcon: PenLine,
      });
      runtime.pages.questions = context.pages.register({
        id: QUESTIONS_PAGE,
        title: "问题",
        component: (props: PluginPageProps) => (
          <RuntimeProvider runtime={runtime}>
            <QuestionsPage {...props} />
          </RuntimeProvider>
        ),
      });
      await runtime.data.ensureDefaultGroup();
    },
  }),
});
