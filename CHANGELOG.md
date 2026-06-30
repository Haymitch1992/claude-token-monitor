# Changelog

本项目变更日志，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- **`claude-token-monitor-notify` 第二个 bin**：纯 Node `http.request` 实现，硬上限 1 秒退出，用于无 curl 环境
- `install-hooks` 自动探测 `curl`，找不到自动切到 Node 模式；可用 `--mode curl|node` 强制
- 安装报告里打印 `钩子模式` 字段

### Security
- 仓库密钥审计：无 `ANTHROPIC_AUTH_TOKEN` / `sk-ant-` / 私有 URL 等敏感信息进入 git 跟踪

## [0.1.0] - 2026-06-30

### Added
- **CLI 入口** `claude-token-monitor`，命令：`start` / `install-hooks` / `uninstall-hooks`，选项 `--port` / `--host` / `--no-open` / `--version` / `--help`
- **端口探测**：被占用时自动从起始端口顺延，最多扫描 30 个端口
- **自动开浏览器**：Win/macOS/Linux 三平台分支处理，可用 `--no-open` 关闭
- **本机绑定**：默认 `127.0.0.1`，避免暴露到局域网
- **仪表盘** (`/`)：
  - 今日 token 总量 + 输入/输出/缓存创建/缓存读取 四象分项
  - 今日 vs 最近 7 天非空日均的 ↑↓ 百分比对比
  - 折线图 Switch 切换：最近 5 小时 / 最近 7 天
  - SSE 实时刷新 + 5s / 30s 轮询兜底
- **3D 信号灯** (`/signal.html`)：
  - three.js 立体模型：壳体 + 三个透镜（红/黄/绿）+ 支架 + 螺丝 + 灯柱
  - `MeshPhysicalMaterial` clearcoat 玻璃透镜，PMREM 环境贴图
  - 状态对应：🟢 running / 🟡 waiting / 🔴 idle，呼吸动画
- **Switch 组件**：仪表盘 ↔ 信号灯导航 + 图表维度切换，iOS 风格滑动旋钮
- **服务端状态机** (`/api/status`)：
  - `state` 字段：`idle` / `running` / `waiting`
  - 钩子事件优先；文件 mtime 作为 30 秒兜底窗口
  - 5 分钟 stale 安全阈，防止漏触发 Stop 钩子卡死
- **SSE 端点** (`/events`)：`hello` / `state-change` / `file-change` 三类事件，15 秒心跳
- **Hook 安装器** (`lib/hooks-installer.js`)：
  - 合并 4 个事件钩子到 `~/.claude/settings.json`，不覆盖用户已有配置
  - URL 查询参数 `ctm=1` 作为卸载识别标记
  - 自动备份到 `settings.json.bak.<时间戳>`
  - `install-hooks --port N` 一键更新所有钩子 URL
- **JSONL 增量扫描** (`lib/scanner.js`)：
  - 按文件 mtime + size 缓存，offset 续读未变化部分
  - 按本地时区分桶（24 小时 + 多天）
  - 自动跨日重置
- **本地化静态资源**：three.js / Chart.js 全部从本地 `node_modules` 服务（`/vendor/three`、`/vendor/chart.js`），消除 CDN 往返
- **延迟 PMREM**：环境贴图在首帧绘制后异步生成，避免阻塞首屏

### Security
- 服务仅监听 `127.0.0.1`，不暴露到局域网
- 钩子命令调用本地 HTTP，零外网流量
- 安装器不读取也不修改用户的 `env.ANTHROPIC_*` 配置

[Unreleased]: https://github.com/Haymitch1992/claude-token-monitor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Haymitch1992/claude-token-monitor/releases/tag/v0.1.0
