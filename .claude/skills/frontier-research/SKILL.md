---
name: frontier-research
description: >-
  生成「前沿研究」栏目（content/research/）的周期性 AIGC 摘要文章。当用户说
  「出一期前沿研究 / 更新前沿研究 / 写一篇 AIGC 前沿摘要 / 前沿研究周报」时使用。
  栏目**专注于 AI / LLM / Agent / Harness 领域**（世界模型与具身作为延伸保留），
  不覆盖纯图像生成、纯视频生成方向。负责三件事：(1) 在没有现成信息源时，按既定
  寻源策略从公开渠道（HuggingFace Daily Papers、arXiv、各家模型厂商官方博客）搜罗
  当期「模型&产品 + 论文」候选；(2) 逐条 WebFetch 原始来源，做结构化简介与总结
  （核心动机 / 横向对比 / 优缺点）；(3) 按固定格式写入 content/research/YYYY-MM-DD.md
  （纯文字、无图、带免责声明）。
---

# frontier-research — 前沿研究栏目生成器

把「找前沿研究 → 读原文 → 结构化总结 → 写进博客栏目」这条流水线固化下来。
栏目基础设施（`content/research/_index.md`、`layouts/research/list.html`、导航项）已建好，
本 skill 只负责**持续产出每期文章**。首期范本见 `content/research/2026-07-05.md`，
新文章必须与它保持同构（首期含「图像」子类，属栏目改版前的历史遗留，新文章不再收录）。

> **栏目定位（硬约束）**：聚焦 **AI / LLM / Agent / Harness**。
> 论文子类固定为 `LLM / Agent`、`Harness / 工程实践`、`世界模型与具身` 三类，
> 且**重心在前两类**（AI/LLM/Agent/Harness 占大头）。**不寻源、不收录**纯图像生成/编辑、
> 纯视频生成/修复类工作；世界模型、具身/机器人 VLA 作为「智能体在物理世界的延伸」保留。

## 触发条件

- 「出一期 / 更新 / 生成 前沿研究」「AIGC 前沿摘要 / 周报」
- 给一批论文/发布链接，要求整理成前沿研究文章
- 只给一个日期或「本周」，要求自动寻源成文

## 整体流程

```
① 定期次 → ② 寻源（找候选） → ③ 筛选打分 → ④ 逐条 WebFetch 总结 → ⑤ 按格式写入 → ⑥ 质检 & 预览
```

先把 ②③ 的候选清单列给用户过目（标题 + 链接 + 分类 + 打分），确认后再做 ④⑤ 的重活，避免白写。

---

## ① 定期次与时间窗

- 文件名 = 期次日期：`content/research/YYYY-MM-DD.md`，`date` front matter 用同一天 `T10:00:00+08:00`。
- 当前日期从环境获取，别硬编造；期次日期默认取当前日期。
- **寻源时间窗（硬约束）**：`(上一期日期, 当前日期]`——即从最新一篇已发布的前沿研究出具时间起，到当前时间为止，只收录落在这个区间内的新进展，避免和往期重复、也不漏。
  - 取上一期日期：
    ```bash
    ls content/research/ | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$' | sort | tail -1
    ```
    文件名去掉 `.md` 即上一期日期；若目录为空（无往期），则退回「近一周」。
  - 判定「落在窗内」：论文按 arXiv submit/更新日期，模型&产品按官方发布日期；卡在边界外的一律不收。
  - 用户显式给了日期/范围时，以用户为准，覆盖上述默认窗。

## ② 寻源策略（没有飞书文档后的信息来源）

用原生 **WebSearch / WebFetch** 抓取，分两条线。搜索时带上当前年月提高时效。

### A. 模型 & 产品（工业界发布）

优先厂商**官方博客/发布页**（一手、可长期引用），再用 WebSearch 补全：

| 来源 | 入口 |
|---|---|
| Anthropic 工程博客 | `anthropic.com/engineering` |
| Anthropic / Claude 博客 | `claude.com/blog`、`anthropic.com/news` |
| Google Research | `research.google/blog` |
| Google DeepMind | `deepmind.google/models`、`blog.google/technology/ai` |
| OpenAI News | `openai.com/zh-Hans-CN/news`、`openai.com/news` |
| OpenAI 开发者博客 | `developers.openai.com/blog` |
| Meta AI | `ai.meta.com/blog` |
| 阿里 Qwen | `qwenlm.github.io/blog` |
| 字节 Seed / 即梦 / Seedream | `seed.bytedance.com/blog`、`seed.bytedance.com/research` |
| 智谱 Z.ai / GLM | `zhipuai.cn/zh/research`、`z.ai/blog` |
| MiniMax | `minimaxi.com/news`、`minimaxi.com/blog` |
| 月之暗面 Moonshot / Kimi | `kimi.com/blog` |
| 美团 LongCat | `longcat.chat/blog`、`tech.meituan.com/tags/longcat.html` |
| 可灵 Kling / 快手 | 快手 `kling.kuaishou.com`、可灵官网 blog |
| xAI / Mistral / Stability / 智源 BAAI | 官网 news/blog |

