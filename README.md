# Claude Token Monitor

> 本地运行的 Claude Code token 用量与运行状态监控面板。3D 信号灯 + 今日/按天 token 折线图，全部基于 Claude Code 的本地 JSONL 日志与 hooks 事件，零外网传输。

<sub>A local-only dashboard that visualises Claude Code token usage and live run state. Reads from <code>~/.claude/projects/*.jsonl</code> and listens to Claude Code hooks; no data leaves your machine.</sub>

---

## 截图

| 仪表盘（按天对比 + 今日 vs 日均） | 3D 信号灯（红/黄/绿三态） |
|:---:|:---:|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Signal light running](docs/screenshots/signal-running.png) |

> 截图待补：把 `dashboard.png` / `signal-running.png` / `signal-idle.png` / `signal-waiting.png` 放进 `docs/screenshots/`。

## 特性

- **今日 token 总量** + 输入 / 输出 / 缓存创建 / 缓存读取 四象分项
- **今日 vs 最近 7 天日均**：自动算 ↑/↓ 百分比
- **图表切换**：按小时（最近 5 小时）/ 按天（最近 7 天）
- **3D 信号灯**（three.js）：
  - 🟢 绿灯 — Claude 正在运行
  - 🟡 黄灯 — 等待用户授权（Notification 钩子触发）
  - 🔴 红灯 — Claude 空闲
- **事件驱动**：通过 Claude Code 的 `UserPromptSubmit` / `PreToolUse` / `Notification` / `Stop` 钩子推送，毫秒级响应
- **本地优先**：服务仅绑 127.0.0.1，**所有数据从未离开你的电脑**
- **零外部 CDN**：three.js / Chart.js 全部本地服务

## 快速开始

### 1. 安装

```bash
npm install -g @haymitch1992/claude-token-monitor
```

需要 Node.js ≥ 18。

### 2. 安装 Claude Code 钩子

```bash
claude-token-monitor install-hooks
```

会把 4 个 hook 合并写进 `~/.claude/settings.json`（操作前自动备份到 `settings.json.bak.<时间戳>`，不覆盖你已有的 env / model / 其他 hooks）。

> ⚠️ **下次打开 Claude Code 才生效**。当前正在跑的 Claude Code 会话不会重新加载 settings.json。

### 3. 启动监控

```bash
claude-token-monitor
```

默认监听 `http://127.0.0.1:7878` 并自动打开浏览器。被占用时端口自动顺延到 7879、7880 … 最多探测 30 个端口。

打开后你会看到：
- 主仪表盘：`http://127.0.0.1:7878/`
- 3D 信号灯（适合放副屏常驻）：`http://127.0.0.1:7878/signal.html`

## 命令参考

```bash
claude-token-monitor                 # 启动 web 服务（默认）
claude-token-monitor start           # 同上，显式
claude-token-monitor install-hooks   # 注入 4 个 Claude Code 钩子
claude-token-monitor uninstall-hooks # 移除本工具注入的钩子（不动你自己的）

# 选项
  -p, --port <num>     起始端口（默认 7878，被占用顺延）
      --host <addr>    监听地址（默认 127.0.0.1）
      --no-open        启动后不自动打开浏览器
  -v, --version        打印版本
  -h, --help           显示帮助

# 用例
claude-token-monitor --port 8080                # 改端口
claude-token-monitor --no-open                  # SSH / 后台运行
claude-token-monitor install-hooks --port 8080  # 钩子对齐到自定义端口
```

## 工作原理

```
┌─────────────────────────────────────────────────┐
│  Claude Code                                    │
│  ├─ 写会话日志 → ~/.claude/projects/*.jsonl     │
│  └─ 触发 hooks → curl POST /api/event/...       │
└────────────┬──────────────────┬─────────────────┘
             │                  │
       chokidar 监听        HTTP POST
             │                  │
             ▼                  ▼
┌─────────────────────────────────────────────────┐
│  Node.js 服务 (127.0.0.1:7878)                  │
│  ├─ /api/usage   → 扫描 JSONL，按时/按天聚合    │
│  ├─ /api/status  → 当前 idle/running/waiting    │
│  └─ /events      → SSE 长连接，推送实时变化     │
└────────────┬────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────┐
│  浏览器                                         │
│  ├─ 仪表盘 (Chart.js 折线图)                    │
│  └─ 信号灯 (three.js 3D 模型)                   │
└─────────────────────────────────────────────────┘
```

**关键点：**
- Token 用量：直接解析每个 session JSONL 文件里 `type=="assistant"` 行的 `message.usage`，按本地时区分桶
- 状态切换：hooks 是权威信号（事件级精度）；文件 mtime 是兜底（无 hooks 时的 30 秒窗口）
- 增量扫描：文件级 mtime + size 缓存，重复请求 < 25 ms

## 数据隐私

- 服务**仅绑 127.0.0.1**，外部机器无法访问
- 不向任何外部接口发送数据（包括你自己的 Anthropic 账号 token）
- 钩子命令是发往 `127.0.0.1:7878` 的本地 HTTP，不出网卡
- 静态资源（three.js / Chart.js）从本地 `node_modules` 服务，无 CDN 调用

如果你的 `~/.claude/settings.json` 里有 `ANTHROPIC_AUTH_TOKEN` 或私有 `ANTHROPIC_BASE_URL`，本工具**不会读取也不会暴露**它们 —— 只动 `hooks` 字段。

## 卸载

```bash
claude-token-monitor uninstall-hooks   # 移除注入的 4 个钩子
npm uninstall -g @haymitch1992/claude-token-monitor
```

## FAQ

**Q：钩子安装后，当前 Claude Code 会话信号灯还是不动？**
A：Claude Code 启动时一次性读 settings.json，运行中不重载。新开一个会话或重启 Claude Code 即可。

**Q：我自己手动改过 hooks，会被覆盖吗？**
A：不会。安装器只动 4 个我们管理的事件（`UserPromptSubmit` / `PreToolUse` / `Notification` / `Stop`），且每条钩子带 `?ctm=1` 标记，卸载时只删带标记的。其他 hook 事件（如 `PostToolUse`、`SessionStart`）完全不碰。

**Q：端口冲突怎么办？**
A：CLI 启动时会自动顺延（7878 → 7879 → …）。如果换了端口想让钩子也指过去，重跑 `install-hooks --port <新端口>`。

**Q：能装到别的目录吗？**
A：数据来源是固定的 `~/.claude/projects/`，不可配置（这是 Claude Code 自己的位置）。

**Q：Windows 上 curl 不存在怎么办？**
A：`install-hooks` 安装时会自动探测 `curl`，找不到时切换到 Node 兜底 —— 钩子命令变成 `claude-token-monitor-notify <event>`，由本工具自己 POST。两种模式行为一致，curl 启动更快（~5 ms），Node 启动稍慢（~50-150 ms），但都不会阻塞 Claude Code。也可用 `--mode node` 强制使用 Node 模式。

**Q：钩子命令多久执行一次？慢吗？**
A：`UserPromptSubmit` 每轮回话 1 次、`Stop` 每轮 1 次、`PreToolUse` 每个工具调用 1 次、`Notification` 在权限请求时触发。curl 模式总开销 < 50 ms / 轮次，可忽略。

## 开发

```bash
git clone https://github.com/Haymitch1992/claude-token-monitor.git
cd claude-token-monitor
npm install
npm start              # 启动开发服务
node ./bin/cli.js -h   # 直接调 CLI
```

文件结构：

```
claude-token-monitor/
├── bin/cli.js                  # CLI 入口
├── server.js                   # Express + SSE + chokidar
├── lib/
│   ├── scanner.js              # JSONL 增量扫描 + 按时/按天聚合
│   └── hooks-installer.js      # settings.json 合并/卸载逻辑
└── public/
    ├── index.html              # 仪表盘
    ├── signal.html             # 3D 信号灯
    └── *.css, *.js
```

## License

[MIT](./LICENSE) © 2026 Haymitch1992
