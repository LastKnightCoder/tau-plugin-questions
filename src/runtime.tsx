/**
 * 插件运行时：本次启用的 context、数据层与查询缓存；组件经 useRuntime 取得。
 * 本插件的内容与记录变化（含同步下载、AI 工具写入）时整体刷新问题数据。
 */
import { createContext, useContext, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PluginContext, PluginEventType, PluginPageHandle } from "@tau/plugins";
import { createQuestionData, type QuestionData } from "./data/questions";

/** 问题数据的查询键前缀 */
export const QUESTIONS_KEY = ["questions"] as const;
/** 引用的标题与摘要（宿主内容变化时刷新） */
export const REFS_KEY = ["refs"] as const;

const OWN_EVENTS: PluginEventType[] = [
  "entity.created",
  "entity.updated",
  "entity.deleted",
  "record.created",
  "record.updated",
  "record.deleted",
  "workspace.reset",
];
const REF_EVENTS: PluginEventType[] = [
  "card.updated",
  "card.deleted",
  "article.updated",
  "article.deleted",
  "document.updated",
  "document.deleted",
  "whiteboard.updated",
  "whiteboard.deleted",
  "project.updated",
  "project.deleted",
  "notebook.updated",
  "notebook.deleted",
  "material.updated",
  "material.deleted",
  "chat.updated",
  "chat.deleted",
];

export interface QuestionsRuntime {
  context: PluginContext;
  data: QuestionData;
  queryClient: QueryClient;
  pages: { questions?: PluginPageHandle };
}

export function createRuntime(context: PluginContext): QuestionsRuntime {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  context.events.on(OWN_EVENTS, () => {
    void queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY });
  });
  context.events.on(REF_EVENTS, () => {
    void queryClient.invalidateQueries({ queryKey: REFS_KEY });
  });
  context.register({ dispose: () => queryClient.clear() });
  return { context, data: createQuestionData(context), queryClient, pages: {} };
}

const RuntimeContext = createContext<QuestionsRuntime | null>(null);

export function RuntimeProvider({
  runtime,
  children,
}: {
  runtime: QuestionsRuntime;
  children: ReactNode;
}) {
  return (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.queryClient}>{children}</QueryClientProvider>
    </RuntimeContext.Provider>
  );
}

export function useRuntime(): QuestionsRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("问题管理的组件需要在插件页面内使用");
  return runtime;
}
