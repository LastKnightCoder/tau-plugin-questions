import { CircleHelp, PenLine } from "lucide-react";
import { definePlugin, type PluginPageProps } from "@tau/plugins";
import { registerQuestionSchema } from "./data/schema";
import { createRuntime, RuntimeProvider } from "./runtime";
import { createQuestionTools, MCP_ID, ROW_TOOLS } from "./ai/tools";
import { createToolResult } from "./ai/ToolResult";
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
      context.mcp.register({
        id: MCP_ID,
        name: "问题管理",
        description: "读取与整理用户在问题管理里记下的问题",
        tools: createQuestionTools(runtime.data, context),
      });
      const ToolResult = createToolResult(page);
      await Promise.all(
        ROW_TOOLS.map(toolName =>
          context.chat.registerToolRenderer({
            mcpId: MCP_ID,
            toolName,
            component: ToolResult,
          })
        )
      );
      await runtime.data.ensureDefaultGroup();
    },
  }),
});
