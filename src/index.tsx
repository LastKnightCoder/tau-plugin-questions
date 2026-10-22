import { CircleHelp, PenLine } from "lucide-react";
import { definePlugin, type PluginPageProps } from "@tau/plugins";
import { registerQuestionSchema } from "./data/schema";
import { createRuntime, RuntimeProvider } from "./runtime";
import { registerQuestionsSidebar } from "./sidebar";
import { HomePanel } from "./ui/HomePanel";
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
      const page = context.pages.register({
        id: QUESTIONS_PAGE,
        title: "问题",
        component: (props: PluginPageProps) => (
          <RuntimeProvider runtime={runtime}>
            <QuestionsPage {...props} />
          </RuntimeProvider>
        ),
      });
      runtime.pages.questions = page;
      registerQuestionsSidebar(runtime, page);
      context.home.registerPanel({
        id: "active",
        title: "探究中的问题",
        component: () => (
          <RuntimeProvider runtime={runtime}>
            <HomePanel />
          </RuntimeProvider>
        ),
      });
      await runtime.data.ensureDefaultGroup();
    },
  }),
});
