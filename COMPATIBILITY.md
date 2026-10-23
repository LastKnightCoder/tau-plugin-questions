# 兼容性与开发验证

当前依赖 SDK 0.37.0、UI 0.4.0；插件版本与最低客户端版本以 manifest.json 为准。保留格式 1、插件 ID、原有数据字段与功能，仅升级公共依赖，不把新 SDK 版本等同于移动平台支持。

## 平台边界

依赖 entities/records/content/data/permissions、首页、MCP 和聊天渲染，移动宿主尚未提供这些接口。当前侧栏分组还带动态管理行为，不能只替换为 navigation 注册就宣称跨端。

跨端能力以[官方 API 支持矩阵](https://github.com/LastKnightCoder/tau-plugin-template/blob/main/docs/api-support.md)为准。未来适配仍使用同一插件 ID 与更高版本，节点 type 和历史数据保持兼容；不生成另一个 Android 专用插件。

## 验证与发布

1. 使用正式 npm 依赖与仓库锁文件执行 `pnpm install --frozen-lockfile`，不注入本地 SDK。
2. 执行 `pnpm test`，再执行 `pnpm build`。
3. 正式用户通过插件中心安装。作者客户端行为验收覆盖启用、原有功能、保存重开与停用；构建或单测通过不等于已完成这些验收。
4. 发布时提高 package.json 与 manifest.json 版本，使用新 tag；不覆盖旧版本。推送 tag 会触发发布工作流，提交源码不等于已经上架。
