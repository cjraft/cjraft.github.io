---
title: "Prompt Cache 技术 & 应用研究"
date: 2026-02-02
tags:
  - "Prompt Cache"
showToc: false
TocOpen: false
---

_研究范围：Anthropic、OpenAI、Google Gemini、月之暗面 Kimi、字节豆包、DeepSeek、开源实现（vLLM/SGLang）_

## 概述

Prompt Caching（提示缓存）是 LLM 推理优化的核心技术之一，通过缓存重复提示前缀的 KV（Key-Value）向量来减少计算冗余，实现成本降低和延迟降低的目的。下面从基本技术原理、系统架构实现、各厂商方案差异三个维度进行深入分析。

---

## 一、技术原理

### 1.1 基础：KV Cache 机制

在 Transformer 自注意力机制中，每个 token 的生成需要依赖之前所有 token 的 Key 和 Value 向量。KV Cache 的核心思想是存储已计算 token 的 KV 向量，避免重复计算。

**内存开销计算（标准 MHA）：**

这里的 MHA 指的是 Multi-Head Attention，也就是标准的多头注意力机制。在这种结构里，每个 attention head 都各自维护一组 Key 和 Value，因此 KV Cache 的开销会随着 head 数量线性增长。后面常见的 GQA、MQA、MLA，本质上都是在不同层面降低这部分缓存成本。

```
KV Cache Size = 2 × num_layers × num_heads × head_dim × seq_len × batch_size × sizeof(dtype)
```

其中各参数含义如下：

- `2`：同时缓存 Key 和 Value 两份张量
- `num_layers`：Transformer 层数，每一层都需要维护自己的 KV Cache
- `num_heads`：Attention 头数，标准 MHA 下每个头各自维护一组 K/V
- `head_dim`：每个 Attention 头的维度，通常等于 `hidden_size / num_heads`
- `seq_len`：当前上下文长度，也就是需要缓存的 token 数量
- `batch_size`：并行推理的序列数
- `sizeof(dtype)`：缓存元素的数据类型大小，FP16/BF16 通常为 2 字节，FP32 通常为 4 字节

以 Llama-3-70B 参数规模为例，若按标准 MHA 估算公式并取 `80 层、64 头、head_dim=128、FP16、batch_size=1`：

```
8K 上下文：
2 × 80 × 64 × 128 × 8192 × 1 × 2
= 21,474,836,480 Bytes
≈ 21.5 GB
≈ 20 GiB
```

因此 `8K` 上下文对应的单序列 KV Cache 约为 `20 GiB`, 这是推理阶段的主要内存瓶颈。

- 这里的 `20 GiB` 可以理解为：在标准 MHA、8K 上下文、FP16、单序列的理论估算下，并不意味着在线服务里真的有这么大的占用， 很多商用模型并不是标准 MHA，而是使用 GQA、MQA 或 MLA 来显著降低单请求 KV 开销。常见数据中心 GPU 的显存虽然可以达到 40 GB（NVIDIA A100）、80 GB （NVIDIA H100），甚至更高，但如果不做这些优化，单卡并发能力依然会非常有限。

- 活跃请求的 KV Cache 通常主要放在 GPU 显存里，而不是普通 CPU 内存， 因为模型参数在显存、 计算发生在 GPU 中。

### 1.2 Prompt Caching 为什么成立

Prompt Caching 本质上是跨请求共享 KV Cache。它之所以成立，是因为在自回归生成中，当前 token 的计算只依赖它之前的前缀；如果两个请求在某一段前缀上完全一致，那么这段前缀已经计算过的 KV 就可以直接复用。

```
生成 Token N 时，只需要 Token 0...N-1 的 KV Cache
⇒ 如果两个请求的 Token 0...N-1 完全相同
⇒ 这段前缀对应的 KV Cache 可以被复用
```

**前缀缓存的查找键生成：**

- 对 Prompt Prefix 计算 SHA-256 哈希
- 或使用块级哈希（Block Hash）配合父哈希链

**缓存命中条件：**

1. 精确前缀匹配（主流方案）：整个前缀必须完全一致
2. 子串匹配（部分实现）：最长公共子串复用
3. 语义匹配（研究阶段）：语义相似但文本不同的 prompt

---

## 二、厂商实现对比

### 2.1 API 设计模式对比

