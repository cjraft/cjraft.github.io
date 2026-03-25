---
title: "@tarko/agent vs pi-mono"
date: 2026-03-24
tags:
  - "Agent"
  - "TypeScript"
  - "开源"
showToc: true
TocOpen: false
---

## 背景与生态定位

最近看了下因为 openclaw 被带火的 pi-mono 框架用法和基本架构， 感觉和 tarko 有很多相似之处， 二者都尽量轻量化、 提供必要的开箱即用的能力、 保留足够的扩展性， 所以想着对二者做一些框架使用、设计理念的对比， 看能否有额外的收获。首先基本情况对比：

| 维度     | @tarko/agent                            | pi-agent-core                                        |
| -------- | --------------------------------------- | ---------------------------------------------------- |
| 出处     | 字节跳动 UI-TARS 项目                   | Mario Zechner 个人项目 pi-mono                       |
| 生产案例 | Agent TARS、UI-TARS Desktop             | TUI 工具、Web UI 应用                                |
| 核心包   | `@tarko/agent`、`@tarko/model-provider` | `@mariozechner/pi-ai`、`@mariozechner/pi-agent-core` |
| 定位     | Agent 运行时核心 + 生态基础设施         | Agent 状态机 + 流控制                                |

---

## 宏观架构

### @tarko/agent 的分层设计

```
┌─────────────────────────────────┐
│         Agent (公开 API)         │
│  run() / abort() / status()     │
├─────────────────────────────────┤
│        BaseAgent (钩子层)        │
│  onLLMRequest / onBeforeToolCall│
│  onEachAgentLoopStart / ...     │
├─────────────────────────────────┤
│        AgentRunner (协调器)      │
│  LLMProcessor / ToolProcessor   │
│  LoopExecutor / StreamAdapter   │
├─────────────────────────────────┤
│       Tool Call Engine 层        │
│  Native / PromptEngineering     │
│  StructuredOutputs              │
├─────────────────────────────────┤
│      @tarko/model-provider       │
│      多 Provider 统一接口         │
└─────────────────────────────────┘
```

典型的**分层 OOP 架构**：`BaseAgent` 承载所有钩子的默认实现，`Agent` 继承它并将执行委托给多个专职子组件（`LLMProcessor`、`ToolProcessor`、`LoopExecutor`）。扩展方式是**子类重写方法**，钩子粒度非常细。

### pi-agent-core 的扁平组合设计

```
┌────────────────────────────────┐
│         Agent (状态机)          │
│  prompt() / steer() / abort()  │
│  subscribe(fn)                  │
├────────────────────────────────┤
│    AgentState (响应式状态)       │
│  model / tools / messages      │
│  isStreaming / streamMessage   │
├────────────────────────────────┤
│       _runLoop (内部)           │
│  runAgentLoop / agentLoop      │
├────────────────────────────────┤
│   @mariozechner/pi-ai (底层)    │
│  streamSimple + 各 Provider    │
└────────────────────────────────┘
```

**扁平组合架构**：Agent 是一个自包含的状态机，通过构造器选项注入行为，钩子是函数参数而非方法重写。`pi-ai` 包负责所有 LLM Provider 的原始流处理。

---

## 微观对比

### 1. 接入便利程度

**@tarko/agent** — 开箱即用，配置项丰富但可选：

```typescript
import { Agent } from "@tarko/agent";

const agent = new Agent({
  instructions: "你是一个编程助手",
  model: { provider: "openai", id: "gpt-4o" },
  tools: [weatherTool],
  maxIterations: 10,
});

const result = await agent.run("帮我调试这段代码");
console.log(result.content);
```

**pi-agent-core** — 需要先从 `pi-ai` 拿到 Model 对象：

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";

const agent = new Agent({
  initialState: {
    systemPrompt: "你是一个编程助手",
    model: getModel("anthropic", "claude-sonnet-4-20250514"),
    tools: [weatherTool],
  },
});

agent.subscribe((event) => {
  if (event.type === "message_update") {
    process.stdout.write(event.assistantMessageEvent.delta ?? "");
  }
});

await agent.prompt("帮我调试这段代码");
```

差异：tarko 的 Model 解析内置在框架里，pi-agent-core 要显式调用 `getModel()` — 更透明但多一步。

---

### 2. 生命周期钩子

这是两者差别最大的地方。

**@tarko/agent 通过继承注入钩子（类方法重写）：**

```typescript
class MyAgent extends Agent {
  // LLM 请求前
  async onLLMRequest(id: string, payload: LLMRequestHookPayload) {
    console.log("即将请求 LLM", payload.messages.length);
  }

