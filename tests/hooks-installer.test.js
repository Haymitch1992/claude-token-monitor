'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { installHooks, uninstallHooks } = require('../lib/hooks-installer.js');

function tmpSettings(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctm-test-'));
  const file = path.join(dir, 'settings.json');
  if (content !== undefined) fs.writeFileSync(file, content);
  return { dir, file };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('install adds 4 hooks into fresh settings', () => {
  const { dir, file } = tmpSettings();
  const r = installHooks({ port: 7878, settingsPath: file, mode: 'curl' });
  assert.deepEqual(r.added.sort(), ['Notification', 'PreToolUse', 'Stop', 'UserPromptSubmit']);
  const j = readJson(file);
  assert.ok(j.hooks.UserPromptSubmit);
  assert.ok(j.hooks.PreToolUse[0].matcher === '.*');
  assert.match(j.hooks.Stop[0].hooks[0].command, /api\/event\/stop\?ctm=1/);
  fs.rmSync(dir, { recursive: true });
});

test('install preserves user env and other top-level keys', () => {
  const initial = JSON.stringify({
    env: { ANTHROPIC_API_KEY: 'sk-secret', MY_VAR: '1' },
    model: 'opus[1m]',
    customField: { foo: 'bar' }
  });
  const { dir, file } = tmpSettings(initial);
  installHooks({ port: 7878, settingsPath: file, mode: 'curl' });
  const j = readJson(file);
  assert.equal(j.env.ANTHROPIC_API_KEY, 'sk-secret');
  assert.equal(j.env.MY_VAR, '1');
  assert.equal(j.model, 'opus[1m]');
  assert.deepEqual(j.customField, { foo: 'bar' });
  fs.rmSync(dir, { recursive: true });
});

test('install is idempotent (same port = no change reported)', () => {
  const { dir, file } = tmpSettings();
  installHooks({ port: 7878, settingsPath: file, mode: 'curl' });
  const r2 = installHooks({ port: 7878, settingsPath: file, mode: 'curl' });
  assert.equal(r2.added.length, 0);
  assert.equal(r2.updated.length, 0);
  fs.rmSync(dir, { recursive: true });
});

test('install with new port updates URL of existing hooks', () => {
  const { dir, file } = tmpSettings();
  installHooks({ port: 7878, settingsPath: file, mode: 'curl' });
  installHooks({ port: 9999, settingsPath: file, mode: 'curl' });
  const j = readJson(file);
  assert.match(j.hooks.Stop[0].hooks[0].command, /:9999\//);
  fs.rmSync(dir, { recursive: true });
});

test('node mode writes claude-token-monitor-notify command', () => {
  const { dir, file } = tmpSettings();
  installHooks({ port: 7878, settingsPath: file, mode: 'node' });
  const j = readJson(file);
  assert.match(j.hooks.UserPromptSubmit[0].hooks[0].command, /claude-token-monitor-notify prompt_submit/);
  fs.rmSync(dir, { recursive: true });
});

test('uninstall removes our hooks but keeps user data', () => {
  const initial = JSON.stringify({
    env: { ANTHROPIC_API_KEY: 'sk-keep' },
    hooks: {
      PostToolUse: [{ hooks: [{ type: 'command', command: 'echo user-owned' }] }]
    }
  });
  const { dir, file } = tmpSettings(initial);
  installHooks({ port: 7878, settingsPath: file, mode: 'curl' });
  uninstallHooks({ settingsPath: file });
  const j = readJson(file);
  assert.equal(j.env.ANTHROPIC_API_KEY, 'sk-keep');
  // User's own PostToolUse hook stays
  assert.equal(j.hooks.PostToolUse[0].hooks[0].command, 'echo user-owned');
  // Our 4 events are gone
  assert.equal(j.hooks.UserPromptSubmit, undefined);
  assert.equal(j.hooks.Stop, undefined);
  fs.rmSync(dir, { recursive: true });
});

test('uninstall recognizes legacy (no-marker) hooks too', () => {
  const initial = JSON.stringify({
    hooks: {
      Stop: [{
        hooks: [{ type: 'command', command: 'curl -X POST http://localhost:7878/api/event/stop' }]
      }]
    }
  });
  const { dir, file } = tmpSettings(initial);
  uninstallHooks({ settingsPath: file });
  const j = readJson(file);
  assert.equal(j.hooks, undefined);
  fs.rmSync(dir, { recursive: true });
});

test('install creates timestamped backup when file exists', () => {
  const { dir, file } = tmpSettings('{"model":"x"}');
  const r = installHooks({ port: 7878, settingsPath: file, mode: 'curl' });
  assert.ok(r.bakPath && fs.existsSync(r.bakPath));
  assert.match(r.bakPath, /\.bak\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
  fs.rmSync(dir, { recursive: true });
});