| 厂商             | 模式           | 控制方式                    | 最小 Token | 默认 TTL         | 定价特点               |
| ---------------- | -------------- | --------------------------- | ---------- | ---------------- | ---------------------- |
| Anthropic Claude | 显式           | `cache_control` 参数        | 1024-2048  | 5 分钟           | 写: +25%, 读: -90%     |
| OpenAI           | 隐式           | 自动（无配置）              | 1024       | 5-10 分钟        | 统一价格，自动折扣 50% |
| Google Gemini    | 混合           | 隐式 + 显式 `cachedContent` | 1024/4096  | 1 小时（可定制） | 按存储时长计费         |
| 月之暗面 Kimi    | 隐式为主       | 自动（部分模型支持手动）    | 未明确     | 未明确           | 自动 75% 折扣          |
| 字节豆包         | 上下文长度定价 | 隐式                        | 未明确     | 未明确           | 按上下文长度分档定价   |
| DeepSeek         | 隐式           | 自动（内部实现）            | 未明确     | 未明确           | MLA 架构优势           |

### 2.2 详细实现差异

#### 2.2.1 Anthropic Claude：显式控制（Explicit）

**API 设计：**

```python
response = client.beta.prompt_caching.messages.create(
    model="claude-3-5-sonnet",
    system=[
        {"type": "text", "text": "System instructions"},
        {"type": "text", "text": large_document,
         "cache_control": {"type": "ephemeral"}}  # ← 显式标记
    ],
    messages=[...]
)
```

**技术特点：**

- 支持最多 4 个缓存断点
- 精确控制哪些部分被缓存
- 缓存写成本：$3.75/MTok（Sonnet）
- 缓存读成本：$0.30/MTok（10x 节省）

**最佳实践（来自 Claude Code 团队）：**

1. 静态内容前置：System Prompt → Tools → CLAUDE.md → Conversation
2. 避免修改已缓存前缀：更新信息用 `<system-reminder>` 标签放在 user message 中
3. 不要会话中途切换模型：不同模型的 KV 表示不同
4. 不要动态增删工具：Tool 定义变更会破坏缓存

#### 2.2.2 OpenAI：完全自动（Implicit）

**API 设计：**

```python
# 无需任何特殊配置
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": large_system_prompt},  # 自动缓存
        {"role": "user", "content": user_query}
    ]
)

# 可选：增强缓存路由
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[...],
    prompt_cache_key="docs-v1",           # 手动分组
    prompt_cache_retention="extended"     # 延长保留
)
```

**技术特点：**

- 零配置，向后兼容
- 基于前缀哈希的路由（前 256 tokens）
- 缓存粒度：1024 tokens 后，每 128 tokens 递增
- 高峰期缓存可能持续 1 小时

优势：简单，无学习成本
劣势：可控性差，难以调试缓存命中率

#### 2.2.3 Google Gemini：混合模式

**隐式缓存（自动）：**

- Gemini 2.5 Flash: 1024 tokens 最小
- Gemini 2.5 Pro: 4096 tokens 最小
- 自动应用于重复内容

**显式缓存（Context Caching API）：**

```python
# 创建缓存
cache = client.caches.create(
    model="gemini-1.5-pro-001",
    config=CreateCachedContentConfig(
        contents=[large_document],
        system_instruction="...",
        ttl="3600s"  # 可定制TTL
    )
)

# 使用缓存
response = client.models.generate_content(
    model="gemini-1.5-pro-001",
    contents="User question",
    config=GenerateContentConfig(cached_content=cache.name)
)
```

**技术特点：**

- 最长默认 TTL（1 小时）
- 显式缓存按存储时长额外收费
- 支持多模态内容缓存（图片、PDF、视频）

#### 2.2.4 月之暗面 Kimi：自动为主

**定价策略（2025-2026）：**

```
Cache创建: ¥4/MTok（原¥24）
Cache存储: ¥1/MTok/分钟（原¥5）
Cache调用: ¥0.01/Request（原¥0.02）
```

**实现特点：**

- `kimi-latest` 模型支持自动上下文缓存
- 缓存命中 tokens 按 ¥1/MTok 计费（75% 折扣）
- 暂不支持手动缓存控制（部分模型）

#### 2.2.5 DeepSeek：架构级优化

**核心优势：MLA 架构**

- 不依赖外部 Prompt Caching API
- 通过低秩压缩从根本上降低 KV Cache 内存占用
- 支持更长上下文的低成本推理
- 与系统级缓存可以叠加使用

---

## 三、定价与成本分析

### 3.1 典型成本对比

