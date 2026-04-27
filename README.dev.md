# dev

```bash
hugo server -D
```

## 文章（articles）

放到 `content/articles/` 下，支持 tags、目录、描述等 frontmatter：

```markdown
---
title: "文章标题"
date: 2026-01-29
tags:
  - "Tag1"
  - "Tag2"
showToc: true
TocOpen: true
description: "文章摘要，用于 SEO 和列表展示"
---

正文内容...
```

- `showToc: true` — 显示文章目录
- `TocOpen: true` — 目录默认展开
- `description` — 文章描述，用于列表页摘要和 SEO
- `tags` — 文章标签，会生成标签聚合页

## 每日资讯（news）

放到 `content/news/` 下，文件名建议用日期格式 `YYYY-MM-DD.md`：

```markdown
---
title: "AI 资讯速递（2026年3月第1周）"
date: 2026-03-01
tags:
  - "资讯"
  - "2026"
  - "AI动态"
description: "本周 AI 行业重大动态摘要"
showToc: true
TocOpen: true
---

## 大模型进展

1. **Claude Code 语音模式正式发布**
   ...
```

和 articles 的渲染逻辑完全一致，只是内容组织在不同目录。

## 生活栏目

生活栏目支持两种内容类型：文章和画廊。

### 文章

放到 `content/life/articles/` 下，和 `content/articles/` 的渲染逻辑完全一致。

```markdown
---
title: "家里来了只猫"
date: 2026-04-20
---

上周在小区楼下遇到一只橘白相间的小猫...
```

### 画廊

放到 `content/life/` 下，frontmatter 中指定 `type: "gallery"`，通过 `photos` 数组填入照片：

```markdown
---
title: "东京 2024"
type: "gallery"
photos:
  - src: "https://example.com/photo1.jpg"
  - src: "https://example.com/photo2.jpg"
  - src: "https://example.com/photo3.jpg"
---
```

画廊模板 `layouts/gallery/single.html` 会自动读取 `photos` 数组，渲染滚动堆叠效果。每张照片的 `src` 为必填，`caption` 为可选。

### 一键创建画廊（七牛云上传）

```bash
node scripts/create-gallery.js
```

首次运行前需要配置七牛云环境变量：

```bash
export QINIU_ACCESS_KEY="你的 AccessKey"
export QINIU_SECRET_KEY="你的 SecretKey"
export QINIU_BUCKET="你的存储空间名"
export QINIU_DOMAIN="https://你的CDN域名/"
```

脚本会交互式提示输入画廊标题和图片路径，自动上传并生成 `content/life/{slug}.md`。
