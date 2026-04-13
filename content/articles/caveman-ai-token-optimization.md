---
title: "Caveman-努力在 PE 优化的路上"
date: 2026-04-08
tags:
  - "AI"
  - "Token Optimization"
  - "Claude Code"
  - "Cost Reduction"
showToc: false
TocOpen: false
cover:
  image: ""
  alt: "Caveman Token Optimization"
  caption: ""
  relative: false
---

最近在 GitHub 上看到叫 Caveman 的项目，简单来说，它能让 AI 用"原始人式"的极简语言来交流，目前给出的数据还挺惊人的——平均能节省 65% 的输出 token 和 45% 的输入 token， 那现在来看下它到底做了些什么。

> 本文是对 [Caveman](https://github.com/JuliusBrussee/caveman) 开源项目的调研，了解其 token 压缩的方式

## 一、项目概述

**项目名称**: caveman  
**GitHub**: https://github.com/JuliusBrussee/caveman  
**作者**: Julius Brussee  
**发布时间**: 2026年  
**许可证**: MIT

### 1.1 项目定位

Caveman 是一个 AI 代理沟通优化工具，通过让 LLM（大语言模型）以"原始人式极简语言"（caveman-speak）进行交流，实现显著的 token 节省。该项目包含两个核心组件：

1. **caveman skill** —— 压缩 AI 输出，减少约 65% 的输出 token
2. **caveman-compress** —— 压缩记忆文件，减少约 45% 的输入 token

## 二、核心原理：为什么能节省 Token？

### 2.1 自然语言的冗余性

现代英语（及其他自然语言）包含大量**语义冗余**：

| 冗余类型 | 示例                                      | token 浪费      |
| -------- | ----------------------------------------- | --------------- |
| 客套话   | "I'd be happy to help you with that"      | 8 tokens        |
| 填充词   | "The reason this is happening is because" | 7 tokens        |
| 模糊措辞 | "I would recommend that you consider"     | 6 tokens        |
| 冠词     | "a", "an", "the"                          | 每句 2-3 tokens |
| 连接词   | "however", "furthermore", "additionally"  | 每句 1-2 tokens |

### 2.2 Caveman 压缩策略

Caveman 通过以下策略去除冗余，同时保留所有技术实质：

#### 去除的内容

- **冠词**: a, an, the → 直接删除
- **填充词**: just, really, basically, actually, simply → 删除
- **客套话**: "Sure!", "I'd be happy to" → 直接删除
- **模糊措辞**: "it might be worth considering" → 直接陈述
- **冗长短语**: "in order to" → "to"

#### 语言风格转换

- **完整句子** → **片段句**
- **长词** → **短词** (extensive → big, implement a solution → fix)
- **因果关系** → **箭头符号** (X → Y)
- **被动语态** → **主动语态**

### 2.3 效果对比示例

#### 示例 1：技术解释

| 模式     | 回复                                                                                                                                                                                                                                                                                                                           | Token 数 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 正常     | "The reason your React component is re-rendering is likely because you're creating a new object reference on each render cycle. When you pass an inline object as a prop, React's shallow comparison sees it as a different object every time, which triggers a re-render. I'd recommend using useMemo to memoize the object." | 69       |
| Caveman  | "New object ref each render. Inline object prop = new ref = re-render. Wrap in `useMemo`."                                                                                                                                                                                                                                     | 19       |
| **节省** |                                                                                                                                                                                                                                                                                                                                | **72%**  |

#### 示例 2：Bug 修复

| 模式     | 回复                                                                                                                                                                                                              | Token 数 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 正常     | "Sure! I'd be happy to help you with that. The issue you're experiencing is most likely caused by your authentication middleware not properly validating the token expiry. Let me take a look and suggest a fix." | ~40      |
| Caveman  | "Bug in auth middleware. Token expiry check use `<` not `<=`. Fix:"                                                                                                                                               | ~15      |
| **节省** |                                                                                                                                                                                                                   | **63%**  |

## 三、双组件架构详解

### 3.1 Caveman Skill（输出端压缩）

**作用**: 修改 AI 的 system prompt，使其以极简风格回复

**使用方式**:

```bash
/caveman           # 启用默认模式
/caveman lite      # 轻度压缩，保留语法
/caveman full      # 完全压缩（默认）
/caveman ultra     # 极限压缩
```

**强度级别对比**:

| 级别  | 触发词           | 风格                 | 示例（解释 React 重渲染）                                                                                |
| ----- | ---------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| Lite  | `/caveman lite`  | 去除填充，保留完整句 | "Your component re-renders because you create a new object reference each render. Wrap it in `useMemo`." |
| Full  | `/caveman full`  | 去除冠词，片段句     | "New object ref each render. Inline object prop = new ref = re-render. Wrap in `useMemo`."               |
| Ultra | `/caveman ultra` | 极限缩写，符号化     | "Inline obj prop → new ref → re-render. `useMemo`."                                                      |

### 3.2 Caveman Compress（输入端压缩）

**作用**: 压缩记忆文件（CLAUDE.md、项目笔记等），减少每次会话加载时的输入 token

**工作流程**:

```
detect file type → compress with Claude → validate → (if errors) fix
```

**文件处理规则**:

| 文件类型             | 处理方式         | 原因     |
| -------------------- | ---------------- | -------- |
| .md, .txt            | 压缩自然语言部分 | 可压缩   |
| .py, .js, .ts 等代码 | 跳过             | 不可压缩 |
| .json, .yaml 等配置  | 跳过             | 不可压缩 |

**压缩效果示例**:

原始 CLAUDE.md（节选）:

```markdown
Taskflow is a full-stack task management application built with a modern web stack.
The application allows teams to create, assign, track, and manage tasks across
multiple projects with real-time collaboration features. It was originally created
as an internal tool for our engineering team and has since been open-sourced.
```

压缩后:

```markdown
Taskflow full-stack task management app. Teams create, assign, track, manage tasks
across projects with real-time collaboration. Started internal tool, now open-source.
```

## 四、实测数据与效果

### 4.1 官方 Benchmark 数据

| 任务                                    | 正常 Token | Caveman Token | 节省比例 |
| --------------------------------------- | ---------- | ------------- | -------- |
| Explain React re-render bug             | 1180       | 159           | **87%**  |
| Fix auth middleware token expiry        | 704        | 121           | **83%**  |
| Set up PostgreSQL connection pool       | 2347       | 380           | **84%**  |
| Explain git rebase vs merge             | 702        | 292           | **58%**  |
| Refactor callback to async/await        | 387        | 301           | **22%**  |
| Architecture: microservices vs monolith | 446        | 310           | **30%**  |
| Review PR for security issues           | 678        | 398           | **41%**  |
| Docker multi-stage build                | 1042       | 290           | **72%**  |
| Debug PostgreSQL race condition         | 1200       | 232           | **81%**  |
| Implement React error boundary          | 3454       | 456           | **87%**  |
| **平均**                                | **1214**   | **294**       | **65%**  |

### 4.2 Caveman Compress Benchmark

| 文件                     | 原始 Token | 压缩后  | 节省比例  |
| ------------------------ | ---------- | ------- | --------- |
| claude-md-preferences.md | 706        | 285     | **59.6%** |
| project-notes.md         | 1145       | 535     | **53.3%** |
| claude-md-project.md     | 1122       | 687     | **38.8%** |
| todo-list.md             | 627        | 388     | **38.1%** |
| mixed-with-code.md       | 888        | 574     | **35.4%** |
| **平均**                 | **898**    | **494** | **45%**   |

### 4.3 综合收益

| 优化方向         | 节省类型     | 节省比例              |
| ---------------- | ------------ | --------------------- |
| caveman skill    | 输出 token   | ~65%                  |
| caveman-compress | 输入 token   | ~45%                  |
| **两者结合**     | **整体会话** | **输入+输出双重节省** |

## 五、负面影响与风险

### 5.1 人类可读性下降

**问题**: Caveman 风格对人类阅读者极不友好

**案例对比**:

- 正常: "The issue is caused by a race condition in the authentication middleware when handling concurrent token refresh requests."
- Caveman: "Race condition auth middleware. Concurrent token refresh."

**影响**: 需要人工审核 AI 输出时，理解成本显著增加

### 5.2 可能的语义歧义

**问题**: 过度压缩可能导致关键信息丢失或误解

**风险场景**:

- 复杂条件语句（if/else 嵌套）
- 多步骤操作流程
- 安全警告和不可逆操作确认

**项目提供的解决方案**: Auto-Clarity 机制 —— 在安全警告等场景自动恢复清晰表达

### 5.3 不适用于所有场景

| 场景       | 适用性    | 原因                     |
| ---------- | --------- | ------------------------ |
| 代码生成   | ✅ 适合   | 代码块保持原样           |
| 技术解释   | ✅ 适合   | 保留技术术语             |
| 安全警告   | ❌ 不适合 | 需要绝对清晰             |
| 复杂流程   | ⚠️ 谨慎   | 步骤顺序可能混淆         |
| 新用户引导 | ❌ 不适合 | 需要完整上下文           |
| API 文档   | ⚠️ 谨慎   | 示例代码保留，但说明压缩 |

### 5.4 对 LLM 理解的依赖

**问题**: Caveman 模式依赖于 AI 能够正确解析极简语言

**潜在风险**:

- 某些 LLM 可能对极简风格的理解能力不同
- 复杂推理任务可能因语言压缩而准确性下降
- 需要持续验证压缩后的输出质量

### 5.5 技术限制

1. **仅影响输出 token**: 思考/推理 token 不受影响（这是好事，确保"大脑"不降智）
2. **需要显式触发**: 不会自动应用于所有对话
3. **会话级生效**: 设置后持续到会话结束或手动关闭

## 六、科学理论支撑

### 6.1 研究论文引用

项目引用了 2026 年 3 月的论文 **"Brevity Constraints Reverse Performance Hierarchies in Language Models"**：

> 限制大模型生成简短回复**在某些基准测试中提高了 26 个百分点的准确率**，并完全逆转了性能层级。冗长并不总是更好。

### 6.2 理论解释

为什么"少即是多"？

1. **减少幻觉**: 更少 token = 更少"编故事"的空间
2. **聚焦核心**: 去除修饰迫使模型关注实质
3. **降低噪声**: 减少无关信息干扰

## 七、安装与使用

### 7.1 安装方式

**通用安装**（支持 40+ 代理）:

```bash
npx skills add JuliusBrussee/caveman
```

**Claude Code 插件**:

```bash
claude plugin marketplace add JuliusBrussee/caveman
claude plugin install caveman@caveman
```

**特定代理**:

```bash
npx skills add JuliusBrussee/caveman -a cursor
npx skills add JuliusBrussee/caveman -a github-copilot
npx skills add JuliusBrussee/caveman -a cline
npx skills add JuliusBrussee/caveman -a windsurf
```

### 7.2 使用方法

**启用 Caveman**:

- `/caveman` 或 `$caveman`（Codex）
- "talk like caveman"
- "caveman mode"

**关闭 Caveman**:

- "stop caveman"
- "normal mode"

**压缩记忆文件**:

```bash
/caveman-compress CLAUDE.md
```

## 八、总结与评价

### 8.1 创新价值

Caveman 是一个**有趣且实用**的创新：

- **证明了"极简沟通"的可行性**: 用数据说话，65% 的平均节省不是噱头
- **双端优化思路**: 同时压缩输入和输出，实现全链路优化
- **强度分级设计**: 满足不同场景的压缩需求

### 8.2 实用价值

对于**高频使用 AI 的开发团队**：

- 直接降低 API 调用成本
- 加快响应速度（约 3 倍）
- 减少"AI 废话"，提高效率

### 8.3 局限性

- **不是银弹**: 不适用于所有场景
- **需要权衡**: 在成本和可读性之间做选择
- **学习成本**: 团队成员需要适应新的沟通风格

---

_数据来源: GitHub 官方仓库、项目文档、实测案例_