以下厂商报价通常以 `每百万 tokens`（`MTok`）为计价单位；下表展示的是在 `100K tokens` 上下文、10 轮对话这一具体场景下，按对应单价折算后的实际成本。

> `100K tokens = 100,000 tokens = 0.1 MTok`

| 厂商             | 首次请求 | 后续请求（缓存命中） | 10 轮总成本 | 节省比例 |
| ---------------- | -------- | -------------------- | ----------- | -------- |
| Anthropic Sonnet | $0.39    | $0.04                | $0.75       | 76%      |
| OpenAI GPT-4o    | $0.26    | $0.13                | $1.45       | 53%      |
| Kimi K2.5        | ~$0.09   | ~$0.02               | ~$0.27      | 75%      |
| 无缓存基准       | -        | -                    | ~$3.00      | 0%       |

### 3.2 成本优化与 Prompt 结构设计

Prompt Caching 的成本优化，本质上取决于缓存命中率，而缓存命中率又直接受 Prompt 结构影响。一个更稳定的前缀，通常比单纯比较厂商单价更重要。

**推荐布局：**

```
[系统提示 - 静态]         ← 缓存
[工具定义 - 静态]         ← 缓存
[知识库/文档 - 静态]      ← 缓存
[对话历史 - 半静态]       ← 部分缓存
[用户输入 - 动态]         ← 不缓存
```

**关键原则：**

1. 静态内容前置：确保 system prompt 和工具定义在前
2. 避免前缀污染：动态内容（如时间戳）放在 user message 中
3. 批处理相似请求：提高缓存复用率
4. 合理设置 TTL：Anthropic 的 5 分钟 TTL 意味着需要持续流量保持缓存温热
5. 保持缓存前缀稳定：不要频繁改写 system prompt、工具定义和知识库顺序
6. 临时信息后置：使用 `<system-reminder>` 更新短期信息，尽量不破坏已缓存前缀

---

## 四、推理系统的 KV Cache 架构

### 4.1 架构演进

KV Cache 演进路径大致可以概括为：

1. 先把 KV 存下来：早期方案主要解决“不要重复算”，因此采用连续内存为每个请求保存整段 KV
2. 再把 KV 管起来：随着长上下文和高并发出现，连续分配带来的碎片和浪费越来越明显，于是出现分页式管理
3. 然后开始跨请求复用：在分页管理之上增加前缀匹配、块哈希和共享机制，形成今天主流的 Prompt Caching
4. 最后从模型结构本身降低成本：像 MLA 这样的方案不只是改推理引擎，而是直接减少需要缓存的 KV 表示

随着 `MaaS`（Model-as-a-Service）兴起，推理能力被做成在线服务，厂商开始同时关注延迟、吞吐和成本，KV Cache 也因此从底层实现细节变成了对外可感知的产品能力。 vLLM、SGLang 这类开源推理框架已经给出了 Prompt Caching 的典型实现思路，OpenAI、Anthropic、Gemini 等厂商并未完整公开底层实现，可能采用了相似的核心思想。

#### Era 1: 连续 KV Cache（2017-2022）

- 要解决的问题：先把历史 token 的 K/V 表示保存下来，避免生成下一个 token 时重复计算整个前缀。
- 核心做法：为每个请求预分配一整段连续内存，按上下文长度顺序写入对应的 KV。
- 局限：这种方式实现简单，但会造成明显的内存浪费。只要请求的实际长度低于预分配上限，剩余空间就会闲置；在高并发场景下，碎片和扩容问题也会越来越突出。

#### Era 2: PagedAttention（vLLM, 2023）

- 要解决的问题：连续分配在长上下文和高并发下浪费太大，推理系统需要一种更灵活的 KV 管理方式。
- 核心做法：借鉴操作系统分页思想，把 KV Cache 拆成固定大小的块，按需分配和回收，再用映射表把逻辑上的上下文顺序和物理上的存储位置对应起来。
- 局限：它主要解决的是“如何更省内存地存放 KV”，还没有真正解决“如何在不同请求之间高效复用同一段前缀”。

#### Era 3: Prefix Caching（自动前缀缓存）

- 要解决的问题：仅仅把 KV 存得更高效还不够，在线服务真正关心的是重复前缀能否跨请求直接复用。
- 核心做法：在分页式 KV 管理之上增加前缀匹配能力，通常做法是对 prompt 前缀或块内容生成哈希，并通过块级索引找到已经存在的缓存。很多实现还会使用父哈希链，确保“命中后面的块”意味着“前面的前缀也完全一致”。
- 局限：这类复用通常依赖精确前缀匹配，一旦 system prompt、工具定义或上下文顺序发生变化，缓存命中率就会明显下降。

