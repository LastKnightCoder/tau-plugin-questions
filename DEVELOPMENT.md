# 开发说明

```bash
pnpm install
pnpm test
pnpm build
pnpm install:local
```

`pnpm build` 先做类型检查，再打包 `dist/tau.questions-<版本>.zip`。

## SDK

依赖 `@xiongtao.xt/tau-plugins@0.35.0` 与 `@xiongtao.xt/tau-ui@0.3.0`（经 npm 别名安装为 `@tau/plugins`、`@tau/ui`），运行时由 Tau 提供。答案与卡片、文章、项目文档共用正文（正文输入 `shareOf`）从 SDK 0.35.0 起提供。

测试里 `@tau/plugins` 的运行时由 `src/__tests__/sdk-mock.ts` 替代，数据层用 `src/__tests__/memory-store.ts` 的内存实现（按 SDK 文档的筛选、排序、revision 与事务语义）。

## 数据

名称与字段随笔记库保存，改动前要考虑已有数据。定义在 `src/data/model.ts`。

| 数据 | 承载 | 字段 |
| --- | --- | --- |
| 问题 | 实体 `question`，正文为背景描述 | 标题；meta：`status`（`not_started` / `in_progress` / `resolved`）、`groupId`（分组记录 ID）、`sortIndex`、`resolvedTime`、`activityAt`（最近活动）、`composition`（各类材料数） |
| 独立答案 | 实体 `answer`，正文为答案 | 标题（正文第一行）；meta：`questionId`、`projections`（与答案共用正文的卡片、文章、项目文档） |
| 分组 | 记录集合 `groups` | `title`、`tone`（侧边栏色点的七种颜色：`rose` `orange` `yellow` `green` `blue` `purple` `gray`）、`sortIndex`、`isDefault`（「未分类」，不可改名、不可删除） |
| 轨迹 | 记录集合 `events`，按创建时间排序 | `questionId`、`type`（`create` / `status` / `link` / `unlink` / `note`）及各类型字段 |
| 材料 | 关联，角色 `material` | 目标为卡片、文章、项目文档、项目、白板或外部材料 |
| 对话 | 关联，角色 `chat` | 目标为对话；`data.messageIds` 记下问题从哪几条消息转来 |
| 答案 | 关联，角色 `answer` | 目标为本插件的 `answer` 实体 |
| 立项 | 关联，角色 `notebook` | 目标为由问题立项出的 Notebook，每个问题最多一个 |

`composition` 与 `activityAt` 由每次写操作在同一个 transaction 里维护，列表与首页据此显示，不必逐个读取关联。

Tau 早期内置的问题管理由宿主一次性迁移到上述形状（宿主 `question-plugin-migration.ts`）：问题与答案的 key 取 `legacy-<旧 ID>`（答案为原正文 ID），分组、轨迹记录与关联的 ID 以 `legacy-` 开头；插件激活时已建的默认分组沿用。迁移在插件启用并激活之后执行，迁入后经实体与记录事件刷新页面。修改这里的字段时，同步宿主的迁移代码。
