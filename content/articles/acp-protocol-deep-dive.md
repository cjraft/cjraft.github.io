---
title: "ACP 协议：Coding Agent 的 LSP"
date: 2026-02-02
tags:
  - "ACP"
  - "Agent Protocol"
  - "编辑器集成"
  - "LSP"
showToc: true
TocOpen: true
---

_研究日期：2026-02-02_

## 一句话说清楚

Agent Client Protocol (ACP) 是一个开放标准协议，让**任何 AI 编码 Agent** 能在**任何支持的编辑器**里跑起来，就像 LSP 让任何语言服务器能在任何编辑器里工作一样。你不再需要绑死在某个 IDE + 某个 AI Agent 的组合上了。

---

## 它要解决什么问题？

### M×N 噩梦

想象一下：市面上有 Cursor、Copilot、Claude Code、Gemini CLI、Goose、Codex CLI 等一堆 AI 编码 Agent，同时有 VS Code、JetBrains、Zed、Neovim、Emacs 等一堆编辑器。如果每个 Agent 都要为每个编辑器单独做集成，那就是经典的 M×N 问题——5 个 Agent × 5 个编辑器 = 25 个集成。

更要命的是，AI Agent 迭代飞快（有些一周发两版），IDE 插件根本跟不上。Block (Square) 团队就吐槽过：给 VS Code 维护 Goose 的插件，插件老是落后、用户老是踩坑。

### 供应商锁定

Cursor 把 AI Agent 焊死在编辑器里——你想用他们的 AI 就必须用他们的编辑器。想在 VS Code 里用 Claude Code、在 Neovim 里用 Gemini？没门。ACP 出现之前，混搭是不可能的。

### ACP 的答案

一句话：**"你实现一次 ACP，就能在所有支持 ACP 的编辑器里跑。"** Agent 专注做 AI 逻辑，编辑器专注做 UX，两边通过标准协议对话。

---

## 它包含哪些部分？

### 协议基础

| 维度         | 技术选型                                        |
| ------------ | ----------------------------------------------- |
| **传输协议** | JSON-RPC 2.0                                    |
| **本地通信** | stdio（标准输入/输出管道）                      |
| **远程通信** | HTTP / WebSocket                                |
| **消息类型** | Methods（请求-响应）+ Notifications（单向通知） |
| **文本格式** | Markdown                                        |
| **文件路径** | 必须用绝对路径，行号从 1 开始                   |
| **许可证**   | Apache 2.0                                      |

### 核心角色

- **Client（客户端）**：代码编辑器/IDE，管理用户界面、文件系统访问、终端控制
- **Agent（智能体）**：AI 编码程序，作为子进程运行或远程托管，负责 AI 推理和代码修改

### 通信生命周期

```
Client                              Agent
  │                                   │
  │──── initialize ──────────────────>│   # 建立连接、交换能力
  │<─── initialize response ─────────│
  │                                   │
  │──── authenticate (可选) ────────>│   # 认证
  │<─── authenticate response ───────│
  │                                   │
  │──── session/new ────────────────>│   # 创建新会话
  │<─── session response ────────────│
  │                                   │
  │──── session/prompt ─────────────>│   # 发送用户 prompt
  │<─── session/update (通知流) ─────│   # Agent 流式返回结果
  │<─── session/update ──────────────│   # 包含：消息片段、工具调用、计划、diff 等
  │<─── session/update ──────────────│
  │                                   │
  │──── session/cancel (可选) ──────>│   # 中断处理
  │                                   │
  │<─── fs/read_text_file ───────────│   # Agent 反向请求：读文件
  │──── file content ───────────────>│
  │                                   │
  │<─── terminal/create ─────────────│   # Agent 反向请求：创建终端
  │──── terminal response ──────────>│
```

### Agent 端方法（Client → Agent）

| 方法               | 必须/可选 | 说明                           |
| ------------------ | --------- | ------------------------------ |
| `initialize`       | 必须      | 初始化连接，交换协议版本和能力 |
| `authenticate`     | 可选      | Agent 认证                     |
| `session/new`      | 必须      | 创建新会话                     |
| `session/load`     | 可选      | 恢复已有会话                   |
| `session/prompt`   | 必须      | 向 Agent 发送 prompt           |
| `session/cancel`   | 可选      | 取消当前处理                   |
| `session/set_mode` | 可选      | 切换 Agent 模式                |

### Client 端方法（Agent → Client）

