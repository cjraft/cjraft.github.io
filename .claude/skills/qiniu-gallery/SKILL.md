---
name: qiniu-gallery
description: >
  将本地图片批量上传到七牛云 CDN，获取外链地址后自动生成 Hugo 画廊文章。
  支持接收目录路径或若干图片路径作为输入，完成上传、生成 CDN 链接、写 Markdown 的全程。
---

# 七牛云画廊上传 Skill

## 触发条件

当用户表达以下意图时，使用本 skill：
- "上传图片到七牛云"
- "创建画廊"
- "把照片传到 CDN"
- "批量上传图片"
- "生成画廊文章"

## 前置检查

**必须的环境变量**（执行前先检查，缺少则中断并提示用户配置）：

| 变量名 | 说明 | 获取方式 |
|---|---|---|
| `QINIU_ACCESS_KEY` | 七牛云 AccessKey | 七牛云控制台 → 密钥管理 |
| `QINIU_SECRET_KEY` | 七牛云 SecretKey | 七牛云控制台 → 密钥管理 |
| `QINIU_BUCKET` | 存储空间名称 | 七牛云控制台 → 对象存储 → 空间名称 |
| `QINIU_DOMAIN` | CDN 域名 | 七牛云控制台 → 对象存储 → 空间 → 域名（如 `https://cdn.example.com/`）|

检查命令：
```bash
env | grep -E "QINIU_(ACCESS_KEY|SECRET_KEY|BUCKET|DOMAIN)"
```

若缺少任意一个，停止执行并向用户输出：

```
缺少环境变量: QINIU_ACCESS_KEY, QINIU_SECRET_KEY, QINIU_BUCKET, QINIU_DOMAIN

请配置后重试，方式如下：
1. 在 shell profile (~/.zshrc 或 ~/.bashrc) 中添加 export
2. 或在当前终端直接 export
3. 或创建项目根目录 .env 文件

export QINIU_ACCESS_KEY="你的 AccessKey"
export QINIU_SECRET_KEY="你的 SecretKey"
export QINIU_BUCKET="你的 Bucket"
export QINIU_DOMAIN="https://你的CDN域名/"

获取方式：七牛云控制台 → 密钥管理 / 对象存储
```

## 执行流程

### 1. 获取输入

脚本依次询问：
1. **画廊标题**：如 `重走北邮`
2. **CDN 目录名**：用于七牛云存储路径，格式为 `{主题}-{年份}`，如 `bupt-walk-2026`、`tokyo-2024`。同一组照片必须放在同一目录下，便于管理和区分
3. **图片路径**，支持两种形式：
   - **单个目录**：如 `~/Photos/tokyo-2024/`，自动遍历目录下所有图片（jpg、jpeg、png、webp、gif）
   - **若干文件路径**：如 `/path/a.jpg /path/b.png /path/c.webp`

### 2. 列出待上传文件

向用户确认文件列表：

```bash
# 如果是目录
ls -la "{用户提供的目录}" | grep -iE '\.(jpg|jpeg|png|webp|gif)$'

# 如果是文件路径，直接 stat 检查
```

### 3. 批量上传

使用项目脚本完成上传：

```bash
node scripts/create-gallery.js
```

脚本会交互式提示输入标题和图片路径。若用户已提供路径，直接传入：

```bash
# 通过环境变量或管道方式将路径传入脚本
```

上传后每张图片会生成 CDN 链接：
- 存储路径：`gallery/{dir}/{filename}`（如 `gallery/bupt-walk-2026/photo-01.jpg`）
- CDN 地址：`{QINIU_DOMAIN}/gallery/{dir}/{filename}`

### 4. 生成画廊文章

上传完成后，脚本自动在 `content/life/{slug}.md` 生成文件：

```yaml
---
title: "用户输入的标题"
type: "gallery"
showToc: false
hideMeta: true
photos:
  - preview: "https://cdn.example.com/gallery/1745xxx-001.jpg"
    original: "https://cdn.example.com/gallery/1745xxx-001.jpg"
    width: 1400
    height: 1050
  - preview: "https://cdn.example.com/gallery/1745xxx-002.jpg"
    original: "https://cdn.example.com/gallery/1745xxx-002.jpg"
    width: 1050
    height: 1400
---
```

> `preview` 和 `original` 均指向同一压缩版本（max 1400px）；`width`/`height` 由脚本从压缩后图片自动读取。

### 5. 预览

提示用户执行：

```bash
hugo server -D
```

访问 `http://localhost:1313/life/{slug}/` 预览画廊效果。

## 脚本位置

项目脚本：`scripts/create-gallery.js`

该脚本内已实现：
- 环境变量检查
- 七牛云表单上传（纯 Node.js fetch，无额外依赖）
- 自动生成 CDN 链接
- 写入 Hugo frontmatter

## 注意事项

1. 七牛云测试域名有防盗链或回收风险，建议使用绑定的自定义域名
2. 上传前确认存储空间已开启公共读权限
3. 图片较大时建议先压缩，避免 CDN 流量过高
