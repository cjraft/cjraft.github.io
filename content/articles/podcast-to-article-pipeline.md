# 播客转文章：3-4 小时长音频的完整处理方案

3-4 小时的播客转录出来约 **5-10 万字**，远超单次 LLM 上下文。核心思路是：**先切片 → 再并行摘要 → 最后汇总成文**。

---

## 阶段 1：语音转文字（ASR）

### 工具选择

| 工具 | 特点 | 适用场景 |
|------|------|----------|
| **Whisper (OpenAI)** | 准确率高，支持多语言，开源 | 本地处理，隐私敏感 |
| **Whisper API** | $0.006/分钟，便宜，快 | 不想本地部署 |
| **Gladia** | 自带说话人分离（Diarization），准确率高 | 多人对话播客 |
| **AssemblyAI** | 内置章节检测、摘要、说话人标记 | 需要一站式 |
| **飞书妙记 / 通义听悟** | 中文优化好，免费额度大 | 中文播客 |

### 推荐配置

```bash
# 本地 Whisper（适合技术用户）
whisper podcast.mp3 --model large-v3 --language zh --output_format json

# 需要说话人分离时加 diarization
# 使用 whisperx（集成 pyannote）
whisperx podcast.mp3 --model large-v3 --diarize --hf_token YOUR_TOKEN
```

**输出格式建议**：JSON 或 SRT（带时间戳），后续切片需要精确回查。

---

## 阶段 2：文本分段（关键步骤）

长文本不能直接塞给 LLM。需要切成「语义完整的块」。

### 方法 A：固定时间切片（简单粗暴）

每 5-10 分钟切一段，每段约 1000-2000 字。

```python
def split_by_time(transcript, interval_minutes=5):
    """按固定时间间隔切片"""
    chunks = []
    current_chunk = []
    current_start = 0
    
    for segment in transcript:
        if segment['end'] - current_start >= interval_minutes * 60:
            chunks.append({
                'start': current_start,
                'end': segment['end'],
                'text': ' '.join(current_chunk)
            })
            current_chunk = []
            current_start = segment['start']
        current_chunk.append(segment['text'])
    
    return chunks
```

### 方法 B：语义切片（推荐）

检测话题转折点，在语义边界处切割。

```python
# 使用 LLM 判断话题边界
TOPIC_SHIFT_PROMPT = """
以下是一段播客转录文本。请判断是否存在话题转换。
如果存在，请用「SHIFT」标记转换点，并说明新话题是什么。
如果话题连续，请回复「CONTINUE」。

文本：
{text}
"""
```

### 方法 C：章节检测（如果 ASR 工具支持）

AssemblyAI 等工具能自动检测章节边界，直接利用。

---

## 阶段 3：并行摘要（Map-Reduce）

### 第一层：逐段摘要

对每个 chunk 提取：
- 核心论点
- 关键事实/数据
- 金句/引语
- 时间戳（方便回查原文）

```python
CHUNK_SUMMARY_PROMPT = """
你是资深内容编辑。请将以下播客片段提炼为结构化摘要：

【原文时间】{start_time} - {end_time}
【原文内容】
{text}

请输出：
1. 核心话题：（一句话概括这段在谈什么）
2. 关键论点：（逐条列出，最多3条）
3. 重要事实/数据：（如有具体数字、案例、引用）
4. 金句摘录：（原文引用，标注说话人）
5. 与上下文的关联：（如果已知）
"""
```

### 第二层：主题聚合

将相似主题的 chunk 摘要合并。

```python
# 用 embedding 聚类，或 LLM 判断主题相似度
MERGE_PROMPT = """
以下是多个播客片段的摘要，请按主题归类合并：

{summaries}

输出格式：
## 主题 X：[主题名]
- 涉及时间段：
- 核心内容：
- 关键论据：
"""
```

### 第三层：文章生成

