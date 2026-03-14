---
title: "MCP Apps 生态：从规范到落地"
date: 2026-03-14
tags:
  - "MCP"
  - "MCP Apps"
  - "MCPUI"
  - "OpenAI"
  - "Anthropic"
showToc: true
TocOpen: true
---

### MCP Apps

[MCP Apps Extension (SEP - 1865)](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1865) 是 MCP 协议的可选扩展，使 MCP Server 能够向 Host 提供交互式用户界面，目标是：

- 统一标准：统一 MCP-UI 与 OpenAI Apps SDK 的两套方案
- 多端支持：Web、桌面、移动端通用

> 把 Apps SDK 的 UI 能力，搬进 MCP Extension 体系

### MCP UI

[MCPUI](https://mcpui.dev) 是一个开源的 UI 框架和 SDK，让开发者能够在 MCP 协议之上构建丰富的动态用户界面。它提供了一套完整的工具链，用于创建 Agent 驱动的交互式 UI 体验。

**核心特点**：

- TypeScript 原生支持
- 基于 VitePress 的文档系统
- Apache 2.0 开源许可
- 活跃的社区（4500+ GitHub Stars）
- 与 MCP Apps 规范完全兼容

**MCPUI 与 MCP Apps 的关系**：

- MCP Apps 定义了 **"UI 资源应该是什么样子"**（规范层）
- MCPUI 提供了 **"如何实现这些 UI"** 的工具和框架（实现层）

### 关键事件

- 2025.11：[SEP-1865](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1865) 正式提案，统一 MCP Apps 规范
- 2024.12.09：OpenAI [宣布](https://openai.com/index/agentic-ai-foundation/) 与 Anthropic、MCP-UI 合作，共建 Agentic AI Foundation
- 2025.05：MCPUI 项目启动，开始提供 MCP UI 实现
- 2026.03：MCPUI 获得 4500+ GitHub Stars，成为 MCP UI 生态的主要实现之一

---

### MCP Apps 核心规范

#### UI 资源标识：`ui://` URI

UI 被定义为一种特殊的资源类型，通过 `ui://` 协议唯一标识：

```
ui://<domain>/<path>

示例：
ui://test/widget/weather-card
```

#### Tool 与 UI 的绑定

通过 Tool 定义中的 `_meta.ui` 字段关联：

```json
{
  "name": "show_weather",
  "description": "显示天气信息",
  "inputSchema": {
    "type": "object",
    "properties": {
      "city": { "type": "string" }
    }
  },
  "_meta": {
    "ui": {
      "resourceUri": "ui://test/weather-widget",
      "visibility": ["model", "app"],
      "prefersBorder": true
    }
  }
}
```

**核心区别**：Tool ≠ UI。在 MCP Apps 规范中，UI (或称 Widget) 不被视为一种 Tool，但 Tool 可以"绑定"一个 UI 界面用于结果展示。

**字段说明**：

```typescript
interface McpUiToolMeta {
  /** UI 资源的 URI */
  resourceUri?: string;

  /** 工具可见性，默认: ["model", "app"] */
  visibility?: Array<"model" | "app">;
  // "model": 模型可调用
  // "app": 仅 UI 可调用（不在 Tool List 中暴露给模型）

  /** 是否在带边框的卡片中渲染（UI 偏好） */
  prefersBorder?: boolean;
}
```

#### 三层架构（Web 端）

![MCP Apps 三层架构](/articles/mcp-apps-architecture.png)

1. **MCP Server**：提供工具和 UI 资源
2. **Host 应用**：管理 MCP 连接和 UI 渲染
3. **UI 渲染层**：通过 iframe 或原生组件展示 UI

---

### MCPUI：实现层的完整方案

#### 核心能力

##### 1. 声明式 UI 组件

MCPUI 提供了一套声明式组件系统，让开发者可以像写 React 组件一样定义 Agent UI：

```typescript
import { Card, Button, TextField } from '@mcpui/react';

export function WeatherWidget({ city }: { city: string }) {
  const [weather, setWeather] = useState(null);

  return (
    <Card>
      <TextField label="城市" value={city} />
      <Button onClick={() => fetchWeather(city)}>查询天气</Button>
      {weather && <WeatherDisplay data={weather} />}
    </Card>
  );
}
```

##### 2. 实时事件同步

MCPUI 内置了与 AG-UI 协议的兼容层，支持：

- 流式文本输出
- 工具调用状态更新
- 用户交互事件回传
- 状态同步（JSON Patch）

##### 3. 沙箱安全模型

- iframe 隔离渲染
- CSP（Content Security Policy）限制
- postMessage 通信
- 权限控制白名单

##### 4. 多端支持

| 平台         | 支持状态    | 说明         |
| ------------ | ----------- | ------------ |
| Web          | ✅ 完全支持 | iframe 渲染  |
| React Native | 🚧 开发中   | 原生组件映射 |
| Electron     | ✅ 完全支持 | 桌面应用集成 |
| CLI          | ⚠️ 有限支持 | 基于 Termui  |

#### 与 MCP Apps 的集成

MCPUI 完全实现了 MCP Apps 规范：

```typescript
// MCPUI Server 端定义
import { createMCPUI } from "@mcpui/server";

const server = createMCPUI({
  name: "weather-server",
  version: "1.0.0",
  tools: {
    show_weather: {
      description: "显示天气信息",
      inputSchema: {
        type: "object",
        properties: {
          city: { type: "string" },
        },
      },
      _meta: {
        ui: {
          resourceUri: "ui://weather-server/widget",
          visibility: ["model", "app"],
          prefersBorder: true,
        },
      },
    },
  },
  ui: {
    "ui://weather-server/widget": WeatherWidget,
  },
});
```

#### 开发体验

##### CLI 快速启动

```bash
# 创建新的 MCPUI 项目
npm create @mcpui/app my-weather-app

# 启动开发服务器
cd my-weather-app
npm run dev
```

##### 热重载支持

- UI 组件修改实时生效
- 工具定义更新自动同步
- 无需重启 MCP Server

##### 调试工具

- MCPUI DevTools 浏览器扩展
- 事件流查看器
- 状态检查面板
- 性能监控

---

### 现状分析

#### 社区对齐进程

- OpenAI Apps SDK 与 MCP-UI 正在对齐过程中，但尚未完全统一
- 目前通过适配器 (adapters) 模式兼容
- MCPUI 提供了统一的抽象层，简化了多协议支持

#### MCP-UI 的局限性

- MCP-UI 目前主要定义了 Web 端规范，不支持移动端
- MCP-UI 当前更接近一个概念验证 (PoC) 项目
- MCPUI 作为实现层，弥补了 MCP-UI 的工程化缺口

---

### 功能对比

#### 元数据声明

| 功能     | 说明                                                                                              | OpenAI Apps SDK                      | MCP Apps                   | MCPUI 支持      |
| -------- | ------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------- | --------------- |
| 输出模板 | 理解为组件的资源 URI                                                                              | \_meta["openai/outputTemplate"]      | \_meta["ui"].resourceUri   | ✅ 完全支持     |
| 边框偏好 | 是否将组件渲染在带边框的卡片容器中                                                                | \_meta["openai/widgetPrefersBorder"] | \_meta["ui"].prefersBorder | ✅ 完全支持     |
| CSP 配置 | 定义 widget 的 CSP 允许列表（connect_domains、resource_domains、frame_domains、redirect_domains） | \_meta["openai/widgetCSP"]           | -                          | ⚠️ 部分支持     |
| 托管域   | 可选的组件托管专用子域（默认是 https://web-sandbox.oaiusercontent.com）                           | \_meta["openai/widgetDomain"]        | \_meta["ui"].domain        | ✅ 支持自定义域 |

#### UI 到 Host 方法

| 功能         | OpenAI Apps SDK                     | MCP Apps                | MCPUI 实现               |
| ------------ | ----------------------------------- | ----------------------- | ------------------------ |
| 调用工具     | window.openai.callTool()            | tools/call              | ✅ MCPUIAgent.callTool() |
| 发送消息     | window.openai.sendFollowUpMessage() | ui/message              | ✅ sendMessage()         |
| 请求显示模式 | window.openai.requestDisplayMode()  | ui/request-display-mode | ✅ requestDisplayMode()  |
| 打开外部链接 | window.openai.openExternal()        | ui/open-link            | ✅ openExternal()        |
| 设置状态     | window.openai.setWidgetState()      | -                       | ✅ setState()            |
| 请求模态框   | window.openai.requestModal()        | -                       | ✅ requestModal()        |
| 文件操作     | window.openai.uploadFile() 等       | -                       | ⚠️ 部分支持（Web 优先）  |

---

### 使用 MCPUI 构建 Agent UI

#### 快速开始

##### 1. 安装依赖

```bash
npm install @mcpui/react @mcpui/server
```

##### 2. 创建 UI 组件

```typescript
// components/WeatherCard.tsx
import { Card, Button, useMCP } from '@mcpui/react';

export function WeatherCard() {
  const { callTool } = useMCP();
  const [weather, setWeather] = useState(null);

  const handleCheck = async (city: string) => {
    const result = await callTool('weather', 'get_forecast', { city });
    setWeather(result);
  };

  return (
    <Card title="天气查询">
      <Button onClick={() => handleCheck('北京')}>查询北京天气</Button>
      {weather && <div>{JSON.stringify(weather)}</div>}
    </Card>
  );
}
```

##### 3. 注册到 MCP Server

```typescript
// server/index.ts
import { createMCPUI } from "@mcpui/server";
import { WeatherCard } from "../components/WeatherCard";

export const server = createMCPUI({
  name: "my-agent",
  tools: {
    "weather.get_forecast": {
      description: "获取天气预报",
      inputSchema: {
        type: "object",
        properties: {
          city: { type: "string" },
        },
      },
    },
  },
  ui: {
    "ui://my-agent/weather": WeatherCard,
  },
});
```

##### 4. 在前端使用

```typescript
// app/App.tsx
import { MCPUIProvider } from '@mcpui/react';
import { server } from './server';

function App() {
  return (
    <MCPUIProvider server={server}>
      <YourAgentInterface />
    </MCPUIProvider>
  );
}
```

---

### 最佳实践

#### 1. 组件设计原则

- **单一职责**：每个 Widget 负责一个明确的任务
- **状态最小化**：尽量让 Agent 驱动状态，而非组件内部状态
- **错误处理**：优雅处理工具调用失败的情况

#### 2. 性能优化

- **懒加载**：大型 Widget 按需加载
- **缓存**：合理使用工具结果缓存
- **批量操作**：合并多次状态更新

#### 3. 安全考虑

- **输入验证**：所有来自 Agent 的数据都需要验证
- **输出转义**：防止 XSS 攻击
- **权限控制**：敏感操作需要用户确认

---

### 相关链接

- [MCPUI 官网](https://mcpui.dev)
- [MCPUI GitHub](https://github.com/MCP-UI-Org/mcp-ui)
- [MCP Apps 规范](https://github.com/modelcontextprotocol/ext-apps)
- [OpenAI Agentic AI Foundation](https://openai.com/index/agentic-ai-foundation/)
- [CopilotKit MCP Apps 集成](https://docs.copilotkit.ai/generative-ui-specs/mcp-apps)