  // LLM 响应后
  async onLLMResponse(id: string, payload: LLMResponseHookPayload) {
    console.log("LLM 回复完成");
  }

  // 每次循环开始
  async onEachAgentLoopStart(sessionId: string) {
    console.log("第 N 次循环开始");
  }

  // 每次循环结束（含本轮 tool call 结果）
  async onEachAgentLoopEnd(context: EachAgentLoopEndContext) {}

  // tool call 前（可修改参数）
  async onBeforeToolCall(id, toolCall, args) {
    return args; // 可以修改后返回
  }

  // tool call 后（可修改结果）
  async onAfterToolCall(id, toolCall, result) {
    return result;
  }

  // tool 报错
  async onToolCallError(id, toolCall, error) {
    return `Error: ${error}`;
  }

  // 即将结束循环时 — 可以强制继续
  async onBeforeLoopTermination(
    id,
    finalEvent,
  ): Promise<LoopTerminationCheckResult> {
    if (!finalEvent.content.includes("done")) {
      return { finished: false }; // 强制再跑一轮
    }
    return { finished: true };
  }

  // 动态修改 system prompt 和 tools（每轮 LLM 请求前）
  async onPrepareRequest(
    context: PrepareRequestContext,
  ): Promise<PrepareRequestResult> {
    return {
      systemPrompt: context.systemPrompt + "\n当前时间：" + new Date(),
      tools: context.tools.filter((t) => t.name !== "dangerous_tool"),
    };
  }
}
```

共有 **10+ 个生命周期钩子**，覆盖从初始化到销毁的全流程，粒度细到每次 LLM 请求和每个 tool call。

**pi-agent-core 通过构造器选项注入钩子（函数组合）：**

```typescript
const agent = new Agent({
  // tool call 前（可拦截/阻止）
  beforeToolCall: async (ctx, signal) => {
    if (ctx.toolCall.name === "dangerous_tool") {
      return { block: true, reason: "不允许执行危险工具" };
    }
  },

  // tool call 后（可覆盖结果）
  afterToolCall: async (ctx, signal) => {
    return {
      content: [{ type: "text", text: JSON.stringify(ctx.result.details) }],
      isError: false,
    };
  },

  // 消息发给 LLM 前的转换（过滤自定义消息类型）
  convertToLlm: (messages) =>
    messages.filter((m) =>
      ["user", "assistant", "toolResult"].includes(m.role),
    ),

  // 上下文窗口管理（token 压缩等）
  transformContext: async (messages) => {
    if (estimateTokens(messages) > 100000) {
      return pruneOldMessages(messages);
    }
    return messages;
  },
});
```

pi-agent-core 的钩子**数量较少、粒度较粗**，但有两个 tarko 没有的特性：

- `transformContext`：在消息进入 LLM 之前做上下文管理（tarko 需要自己在 onPrepareRequest 里实现）
- `convertToLlm`：显式的消息格式转换层，支持自定义消息类型

---

### 3. LLM 数据消费方式

**@tarko/agent** 使用事件流（Event Stream）模式：

```typescript
// 非流式 — 返回最终 AssistantMessageEvent
const result = await agent.run("问题");
console.log(result.content);

// 流式 — 返回 AsyncIterable<AgentEventStream.Event>
for await (const event of await agent.run({ input: "问题", stream: true })) {
  switch (event.type) {
    case "assistant_message_chunk":
      process.stdout.write(event.content);
      break;
    case "tool_call_start":
      console.log("开始调用工具", event.name);
      break;
    case "agent_run_end":
      console.log("结束，共迭代", event.iterations, "次");
      break;
  }
}

// 也可以监听内部 EventStream
agent.getEventStream().on("*", (event) => {
  /* 全量监听 */
});
```

**pi-agent-core** 使用观察者（Subscribe）模式：

```typescript
// 订阅事件（响应式 UI 友好）
const unsubscribe = agent.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      // 每个流式 chunk
      break;
    case "tool_execution_start":
      showToolLoading(event.toolName);
      break;
    case "tool_execution_end":
      hideToolLoading(event.toolCallId);
      break;
    case "agent_end":
      renderFinalMessages(event.messages);
      break;
  }
});