```python
ARTICLE_PROMPT = """
你是一位专栏作家。请根据以下播客摘要，撰写一篇结构清晰的文章。

要求：
1. 标题吸引人，概括全文主旨
2. 开头用「钩子」引入（可以是一个引人思考的问题或场景）
3. 正文按逻辑重组，不要按时间顺序堆砌
4. 保留重要数据、案例、引语的准确性
5. 结尾给出 actionable insight 或开放性问题
6. 在关键处标注「原文时间戳」，方便读者回听

原始摘要：
{aggregated_summaries}

请直接输出完整的 Markdown 文章。
"""
```

---

## 阶段 4：后处理与润色

### 自动化检查

```python
# 1. 时间戳校验：确保引用的 timestamp 在有效范围内
# 2. 事实一致性：检查前后文是否有矛盾
# 3. 去重：删除重复的案例或论点

FACT_CHECK_PROMPT = """
请检查以下文章中是否存在事实矛盾或重复内容：

{article}

如有问题，请指出具体位置并建议修改。
"""
```

### 人工审核点

| 检查项 | 重要性 |
|--------|--------|
| 说话人身份标注 | 高（避免「某嘉宾说」这种模糊表述） |
| 专业术语准确性 | 高 |
| 金句是否断章取义 | 高 |
| 数据引用是否准确 | 极高 |

---

## 完整工具链（可直接跑）

```bash
# 1. 安装依赖
pip install openai-whisper whisperx openai tiktoken

# 2. 转录 + 说话人分离
whisperx podcast.mp3 \
  --model large-v3 \
  --diarize \
  --hf_token $HF_TOKEN \
  --output_dir ./output

# 3. 运行处理脚本（下面提供）
python podcast_to_article.py \
  --input ./output/podcast.json \
  --output ./article.md \
  --model gpt-4o
```

### 完整处理脚本

```python
# podcast_to_article.py
import json
import openai
from typing import List, Dict
import tiktoken

class PodcastProcessor:
    def __init__(self, model="gpt-4o"):
        self.model = model
        self.encoding = tiktoken.encoding_for_model(model)
        self.max_tokens = 120000  # 留 margin
    
    def load_transcript(self, path: str) -> List[Dict]:
        with open(path) as f:
            data = json.load(f)
        return data.get('segments', [])
    
    def chunk_by_tokens(self, segments: List[Dict], max_tokens=8000) -> List[Dict]:
        """按 token 数切片，保持说话人连续"""
        chunks = []
        current = []
        current_tokens = 0
        
        for seg in segments:
            text = f"[{seg['speaker']}] {seg['text']}"
            tokens = len(self.encoding.encode(text))
            
            if current_tokens + tokens > max_tokens and current:
                chunks.append(self._merge_segment(current))
                current = [seg]
                current_tokens = tokens
            else:
                current.append(seg)
                current_tokens += tokens
        
        if current:
            chunks.append(self._merge_segment(current))
        
        return chunks
    
    def _merge_segment(self, segments: List[Dict]) -> Dict:
        return {
            'start': segments[0]['start'],
            'end': segments[-1]['end'],
            'text': '\n'.join([f"[{s.get('speaker', 'Unknown')}] {s['text']}" for s in segments]),
            'speakers': list(set([s.get('speaker', 'Unknown') for s in segments]))
        }
    
    def summarize_chunk(self, chunk: Dict) -> Dict:
        prompt = f"""
将以下播客片段提炼为结构化摘要：

【时间】{chunk['start']//60}分{chunk['start']%60}秒 - {chunk['end']//60}分{chunk['end']%60}秒
【参与】{', '.join(chunk['speakers'])}
【内容】
{chunk['text']}

输出 JSON：
{{
  "topic": "这段核心话题（15字内）",
  "key_points": ["论点1", "论点2"],
  "facts": ["具体数据/案例"],
  "quotes": ["说话人：金句"],
  "context": "与节目整体的关联"
}}
"""
        response = openai.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}
        )
        
        summary = json.loads(response.choices[0].message.content)
        summary['time_range'] = (chunk['start'], chunk['end'])
        return summary
    
    def aggregate_by_topic(self, summaries: List[Dict]) -> List[Dict]:
        """用 LLM 将摘要按主题聚类"""
        prompt = f"""
以下是播客各片段的摘要，请按主题归类（3-6个主题），合并相似内容：

{json.dumps(summaries, ensure_ascii=False)}

输出 JSON：
{{
  "themes": [
    {{
      "title": "主题名称",
      "time_ranges": [["开始秒", "结束秒"]],
      "content": "合并后的核心内容",
      "key_quotes": ["金句"]
    }}
  ]
}}
"""
        response = openai.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)['themes']
    
    def write_article(self, themes: List[Dict]) -> str:
        prompt = f"""
根据以下播客主题摘要，撰写一篇结构清晰的深度文章。

要求：
- 标题吸引人
- 开头有钩子
- 按逻辑而非时间顺序组织
- 保留关键数据和金句，标注时间戳
- 结尾有 insight

主题摘要：
{json.dumps(themes, ensure_ascii=False)}

请输出完整 Markdown 文章。
"""
        response = openai.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content

# 主流程
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="gpt-4o")
    args = parser.parse_args()
    
    processor = PodcastProcessor(args.model)
    
    # 1. 加载
    segments = processor.load_transcript(args.input)
    print(f"加载 {len(segments)} 个片段")
    
    # 2. 切片
    chunks = processor.chunk_by_tokens(segments)
    print(f"切成 {len(chunks)} 块")
    
    # 3. 逐段摘要
    summaries = [processor.summarize_chunk(c) for c in chunks]
    print(f"完成 {len(summaries)} 个摘要")
    
    # 4. 主题聚合
    themes = processor.aggregate_by_topic(summaries)
    print(f"聚合为 {len(themes)} 个主题")
    
    # 5. 生成文章
    article = processor.write_article(themes)
    
    # 6. 保存
    with open(args.output, 'w') as f:
        f.write(article)
    
    print(f"文章已保存至 {args.output}")
```