#### Era 4: 位置无关缓存（Position-Independent Caching）

- 要解决的问题：传统 KV Cache 往往和位置编码绑定，同样的文本如果出现在不同位置，缓存也未必能直接复用。
- 核心做法：把“内容表示”和“位置信息”尽量解耦，例如先存储不带位置信息的表示，再在注意力计算阶段动态应用位置编码。
- 局限：这类方案更接近研究或前沿优化方向，实现复杂度更高，目前还没有像普通前缀缓存那样成为所有推理系统的标准配置。

### 4.2 MLA：架构级 KV 压缩

DeepSeek-V2/V3/R1 引入的 MLA 是架构层面的 KV Cache 优化，与系统级 Prompt Caching 形成互补。

- 要解决的问题：即使有了更好的缓存管理和跨请求复用，只要单个 token 对应的 KV 表示本身太大，超长上下文推理仍然会非常昂贵。
- 核心做法：MLA 不再只优化“怎么存”，而是直接优化“存什么”。它通过低秩压缩把原本需要缓存的大量 K/V 表示收缩成更小的潜在表示，再在需要时恢复出参与注意力计算的结果。
- 效果：在公开资料中，MLA 能把单 token 的缓存体积显著压缩。例如 DeepSeek 的公开材料中，128K 上下文下的 KV Cache 占用可从数百 GB 量级下降到个位数 GB 量级，这使超长上下文和磁盘级缓存更可行。
- 意义：Prompt Caching 主要解决“已有 KV 能不能复用”，而 MLA 进一步解决“即使不能复用，单次缓存本身能不能更便宜”。两者并不是替代关系，而是不同层面的优化。

---

## 五、未来趋势

### 5.1 技术演进方向

1. 更长 TTL：从分钟级向小时级甚至持久化发展
2. 语义缓存：不仅匹配相同文本，还匹配语义等价表达
3. 多级缓存架构：HBM → DRAM → SSD → 分布式缓存
4. 模型架构统一：MLA 类低秩压缩有望成为标准

### 5.2 标准化趋势

- OpenAI 的隐式模式降低使用门槛
- Anthropic 的显式模式提供更精细控制
- 未来可能出现统一的缓存控制标准（通过 OpenAI-compatible API）

---

## 六、查询：注意力架构说明

MHA、MQA、GQA、MLA 都可以看作是 Transformer 内部 attention / KV 机制的不同变体， 不通的注意力架构会直接影响 Prompt Caching 的成本表现。Prompt Caching 复用的是已经算好的 KV，而不同注意力变体决定了每个 token 需要缓存多少 KV、这些 KV 是否容易压缩，以及长上下文下的显存压力有多大。

对于 OpenAI、Anthropic 这类闭源厂商，公开资料通常只会说明产品层的缓存行为、上下文长度和 API 能力，并不会完整披露线上模型具体采用的是哪一种注意力变体。

**一些开源模型的注意力架构对比：**

| 架构           | KV Heads        | VRAM 使用       | 性能            | RoPE 处理 |
| -------------- | --------------- | --------------- | --------------- | --------- |
| MHA (Llama-1)  | = Query Heads   | 100% (baseline) | Baseline        | Native    |
| MQA (Falcon)   | 1               | ~1-2%           | Lossy           | Native    |
| GQA (Llama-3)  | Groups (8)      | ~12-25%         | Near Lossless   | Native    |
| MLA (DeepSeek) | Virtual/Dynamic | ~5-10%          | Lossless/Better | Decoupled |

---

## 参考资料

1. [Claude Prompt Caching Best Practices - Claude Code Team](https://www.claudecodecamp.com/p/how-prompt-caching-actually-works-in-claude-code)
2. [OpenAI Prompt Caching Documentation](https://developers.openai.com/api/docs/guides/prompt-caching/)
3. [vLLM PagedAttention Paper](https://arxiv.org/abs/2309.06180)
4. [DeepSeek-V3 Technical Report](https://arxiv.org/abs/2412.19437)
5. [Gemini Context Caching Documentation](https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache)
6. [MLA: Multi-head Latent Attention](https://arxiv.org/abs/2502.07864)

---

_报告基于公开技术文档、论文和实测数据整理，部分厂商实现细节可能因版本更新而变化。_
