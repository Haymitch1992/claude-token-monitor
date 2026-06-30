#!/usr/bin/env node
'use strict';

const net = require('node:net');
const { spawn } = require('node:child_process');
const { parseArgs } = require('node:util');
const path = require('node:path');
const pkg = require('../package.json');

const DEFAULT_PORT = 7878;
const DEFAULT_HOST = '127.0.0.1';
const PORT_PROBE_RANGE = 30;

const HELP = `
${pkg.name} v${pkg.version}
${pkg.description}

用法:
  claude-token-monitor [start] [options]   启动本地 web 服务（默认）
  claude-token-monitor install-hooks       注入 Claude Code 钩子到 ~/.claude/settings.json
  claude-token-monitor uninstall-hooks     移除本工具注入的钩子

选项:
  -p, --port <num>      起始端口（默认 ${DEFAULT_PORT}，被占用时自动顺延）
      --host <addr>     监听地址（默认 ${DEFAULT_HOST}，仅本机；填 0.0.0.0 暴露到局域网，请谨慎）
      --no-open         启动后不自动打开浏览器
      --mode <c|n>      install-hooks 模式：curl 或 node（默认自动探测 curl）
  -v, --version         打印版本
  -h, --help            显示帮助

示例:
  claude-token-monitor                     用默认设置启动
  claude-token-monitor --port 8080         指定起始端口
  claude-token-monitor --no-open           启动但不开浏览器（适合后台 / SSH）
`.trim();

function log(msg) { process.stdout.write(msg + '\n'); }
function err(msg) { process.stderr.write(msg + '\n'); }

// === Port probe (sequential) ===
function tryListen(port, host) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

async function findFreePort(start, host) {
  for (let p = start; p < start + PORT_PROBE_RANGE; p++) {
    if (await tryListen(p, host)) return p;
  }
  throw new Error(`端口 ${start}..${start + PORT_PROBE_RANGE - 1} 均被占用`);
}

// === Browser open (cross-platform) ===
function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    err(`[warn] 自动打开浏览器失败: ${e.message}`);
  }
}

// === Commands ===
async function cmdStart(opts) {
  const host = opts.host || DEFAULT_HOST;
  const startPort = Number(opts.port) || DEFAULT_PORT;

  let port;
  try {
    port = await findFreePort(startPort, host);
  } catch (e) {
    err(e.message);
    process.exit(3);
  }

  const { createServer } = require('../server.js');
  const server = createServer({ host, port, quiet: true });

  const displayHost = (host === '0.0.0.0' || host === '::') ? 'localhost' : host;
  const url = `http://${displayHost}:${port}`;

  log('');
  log(`  Claude Token Monitor v${pkg.version}`);
  log('  ─────────────────────────────────────');
  log(`  仪表盘: ${url}`);
  log(`  信号灯: ${url}/signal.html`);
  log('  ─────────────────────────────────────');
  if (host === '127.0.0.1') log('  绑定 127.0.0.1（仅本机可访问）');
  else log(`  绑定 ${host}（其他机器可访问，确认网络环境安全）`);
  log('  按 Ctrl+C 退出');
  log('');

  if (!opts['no-open']) {
    setTimeout(() => openBrowser(url), 400);
  }

  const shutdown = async (sig) => {
    log(`\n收到 ${sig}，正在关闭...`);
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function cmdInstallHooks(opts) {
  const { installHooks, SETTINGS_PATH } = require('../lib/hooks-installer.js');
  const port = Number(opts.port) || DEFAULT_PORT;
  const host = '127.0.0.1';
  const mode = opts.mode;  // undefined = auto-detect (curl if present, else node)

  if (mode && mode !== 'curl' && mode !== 'node') {
    err(`--mode 必须是 curl 或 node`);
    process.exit(2);
  }

  try {
    const result = installHooks({ port, host, mode });
    if (result.bakPath) log(`已备份原 settings.json → ${result.bakPath}`);
    if (result.added.length) log(`✓ 新增钩子: ${result.added.join(', ')}`);
    if (result.updated.length) log(`✓ 更新钩子（指向端口 ${port}）: ${result.updated.join(', ')}`);
    if (!result.added.length && !result.updated.length) log('钩子已是最新，无变更');
    log('');
    log(`钩子模式: ${result.mode}${result.mode === 'node' ? '（未检测到 curl，使用 Node 兜底）' : ''}`);
    log(`配置位置: ${SETTINGS_PATH}`);
    log('下次启动 Claude Code 时钩子生效（当前已开会话不会重新加载 settings.json）。');
  } catch (e) {
    err(`安装失败: ${e.message}`);
    process.exit(1);
  }
}

function cmdUninstallHooks() {
  const { uninstallHooks, SETTINGS_PATH } = require('../lib/hooks-installer.js');
  try {
    const result = uninstallHooks();
    if (!result.settingsExisted) {
      log(`${SETTINGS_PATH} 不存在，无需操作。`);
      return;
    }
    if (result.bakPath) log(`已备份原 settings.json → ${result.bakPath}`);
    if (result.removed.length) {
      log(`✓ 已从以下事件中移除本工具注入的钩子: ${result.removed.join(', ')}`);
    } else {
      log('未发现本工具注入的钩子，settings.json 未变化。');
    }
  } catch (e) {
    err(`卸载失败: ${e.message}`);
    process.exit(1);
  }
}

// === Main ===
async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        port:      { type: 'string',  short: 'p' },
        host:      { type: 'string' },
        'no-open': { type: 'boolean' },
        mode:      { type: 'string' },  // 'curl' | 'node' — only for install-hooks
        version:   { type: 'boolean', short: 'v' },
        help:      { type: 'boolean', short: 'h' }
      },
      allowPositionals: true,
      strict: true
    });
  } catch (e) {
    err(`参数错误: ${e.message}`);
    err(HELP);
    process.exit(2);
  }

  const { values, positionals } = parsed;

  if (values.version) { log(pkg.version); return; }
  if (values.help)    { log(HELP); return; }

  const sub = positionals[0] || 'start';
  switch (sub) {
    case 'start':            return cmdStart(values);
    case 'install-hooks':    return cmdInstallHooks(values);
    case 'uninstall-hooks':  return cmdUninstallHooks(values);
    default:
      err(`未知命令: ${sub}\n`);
      err(HELP);
      process.exit(2);
  }
}

main().catch(e => {
  err(e && e.stack || String(e));
  process.exit(1);
});
