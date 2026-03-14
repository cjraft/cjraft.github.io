---
title: "Code Mode & Code Execution"
date: 2026-03-06
tags:
  - "MCP"
  - "Code Execution"
  - "Agent"
  - "Cloudflare"
showToc: true
TocOpen: true
---

## 背景：MCP 工具调用的问题 {#背景}

2024 年 11 月，Anthropic 开源 Model Context Protocol（MCP）后，社区热情高涨，几个月内涌现出数千个 MCP 服务器。但随着实际应用深入，一个根本性的矛盾暴露出来：

**MCP 的工具越多，Agent 越傻。**

传统 MCP 的工作流是这样的：

```
用户请求 → 加载所有工具定义 → 塞进上下文 → LLM 选择工具 → 返回结果 → 再喂给 LLM
```

这里有两个致命的 Token 黑洞：

**问题一：工具定义开销爆炸**

每个工具都需要在系统提示或上下文中描述清楚——名称、参数、类型、含义。接入 5 个 MCP 服务器，每个 20 个工具，光工具定义就能吃掉十几万 Token，模型还没开始干活。

Cloudflare 给出了一个极端案例：其 API 有 2,500+ 个端点，如果全量转化为 MCP 工具，需要 **1,170,523 个 Token**——超过当前最先进模型的整个上下文窗口。

**问题二：中间结果污染上下文**

Agent 调用工具获取数据，结果必须经过上下文"传送"给下一轮推理。一份会议纪要、一张电子表格，动辄几万字，全塞进去，效率直接崩了。

Anthropic 的实测数据：一个包含转录文本传输的工作流，仅中间数据就多消耗了约 **50,000 Token**。

这就是为什么 2025 年底，Cloudflare 和 Anthropic 几乎同时，从不同角度提出了同一个解法：**让 Agent 写代码，而不是喊话。**

---

## 两条殊途同归的路 {#两条路}

| 维度         | Cloudflare Code Mode                    | Anthropic Code Execution with MCP |
| ------------ | --------------------------------------- | --------------------------------- |
| 发布时间     | 2026 年 2 月                            | 2025 年 11 月                     |
| 核心思路     | 服务端封装，2 个工具代替 2500 个        | 客户端文件系统，按需加载定义      |
| 执行环境     | Cloudflare Dynamic Worker（V8 Isolate） | 客户端沙箱（可插拔）              |
| 语言         | JavaScript                              | TypeScript / Python               |
| 工具发现方式 | `search()` + 内嵌 OpenAPI spec          | 文件系统目录树浏览                |
| 认证方式     | OAuth 2.1 + Worker Binding              | MCP Client 持有 Token             |
| 适用场景     | 大规模 API 访问（Cloudflare 生态）      | 通用多服务器编排                  |
| Token 节省   | 99.9%（vs 全量 MCP）                    | 98.7%（vs 传统工具加载）          |
| 开源状态     | `@cloudflare/codemode` 实验性           | 设计模式，非框架                  |

两者的交集在于一个核心洞察：**LLM 写代码比调用 JSON 格式的工具更擅长，因为它见过的代码比见过的 tool_call 格式多出几个数量级。**

---

## Cloudflare Code Mode：服务端的极简主义 {#cloudflare-code-mode}

### 设计哲学

Code Mode 的核心是一种**服务端封装策略**：把庞大的 API 文档锁在服务器端，只给 Agent 两把钥匙：

- **`search()`**：让 Agent 用 JavaScript 代码在 OpenAPI spec 里检索端点
- **`execute()`**：让 Agent 用 JavaScript 代码调用找到的端点

API 规格说明永远不进入模型上下文——Agent 只拿到它需要的那一片段的结果。

### 架构全景

```
┌─────────────────────────────────────────────────┐
│                  AI Agent                        │
│                                                  │
│   write JS code → search() or execute()         │
└──────────────────┬──────────────────────────────┘
                   │ MCP Protocol
                   ▼
┌─────────────────────────────────────────────────┐
│          Cloudflare MCP Server                  │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │     Dynamic Worker Loader (V8 Isolate)   │   │
│  │                                          │   │
│  │  • No filesystem access                  │   │
│  │  • No env variable leakage               │   │
│  │  • External fetch() blocked by default   │   │
│  │  • Agent Supervisor holds credentials    │   │
│  └──────────────────────────────────────────┘   │
│                   │                              │
│                   ▼                              │
│          Cloudflare API (2,500+ endpoints)       │
└─────────────────────────────────────────────────┘
```

