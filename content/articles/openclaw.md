---
title: "OpenClaw/ClawdBot 使用指南&实践"
date: 2026-02-02
tags:
  - "OpenClaw"
showToc: true
TocOpen: false
---

## 快速认识

OpenClaw 是一个开源的、可本地部署的个人 AI 智能体（Personal AI Agent），它的前身是 ClawdBot 和 MoltBot。

其核心设计理念是“本地优先”（Local-first），它将 AI 的“大脑”即 Gateway（网关）控制平面运行在你自己的设备上。这意味着：

- 数据隐私：你的所有数据、配置和对话历史都存储在本地，不经过第三方服务器。
- 高权限操作：AI 能够直接操作你的电脑，如执行 Shell 命令、管理文件、控制浏览器等。
- 全渠道接入：你可以通过日常使用的聊天工具（如 WhatsApp、Telegram、飞书、Slack 等）与它交互，将 AI 无缝融入工作流。
- 持久化记忆：通过本地文件系统实现长期记忆，让 AI 越用越懂你。

> Notes
>
> - ClawdBot → MoltBot → OpenClaw：是同一个项目，因法务和命名原因多次更名。
> - Gateway：是 OpenClaw 的“大脑”和控制中心，管理所有连接和任务。
> - Channels：指的是与 Gateway 连接的各个聊天平台，如 WhatsApp、飞书等。

## 部署和安装

### 一键安装

官方提供了一键安装脚本，这是最推荐的入门方式。它会自动处理 Node.js 依赖（要求 v22+）并完成基础环境配置。

macOS / Linux：

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

Windows（使用 PowerShell）：

```powershell
iwr -useb https://openclaw.ai/install.ps1 | iex
```

安装脚本会自动引导你完成一个交互式的配置向导（onboard），包括：

1. 配置 AI 模型：设置你偏好的大语言模型提供商及其 API Key（例如 Kimi、智谱 GLM、OpenAI 等）。
2. 配置 Channels：选择要连接的聊天工具。如果暂时不确定，可以先跳过，后续再单独配置。支持 Telegram、WhatsApp 等 IM 软件，后文有 WhatsApp、飞书的详细配置方式。
3. 安装 Skills：选择默认安装的官方技能，这里比较多，选几个自己熟悉的工具即可。
4. 配置 Hooks：建议启用 `session-memory` 等核心钩子，以增强 AI 的记忆能力。

如果在配置过程中出错或想重新配置，可以随时 `Ctrl+C` 退出，然后执行以下命令再次进入向导：

```bash
openclaw onboard --install-daemon
```

### 检查 Gateway

安装完成后，Gateway 应该已作为系统服务在后台运行。你可以通过以下命令检查其状态：

```bash
# 查看 Gateway 运行状态（最重要）
openclaw gateway status

# 查看实时日志
openclaw gateway logs --tail 100
```

所有配置文件和数据默认存储在 `~/.openclaw` 目录下。

### 重要安全提醒

Gateway 默认仅在本地 `127.0.0.1` 监听服务，千万不要直接将其端口暴露到公网。不当的端口转发或防火墙配置可能导致你的设备被恶意访问，存在极高风险。

- 官方文档：https://docs.openclaw.ai/
- GitHub 仓库：https://github.com/openclaw/openclaw

### macOS VM

如果想在个人工作电脑上安装 openclaw，强烈建议使用虚拟机，防止潜在的合规风险。比如官方提到的 https://docs.openclaw.ai/platforms/macos-vm，用 lume 拉起一个 macOS VM 来跑。

基本的硬件要求：

- Apple Silicon Mac（M1/M2/M3/M4）
- macOS Sequoia 或更新版本
- ~60GB 空闲磁盘空间

## 配置 Gateway

Gateway 是 OpenClaw 的出口和管控核心。

### 设置为系统服务

在 onboard 过程中使用 `--install-daemon` 参数，会自动将 Gateway 安装为一个系统服务（如 macOS 的 `launchd` 或 Linux 的 `systemd`），实现开机自启和稳定运行。相关的生命周期管理命令如下：

```bash
# 安装为系统服务
openclaw gateway install

# 启动服务
openclaw gateway start

# 停止服务
openclaw gateway stop

# 重启服务
openclaw gateway restart

# 查看服务状态
openclaw gateway status

# 探测服务是否可达
openclaw gateway probe
```

### 访问 Dashboard 控制台

OpenClaw 提供了一个 Web UI 控制台（Dashboard），用于查看状态、管理会话、配置技能等。

- 访问方式：在浏览器中打开 `http://127.0.0.1:18789`
- 获取访问令牌：首次访问通常会提示“未授权”。你需要通过以下命令生成一个带 Token 的访问链接：

```bash
openclaw dashboard
```

