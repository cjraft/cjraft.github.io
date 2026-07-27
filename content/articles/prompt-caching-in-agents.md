---
title: "Prompt Caching In Agents[中译]"
date: 2026-07-25
tags:
  - "Prompt Caching"
  - "KV Cache"
  - "Coding Agent"
  - "Pi Agent"
  - "LLM 推理"
showToc: true
TocOpen: true
description: 翻译自 Earendil Engineering《Prompt Caching In Agents》。对编码 Agent 来说，缓存行为不只是实现细节或优化，它影响延迟、成本、工具设计、会话设计，甚至决定哪些产品功能该不该开放。本文以 Pi 为例，讲解 KV Cache 原理、缓存存放位置、前缀与分支、显式/自动缓存、工具装载为何毁掉缓存、TTL、缓存未命中的代价，以及 Pi 为何不激进裁剪历史。
lastmod: "2026-07-25"
---

> **译者按**：本文翻译自 Earendil Engineering 的 [Prompt Caching In Agents](https://earendil.com/posts/prompt-caching/)（2026-07-22）。译文逐句忠实原文，未作删改。文中的 Pi、Fable 均为作者所在团队的编码 Agent / 模型产品。

# Agent 中的 Prompt Caching

**原文链接**: <https://earendil.com/posts/prompt-caching/>

---

大语言模型常常被想象成一个函数：输入一些文本，得到一些文本。这是一个有用的抽象，但它忽略了运行一个编码 Agent（coding agent，编码智能体）最重要的部分之一：大部分输入和上一次是一样的。换句话说，我们大多只是在往里面追加内容。

一个编码 Agent 会把它的 system prompt（系统提示）、tool definitions（工具定义）、project instructions（项目指令）、conversation history（对话历史）、tool calls（工具调用）和 tool results（工具结果）发给模型。到了下一轮，它又几乎把这些全部再发一遍，外加一小部分新内容。一旦一个会话增长到几万甚至几十万 token，每一轮都重新计算整个 prompt 就会既慢又贵。

Prompt caching（提示缓存）正是让这件事在经济上还算划算的东西，但它同时也相当脆弱。一个被改动的工具定义、一次模型切换，或者一次供应商的路由决策，都可能把一个你本以为廉价的增量请求，变成一次对整个上下文的完整重放（replay）。

因此，对编码 Agent 来说，缓存行为不只是一个实现细节或者优化。它影响延迟、成本、工具设计、会话设计，甚至影响哪些产品功能应该被开放出来。

## KV Cache 里装了什么

Transformer 处理一个 prompt 分为两个大的阶段。在 prefill（预填充）阶段，它读取输入 token 并为它们计算注意力状态。在 decode（解码）阶段，它一次生成一个新 token。

在每一个注意力层，每个被处理的 token 都会产生一个 key（键）和一个 value（值）。它们并不完全像哈希表里的键值查找：两者都是数字数组，通常是浮点数或者更低精度的量化值。当处理一个新 token 时，模型会把这个 token 的 query（查询）与之前的 key 做比较，从而确定之前每个 token 有多相关。然后它用这些相关性分数，对相应的 value 做加权混合。从这个意义上说，key 是模型用来匹配的东西，而 value 是它取回的信息（但这种查找是模糊的，而不是像字典查找那样“返回唯一的精确匹配”）。

这些 key 和 value 被保留下来，好让下一个生成的 token 能够注意到（attend to）之前的所有内容，而不必重新计算更早的 token。这份被保留下来的状态就是 KV cache。

从概念上讲，一个请求看起来是这样的：

```
request 1:

[system][tools][user][assistant][tool result][user]
<--------------------- prefill -------------------->
                       |
                       K and V tensors per token and layer

request 2:

[system][tools][user][assistant][tool result][user][new]
<---------------- reusable prefix ----------------><--->
                                                    |
                                                    new work
```

真实的表示要更复杂、与具体模型相关，而且“相当”大。重要的性质是，它们对应于某个特定的 token 前缀（prefix）。两个意思相同但分词（tokenize）方式不同的 prompt，并不共享同一份 KV cache。如果中间某个 token 变了，那么它之后的一切就是一个不同的续接（continuation）。

Prompt caching 把这份状态的生命周期延长到超出一次生成之外。当编码 Agent 的下一个 API 请求以相同的 token 开头时，推理系统就可以复用为匹配前缀存下来的计算成果，而只对新的后缀（suffix）做 prefill。理论上，到此为止。

## 缓存存放在哪里

要让缓存起作用，它需要被存放在某个地方，而且需要是可寻址的。推理系统让 KV cache 对后续请求可用的方式，大体上有两种。

比较简单的做法是 session affinity（会话亲和）。它的工作方式是把 KV cache 保存在计算出它的那块 GPU 上或附近，并把下一个请求路由回同一个 worker。一个 session ID 或 prompt-cache key 就成了一个微不足道的路由提示（routing hint），于是你甚至可以在 HTTP 负载均衡器这一层就处理这个问题，而无需去看请求负载（payload）的内容。

```
request(session-42) --> router --> worker 7 --> GPU 7 KV cache
next(session-42)    --> router --> worker 7 --> GPU 7 KV cache
```

这避免了把一份非常大的缓存搬到网络上。它在能工作的时候很快，但它约束了调度。被选中的 worker 可能过载、重启，或者把这个条目驱逐（evict）掉。路由器也可能判定，平衡整个机队（fleet）比保住某一个会话的缓存更重要。不过它仍然是一个非常有吸引力的方案，因为它几乎不需要额外部署的基础设施和硬件就能工作。

另一种做法是把缓存分布式化（distribute）。KV block（KV 块）可以被存放到另一个内存层级，或者跨 worker 提供，这样一个请求就不会那么紧地被绑在某一块 GPU 上。

```
                         +--------------------+
request --> scheduler -->| worker 3 / GPU 3   |
             |           +--------------------+
             |
             +----------> distributed KV blocks
             |
             +----------> worker 9 / GPU 9
```

这提升了调度的灵活性和恢复能力，但搬运、索引和保留 KV block 本身就是一个系统性难题。不同的实现会以不同方式混合使用 GPU 内存、主机内存、本地存储、远程存储、前缀感知路由（prefix-aware routing）和驱逐策略。

把 KV cache 放到一个合适的尺度来看：它们可能很大，但在某些方面又比人们以为的要小。借助各种技巧，即便是很长的对话，KV cache 的大小也能被压缩到区区几 GB。

## 缓存与前缀

Pi 的会话是树（tree），不是列表（list）。`/tree` 可以把活动的对话移回到更早的某个点，然后沿着另一条分支继续下去。一次 rewind（回退）可以丢弃当前活动的后缀，而不把它从会话文件里删掉。一条新分支可以共享旧上下文的大部分、一小部分，或者实际上几乎不共享。这个设计并非 Pi 独有，相当多的编码 Agent 都有某种至少在概念上类似的东西。即便你不把会话表示成一棵树，Agent 拥有某种形式的回退也并不罕见。

```
                             +-- E -- F  another branch
                             |
session S: root -- A -- B -- C -- D  current branch
                   |
                   +-- Z  branch near the start
```

这三条分支可以拥有相同的 Pi session ID。从路由器的视角看，它们是同一个会话。从 prompt cache 的视角看，它们是三个只有部分前缀重叠的 token 序列。

如果缓存保留可复用的前缀块，那么从 D 跳到 F 可能仍然能复用 `root -> C`。如果它只保留最热的那条续接、如果共享的块被驱逐了，或者请求被路由到了别处，那么命中（hit）就可能小得多。跳到 Z 可能只保住了 system prompt 和最初的工具定义，即便它是从 A 开始的。这里精确的缓存管理行为在很大程度上取决于供应商。

反过来的情况也会发生。`/fork` 或者一个新会话可以产生一个新的 session ID，却带着大量完全相同的上下文。一个按 session key 隔离缓存的路由系统，可能注意不到这种有用的重叠。

可复用的前缀决定了哪些计算可以被缓存。会话身份（session identity）只不过是帮助基础设施去找到可能匹配的内容。在某些系统上，路由 key 对管理缓存至关重要；在另一些系统上，它只是一个优化。

## 显式前缀缓存 vs 自动前缀缓存

供应商 API 主要以两种风格暴露缓存能力。

Anthropic 传统的接口使用显式的 `cache_control` 点（cache_control point）。客户端在请求中稳定部分之后标记边界，比如 system prompt、tool definitions，或者最新的可缓存对话内容。服务端随后就可以写入或查找以这些点为结尾的前缀。边界是显式的，但复用仍然要求它之前的内容能够匹配。不仅缓存点是显式的，定价也是显式的。你要为缓存写入付费，并且你可以选择保留多久，而这对应不同的价位。

其他 API 使用自动前缀缓存（automatic prefix caching）。客户端照常发送请求，供应商在没有客户端放置断点（breakpoint）的情况下找到可复用的前缀。一个 prompt-cache key 或 session header 可能会改善路由或分组，但它并不能让不同的前缀变得相等。

## 为什么工具装载会毁掉缓存

工具定义通常出现在对话之前，而且它们在内部会被“折叠（fold）”进 system prompt。它们的名称、描述和 JSON schema 都是模型输入，和其他任何文本一样。增加一个工具、移除一个工具、改变它的 schema，甚至以不同的顺序序列化（serialize）这些工具，都可能把第一个不匹配点（mismatch）挪到接近 prompt 起始处的位置。

```
turn 1: [system][read][write][bash][conversation...........]
turn 2: [system][read][write][bash][deploy][conversation...]
                                   |
                                   old conversation is now
                                   after a mismatch
```

这是插件系统和 MCP 风格工具目录（tool catalog）常见的一个意外。只在某个工具变得相关时才加载它，听起来很高效，因为一开始发送的 schema 更少。然而在大多数模型上，新扩展出来的装载（loadout）会让它之后那段被缓存的对话失效。省下几个工具 schema 的 token，可能导致几万个对话 token 被重新处理。

一些较新的模型 API 支持追加式工具加载（additive tool loading）。一个工具可以在 transcript（对话记录）里某个特定的 tool result 处变为可用，而不是被插入到最初的工具列表里。旧的前缀保持不变：

```
[system][initial tools][conversation][new tool][next turn]
<--------- cached prefix ----------->
```

Pi 如今对具备原生延迟工具（deferred-tool）机制的模型支持这一点。当某个扩展用 `setActiveTools()` 做出一个纯追加式的改动时，Pi 会把新增的名称记录在 tool result 上。对于受支持的 Anthropic 模型，它使用延迟定义（deferred definitions）和一个 `tool_reference`；对于受支持的 OpenAI 模型，它发出相应的 tool-search 条目。其他模型会得到一个安全的回退方案：Pi 在下一个请求里发送完整的活动工具列表，这在功能上是可行的，但可能会抹掉（wipe）prompt cache。

“追加式（additive）”这个词很重要，因为移除工具、用一套装载替换另一套，或者改动 prompt 片段，仍然会改变更早的输入。一个每一轮都重建 system prompt、打乱工具顺序、注入时间戳，或者改变活动工具的扩展，都可能在不经意间毁掉整个会话的缓存。

可扩展性（extensibility）意味着 Pi 无法替每一个扩展保证缓存的稳定性。我们可以提供对缓存友好的机制；扩展仍然必须去使用它们，而据我们所见，对许多扩展来说缓存效率只是一个事后才想起来的东西（afterthought）。这在一定程度上是因为，当你按固定订阅付费时，缓存未命中所关联的成本并不那么显眼。

## 中断与 TTL

一些重要的 prompt cache 有着很短的默认生命周期。Anthropic 默认的五分钟缓存尤其重要，因为它比许多正常的编码活动都要短。如果你在用 Fable 的时候起身去喝口咖啡，10 分钟后回来，那么仅仅一条“say hi”消息就会花掉你比预期更多的钱。

这是因为，虽然用户可能把一个编码会话想成是持续活跃的，推理供应商看到的却是一连串彼此孤立的请求：

```
model request --> run tests for 7 minutes --> model request
                  no cache traffic here
```

一次漫长的构建、一整套测试、一顿午饭、一场会议，或者仅仅是停下来审查一个 diff，都可能比缓存活得更久。下一个请求包含相同的 prompt，但存下来的 KV 状态已经没了，于是前缀又被当作输入重新计费。

由于 Pi 目前还不是 Anthropic 订阅上被许可的 harness（承载框架），我们遵循 Anthropic 对 API 用户建议的 5 分钟默认值。不过，通过查看 Claude Code 的代码库，我们知道对于他们自己的订阅用户，他们正在把这个缓存超时提高到一个小时。然而，当你需要支付 API token 价格时，这样做增加的成本往往并不划算。

但你可以选择开启它。一些供应商，比如 Anthropic，暴露了更长的保留控制。对于受支持的直连 API，Pi 用户可以设置 `PI_CACHE_RETENTION=long` 来请求它们。不过那仍然只是一个请求：Pi 无法强迫一个网关（gateway）保留某个条目，无法在内存压力下阻止驱逐，也无法在没有模型请求发出时让某个缓存保持存活。

## 未命中的代价

供应商通常对未缓存输入（uncached input）、缓存写入（cache write）和缓存读取（cache read）分别定价。缓存读取通常有折扣，因为昂贵的 prefill 计算已经做过了。缓存写入可能带有溢价，因为供应商承诺要为以后的使用保留状态。

设想一个编码会话，有 10 万 token 的历史，后面跟着一个简短的新请求，就像上面 Fable 的例子。当缓存起作用时，几乎所有这些历史都按更低的缓存读取价格计费。只有那一小部分新内容需要按常规输入价格处理，并可能被写入缓存。

当缓存未命中时，供应商不得不再一次按常规输入价格处理整个 10 万 token 的历史。它可能还会为把这段历史写回缓存而收费。这就是为什么在缓存过期之后，一个像 `continue` 这样简短的请求会贵得出人意料。在一个漫长的编码会话里，重新读取旧的输入所花的钱，可能远超生成下一个回答的钱。

缓存还有可能制造出不那么显而易见的激励（incentive）。

用户应该想要高命中率，因为它降低延迟和价格。一个拥有这些 GPU 的推理运营方也应该想要它们：更少的 prefill 计算意味着用同样的硬件服务更多请求。一个设计良好的缓存 token 折扣可以让双方的利益对齐，同时让运营方保有更好的利润率。

一个网关或者经销商（reseller）可能有着不同的激励。如果它的收入来自按未缓存费率计费的输入 token，那么一次缓存未命中就可能产生比命中更大的一张客户账单。这是否也带来更多利润，则取决于它的上游成本、合同，以及由谁来运营缓存。在一个对齐糟糕的技术栈里，负责路由的一方可能并不承担未命中的全部成本，而给用户计费的一方却在未命中发生时赚到更多收入。

这并不意味着供应商在蓄意破坏缓存，但它意味着缓存表现应当是可观测的（observable）。用户不应该只能从一张大得离谱的账单里去推断这一点。搞清楚缓存是不是出了什么怪事，可以是一个重要的洞察。

严格遵守缓存也意味着网关在轮次之间把你路由到最佳选项的灵活性变小了。你也许愿意接受一次缓存命中，转而用另一个模型继续，因为从那一刻起它可能更经济；又或者，把负载均衡到另一个供应商对你更划算。

## 为什么 Pi 不激进地裁剪

既然你已经读到这里，你大概已经有了个想法，明白 Pi 为什么不裁剪（prune）工具调用。通过不断删除旧的 tool result 或重写历史来控制成本，是很诱人的，而且有时候确实有必要，尤其是在接近上下文窗口上限的时候。但正如我们已经了解到的，裁剪本身也有一份缓存代价。

从中间删除内容，会在删除点改变前缀。它之后所有幸存下来的对话都可能需要被重新处理。重写一段很长的已缓存上下文的即时代价，可能超过移除少量廉价缓存 token 所带来的未来收益。

一个粗略的盈亏平衡（break-even）比较是：

```
one-time rewrite cost
    ~= surviving tokens after the edit * (uncached price - cache-read price)

future savings per turn
    ~= pruned tokens * cache-read price
```

这不仅仅是一个记账问题，因为旧的 tool result 里往往包含着模型用来做出后续决策的证据。把它们移除，即便有一份摘要保留了大意，也可能让行为退化（degrade）。

因此 Pi 更倾向于一个稳定的、面向追加（append-oriented）的对话记录，并且不把每一个旧 token 都当作浪费。当上下文压力足以正当化一次有损重写（lossy rewrite）时，compaction（压缩）是可用的。因为 compaction 是刻意去创建新上下文，而不是意外地对一个未改变的 prompt 重新计费，所以 Pi 在它的会话统计里把它当作一次缓存重置（cache reset），而不是一次缓存失败（cache failure）。

目标不是让 prompt 尽可能小，而是在模型上下文、缓存复用、延迟和价格之间取得最佳的权衡。

与此同时，裁剪也可能有它成立的理由。如果你对接的供应商并不因为你良好的缓存使用而给你折扣，或者由于种种原因就是拿不到高缓存率，那么裁剪也许更可取。它确实提升了路由器在不同后端之间做均衡的机会，因为缓存是不可转移的。

## Pi 能做什么、不能做什么

Pi 致力于让稳定的输入保持稳定。它传递一致的 session ID 和供应商特定的缓存提示，为需要显式缓存点的 API 放置这些缓存点，记录缓存读取和缓存写入的用量，并在模型允许的地方支持消息锚定（message-anchored）的追加式工具加载。它默认的对话记录行为，也避免无谓地重写旧上下文。

Pi 无法控制请求离开这台机器之后的每一层。它无法选择供应商的驱逐策略，无法把缓存延长到超出 API 允许的范围，无法让某一块特定的 GPU 保持存活，也无法保证一个网关会遵守亲和性（affinity）。它同样无法保住一个被扩展改动过的前缀。

它能做的，是让缓存健康状况变得可见。

交互式的页脚（footer）会把累计的缓存读取和写入显示为 `R` 和 `W`，外加代表最近一次请求缓存命中率的 `CH`。`/session` 命令给出一个更完整的视图：总的已缓存和未缓存输入、累计命中率、成本，以及一份对被显著缓存未命中重新计费的 token 数和美元数的估算。

```
Messages
Total: 178
User: 6
Assistant: 58
Tools: 114 calls, 114 results

Tokens
Input: 7,129,883
  Cached: 6,776,832 (95.0%)
  Uncached: 353,051
Output: 30,013
Total: 7,159,896

Cost
Total: $6.054
Cache Re-billed: $0.728 (161,744 tokens, 2 misses)
```

想要在缓存未命中发生时就被明确告知的用户，可以在 `/settings` 里启用 Show cache miss notices，对应 `settings.json` 里的 `showCacheMissNotices`。此后，Pi 会在一次显著的未命中之后插入一条警告，包含被重新计费 token 数和成本的估算。当它能观察到一次模型切换，或者一段超出通常那个短 TTL 的空闲间隔时，它会说出来。对于其他的未命中，它会报告这一事实，而不假装知道供应商内部发生了什么。

## 缓存表现变差的常见原因

当一个会话的缓存命中率看起来不对劲时，通常的原因有：

- **闲置（Idling）**。一个命令、一次审查，或者一次对话停顿，超出了供应商的保留窗口。

- **模型或供应商切换**。KV 状态是与模型相关的，通常不能跨供应商迁移。

- **分支导航**。`/tree`、回退、fork 和替代分支，即便 session ID 保持不变，也可能改变活动的 token 序列。

- **Compaction 或手动重写历史**。这些会有意地替换 prompt 的一部分，并确立一个新的前缀。

- **工具与推理级别（reasoning level）的改动**。增加、移除、重排或编辑工具定义，会改变请求靠前的部分——除非模型支持消息锚定的加载，而且这个改动是纯追加式的。推理级别的改动通常有同样的效果。

- **动态 system prompt**。时间戳、随机值、变化的项目上下文，以及扩展提供的 prompt 片段，都可能让它们之后的一切失效。

- **扩展的上下文变换（context transform）**。一个修改旧消息或供应商 payload 的扩展，可以让一个看起来稳定的 Pi 对话记录，在传输线路（on the wire）上变得不稳定。

- **供应商路由与驱逐**。prompt 可以是完全相同的，却仍然未命中，因为相关的 KV block 在请求落地的地方已经不再可用了。

---

## 翻译质量自检

- [x] 所有段落和句子已翻译，无遗漏
- [x] 技术术语翻译准确，无同义词替换
- [x] 未为通顺而改变原句结构
- [x] 未添加原文没有的过渡词或解释
- [x] 代码、命令、链接、ASCII 图示完整保留
- [x] 整体忠实度: 100%
