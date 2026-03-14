---
title: "A2UI 协议深度解析"
date: 2026-01-29
tags:
  - "A2UI"
  - "Agent UI"
  - "Google"
  - "前端协议"
showToc: true
TocOpen: true
---

_研究日期: 2026-01-29_

## 一句话说清楚

A2UI（Agent-to-User Interface）是 Google 在 2025 年 12 月开源的一套**声明式 UI 协议**——AI Agent 不再吐 HTML 或写代码，而是发一段 JSON "蓝图"，告诉客户端"我想要一个日期选择器和一个提交按钮"，客户端拿着这份蓝图用自己的原生组件去渲染。安全得像数据，表达力像代码。

## 要解决什么问题？

你跟一个 AI Agent 聊天预订餐厅：

> "帮我订今晚 7 点的位置"
> Agent: "请问几位？"
> "两位"
> Agent: "请问室内还是室外？"
> "室内"
> Agent: "好的，我帮你预订了..."

这来回好几轮纯文本对话，用户体验很差。理想情况下，Agent 应该直接弹一个小表单——日期选择、人数下拉、座位偏好，一步搞定。

但问题来了：**让 LLM 直接生成 HTML/JS 代码来渲染 UI 太危险了**。注入攻击、XSS、任意代码执行，安全隐患一堆。

A2UI 的答案是：**Agent 不生成代码，只生成"UI 描述"**。客户端拿到这份 JSON 描述后，用自己预先审核过的组件库去渲染。Agent 永远碰不到真正的渲染逻辑。

## 核心设计理念

### 1. 安全第一（Security-First）

A2UI 最根本的设计决策：**它是一种声明式数据格式，不是可执行代码**。

客户端维护一个"组件目录"（Component Catalog），里面是预先审核、信任的 UI 组件（Button、Card、TextField 等）。Agent 只能从这个目录里"点菜"，不能往里塞自定义的脚本。这从协议层面就掐死了 UI 注入的可能性。

### 2. LLM 友好（LLM-Friendly）

UI 被表示为一个**扁平的组件列表 + ID 引用**（邻接表模型），而不是嵌套的树结构。为什么？因为 LLM 生成扁平列表比生成正确嵌套的树结构容易得多，而且支持：

- **增量生成**：Agent 可以一个组件一个组件地流式输出
- **渐进式渲染**：客户端边收边画，用户不用干等
- **增量更新**：对话推进时，Agent 只需修改变化的组件，不用重发整个 UI

### 3. 框架无关（Framework-Agnostic）

这是 A2UI 最酷的地方：**同一份 JSON，不同平台用自己的原生组件渲染**。

- Web 上用 Lit/Angular/React 组件
- 移动端用 Flutter Widget 或 SwiftUI View
- 桌面端用原生控件

Agent 发的是抽象的"组件蓝图"，客户端负责把它翻译成自己平台的语言。UI 自然继承宿主应用的样式和无障碍特性。

## 架构与协议详解

### 交互循环：发射-渲染-信号-推理（Emit-Render-Signal-Reason）

```
Agent 发送 JSONL 消息（Emit）
       ↓
客户端映射为原生组件（Render）
       ↓
用户操作界面（Interact）
       ↓
渲染器返回结构化事件（Signal）
       ↓
Agent 消费事件，更新 UI（Reason）
       ↓
循环继续...
```

注意：用户操作返回的是**结构化的 `userAction` 事件**，不是自由文本。这让 Agent 的推理更精确。

### 消息类型（v0.9）

A2UI 通过 JSONL（JSON Lines）流进行通信，服务端发给客户端的消息有五种：

| 消息类型           | 作用             |
| ------------------ | ---------------- |
| `createSurface`    | 创建新渲染表面   |
| `updateComponents` | 添加或更新组件   |
| `updateDataModel`  | 更新应用状态     |
| `deleteSurface`    | 删除渲染表面     |
| `watchDataModel`   | 配置数据模型监听 |

### JSON 示例

一个简单的餐厅预订表单：

```json
{
  "surfaceUpdate": {
    "surfaceId": "booking",
    "components": [
      {
        "id": "title",
        "component": {
          "Text": {
            "text": "预订餐厅"
          }
        }
      },
      {
        "id": "date-picker",
        "component": {
          "DateTimeInput": {
            "label": "日期",
            "dataPath": "/booking/date"
          }
        }
      },
      {
        "id": "guests",
        "component": {
          "TextField": {
            "label": "人数",
            "dataPath": "/booking/guests"
          }
        }
      },
      {
        "id": "submit-btn",
        "component": {
          "Button": {
            "label": "预订",
            "action": "submit"
          }
        }
      }
    ]
  }
}
```

### 关键概念

| 概念               | 说明                                     |
| ------------------ | ---------------------------------------- |
| **Surface**        | 渲染画布（对话框、侧边栏、主视图等）     |
| **Component**      | UI 元素（Button、TextField、Card 等）    |
| **Data Model**     | 应用状态，组件通过 JSON Pointer 路径绑定 |
| **Catalog**        | 可用组件类型的注册表                     |
| **Adjacency List** | 扁平组件列表 + ID 引用，客户端重建树结构 |