// 永远是 Promise<void>，数据通过事件推送
await agent.prompt("问题");
unsubscribe();
```

关键区别：

- tarko 流式接口返回 `AsyncIterable`，消费侧用 `for await`，更符合函数式数据流风格
- pi-agent-core 用 `subscribe` + 全局状态，更适合绑定 React/UI 的状态管理
- pi-agent-core 的 `agent.state` 是响应式的，UI 层可以直接读取 `isStreaming`、`streamMessage` 等状态

---

### 4. Tool Call 引擎

**@tarko/agent** 有三种 Tool Call 引擎，可以在不支持 native tool call 的模型上工作：

```typescript
const agent = new Agent({
  toolCallEngine: "native", // 使用模型原生 function calling（默认）
  // toolCallEngine: 'prompt_engineering', // 把工具定义注入 prompt，解析 LLM 文本输出
  // toolCallEngine: 'structured_outputs', // 用结构化输出模式
});
```

**pi-agent-core** 依赖 `pi-ai` 底层的 provider 实现，工具调用能力由 Provider 决定，不提供 prompt engineering 降级方案。

---

### 5. 对话流控制（pi-agent-core 独有特性）

pi-agent-core 有两个 tarko 没有的概念：

```typescript
// Steering：在 Agent 运行中插入引导消息（下一轮 tool call 完成后生效）
agent.steer({
  role: "user",
  content: [{ type: "text", text: "等等，先把结果保存到文件" }],
  timestamp: Date.now(),
});

// FollowUp：Agent 完成当前任务后自动继续的消息
agent.followUp({
  role: "user",
  content: [{ type: "text", text: "现在生成一份执行报告" }],
  timestamp: Date.now(),
});

// 等待空闲
await agent.waitForIdle();
```

这对构建「人在回路（Human-in-the-loop）」交互非常有用，用户可以在 Agent 执行过程中随时介入。

---

### 6. Provider 支持

| Provider          | @tarko/agent              | pi-agent-core       |
| ----------------- | ------------------------- | ------------------- |
| OpenAI            | ✅                        | ✅                  |
| Anthropic         | ✅                        | ✅                  |
| Google Gemini     | ✅                        | ✅                  |
| Azure OpenAI      | ✅                        | ✅                  |
| Amazon Bedrock    | ✅                        | ✅                  |
| Mistral           | ❓                        | ✅                  |
| GitHub Copilot    | ❌                        | ✅（含 OAuth 刷新） |
| Google Vertex AI  | ❌                        | ✅                  |
| Gemini CLI        | ❌                        | ✅                  |
| 自定义 LLM 客户端 | ✅ `setCustomLLMClient()` | ✅ `streamFn` 替换  |

pi-agent-core 的 `pi-ai` 包 Provider 覆盖更广，特别是 GitHub Copilot 的 OAuth token 动态刷新是 tarko 没有的。

---

### 7. 快照与回放（tarko 独有）

```typescript
// 保存快照
const snapshot = await agent.saveSnapshot();

// 用快照创建回放 Agent（确定性上下文）
const replayAgent = new Agent({ snapshot });
replayAgent._setIsReplay();
const result = await replayAgent.run("同样的问题");
// 结果完全可复现
```

这是 tarko 专门为测试和调试设计的功能，可以固化 Agent 的运行上下文，排查生产问题时非常有价值。

---

### 8. 思考/推理模式

| 特性          | @tarko/agent                                         | pi-agent-core                                           |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Thinking 配置 | `thinking: { type: 'enabled', budget_tokens: 1024 }` | `thinkingLevel: 'low' \| 'medium' \| 'high' \| 'xhigh'` |
| 粒度          | token budget                                         | 语义级别（框架自动映射到各 Provider）                   |
| 适用模型      | Claude 系列                                          | 多 Provider 统一抽象                                    |

---

### 9. 自定义消息类型（pi-agent-core 独有）

pi-agent-core 的 `AgentMessage` 支持 TypeScript Declaration Merging，可以添加应用自定义消息类型并保持类型安全：

```typescript
// 在应用代码中扩展
declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    artifact: {
      role: "artifact";
      artifactType: "code" | "image";
      content: string;
      timestamp: number;
    };
    notification: {
      role: "notification";
      level: "info" | "warn" | "error";
      text: string;
      timestamp: number;
    };
  }
}