这是 ACP 的亮点之一——Agent 可以**反向调用** Client 的能力：

| 方法                         | 说明                                   |
| ---------------------------- | -------------------------------------- |
| `session/request_permission` | 请求用户授权（比如修改文件前先问一下） |
| `fs/read_text_file`          | 读取文件内容                           |
| `fs/write_text_file`         | 写入文件                               |
| `terminal/create`            | 创建终端                               |
| `terminal/output`            | 获取终端输出                           |
| `terminal/kill`              | 关闭终端                               |
| `terminal/wait_for_exit`     | 等待终端命令完成                       |

### session/update 通知流

Agent 通过 `session/update` 通知流式返回各种内容：

- **消息片段**：agent 消息、用户消息、思考过程（thought）
- **工具调用及更新**：Agent 使用了什么工具、执行状态
- **计划 (Plans)**：Agent 的执行计划展示
- **Diff 展示**：代码变更的 diff 视图（这是 ACP 特有的 UX 元素）
- **模式切换**：Agent 工作模式的变化
- **可用命令更新**：Agent 支持的命令列表变化

### 能力协商

ACP 使用**能力广告（Capability Advertisement）** 而非版本协商。初始化时双方声明自己支持什么特性，然后各取所需。协议版本号是一个简单的整数（当前 `PROTOCOL_VERSION = 1`），只在有 breaking change 时才递增。新功能通过能力协商无痛引入。

### 可扩展性

Agent 和 Client 命名空间都支持扩展方法（`ExtMethodRequest`、`ExtNotification`），可以加自定义功能而不破坏协议兼容性。元数据通过 `_meta` 字段携带。

---

## 核心设计理念

### 1. "AI Agent 的 LSP"

这是 ACP 最核心的类比和设计哲学。2016 年前，每个编辑器都要为每种语言单独写插件——Python 补全要为 VS Code 写一个、为 Vim 写一个、为 Sublime 写一个。LSP 用一个标准协议终结了这个混乱。ACP 对 AI Agent 做了同样的事情。

**关键差异是**：LSP 处理的是相对确定性的操作（补全、跳转定义、重构），而 ACP 处理的是非确定性的 AI 行为——流式输出、多步推理、工具调用链、需要人类审批的操作。所以 ACP 在 LSP 的基础上增加了：

- **流式通知**：Agent 可以逐 token 推送输出，编辑器实时展示"AI 在想什么"
- **双向请求**：Agent 可以反过来问 Client 要文件、要终端、要权限
- **权限模型**：Agent 修改代码前可以先请求用户授权
- **Diff 原语**：协议内置了代码 diff 展示能力，而不是让每个 Agent 自己发明格式

### 2. 复用 MCP 的 JSON 表示

ACP 不是从头造轮子。它尽可能复用 MCP（Model Context Protocol）的 JSON 表示格式，但在 MCP 没覆盖的 UX 场景（如 diff 展示、计划视图）上增加了自定义类型。这让已经熟悉 MCP 的开发者能快速上手。

### 3. 进程隔离 + 语言无关

Agent 作为独立进程运行，通过 stdio 管道通信。这意味着：

- Agent 可以用任何语言实现（Rust、Python、TypeScript、Go...）
- 不需要网络配置或端口管理
- 天然的安全隔离——Agent 不能直接碰 Client 的内存

### 4. 实用主义优先

ACP 不是委员会设计出来的。2025 年初，Zed 团队在做 "agentic editing" 实验，Google 拿着 Gemini CLI 来找合作。两边发现需要一个比"套个终端壳"更深度的集成方案，ACP 就这么诞生了。先解决真实问题，再抽象为标准——这和 LSP 的诞生路径惊人地相似。

---

## 生态全景

### 支持的编辑器（Clients）

| 编辑器               | 状态             | 说明                                        |
| -------------------- | ---------------- | ------------------------------------------- |
| **Zed**              | 已上线           | ACP 的发源地，原生集成                      |
| **JetBrains 全家桶** | 已上线 (2025.3+) | IntelliJ IDEA, PyCharm, WebStorm 等全线支持 |
| **Neovim**           | 已上线           | 通过 CodeCompanion 和 avante.nvim 插件      |
| **Emacs**            | 已上线           | 通过 agent-shell 插件                       |
| **marimo**           | 已上线           | Python notebook 环境                        |
| **Eclipse**          | 开发中           | 原型阶段                                    |
| **Unity**            | 社区实现         | 通过 UnityAgentClient 扩展                  |
| **VS Code**          | 未明确支持       | 微软态度谨慎（详见下文）                    |