### 数据绑定

组件通过 `dataPath`（JSON Pointer）绑定到 Data Model。当 Agent 发送 `updateDataModel` 消息更新状态时，绑定到对应路径的组件自动更新，**无需重新生成组件**。这种数据和 UI 的分离是 A2UI 高效增量更新的关键。

### 组件目录（Catalog）系统

A2UI 的组件不是写死在协议里的，而是通过 Catalog 机制动态管理：

- **标准目录**：Button、TextField、Card、DateTimeInput 等通用组件
- **自定义目录**：业务可以注册领域特定组件（StockTicker、GoogleMap、MedicalChart 等）
- **目录协商**：客户端在连接时告知服务端它支持哪些 Catalog，Agent 根据可用组件生成 UI

这个设计既保证了安全（只有注册过的组件才能渲染），又保留了扩展性（业务可以加自己的组件）。

## 在协议栈中的位置

2025-2026 年，AI Agent 生态涌现了一堆协议。A2UI 在其中扮演什么角色？

```
┌─────────────────────────────────────────────┐
│           完整 Agent 协议栈                    │
├─────────────────────────────────────────────┤
│  Agent ↔ Agent    → A2A（Google）             │
│  Agent ↔ 工具/系统 → MCP（Anthropic）          │
│  Agent ↔ 前端传输  → AG-UI（CopilotKit）      │
│  Agent ↔ UI 描述   → A2UI（Google）           │
└─────────────────────────────────────────────┘
```

简单说：

- **A2A** 管 Agent 之间怎么通信
- **MCP** 管 Agent 怎么调工具
- **AG-UI** 管数据怎么在后端和前端之间流转（传输层）
- **A2UI** 管 Agent 想给用户看什么样的 UI（内容层）

A2UI 定义的是 **"什么"（What）**，AG-UI 处理的是 **"怎么送"（How）**。它们不是竞争关系，而是互补关系。

## 两大阵营对比：原生优先 vs Web 优先

目前 Agent UI 领域形成了两个清晰的技术路线：

### Google 路线：原生优先（A2UI）

| 维度         | A2UI                                              |
| ------------ | ------------------------------------------------- |
| **渲染方式** | 原生组件映射                                      |
| **格式**     | 声明式 JSON                                       |
| **安全模型** | 组件目录白名单，不执行代码                        |
| **跨平台**   | Flutter、Web Components、Angular、React（规划中） |
| **样式**     | 继承宿主应用样式                                  |
| **适用场景** | 跨平台应用、企业 Agent Mesh                       |

### OpenAI/Anthropic 路线：Web 优先（MCP Apps）

| 维度         | MCP Apps                   |
| ------------ | -------------------------- |
| **渲染方式** | 沙箱 iframe                |
| **格式**     | HTML + CSS + JS            |
| **安全模型** | iframe 隔离                |
| **跨平台**   | 主要面向 Web               |
| **样式**     | 独立样式，与宿主隔离       |
| **适用场景** | ChatGPT 平台应用、Web 场景 |

**核心区别**：MCP Apps 把 UI 当作"资源"通过 `ui://` URI 获取，渲染在沙箱 iframe 里；A2UI 把 UI 当作"消息"发送组件蓝图，客户端用原生组件渲染。前者是"嵌个小网页"，后者是"用你自己的积木拼"。

### 完整对比表

| 标准                | 发起方             | 路线        | 核心特征                    |
| ------------------- | ------------------ | ----------- | --------------------------- |
| **A2UI**            | Google             | 原生优先    | 声明式 JSON 组件蓝图        |
| **MCP Apps**        | Anthropic + OpenAI | Web 优先    | 沙箱 HTML 控件，`ui://` URI |
| **OpenAI Apps SDK** | OpenAI             | Web 优先    | 扩展 MCP，面向 ChatGPT 平台 |
| **AG-UI**           | CopilotKit         | 传输层      | 双向实时 Agent ↔ 前端通信   |
| **Open-JSON-UI**    | OpenAI             | 声明式 JSON | 对齐 OpenAI 模型响应 Schema |

## 社区评价

### 叫好的地方

1. **解决了真问题**：ChatOps 场景下的"文字墙"终于可以变成交互式表单了，DevOps/SRE 从业者反响强烈
2. **安全模型成熟**：声明式数据 + 组件白名单的设计被普遍认为是"正确的架构决策"
3. **跨平台野心**：同一份 JSON 跑 Web、Flutter、原生移动端，这个卖点独一无二
4. **协议可读性好**：开发者反馈 wire protocol "非常易读"

### 吐槽的地方