---

## 成本估算（以 4 小时播客为例）

| 环节 | 工具 | 费用 |
|------|------|------|
| 转录 | Whisper API | 4×60×$0.006 = **$1.44** |
| 说话人分离 | whisperx 本地 | 免费（GPU） |
| 摘要（假设切 20 段）| GPT-4o | 20 × 8K tokens × $2.5/M = **$0.40** |
| 聚合 + 成文 | GPT-4o | 约 20K tokens × $2.5/M = **$0.05** |
| **总计** | | **约 $2** |

---

## 进阶技巧

### 1. 说话人身份标注

如果播客有固定主持人/嘉宾，先做一个「声音指纹」识别：

```python
# 在转录后，用少量标注样本训练说话人映射
speaker_map = {
    "SPEAKER_00": "主持人 A",
    "SPEAKER_01": "嘉宾 B（某领域专家）",
}
```

### 2. 关键片段高亮

在文章中嵌入可点击的时间戳，直接跳到播客对应位置：

```markdown
> "AI 不会取代程序员，但会用 AI 的程序员会取代不用 AI 的程序员。"
> —— [嘉宾 B @ 1:23:45](https://podcast.example.com?t=5025)
```

### 3. 多模态输出

除了文章，还可以同时生成：
- **章节时间线**（带关键 quote）
- **Twitter/X 线程**（逐条发布）
- **Newsletter 摘要**（更短的版本）

---

## 避坑指南

| 坑 | 解决方案 |
|----|----------|
| 转录质量差（口音、专业术语） | 用 Whisper large-v3 + 后处理术语表 |
| 说话人分离混乱 | 用 pyannote.audio 或 Gladia |
| 摘要丢失上下文 | 切片时加 overlap（前后各 100 字） |
| 文章像流水账 | 第二层聚合时强制按逻辑重组 |
| 金句断章取义 | 最终校验时回查原文 timestamp |

---

要我直接帮你跑一套出来测试吗？你可以丢一个播客链接或文件给我。