### 实际运行示例：DDoS 防护配置

一个要"给 origin 配置 DDoS 防护"的 Agent，完整流程只需 4 次工具调用：

**第一步：用代码搜索相关端点**

```javascript
// Agent 调用 search()，传入过滤逻辑代码
spec.paths
  .filter(
    (path) =>
      path.includes("/zones/") &&
      (path.includes("firewall/waf") || path.includes("rulesets")),
  )
  .map((path) => ({ path, operations: spec.paths[path] }));
```

服务器执行这段代码，返回匹配的端点列表（不是完整 spec）。

**第二步：用代码执行配置**

```javascript
// Agent 调用 execute()
const rulesets = await cloudflare.request("GET", "/zones/{zone_id}/rulesets");
const ddosRuleset = rulesets.find((r) => r.phase === "ddos_l7");
await cloudflare.request(
  "PUT",
  `/zones/{zone_id}/rulesets/${ddosRuleset.id}/rules`,
  {
    action: "execute",
    action_parameters: { id: "ddos_protection" },
  },
);
```

整个过程，上下文中只有代码和执行结果，永远不会出现 2MB 的 OpenAPI 文档。

### Dynamic Worker Loader：沙箱技术核心

Code Mode 的执行引擎是 Cloudflare 2026 年初推出的 **Dynamic Worker Loader API**，核心特性：

```typescript
// 动态实例化一个 Worker 来执行 Agent 生成的代码
let worker = env.LOADER.get(id, async () => {
  return {
    compatibilityDate: "2025-06-01",
    mainModule: "agent_code.js",
    modules: { "agent_code.js": agentGeneratedCode },
    env: {
      // 只注入 MCP 服务绑定，不注入任何 secret
      CLOUDFLARE_API: mcpServerBinding,
    },
  };
});

const result = await worker.run();
```

每次代码执行都在独立的 V8 Isolate 中运行，执行完即销毁（disposable model）。

---

## Anthropic Code Execution with MCP

### 设计哲学

Anthropic 的方案更像一套**系统架构指导原则**，核心是重新设计 Agent 与工具的接口方式：

**把工具变成文件，把调用变成 import。**

不再在 prompt 里声明所有工具，而是把工具定义组织成文件系统目录：

```
servers/
├── google-drive/
│   ├── index.ts          # 导出所有函数
│   ├── getDocument.ts    # 单个工具实现
│   └── listFiles.ts
├── salesforce/
│   ├── index.ts
│   ├── updateRecord.ts
│   └── queryRecords.ts
└── github/
    ├── index.ts
    └── createPR.ts
```

Agent 像一个程序员一样：先 `ls` 看看有什么，再按需 `read` 定义，最后写代码调用。

### 工作流对比

**传统 MCP 调用流程：**

```
用户请求
  → 加载所有工具定义（150,000 tokens）
    → LLM 输出 tool_call JSON
      → 执行工具
        → 结果塞回上下文（+50,000 tokens）
          → LLM 再推理...
```

**Code Execution with MCP 流程：**

```
用户请求
  → Agent 发现工具文件树（2,000 tokens 完成）
    → 按需读取具体工具定义
      → 编写执行代码
        → 沙箱执行，中间数据留在沙箱
          → 只返回最终摘要
```

### 典型代码示例

```typescript
// Agent 生成的代码（在沙箱中执行）
import * as gdrive from "./servers/google-drive";
import * as salesforce from "./servers/salesforce";

// 获取会议记录（数据留在沙箱，不进 LLM 上下文）
const transcript = (
  await gdrive.getDocument({
    documentId: "abc123",
  })
).content;

// 在沙箱内处理：提取关键决议
const actionItems = transcript
  .split("\n")
  .filter((line) => line.startsWith("ACTION:"));

// 只把精炼结果写回给 LLM
await salesforce.updateRecord({
  objectType: "SalesMeeting",
  recordId: "00Q5f000001abcXYZ",
  data: { ActionItems: actionItems.join("\n") }, // 不是原始 transcript！
});

console.log(`Updated ${actionItems.length} action items`);
```

原始转录文本（可能几万字）在沙箱内处理，只有 `actionItems` 的摘要最终返回给模型。

---

## 核心设计理念：为什么是代码，而不是 JSON {#核心设计理念}

这是两个方案最值得玩味的共同洞察，也是整个范式转变的哲学基础。

### LLM 的训练数据分布