WebSearch 兜底查法：`"<产品名>" release 2026`、`新模型 发布 2026年X月`、Hacker News（`news.ycombinator.com`）当周热帖。

### B. 论文（学术界）

按本栏目子类去找，**首选精选源**，再回 arXiv 拉原文。**寻源重心放在 LLM / Agent 与 Harness / 工程实践**，世界模型与具身作为补充：

| 精选源（先看这里） | 说明 |
|---|---|
| **HuggingFace Daily Papers** | `huggingface.co/papers`，可加 `?date=YYYY-MM-DD`；有摘要与社区投票，是最省事的当期精选。**注意过滤**：本栏目跳过纯图像/纯视频生成条目，只挑 LLM/Agent/Harness/世界模型 |
| alphaXiv Trending | `alphaxiv.org` 热度榜 |
| X/社媒 讨论热帖 | WebSearch `arxiv <关键词> 2026` |

| arXiv 分类（回源读原文） | 对应本栏目子类 |
|---|---|
| `arxiv.org/list/cs.CL/recent`、`cs.AI` | **LLM / Agent**（语言模型、Agent、记忆、工具调用、GUI Agent、搜索、RL/后训练、推理） |
| `cs.SE`、`cs.HC`、`cs.DC`/`cs.OS`/`cs.DB`/`cs.PL` | **Harness / 工程实践**（见 B'） |
| `cs.RO`（robotics）+ `cs.CV`/`cs.LG` 中的 world model / 具身 / VLA | **世界模型与具身**（补充，非重心） |

> arXiv 单篇读原文：`arxiv.org/abs/<id>` 摘要页最省 token；需要方法细节再取 `arxiv.org/pdf/<id>`。有代码/项目页（github.io、GitHub）也一并收录。
> **不收**：纯文生图/图像编辑/图像数据集、纯视频生成/修复/扩散训练方法——这些不属于本栏目范围。世界模型即便以视频为建模载体，只要落点在「世界状态/交互/具身控制」即可收。

#### B'. Harness / 工程实践类论文（本栏目重心之一）

偏工程、能直接给出工程 insight 的 agent/AI/harness 论文（如 `2607.06101 Agents That Teach` 提出 "Knowledge Debt"），
**不在** `cs.CL/cs.LG` 的能力研究区，需要单独一条线去找。这条线与 LLM/Agent 并列为栏目重心，
尤其关注 **harness / scaffold / agent 运行时**（工具编排、上下文管理、记忆、评测框架、AI 辅助研发流程）：

| 手段 | 具体做法 |
|---|---|
| 换 arXiv 分类 | `cs.SE`（软工，主战场）、`cs.HC`（开发者体验/人机协作）、`cs.DC`/`cs.OS`/`cs.DB`/`cs.PL`（系统/serving/基础设施）；列表页 `arxiv.org/list/cs.SE/recent`、`cs.HC/recent` |
| 按框架词搜 | 摘要含 `"empirical study"`、`"in practice"`、`"case study"`、`"design principles"`、`"in production"`、`developer study`、`AI-assisted`、`agent workflow`、`harness`、`scaffold`；用 `export.arxiv.org/api/query` 组合 |
| 认录用会议 | 被 ICSE / FSE / ASE / ISSTA（软工）或 OSDI / SOSP / NSDI / MLSys / EuroSys / USENIX ATC（系统）接收 = 工程相关性背书，摘要常写 "Accepted to …" |
| 从业者渠道 | Hacker News（`hn.algolia.com` 搜 arxiv+agent/LLM 看讨论热度）、Latent Space / The Batch / Interconnects newsletter、各 AI 实验室工程博客（insight 有时是博客而非论文） |

**判定 rubric（满足其一即是工程 insight）**：给出可复用的系统/工具/harness；提炼设计原则/模式；有真实开发者/实证研究；讨论了生产环境的延迟/成本/失败模式；提出从业者能直接套用的概念。纯刷 benchmark 降权。

> 注意：HuggingFace Daily Papers 对这类覆盖偏弱（偏模型能力），所以此类优先靠「换分类 + 认会议 + 从业者渠道」。收录时归入 `### Harness / 工程实践` 子类。

### 分类映射（三子类，重心在前两类）

- `### LLM / Agent`（重心）：语言模型、Agent、记忆、工具调用、GUI Agent、搜索、RL/后训练、推理/serving 能力研究。
- `### Harness / 工程实践`（重心）：AI 辅助编程、agent 融入研发流程、harness/scaffold/agent 运行时、工具链、系统基础设施、开发者实证研究（见 B'）。
- `### 世界模型与具身`（补充）：world model、交互式世界、具身/机器人 VLA、相关评测基准。**不含**纯视频生成/修复。
- ~~`### 图像`~~：**已废弃**，纯图像生成/编辑不再收录（首期遗留，勿沿用）。

## ③ 筛选与打分

