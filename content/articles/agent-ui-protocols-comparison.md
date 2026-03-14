---
title: "AG-UI  调研以及 A2UI 对比"
date: 2026-01-30
tags:
  - "AG-UI"
  - "A2UI"
  - "CopilotKit"
  - "前端协议"
showToc: true
TocOpen: true
---

**讨论背景**：从 A2UI 和 AG-UI 的基本概念对比开始，逐步深入到 AG-UI 的协议细节、使用方式、与 A2UI / MCP Apps 的集成支持。

## 1. A2UI vs AG-UI 核心对比

| 项目      | 全称                            | 发起方            | 核心作用                                                                | 层级定位              | 典型生态支持                                            |
| --------- | ------------------------------- | ----------------- | ----------------------------------------------------------------------- | --------------------- | ------------------------------------------------------- |
| **A2UI**  | Agent-to-User Interface         | Google（开源）    | 声明式生成式 UI 规范（JSON 格式），Agent 生成安全、可渲染的交互 UI 描述 | UI 描述层（内容）     | Flutter、Angular、Web Components、Lit 等渲染器；跨平台  |
| **AG-UI** | Agent–User Interaction Protocol | CopilotKit 团队等 | 双向事件/交互协议：前后端实时通信、状态同步、事件处理                   | 传输/运行时层（管道） | CopilotKit、Vercel AI SDK、LangGraph 等；常与 A2UI 搭配 |

**区别**：

- A2UI：Agent 要"画"什么样的界面？（描述结构和意图）
- AG-UI：界面怎么实时送到前端、用户怎么互动、状态怎么同步？（通信管道）

**常见组合**：A2A（Agent-Agent） + AG-UI（前后端管道） + A2UI（UI 内容格式）

## 2. AG-UI 协议详解

AG-UI 是**事件驱动的双向协议**，主要通过 SSE（Server-Sent Events）或 WebSocket 传输标准化 JSON 事件。

### 核心事件类型（约 17 种主流）

| 类别     | 主要事件类型示例                                                   | 作用简述                             | 前端典型反应           |
| -------- | ------------------------------------------------------------------ | ------------------------------------ | ---------------------- |
| 生命周期 | RUN_STARTED, RUN_FINISHED, RUN_PAUSED, RUN_ERROR                   | Agent run 的整体状态                 | 显示"思考中"/完成/错误 |
| 文本消息 | TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT (delta), TEXT_MESSAGE_END | 流式文本输出                         | 打字机效果             |
| 工具调用 | TOOL_CALL_START, TOOL_CALL_PROGRESS, TOOL_CALL_END                 | 工具执行生命周期                     | Loading 卡片 / 进度条  |
| 前端工具 | FRONTEND_TOOL_REQUEST                                              | Agent 需要前端执行工具（如获取位置） | 前端执行后回传结果     |
| 状态同步 | STATE_DELTA (JSON Patch), STATE_SNAPSHOT                           | 共享状态增量/全量更新                | 更新表单/购物车等      |
| 人工干预 | HUMAN_APPROVAL_REQUEST, USER_PROMPT_REQUEST                        | 需要用户确认/输入                    | 弹出 modal / 输入框    |
| 渲染相关 | BEGIN_RENDERING, UPDATE_COMPONENT, END_RENDERING                   | 常包 A2UI JSON，通知渲染 UI          | 调用 A2UI renderer     |
| 其他     | MEDIA_FRAME, DEBUG_LOG, CUSTOM                                     | 媒体/日志/扩展                       | 显示图片、log 等       |

**传输约定**：

- 后端：HTTP 200 + text/event-stream，持续推送 `event: XXX\ndata: {...}\n\n`
- 前端：可随时 POST 或 WebSocket 发送用户操作（如批准、工具结果）
- 支持重连、session/run ID 恢复

## 3. AG-UI 支持 A2UI 和 MCP Apps

- **A2UI 支持**：⭐⭐⭐⭐⭐ 全原生支持（Google launch partner）
  - Agent 生成 A2UI JSON → 通过 AG-UI 事件（如 BEGIN_RENDERING）传输 → 前端用 A2UI Renderer 渲染原生组件（安全、无代码执行）

- **MCP Apps 支持**：⭐⭐⭐⭐ 已支持（CopilotKit 集成）
  - MCP Apps：MCP 扩展，工具返回交互式 UI（通常 sandboxed iframe + postMessage JSON-RPC）
  - AG-UI 作用：提供事件同步、状态管理、human-in-the-loop，让 MCP Apps 嵌入整体流程
  - 优势：MCP Apps 擅长复杂工具 UI，AG-UI 管整体交互流

## 4. CopilotKit 对 MCP Apps 的官方支持文档

CopilotKit 是 AG-UI 的主要实现框架，已深度集成 MCP Apps。

**核心官方文档位置**（2026 年 1 月最新）：

- **MCP Apps 专用页面**：
  https://docs.copilotkit.ai/generative-ui-specs/mcp-apps
  （或类似路径：/generative-ui/specs/mcp-apps）
  内容：解释 MCP Apps 定义、CopilotKit 如何自动 fetch & 渲染、CLI 快速启动等。

- **What's New / Full MCP Apps Support**：
  https://docs.copilotkit.ai/whats-new/mcp-apps-support
  宣布全面支持，通过 AG-UI 桥接 MCP Apps。

- **关键博客文章**（最详细技术解释）：
  https://www.copilotkit.ai/blog/bring-mcp-apps-into-your-own-app-with-copilotkit-and-ag-ui
  发布时间：2026 年 1 月 22 日
  亮点：
  - 集成流程：AG-UI 作为同步层（事件流 + JSON Patch）
  - CLI 启动：`npx copilotkit create -f mcp-apps`
  - 示例 JSON（ui:// URI、\_meta 字段）
  - Live Demo：https://web-app-production-9af6.up.railway.app/
  - GitHub 示例：https://github.com/CopilotKit/with-mcp-apps

- **首页 / 介绍**：
  https://docs.copilotkit.ai/
  顶部常有 banner："CopilotKit fully supports MCP Apps!"

- **其他相关**：
  - MCP 通用集成：https://docs.copilotkit.ai/guides/model-context-protocol
  - Generative UI 总览（包含 MCP Apps vs A2UI）：https://docs.copilotkit.ai/generative-ui

**快速上手推荐**：从 CopilotKit 文档首页搜索 "MCP Apps" 或直接访问上述链接。CopilotKit 把 AG-UI + A2UI + MCP Apps 封装成统一框架，最适合 React/Next.js 项目。