### 支持的 Agent

| Agent              | 提供方         | 状态                                              |
| ------------------ | -------------- | ------------------------------------------------- |
| **Gemini CLI**     | Google         | 原生支持（首个参考实现）                          |
| **Goose**          | Block (Square) | 原生支持                                          |
| **Claude Code**    | Anthropic      | 通过 Zed SDK 适配器（非原生）                     |
| **Codex CLI**      | OpenAI         | 通过适配器                                        |
| **Augment Code**   | Augment        | 支持                                              |
| **Qwen Code**      | 阿里巴巴       | 支持                                              |
| **Mistral Vibe**   | Mistral        | 支持                                              |
| **OpenCode**       | 社区           | 支持                                              |
| **OpenHands**      | 社区           | 支持                                              |
| **Kimi CLI**       | Moonshot AI    | 支持                                              |
| **Junie**          | JetBrains      | 即将支持                                          |
| **GitHub Copilot** | GitHub/微软    | 注册表已收录                                      |
| 更多...            | 社区           | AgentPool, Blackbox AI, Pi, Qoder CLI, VT Code 等 |

### SDK 支持

| 语言       | 包名                       | 状态             |
| ---------- | -------------------------- | ---------------- |
| TypeScript | `@agentclientprotocol/sdk` | npm 已发布       |
| Python     | `python-sdk`               | 已发布           |
| Rust       | `agent-client-protocol`    | crates.io 已发布 |
| Kotlin     | `acp-kotlin`               | JVM 平台，含示例 |

### ACP Agent Registry

2026 年 1 月，JetBrains 和 Zed 联合上线了 **ACP Agent Registry**——一个 Agent 的"应用商店"：