1. **标准碎片化**：A2UI、MCP Apps、MCP-UI、OpenAI Apps SDK、AG-UI、Open-JSON-UI... 开发者直呼"太多了"。The New Stack 的评论："2026 年的协议过载（protocol overload）是真实的"
2. **状态管理是坑**：实际使用中，"最常见的失败模式不是渲染——而是状态管理"。数据模型的同步和一致性是开发者踩坑最多的地方
3. **生态还早期**：v0.8 公开预览，客户端库只有 Flutter、Web Components、Angular，React 原生渲染器还在规划中
4. **依赖宿主应用**：需要一个支持 A2UI 的宿主应用才能运行，不像 iframe 方案那样即插即用

## 当前状态与路线图

| 项目           | 状态                                                       |
| -------------- | ---------------------------------------------------------- |
| 版本           | v0.8（公开预览），v0.9 规范已在 GitHub                     |
| 协议           | Apache 2.0                                                 |
| 客户端库       | Flutter、Web Components、Angular                           |
| 规划中         | React 原生渲染器、iOS/Android 原生渲染器、规范 v1.0 稳定版 |
| Agent 框架集成 | Genkit、LangGraph 等                                       |
| 仓库           | [github.com/google/A2UI](https://github.com/google/A2UI)   |

## 实际应用案例

- **Opal**：用 A2UI 让用户通过自然语言构建小型 AI 应用的动态界面
- **Gemini Enterprise**：企业级 AI Agent 使用 A2UI 引导员工完成复杂任务，包括自定义表单和仪表板
- **Flutter GenUI SDK**：Flutter 团队基于 A2UI 帮助开发者生成个性化、跨平台、符合品牌设计体系的 UI

## 我的判断

A2UI 抓住了一个真实的痛点：Agent 需要超越纯文本的交互能力，但又不能让 LLM 直接写前端代码。"声明式 JSON + 组件白名单"这个解法很干净。

但它面临的挑战也很明确：

1. **标准大战刚开始**。Google 推 A2UI（原生优先），OpenAI + Anthropic 推 MCP Apps（Web 优先），CopilotKit 做传输层。现在还看不清谁会赢，也可能最终共存——毕竟它们解决的粒度不同
2. **生态成熟度不够**。v0.8，React 渲染器都还没有。对于 React 主力技术栈的团队来说，现在上车有点早
3. **状态管理是硬骨头**。声明式 UI 好做，但 Agent 驱动的状态同步是个新课题，目前的实践经验还不多
4. **适用场景有门槛**。你需要一个支持 A2UI 的宿主应用，这不是"加个 npm 包"就能搞定的事

**建议**：如果你在做跨平台 Agent 应用（尤其是 Flutter 生态），或者在搭建企业内部的 Agent Mesh，A2UI 值得关注和试验。如果你的场景纯 Web 且已经在用 MCP 生态，MCP Apps 可能更务实。不管哪条路，这个赛道值得持续跟踪。

## 快速上手

```bash
# 克隆仓库
git clone https://github.com/google/A2UI.git
cd A2UI

# 设置 Gemini API Key
export GEMINI_API_KEY="your_key"

# 启动 Agent 后端（一个终端）
cd a2a_agents && uv run .

# 启动前端（另一个终端）
cd renderers/web && npm run dev
```

## 参考来源

1. [Introducing A2UI: An open project for agent-driven interfaces - Google Developers Blog](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/)
2. [What is A2UI? - A2UI Official](https://a2ui.org/introduction/what-is-a2ui/)
3. [A2UI Specification v0.8 - A2UI Official](https://a2ui.org/specification/v0.8-a2ui/)
4. [GitHub - google/A2UI](https://github.com/google/A2UI)
5. [Agent UI Standards Multiply: MCP Apps and Google's A2UI - The New Stack](https://thenewstack.io/agent-ui-standards-multiply-mcp-apps-and-googles-a2ui/)
6. [The State of Agentic UI: Comparing AG-UI, MCP-UI, and A2UI - CopilotKit](https://www.copilotkit.ai/blog/the-state-of-agentic-ui-comparing-ag-ui-mcp-ui-and-a2ui-protocols)
7. [AG-UI and A2UI Explained - CopilotKit](https://www.copilotkit.ai/blog/ag-ui-and-a2ui-explained-how-the-emerging-agentic-stack-fits-together)
8. [A2UI Agent UI Ecosystem - A2UI Official](https://a2ui.org/introduction/agent-ui-ecosystem/)
9. [The A2UI Protocol: A 2026 Complete Guide - DEV Community](https://dev.to/czmilo/the-a2ui-protocol-a-2026-complete-guide-to-agent-driven-interfaces-2l3c)
10. [A2A, MCP, AG-UI, A2UI: The Essential 2026 AI Agent Protocol Stack - Medium](https://medium.com/@visrow/a2a-mcp-ag-ui-a2ui-the-essential-2026-ai-agent-protocol-stack-ee0e65a672ef)
11. [Google A2UI Explained - Analytics Vidhya](https://www.analyticsvidhya.com/blog/2025/12/google-a2ui-explained/)
12. [Google A2UI: The Future of Agentic AI for DevOps & SRE - DEV Community](https://dev.to/deneesh_narayanasamy/google-a2ui-the-future-of-agentic-ai-for-devops-sre-goodbye-text-only-chatops-159l)
