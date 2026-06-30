#!/usr/bin/env node
'use strict';

// Tiny fire-and-forget notifier used by Claude Code hooks when curl isn't
// available. Exits within ~1s regardless of network outcome so it never
// blocks the Claude Code hook pipeline.
//
// Usage:  claude-token-monitor-notify <event_type> [--port N] [--host H]
//
// All errors are swallowed silently — hooks must never disrupt the user.

const http = require('node:http');

const args = process.argv.slice(2);
let event = null;
let port = 7878;
let host = '127.0.0.1';

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--port' || a === '-p') port = Number(args[++i]) || port;
  else if (a === '--host') host = args[++i] || host;
  else if (!event && !a.startsWith('-')) event = a;
}

if (!event) process.exit(0);  // silent: invalid invocation should not noisy the hook

const req = http.request({
  hostname: host,
  port,
  path: `/api/event/${encodeURIComponent(event)}?ctm=1`,
  method: 'POST',
  timeout: 800
}, res => { res.resume(); res.on('end', () => process.exit(0)); });

req.on('error', () => process.exit(0));
req.on('timeout', () => { req.destroy(); process.exit(0); });
req.end();

// Hard ceiling — guarantee we exit fast
setTimeout(() => process.exit(0), 1000).unref();