该命令会输出一个类似 `http://127.0.0.1:18789/?token=xxxxx` 的 URL，使用这个完整的 URL 访问即可。Token 会被浏览器存储在 `localStorage` 中，后续访问无需重复输入。

- 远程访问：
  - 首选方案：强烈建议通过 SSH 隧道或 Tailscale 等安全的内网穿透工具进行远程访问，而不是直接暴露端口。

    ```bash
    ssh -N -L 18789:127.0.0.1:18789 user@your-server-ip
    ```

  - 风险降级方案：如果万不得已需要通过 HTTP 访问，你可以在配置文件中设置 `controlUi.allowInsecureAuth: true`。但这会降低安全性，因为浏览器在非 HTTPS 环境下无法使用更安全的设备身份验证。

核心配置文件：

以下是一些关键配置项的示例：

```jsonc
{
  "gateway": {
    // Gateway 运行模式，"local" 表示在本地安全运行
    "mode": "local",
    // 监听地址，"loopback"（127.0.0.1）是最安全的选择
    "bind": "loopback",
    "auth": {
      // 认证模式，可以是 "token" 或 "password"
      "mode": "token",
      // 认证令牌，由系统自动生成
      "token": "oc_token_xxxxxxxxxxxx",
    },
  },
  // 如果 Gateway 部署在反向代理（如 Nginx）后面，
  // 需要将代理服务器的 IP 加入信任列表，以便正确识别客户端 IP
  "trustedProxies": ["127.0.0.1"],
}
```

### 配置修改注意事项

- 严格的 Schema 校验：OpenClaw 会对配置文件进行严格的格式校验。任何未知的键、错误的类型或无效的值都会导致 Gateway 启动失败。
- 推荐的修改方式：
  - 使用 `openclaw config set <key> <value>` 来修改单个配置项。

### 快速自检与排错

当你遇到问题时，以下命令可以帮助你快速定位：

```bash
# 全面健康检查
openclaw health

# 深度安全审计，检查常见配置风险
openclaw security audit --deep

# 查看 Gateway 状态
openclaw gateway status
```

- 日志位置：默认日志文件位于 `/tmp/openclaw/openclaw-YYYY-MM-DD.log`。如果 Gateway 无法启动，检查最新的日志文件通常能找到原因。
- 常用排错入口：`openclaw doctor` 命令可以诊断并尝试修复常见的配置问题。

## 安装与管理 Skills

### 技能的来源与加载优先级

OpenClaw 从多个位置加载技能，并按以下优先级顺序处理同名冲突（高优先级覆盖低优先级）：

1. `<workspace>/skills`：当前工作区内的技能，优先级最高。这是你自定义或通过 ClawHub 安装技能的默认位置。
2. `~/.openclaw/skills`：用户级别的本地技能，用于存放跨工作区共享的个人技能。
3. Bundled Skills：OpenClaw 安装时内置的官方核心技能，优先级最低。
4. `skills.load.extraDirs`：在配置文件中指定的额外技能目录，优先级在内置技能之后。

### 使用 ClawHub 管理技能

可以通过 `clawhub` 命令行工具来发现、安装和更新技能。

```bash
# 安装一个技能（例如与 GitHub 交互的技能）
# 默认会安装到当前目录的 ./skills 下，随工作区加载
clawhub install github

# 更新所有已安装的技能
clawhub update --all

# 同步本地与远程市场的技能状态
clawhub sync
```

安装后的技能会在下一次创建新会话（Session）时被自动加载和识别。

### 查看与检查技能

你可以使用 `openclaw skills` 系列命令来管理和检查本地可用的技能。

```bash
# 列出所有已加载的技能及其状态
openclaw skills list

# 查看特定技能的详细信息（包括其依赖和指令）
openclaw skills info github

# 检查技能的依赖是否满足（例如，是否安装了必需的命令行工具）
openclaw skills check
```

- 环境依赖：很多技能依赖于外部命令行工具（如 `gh`、`git` 等）。`skills.install.preferBrew` 配置项（默认为 `true`）在 macOS 上优先使用 Homebrew 来安装这些依赖。`skills.install.nodeManager` 则控制使用哪个包管理器（`npm`、`pnpm` 等）来安装基于 Node.js 的技能依赖。

### 配置单个技能

你可以在 `~/.openclaw/openclaw.json` 的 `skills.entries` 部分为特定技能提供定制化配置，例如启用/禁用、注入环境变量或 API 密钥。

```jsonc
{
  "skills": {
    "entries": {
      // "github" 是技能的名称
      "github": {
        // 设为 false 可禁用该技能，即使它存在于加载路径中
        "enabled": true,
        // 为该技能的运行环境注入特定的环境变量
        "env": {
          "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx",
        },
        // apiKey 是一个便捷写法，等同于为技能声明的主环境变量（primaryEnv）赋值
        // "apiKey": "ghp_xxxxxxxxxxxx",
        "config": {
          "defaultRepo": "my-org/my-project",
        },
      },
    },
  },
}
```

