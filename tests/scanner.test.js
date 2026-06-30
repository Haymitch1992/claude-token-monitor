'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { aggregateRecent } = require('../lib/scanner.js');

test('aggregateRecent returns expected shape', async () => {
  const result = await aggregateRecent({ daysBack: 7 });
  assert.ok(result, 'returns object');
  assert.ok(result.totals, 'has totals');
  for (const k of ['input', 'output', 'cache_creation', 'cache_read']) {
    assert.equal(typeof result.totals[k], 'number', `totals.${k} is number`);
  }
  assert.ok(Array.isArray(result.hourly), 'hourly is array');
  assert.equal(result.hourly.length, 24, 'hourly has 24 buckets');
  assert.equal(result.hourly[0].hour, 0);
  assert.equal(result.hourly[23].hour, 23);
  assert.ok(Array.isArray(result.daily), 'daily is array');
  assert.equal(result.daily.length, 7, 'daily has 7 entries');
  assert.equal(typeof result.daily[6].isToday, 'boolean');
  assert.equal(typeof result.fileCount, 'number');
  assert.ok(result.updatedAt, 'has updatedAt');
});

test('aggregateRecent respects daysBack parameter', async () => {
  const r3 = await aggregateRecent({ daysBack: 3 });
  const r14 = await aggregateRecent({ daysBack: 14 });
  assert.equal(r3.daily.length, 3);
  assert.equal(r14.daily.length, 14);
});

test('daily entries are oldest-to-newest with today last', async () => {
  const result = await aggregateRecent({ daysBack: 5 });
  const dates = result.daily.map(d => d.date);
  const sorted = [...dates].sort();
  assert.deepEqual(dates, sorted, 'dates are ascending');
  assert.equal(result.daily[result.daily.length - 1].isToday, true);
});