- 集成在 JetBrains IDE 和 Zed 里，一键安装
- Agent 版本每小时自动更新
- 所有 Agent 通过 CI 验证 ACP 握手兼容性
- 开源仓库：[github.com/agentclientprotocol/registry](https://github.com/agentclientprotocol/registry)

---

## ACP vs MCP vs A2A — 谁跟谁？

这三个协议经常被放在一起比较，但它们解决的是**完全不同层面**的问题：

```
┌─────────────────────────────────────────────────────┐
│                  开发者的工作流                        │
│                                                      │
│  ┌──────────┐    ACP     ┌──────────┐               │
│  │  编辑器   │◄─────────►│ AI Agent │               │
│  │ (Zed/JB) │           │(Claude等)│               │
│  └──────────┘           └────┬─────┘               │
│                               │                      │
│                          MCP  │  Agent 访问工具/数据  │
│                               │                      │
│                         ┌─────▼─────┐               │
│                         │ 工具/数据源 │               │
│                         │(DB/API/FS)│               │
│                         └───────────┘               │
│                                                      │
│  ┌──────────┐    A2A     ┌──────────┐              │
│  │ Agent A  │◄─────────►│ Agent B  │              │
│  └──────────┘           └──────────┘              │
└─────────────────────────────────────────────────────┘
```

| 维度         | ACP                          | MCP                         | A2A                                  |
| ------------ | ---------------------------- | --------------------------- | ------------------------------------ |
| **一句话**   | 编辑器 ↔ Agent 通信          | Agent ↔ 工具/数据通信       | Agent ↔ Agent 通信                   |
| **创建者**   | Zed Industries               | Anthropic                   | Google                               |
| **类比**     | "AI 的 LSP"                  | "AI 的 USB-C"               | "Agent 的社交网络"                   |
| **传输**     | JSON-RPC 2.0 over stdio/HTTP | JSON-RPC 2.0 over stdio/SSE | HTTP + JSON                          |
| **关注点**   | UI/UX 集成、开发者体验       | 工具调用、上下文注入        | 跨组织 Agent 协作                    |
| **架构**     | Client-Server                | Client-Server               | Peer-to-Peer                         |
| **发现机制** | Agent Registry + acp.json    | 配置文件                    | Agent Cards (.well-known/agent.json) |
| **关系**     | 互补                         | 互补                        | 互补                                 |

**一个精准的比喻**：

- **MCP** 管的是 "Agent 能拿到什么工具和数据"（纵向集成）
- **A2A** 管的是 "Agent 之间怎么协作"（横向集成）
- **ACP** 管的是 "Agent 怎么出现在开发者面前"（界面集成）

它们不是竞争关系，而是**协议栈的不同层**。一个 Agent 完全可以同时实现 ACP（和编辑器对话）、使用 MCP（调用工具）、通过 A2A（和其他 Agent 协作）。

---

## ACP vs LSP

| 维度         | LSP                          | ACP                                           |
| ------------ | ---------------------------- | --------------------------------------------- |
| **目的**     | 语言智能（补全、诊断、跳转） | AI Agent 辅助（生成、重构、解释）             |
| **交互模式** | 请求-响应为主，确定性        | 流式通知为主，非确定性                        |
| **双向性**   | Server 响应 Client 请求      | Agent 可以反向请求文件、终端、权限            |
| **数据模型** | 文档 URI、位置、范围         | 复用 MCP 的 JSON 表示 + 自定义 diff/plan 类型 |
| **UX 元素**  | 补全列表、悬停提示、诊断标记 | 实时进度、多文件 diff、Agent 行动透明化       |
| **部署**     | 本地进程                     | 本地进程 or 远程云端                          |
| **诞生**     | 微软，2016                   | Zed，2025 年 8 月                             |

---

## 社区怎么看？

### 正面评价

**开发者社区的反应总体积极：**

- Hacker News 上开发者表示 "nice to see" 竞争，ACP "让切换 Agent 的成本更低了"
- Block (Square) 在 Goose 上全面拥抱了 ACP，因为维护 VS Code 插件的痛苦实在太深
- 有分析师评价："Protocols win by being small, useful, and widely implemented. ACP checks the first two boxes already."
- JetBrains 的加入被视为重大里程碑——第一次有主流 IDE 厂商全力押注 Agent 开放互操作

**JetBrains 的务实态度**：

> "Don't wait around for 'one protocol to rule them all.' ACP is stable, open, and usable now. Support both if needed — do what serves your users best."

### 质疑和批评

**Sourcegraph CEO Quinn Slack** 表示过早采用 ACP 可能限制产品创新："It's a cool idea and I respect people shipping and building"，但担心标准化来得太早。

**微软/VS Code** 态度谨慎。VS Code 工程师 Rob Laurens 表示 "interesting" 但不急于实现，团队更关注深度集成 Claude Code。The Register 点评："微软的 VS Code 市场地位最强，因此支持 ACP 的动力最小。"

**"不是所有能力都能通过 ACP 暴露"** 也是一个实际顾虑——有些 Agent 的高级功能可能需要比 ACP 当前规范更丰富的协议支持。

### 协议缩写冲突

ACP 这个缩写不幸地和另外两个协议撞了名：

1. **Agent Communication Protocol** (IBM)：Agent 间通信协议，已合并入 A2A
2. **Agentic Commerce Protocol** (OpenAI + Stripe)：AI 商业交易协议

这确实造成了一些社区困惑。本文讨论的是 Zed/JetBrains 主导的 **Agent Client Protocol**。

---

## 实际应用场景

### 场景 1：自由搭配 Agent + 编辑器

你是 JetBrains 老用户，但想试试 Claude Code 的能力。以前不可能，现在通过 ACP：

```
JetBrains IDE ──ACP──> Claude Code (via adapter)
                           │
                           ├──MCP──> 读取项目文件
                           ├──MCP──> 查询数据库 schema
                           └──MCP──> 调用测试框架
```

### 场景 2：Agent 快速切换

今天用 Gemini CLI 做代码生成，明天切 Goose 做重构，后天试试 Qwen Code 看中文项目支持——全在同一个编辑器里，一键切换。

### 场景 3：Agent 开发者的分发渠道

你开发了一个专门做安全审计的 AI Agent。实现 ACP 一次，就自动进入 JetBrains + Zed + Neovim + Emacs 的用户池，不需要为每个编辑器写插件。

---

## 怎么用起来？

### 对于开发者（使用 Agent）

**JetBrains IDE：**

1. 确保 IDE 版本 ≥ 2025.3
2. 打开 AI Chat → 模式选择器 → "Install From ACP Registry"
3. 浏览可用 Agent，点 Install
4. 开始对话

**Zed：**

- 内置 ACP 支持，Settings → Agent 配置

**Neovim：**

- 安装 CodeCompanion 或 avante.nvim 插件

### 对于 Agent 开发者（实现 ACP）

1. 选择 SDK：TypeScript (`@agentclientprotocol/sdk`)、Python、Rust、Kotlin
2. 实现核心方法：`initialize`、`session/new`、`session/prompt`
3. 通过 `session/update` 通知流式返回结果
4. 实现认证（Agent Auth 或 Terminal Auth）
5. 提交到 [ACP Registry](https://github.com/agentclientprotocol/registry)

---

## 未来展望

1. **VS Code 支持是最大变量**——如果微软拥抱 ACP，那就是 game over（好的意义上）。但目前微软更倾向于自家 AgentHQ 方案
2. **协议能力持续扩展**——当前版本(v1)覆盖了基础场景，但更复杂的 Agent 行为（多 Agent 协调、长期记忆、项目级理解）还需要协议演进
3. **安全模型完善**——Agent 能读写文件、执行终端命令，权限管控会越来越重要
4. **AI Agent "应用商店" 成型**——ACP Registry 只是开始，未来可能出现更成熟的 Agent 分发和评级体系

---

## 总结

Agent Client Protocol 做了一件看似简单但意义深远的事：**把 AI Agent 从编辑器里解耦出来**。

十年前 LSP 让 "一个语言服务器，到处都能用" 变成现实，催生了蓬勃的语言工具生态。ACP 正在对 AI Agent 做同样的事——而且这一次，时间线被压缩了。从 2025 年 8 月发布到 2026 年 1 月 Agent Registry 上线，只用了 5 个月就跑通了 "协议 → SDK → 生态 → 分发" 的完整闭环。

如果你是 Agent 开发者，现在就该关注 ACP。不是因为它完美，而是因为它**够小、够有用、够多人在用**——而这恰恰是协议成功的三要素。

---

## Sources

1. [Agent Client Protocol - Official Site](https://agentclientprotocol.com/) - 协议规范和文档
2. [Agent Client Protocol - GitHub](https://github.com/agentclientprotocol/agent-client-protocol) - 开源仓库
3. [Zed ACP Page](https://zed.dev/acp) - Zed 编辑器 ACP 集成
4. [Intro to ACP - Goose Blog](https://block.github.io/goose/blog/2025/10/24/intro-to-agent-client-protocol-acp/) - Block 团队的 ACP 介绍
5. [ACP Agent Registry Launch - JetBrains Blog](https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/) - ACP Registry 上线公告
6. [JetBrains × Zed ACP Partnership](https://blog.jetbrains.com/ai/2025/10/jetbrains-zed-open-interoperability-for-ai-coding-agents-in-your-ide/) - JetBrains 加入 ACP
7. [ACP Progress Report - Zed Blog](https://zed.dev/blog/acp-progress-report) - 社区进展报告
8. [JetBrains ACP Documentation](https://www.jetbrains.com/help/ai-assistant/acp.html) - JetBrains IDE 使用文档
9. [Agent Client Protocol: The LSP for AI Coding Agents](https://blog.promptlayer.com/agent-client-protocol-the-lsp-for-ai-coding-agents/) - 技术分析
10. [Protocol Overview](https://agentclientprotocol.com/protocol/overview) - 协议技术概览
11. [AI Agent Protocols 2026 Complete Guide](https://www.ruh.ai/blogs/ai-agent-protocols-2026-complete-guide) - 协议全景指南
12. [Top AI Agent Protocols in 2026](https://getstream.io/blog/ai-agent-protocols/) - MCP/A2A/ACP 对比
13. [MCP, ACP, A2A: What does it all mean?](https://akka.io/blog/mcp-a2a-acp-what-does-it-all-mean) - 协议关系梳理
14. [Agents, Protocols, and Why We're Not Playing Favorites - JetBrains](https://blog.jetbrains.com/ai/2025/12/agents-protocols-and-why-we-re-not-playing-favorites/) - JetBrains 的协议立场
15. [Google, Zed fight VS Code lock-in with ACP - The Register](https://www.theregister.com/2025/08/28/google_zed_acp/) - 媒体报道
16. [ACP Agent Registry - GitHub](https://github.com/agentclientprotocol/registry) - Agent 注册表仓库
17. [An Unbiased Comparison of MCP, ACP, and A2A](https://medium.com/@sandibesen/an-unbiased-comparison-of-mcp-acp-and-a2a-protocols-0b45923a20f3) - 协议对比分析
18. [DeepLearning.AI ACP Course](https://www.deeplearning.ai/short-courses/acp-agent-communication-protocol/) - 学习资源