### 核心安全提醒

- 将第三方 Skills 视为不可信代码：在安装和启用来自社区的技能前，务必审查其 `SKILL.md` 和相关脚本，了解它会执行哪些操作。
- 通过 `env` 或 `config` 注入机密：不要将 API Key 等敏感信息直接写在提示词中。应使用 `skills.entries.*.env` 或 `apiKey` 等配置方式安全地注入。
- 热加载与会话快照：默认情况下，技能的变更（增删改）会在新会话开始时生效。如果开启了文件监听（`skills.load.watch: true`），技能变更可以在当前会话的下一轮对话中“热加载”，这对于开发和调试非常有用。

## 常用功能与配置实践

### 1. 飞书插件

社区提供了成熟的飞书插件，可以让你在飞书应用内与 OpenClaw 交互。

- 插件地址：[m1heng/clawdbot-feishu](https://github.com/m1heng/clawdbot-feishu)
- 注意点：按 `README.md` 一步步配置的时候，有两个点需要注意下：
  - 必须在 OpenClaw 安装好插件、配置好 `AppId`、`AppSecret` 之后重启 OpenClaw 网关，否则在飞书开放平台修改事件配置方式的时候会报错，也就是下面这一步：

    `[图片]`

  - `allowFrom`、`allowGroupFrom`、`dmPolicy` 建议都设置成 `allowlist`，防止其他人通过私聊 bot 的形式接入。

### 2. 无法自动重启

有时，错误的配置（尤其是 AI 自动修改的配置）可能导致 Gateway 启动失败，从而陷入无法自愈的循环。

例如，AI 尝试配置 Telegram 频道时，生成了格式错误的 JSON，导致 `openclaw gateway restart` 失败。

在这种情况下，可以借助外部的守护进程来监控 OpenClaw 的健康状况，并在出现问题时执行自动修复或回滚操作。

- 项目地址：[cjraft/openclaw-watcher](https://github.com/cjraft/openclaw-watcher)
- 定期检查 Gateway 健康状态。
- 在检测到启动失败时，尝试从备份中恢复 `openclaw.json`。
- 记录故障日志，帮助你定位问题。

### 3. WhatsApp 连接

OpenClaw 用的是 WhatsApp Web 协议（通过 Baileys 库实现）来连 WhatsApp，不是官方 Business API，所以不需要企业账号，但需要扫二维码把你的 WhatsApp 账号“链接设备”给 Gateway 用。

配置：

如果在安装阶段跳过了 whatsapp 的配置，可以通过下述命令配置：

```bash
openclaw channels login whatsapp
```

- 弹出 QR 码（终端里显示）
- 打开手机 WhatsApp → 设置 → 已链接设备（Linked Devices）→ 链接设备（Link a Device）
- 用手机扫描终端/浏览器里的 QR 码
- 成功后会看到 `"Session established"` 或类似提示

#### 权限

配置允许谁能找 bot 聊天（强烈建议，防骚扰/防滥用）。在 `~/.openclaw/openclaw.json` 加这段（替换成你自己的手机号，国际格式 `+81` 开头）：

```jsonc
{
  "channels": {
    "whatsapp": {
      "dmPolicy": "allowlist",
      "allowFrom": ["+8611234567890"], // ← 你的手机号码，允许多个，逗号隔开
    },
  },
}
```

保存后重启 Gateway，测试：

- 用你 `allowFrom` 里的手机号码，给自己发消息（WhatsApp 自聊功能：新建聊天搜自己的号码）
- 或者直接发消息给任意联系人

### 4. Hooks 机制

Hooks 是在特定事件发生时自动触发的脚本或操作，它们在 Gateway 启动或处理命令时自动运行，是 OpenClaw 实现自动化的关键。其中 `boot-md`、`command-logger`、`session-memory` 是 OpenClaw 内置的 Hooks：

- `boot-md`：Gateway 启动时自动执行 `BOOT.md` 文件中的指令，用于初始化系统提示词、加载常用配置等，相当于“开机自启脚本”。
- `command-logger`：将所有执行的命令（用户输入、工具调用等）记录到日志文件（`~/.openclaw/logs/commands.log`），便于追踪和调试。
- `session-memory`：当你使用 `/new` 命令开启新会话时，它会自动将当前会话的上下文总结并保存到 `memory/` 目录下，为 AI 提供长期记忆的素材。

你可以通过 `openclaw hooks list` 和 `openclaw hooks info <hook_name>` 来查看和管理这些 Hooks。

### 5. 远程管控

适用于 mac mini 在家，但是人在外想要管理 mac mini 的情况。可以使用 jump desktop 这样的付费软件进行远程登录，不需要公网 IP 就能直连，效果取决于两端的网速。折腾点的可以用 OpenVPN + Screens 的方式。
