'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

// Sentinel embedded in our hook URLs so uninstall can pick them out without
// touching anything the user wrote by hand.
const MARKER = 'ctm=1';

// Map Claude Code hook event name -> our internal event type
const HOOK_EVENTS = {
  UserPromptSubmit: 'prompt_submit',
  PreToolUse:       'tool_use',
  Notification:     'notification',
  Stop:             'stop'
};

// Events that require a `matcher` field in Claude Code's settings.json schema
const NEEDS_MATCHER = new Set(['PreToolUse', 'PostToolUse']);

function hasCurl() {
  const probe = process.platform === 'win32' ? 'where curl' : 'command -v curl';
  try {
    execSync(probe, { stdio: 'ignore', timeout: 1500 });
    return true;
  } catch { return false; }
}

function buildCommand(eventType, host, port, mode) {
  const url = `http://${host}:${port}/api/event/${eventType}?${MARKER}`;
  if (mode === 'node') {
    // Uses the second bin we publish — assumed on PATH after `npm install -g`
    return `claude-token-monitor-notify ${eventType} --port ${port} --host ${host}`;
  }
  return `curl -s --max-time 1 -X POST "${url}"`;
}

function readSettings(filePath) {
  if (!fs.existsSync(filePath)) return {};
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(`无法读取 ${filePath}: ${e.message}`);
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${filePath} 不是合法 JSON: ${e.message}`);
  }
}

function backup(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const bakPath = `${filePath}.bak.${ts}`;
  fs.copyFileSync(filePath, bakPath);
  return bakPath;
}

function writeSettings(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/**
 * A hook command is "ours" if it carries our marker, OR (legacy) it points to
 * /api/event/<our events> on any local host. The second branch lets us
 * upgrade hooks that were set up manually before this CLI existed.
 */
function isOurHookCommand(cmd) {
  if (typeof cmd !== 'string') return false;
  if (cmd.includes(MARKER)) return true;
  if (cmd.includes('claude-token-monitor-notify')) return true;
  return /\/api\/event\/(prompt_submit|tool_use|notification|stop|subagent_stop)\b/.test(cmd);
}

function isOurHookEntry(entry) {
  if (!entry || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some(h => h && isOurHookCommand(h.command));
}

function installHooks({ port = 7878, host = '127.0.0.1', mode, settingsPath = SETTINGS_PATH } = {}) {
  const resolvedMode = mode || (hasCurl() ? 'curl' : 'node');
  const settings = readSettings(settingsPath);
  const bakPath = backup(settingsPath);

  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};

  const added = [];
  const updated = [];

  for (const [eventName, eventType] of Object.entries(HOOK_EVENTS)) {
    if (!Array.isArray(settings.hooks[eventName])) settings.hooks[eventName] = [];

    const cmd = buildCommand(eventType, host, port, resolvedMode);
    const existingEntry = settings.hooks[eventName].find(isOurHookEntry);

    if (existingEntry) {
      // Upgrade in place: replace any of our hooks with the canonical command
      const before = JSON.stringify(existingEntry);
      existingEntry.hooks = existingEntry.hooks.map(h =>
        h && isOurHookCommand(h.command)
          ? { type: 'command', command: cmd }
          : h
      );
      if (NEEDS_MATCHER.has(eventName) && !existingEntry.matcher) existingEntry.matcher = '.*';
      if (JSON.stringify(existingEntry) !== before) updated.push(eventName);
    } else {
      const newEntry = { hooks: [{ type: 'command', command: cmd }] };
      if (NEEDS_MATCHER.has(eventName)) newEntry.matcher = '.*';
      settings.hooks[eventName].push(newEntry);
      added.push(eventName);
    }
  }

  writeSettings(settingsPath, settings);
  return { added, updated, bakPath, settingsPath, mode: resolvedMode };
}

function uninstallHooks({ settingsPath = SETTINGS_PATH } = {}) {
  if (!fs.existsSync(settingsPath)) {
    return { removed: [], bakPath: null, settingsExisted: false, settingsPath };
  }
  const settings = readSettings(settingsPath);
  const bakPath = backup(settingsPath);

  if (!settings.hooks || typeof settings.hooks !== 'object') {
    return { removed: [], bakPath, settingsExisted: true, settingsPath };
  }

  const removed = [];

  for (const eventName of Object.keys(HOOK_EVENTS)) {
    if (!Array.isArray(settings.hooks[eventName])) continue;
    const before = settings.hooks[eventName].length;

    settings.hooks[eventName] = settings.hooks[eventName]
      .map(entry => {
        if (!entry || !Array.isArray(entry.hooks)) return entry;
        const filtered = entry.hooks.filter(h => !(h && isOurHookCommand(h.command)));
        if (filtered.length === entry.hooks.length) return entry;
        if (filtered.length === 0) return null; // mark for removal
        return { ...entry, hooks: filtered };
      })
      .filter(Boolean);

    if (settings.hooks[eventName].length === 0) {
      delete settings.hooks[eventName];
      if (before > 0) removed.push(eventName);
    } else if (settings.hooks[eventName].length < before) {
      removed.push(eventName);
    }
  }

  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  writeSettings(settingsPath, settings);
  return { removed, bakPath, settingsExisted: true, settingsPath };
}

module.exports = {
  installHooks,
  uninstallHooks,
  hasCurl,
  SETTINGS_PATH,
  HOOK_EVENTS,
  MARKER
};