LLM 在预训练阶段接触了大量真实世界的代码——GitHub 上的亿级代码库、Stack Overflow 的问答、技术博客。但"MCP tool call JSON"这种格式，在训练数据里几乎是零。

```
训练数据中:
  代码 (Python/TypeScript/JS) ████████████████████ 海量
  API tool_call JSON 格式     █ 极少（主要来自合成数据）
```

这意味着：

- 让 LLM 写代码 → 它有海量参考，表现稳定
- 让 LLM 输出 tool_call JSON → 它在猜测一种罕见的格式，容易出错

Cloudflare 工程师在博客中直接点明：

> "LLMs have seen a lot of code. They have not seen a lot of 'tool calls' in real-world contexts, making code generation substantially more reliable than direct tool invocation."

### 类型系统提供隐式文档

当工具被转换为 TypeScript 接口时，类型签名本身就是文档：

```typescript
// 这比 JSON schema 更直观，LLM 更熟悉
async function createDnsRecord(params: {
  zoneId: string; // The Zone ID
  name: string; // DNS record name (e.g., "example.com")
  type: "A" | "AAAA" | "CNAME" | "MX";
  content: string; // IP address or hostname
  ttl?: number; // Time to live (default: 3600)
  proxied?: boolean; // Enable Cloudflare proxy (default: false)
}): Promise<DnsRecord>;
```

JSDoc 注释 + TypeScript 类型 = LLM 最熟悉的 API 文档形式。

---

## 沙箱安全模型对比 {#沙箱安全模型}

代码执行的安全性是最关键的问题。两种方案都选择了 V8 Isolate（而非容器），但侧重点不同。

### V8 Isolate vs 容器：选择的逻辑

| 维度     | V8 Isolate                     | 容器 (Docker)              |
| -------- | ------------------------------ | -------------------------- |
| 启动时间 | 毫秒级                         | 秒级                       |
| 内存占用 | 几 MB                          | 几百 MB                    |
| 隔离级别 | 内存级别（同进程不同 Isolate） | 进程/内核级别              |
| 支持语言 | JavaScript / WebAssembly       | 任意                       |
| 成本     | 极低                           | 较高                       |
| 适合场景 | 高频、短时、轻量代码           | 长时运行、需要完整系统调用 |

对于 Agent 生成的短时工具调用代码，V8 Isolate 是完美选择。

### Cloudflare 的安全层次

**第一层：网络隔离**

```typescript
// Wrangler 配置中，外部网络完全封锁
const executor = new DynamicWorkerExecutor({
  loader: env.LOADER,
  globalOutbound: null, // null = 完全禁止外部 fetch()
});
```

不是"过滤"，而是"不存在"。Isolate 里根本没有 Internet 连接。

**第二层：Binding 访问控制**

认证信息不注入到 Isolate 的代码环境中，而是通过 Binding 对象提供：

```typescript
// Agent 的代码只能调用 binding 提供的方法
// 无法通过 process.env 或任何方式泄露 API Key
const result = await cloudflare.request("GET", "/zones");
// cloudflare 是一个 Binding 对象，不是真实的 fetch
```

即使 Agent 写了恶意代码 `console.log(process.env.CF_API_KEY)`，也拿不到任何东西，因为环境变量根本不在 Isolate 里。

**第三层：Agent Supervisor 授权**

```
┌──────────────────────────┐
│    Agent Supervisor      │  ← 持有真实 API Token
│                          │
│  ┌───────────────────┐   │
│  │  V8 Isolate       │   │  ← Agent 代码在这里运行
│  │                   │   │
│  │  cloudflare.      │   │  ← 调用时 Supervisor 注入 Token
│  │  request(...)     │───┤
│  └───────────────────┘   │
└──────────────────────────┘
```

所有对 Cloudflare API 的请求先经过 Supervisor，由 Supervisor 添加认证头。AI 永远看不到真实的 Token。

---

## Token 效率 {#token-效率}

### Cloudflare API 场景的 Token 对比

| 方案                  | Token 消耗 | 占 200K 上下文的比例 |
| --------------------- | ---------- | -------------------- |
| 原始 OpenAPI Spec     | ~2,000,000 | 977%                 |
| 完整 MCP（含 Schema） | 1,170,523  | 585%                 |
| 精简 MCP（最小参数）  | 244,047    | 122%                 |
| Code Mode             | **1,069**  | **0.5%**             |

Code Mode 比"精简 MCP"还节省 **99.6%**。

### Anthropic 场景的实测数据

