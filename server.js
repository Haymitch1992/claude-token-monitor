const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const chokidar = require('chokidar');
const { aggregateRecent, PROJECTS_ROOT } = require('./lib/scanner');

// File-mtime fallback window — used only before any hook event is seen
const FALLBACK_WINDOW_MS = 30_000;
// Safety: if hook mode marks running/waiting but no activity for this long, assume idle
const STALE_WINDOW_MS = 5 * 60_000;

const app = express();

// Vendor JS — serve three.js and chart.js from local node_modules to avoid CDN latency
app.use('/vendor/three', express.static(
  path.join(__dirname, 'node_modules/three'),
  { maxAge: '7d', immutable: true }
));
app.use('/vendor/chart.js', express.static(
  path.join(__dirname, 'node_modules/chart.js/dist'),
  { maxAge: '7d', immutable: true }
));

app.use(express.static(path.join(__dirname, 'public')));

// === State machine ===
let state = 'idle';            // 'idle' | 'running' | 'waiting'
let lastActivity = 0;          // ms; updated by hooks OR file change
let lastEventType = null;      // for diagnostics
let lastFilePath = null;
let hooksSeen = false;         // becomes true on first hook event

const sseClients = new Set();

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) {
    try { c.write(payload); } catch {}
  }
}

function snapshot() {
  return {
    state: currentState(),
    rawState: state,
    hooksActive: hooksSeen,
    lastActivity: lastActivity ? new Date(lastActivity).toISOString() : null,
    lastActivityTs: lastActivity || null,
    lastEventType,
    lastFilePath,
    secondsSinceActivity: lastActivity ? Math.floor((Date.now() - lastActivity) / 1000) : null,
    fallbackWindowSeconds: FALLBACK_WINDOW_MS / 1000,
    // Backward-compat fields
    running: currentState() === 'running',
    lastWriteTime: lastActivity ? new Date(lastActivity).toISOString() : null,
    secondsSinceLastWrite: lastActivity ? Math.floor((Date.now() - lastActivity) / 1000) : null,
    windowSeconds: FALLBACK_WINDOW_MS / 1000
  };
}

function currentState() {
  if (!hooksSeen) {
    if (lastActivity > 0 && Date.now() - lastActivity < FALLBACK_WINDOW_MS) return 'running';
    return 'idle';
  }
  if (state !== 'idle' && Date.now() - lastActivity > STALE_WINDOW_MS) return 'idle';
  return state;
}

function transition(newState, eventType) {
  state = newState;
  lastActivity = Date.now();
  lastEventType = eventType;
  broadcastSSE('state-change', snapshot());
}

// === API ===
app.get('/api/usage', async (req, res) => {
  try {
    const days = Math.max(2, Math.min(30, Number(req.query.days) || 7));
    const data = await aggregateRecent({ daysBack: days });
    res.json(data);
  } catch (err) {
    console.error('aggregate error', err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
});

app.get('/api/status', (req, res) => {
  res.json(snapshot());
});

// Hook event ingress — both GET and POST so curl works either way
const HOOK_TO_STATE = {
  prompt_submit:  'running',
  tool_use:       'running',
  pre_tool_use:   'running',  // alias
  post_tool_use:  'running',  // optional
  notification:   'waiting',
  stop:           'idle',
  subagent_stop:  null        // do not change top-level state
};

function handleHook(type) {
  hooksSeen = true;
  const next = HOOK_TO_STATE[type];
  if (next == null) {
    // event recognised but does not change state (e.g. subagent_stop heartbeat)
    lastActivity = Date.now();
    lastEventType = type;
    broadcastSSE('state-change', snapshot());
    return true;
  }
  transition(next, type);
  return true;
}

app.post('/api/event/:type', express.json(), (req, res) => {
  const ok = handleHook(req.params.type);
  res.json({ ok, state: currentState() });
});
app.get('/api/event/:type', (req, res) => {
  const ok = handleHook(req.params.type);
  res.json({ ok, state: currentState() });
});

// === SSE ===
app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write(`event: hello\ndata: ${JSON.stringify(snapshot())}\n\n`);
  sseClients.add(res);
  const keepAlive = setInterval(() => {
    try { res.write(`: keepalive\n\n`); } catch {}
  }, 15_000);
  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// === File watcher (fallback + heartbeat in hook mode) ===
function onFileTouched(eventName, filePath) {
  if (!filePath || !filePath.endsWith('.jsonl')) return;
  lastActivity = Date.now();
  lastFilePath = filePath;
  if (!hooksSeen) lastEventType = 'file:' + eventName;
  broadcastSSE('file-change', {
    event: eventName,
    path: filePath,
    ts: lastActivity,
    ...snapshot()
  });
}

function startWatcher() {
  if (!fs.existsSync(PROJECTS_ROOT)) {
    console.warn(`[warn] Projects directory does not exist: ${PROJECTS_ROOT}`);
    return null;
  }
  const watcher = chokidar.watch(PROJECTS_ROOT, {
    ignoreInitial: true,
    awaitWriteFinish: false,
    depth: 4,
    persistent: true,
    usePolling: false
  });
  watcher.on('change', fp => onFileTouched('change', fp));
  watcher.on('add', fp => onFileTouched('add', fp));
  watcher.on('error', err => console.error('[chokidar] error', err));
  watcher.on('ready', () => console.log(`[chokidar] watching ${PROJECTS_ROOT}`));
  return watcher;
}

function createServer({ host = '127.0.0.1', port = 7878, quiet = false } = {}) {
  const watcher = startWatcher();
  const httpServer = app.listen(port, host, () => {
    if (!quiet) {
      console.log(`Claude token monitor listening on http://${host}:${port}`);
      console.log(`Data source: ${PROJECTS_ROOT}`);
    }
  });
  return {
    app,
    httpServer,
    watcher,
    close() {
      return new Promise(resolve => {
        if (watcher) watcher.close();
        httpServer.close(() => resolve());
      });
    }
  };
}

module.exports = { createServer, app };

if (require.main === module) {
  const port = Number(process.env.PORT) || 7878;
  const host = process.env.HOST || '127.0.0.1';
  createServer({ host, port });
}