- **数量与配比**：模型&产品 1~3 条；论文共约 6~12 篇，**重心在 LLM / Agent 与 Harness / 工程实践两类（合计占约 2/3 及以上）**，世界模型与具身作补充（约 1/4，宁缺毋滥）。宁精勿滥，"精选"不是全量搬运。
- **取舍**：优先「有明确动机 + 有横向对比数据 + 可落地」的工作；纯增量、无对比、营销稿降权。**例外**：工程实践类（B'）即便没有 benchmark 表，只要给出可复用系统/设计原则/生产经验/从业者概念，同样优先收录——它们的价值在 insight 而非刷点。
- **打分**（沿用首期，1~5，写进每篇 meta 行）：
  - `实用性`：能否落地、复现门槛、对工程/产品的直接价值。
  - `创新性`：思路新颖度、是否跳出「堆数据/堆参数」。
- 把候选清单（标题｜链接｜子类｜实用性/创新性）先发给用户确认。

## ④ 逐条 WebFetch 总结

对每条候选 WebFetch 原始来源，产出结构化中文要点。**忠于原文、不臆造数字**；数据拿不准就写定性描述。

**模型 & 产品**（`###` 一条）：一句定位（谁家、什么、对标谁）+ 分点：
- **性能**：核心指标、速度/成本、评测名次（有具体数就写）。
- **生态**：与自家其它模型/产品的联动、迁移建议。
- **接入**：开放渠道、定价。
- **局限**（如有）。

**论文**（`####` 一篇）：链接 + 评分 meta 行，随后 bold 标签段落：
- 一句机构/底座背景。
- **核心动机**：解决什么痛点、关键洞察。
- **横向对比**：和同类方案比、关键 benchmark 数字。
- **优点** / **缺点**：各 3~5 点，缺点要真实（局限、依赖、未验证场景）。

> 不使用超过 `####` 的更深标题，段内用 **加粗标签** 承载结构，保持 TOC 干净。

## ⑤ 按格式写入 content/research/YYYY-MM-DD.md

严格对齐首期 `content/research/2026-07-05.md`。模板：

```markdown
---
title: "AIGC 前沿研究摘要（YYYY 年 M 月 D 日）"
date: YYYY-MM-DDT10:00:00+08:00
categories: ["前沿研究"]
tags: ["AIGC", "论文精读", "模型发布", "2026"]   # 按当期内容增减，如 "世界模型" "语音"
description: "本期：<模型产品清单>，及 <子类> 方向重点论文精读。"
showToc: true
TocOpen: true
---

> 本栏目为每期一版的 AIGC 学术界 / 工业界前沿摘要。选题以人工筛选为主，每篇的分析要点由自动化流程生成，可能存在偏差或不准确之处，仅供参考。

## 模型 & 产品

### <产品名>
- 官方页面：<https://...>
<定位段 + 性能/生态/接入/局限 分点>

## 论文精选

> 每篇附 arxiv/项目链接，并给出「实用性 / 创新性」评分（满分 5）。

### LLM / Agent
#### <简称> — <英文标题>
- <https://arxiv.org/pdf/...> ｜ [代码](...) ｜ 实用性 X ／ 创新性 Y
- <一句机构/底座>
**核心动机**：...
**横向对比**：...
**优点**：...
**缺点**：...

### Harness / 工程实践
（同上）

### 世界模型与具身
（同上）
```

> 子类固定这三类，缺某类就省略该 `###`；**不再出现「图像」「视频」子类**。


### 硬性格式约定

- **纯文字、无图**：绝不插入图片（尤其不要外站鉴权/防盗链图床链接）。写完 `grep -c 'internal-api-drive-stream\|!\[' content/research/<file>` 应为 0。
- 中英文之间留空格（`Nano Banana 2 Lite` 前后、`Qwen3-VL` 等术语）。
- 标题层级只用 `##` / `###` / `####`；子类固定用「LLM / Agent」「Harness / 工程实践」「世界模型与具身」，缺某类就省略该 `###`；不再使用「图像」「视频」子类。
- 链接用 `<https://...>` 尖括号或 `[名](url)`，保证可点。
- 遵循博客写法：聚焦流程与结论、不挂 file:line（见 memory `blog-no-line-number-refs`）。

## ⑥ 质检 & 预览

1. 跑一遍 `article-review` skill 去 AI 味（可选但推荐，尤其总结段容易套话）。
2. 构建验证：
   ```bash
   hugo --gc --minify 2>&1 | tail -5          # 无 ERROR
   ls public/research/<YYYY-MM-DD>/index.html # 产出存在
   grep -c 'internal-api-drive-stream' public/research/<YYYY-MM-DD>/index.html  # = 0
   ```
3. 本地预览：`hugo server -D` → `/research/` 时间轴出现新条目 → 打开文章确认 TOC、链接、无坏图。

## 注意事项

- 时效性第一：搜索必带当前年月；宁可少收几条，也不写没核实的旧闻。
- 一手来源优先（官方博客、arXiv 原文）；二手报道只用来发现线索，正文以一手信息为准。
- 每篇总结独立可读，别互相引用「上文所述」。
- 不确定的评分/数字：评分可给区间或从缺，数字用定性描述，别编。
