'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

const { createServer } = require('../server.js');

// Pick a random free port to avoid colliding with a running instance
async function freePort() {
  return new Promise(resolve => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

async function withServer(fn) {
  const port = await freePort();
  const server = createServer({ host: '127.0.0.1', port, quiet: true });
  // Wait one tick for listen to bind
  await new Promise(r => server.httpServer.once('listening', r));
  try { await fn({ port }); } finally { await server.close(); }
}

test('GET /api/status returns valid snapshot', async () => {
  await withServer(async ({ port }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/status`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(['idle', 'running', 'waiting'].includes(j.state), `state should be enum, got ${j.state}`);
    assert.equal(typeof j.hooksActive, 'boolean');
    assert.equal(typeof j.fallbackWindowSeconds, 'number');
  });
});

test('GET /api/usage returns aggregated structure', async () => {
  await withServer(async ({ port }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/usage?days=3`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(j.totals);
    assert.equal(j.hourly.length, 24);
    assert.equal(j.daily.length, 3);
  });
});

test('POST /api/event/prompt_submit transitions to running', async () => {
  await withServer(async ({ port }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/event/prompt_submit`, { method: 'POST' });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.state, 'running');
    assert.equal(j.ok, true);
  });
});

test('POST /api/event/stop transitions to idle', async () => {
  await withServer(async ({ port }) => {
    await fetch(`http://127.0.0.1:${port}/api/event/prompt_submit`, { method: 'POST' });
    const r = await fetch(`http://127.0.0.1:${port}/api/event/stop`, { method: 'POST' });
    const j = await r.json();
    assert.equal(j.state, 'idle');
  });
});

test('POST /api/event/notification transitions to waiting', async () => {
  await withServer(async ({ port }) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/event/notification`, { method: 'POST' });
    const j = await r.json();
    assert.equal(j.state, 'waiting');
  });
});

test('GET / serves dashboard HTML', async () => {
  await withServer(async ({ port }) => {
    const r = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /Claude Token/);
  });
});

test('GET /signal.html serves signal page', async () => {
  await withServer(async ({ port }) => {
    const r = await fetch(`http://127.0.0.1:${port}/signal.html`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /signal\.js/);
  });
});