| 指标                   | 传统 MCP | Code Execution | 节省  |
| ---------------------- | -------- | -------------- | ----- |
| 工具定义加载 Token     | 150,000  | 2,000          | 98.7% |
| 含数据传输的完整工作流 | 771,000  | 165,000        | 78.5% |

---

## Agent Skills：从工具调用到能力积累 {#agent-skills}

Anthropic 方案中最具前瞻性的概念之一是 **Skill（技能）**，这让 Agent 从单次任务执行进化到能力持续积累。

### Skills 的工作原理

```
./skills/
├── create-jira-from-alert.ts      # 之前任务中提炼的技能
├── sync-meeting-notes.ts          # 可复用的工作流封装
└── batch-user-provisioning.ts     # 复杂操作的抽象
```

当 Agent 成功完成一项复杂任务后，可以把核心逻辑提炼成 Skill 保存起来。下次面对类似任务，Agent 先扫描 skills 目录，直接复用而不是从头推理。

---

## 架构权衡与适用场景 {#架构权衡}

### 代码执行的代价

**可靠性风险**

LLM 写的代码不保证语法正确，也不保证逻辑正确。需要完善的错误捕获和重试机制。

**基础设施成本**

你需要一个安全的代码执行环境：Cloudflare Code Mode 依赖 Dynamic Worker Loader（目前是 closed beta）。

### 适用场景矩阵

| 场景                                      | 推荐方案       | 理由                 |
| ----------------------------------------- | -------------- | -------------------- |
| 访问单一大型 API（如 Cloudflare、Stripe） | Code Mode      | 服务端封装，简单接入 |
| 多服务编排（CRM + 云存储 + 通知）         | Code Execution | 客户端灵活组合       |
| 需要处理敏感 PII                          | Code Execution | 数据不出沙箱         |
| 简单问答、单工具调用                      | 传统 MCP       | 无需引入额外复杂度   |

---

## 行业意义与未来展望 {#行业意义}

### 两个独立团队的趋同验证

Cloudflare 和 Anthropic 在几乎相同的时间窗口内，基于各自的实践经验，独立得出了同一个结论：**代码是 AI Agent 调用工具的更好抽象**。

这种趋同（convergence）本身就是强信号——它说明这不是一家公司的特定偏好，而是工程实践揭示的客观规律。

### MCP 本身的进化方向

Code Mode 并非要取代 MCP，而是在 MCP 之上的一种**使用范式**的进化：

```
MCP 1.0: 标准化工具定义格式 ✓（已完成）
MCP 2.0: 标准化代码执行接口？（正在发生）
```

可以预见，未来 MCP 规范可能会纳入代码执行相关的标准——比如沙箱接口、类型定义导出格式等。

---

## 总结：一场正在发生的范式迁移

| 旧范式（传统 MCP 工具调用）  | 新范式（代码执行）             |
| ---------------------------- | ------------------------------ |
| LLM 输出 tool_call JSON      | LLM 输出可执行代码             |
| 工具定义全量加载             | 按需发现和加载                 |
| 中间数据过上下文             | 中间数据留在沙箱               |
| 串行工具调用                 | 并发代码执行                   |
| 无状态（每次从零开始）       | 有状态（技能积累，进度持久化） |
| 隐私依赖模型服务商           | 隐私可控（PII 不进模型）       |
| Token 消耗随工具数量线性增长 | Token 消耗接近常数             |

AI Agent 正在从"一个会按按钮的机器人"，进化为"一个会写程序的工程师"。

这不仅是工程效率的提升，更是 Agent 自主能力的质变——当工具调用变成代码，Agent 就获得了组合、抽象、复用的能力，而这正是软件工程的本质。

---

## 参考资料 {#参考资料}

1. [Code Mode: give agents an entire API in 1,000 tokens — Cloudflare Blog](https://blog.cloudflare.com/code-mode-mcp/)
2. [Code execution with MCP: building more efficient AI agents — Anthropic Engineering](https://www.anthropic.com/engineering/code-execution-with-mcp)
3. [Cloudflare MCP Server — GitHub](https://github.com/cloudflare/mcp)
4. [Code Mode: the better way to use MCP — Cloudflare Blog](https://blog.cloudflare.com/code-mode/)
5. [Codemode API Reference — Cloudflare Agents Docs](https://developers.cloudflare.com/agents/api-reference/codemode/)
6. [Dynamic Worker Loaders — Cloudflare Workers Docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/)

---

_调研日期：2026-03-06_
_关联话题：MCP, AI Agent, 代码执行, 沙箱安全, Token 效率_