// 使用自定义消息
agent.appendMessage({
  role: "notification",
  level: "info",
  text: "工具执行耗时 3.2s",
  timestamp: Date.now(),
});
```

这让 Agent 的消息历史可以包含 UI 状态、通知等非 LLM 消息，同时不影响发给 LLM 的内容（通过 `convertToLlm` 过滤）。

---

## 综合对比总结

| 维度           |       @tarko/agent       |      pi-agent-core      |
| -------------- | :----------------------: | :---------------------: |
| 上手难度       |   中（需理解钩子体系）   |  低（构造器注入即可）   |
| 可扩展性       | ★★★★★（继承 + 10+ 钩子） | ★★★☆☆（组合，钩子较少） |
| 生命周期粒度   | 极细（每次 LLM 请求级）  |  适中（tool call 级）   |
| 对话流控制     |        无内置机制        | ★★★★★（steer/followUp） |
| LLM Provider   |        主流全覆盖        | 覆盖更广（含 Copilot）  |
| Tool Call 降级 |    ★★★★★（3 种引擎）     |    ❌ 依赖 Provider     |
| 快照/回放      |            ✅            |           ❌            |
| UI 状态集成    |        需自行封装        |  ★★★★★（响应式 state）  |
| 自定义消息类型 |            ❌            |     ✅（声明合并）      |
| 多模态支持     |  ★★★★★（内置图片管理）   |        基础支持         |
| 可观测性       |   ★★★★★（事件流+日志）   |          ★★★☆☆          |
| 生产验证程度   |  高（15k+ Stars 项目）   |   中（个人项目生态）    |

---

## 适用场景推荐

### 选 @tarko/agent 的场景

**1. 生产级 GUI / 多模态 Agent**
处理截图、UI 操作等多模态任务，内置图片数量限制和上下文压缩，减少 token 浪费。

**2. 需要精确 Tool Call 控制的场景**
通过 `onBeforeLoopTermination` 强制 Agent 必须调用特定工具后才退出，适合 Coding Agent、DeepResearch Agent 等需要严格执行步骤的场景。

**3. 需要支持不具备 native tool call 能力的模型**
三种 Tool Call 引擎让你可以接入任何 LLM，包括本地部署的开源模型。

**4. 需要快照/回放能力的场景**
线上 Agent 出问题，保存现场快照，本地精确复现，适合企业级质量保障流程。

**5. 构建复杂 Agent 子类体系**
通过继承组合 `onPrepareRequest`、`onBeforeLoopTermination` 等，快速搭建 `DeepResearchAgent`、`GUIAgent` 等上层 Agent。

---

### 选 pi-agent-core 的场景

**1. 构建有实时 UI 的 Agent 应用（TUI / Web）**
`subscribe` 事件 + 响应式 `state` 天然对接 React/Vue/Solid，`isStreaming`、`streamMessage`、`pendingToolCalls` 可直接绑定 UI 状态。

**2. 需要 Human-in-the-loop 交互**
`steer()` 和 `followUp()` 让用户可以在 Agent 运行中实时介入引导，适合 AI 聊天助手、协作写作工具等场景。

**3. 需要对接 GitHub Copilot 或 Gemini CLI**
pi-ai 包覆盖了这些非标准 Provider，并支持 OAuth token 动态刷新，省去自己适配的成本。

**4. 自定义消息类型的应用（Artifact、Notification 等）**
声明合并让消息历史可以承载任意应用语义，又不污染 LLM 上下文，适合复杂 UI 状态管理需求。

**5. 快速搭建原型或个人项目**
API 设计直觉友好，代码量更少，不需要理解深层继承体系，迭代速度快。

---

## 总结

两个框架都是优秀的 TypeScript Agent 实现，出发点却又不同：

**@tarko/agent** 是「框架思维」的产物，用继承和丰富的钩子体系给了开发者极大的控制力，代价是需要学习整套钩子协议；它的快照/回放、多种 Tool Call 引擎在需要兼容性更强的生产场景会更方便

**pi-agent-core** 是「库思维」的产物，做的事情更专注（状态管理 + 流控制），用组合代替继承，API 更小更正交；它的 `steer/followUp` 对话流控制和自定义消息类型是 UI 场景的亮点，Provider 覆盖也更广。
