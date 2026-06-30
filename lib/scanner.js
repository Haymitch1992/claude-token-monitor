const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const readline = require('readline');

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');
const DEFAULT_DAYS_BACK = 7;

// Per-file incremental cache:
// filepath -> { size, mtimeMs, perDay: Map<dayKey, tokens>, todayHourly: [24 buckets], todayKey }
const fileCache = new Map();

function emptyTokens() {
  return { input: 0, output: 0, cache_creation: 0, cache_read: 0 };
}
function emptyHourly() {
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h, input: 0, output: 0, cache_creation: 0, cache_read: 0
  }));
}
function addTokens(target, src) {
  target.input += src.input || 0;
  target.output += src.output || 0;
  target.cache_creation += src.cache_creation || 0;
  target.cache_read += src.cache_read || 0;
}
function totalOf(tokens) {
  return (tokens.input || 0) + (tokens.output || 0)
       + (tokens.cache_creation || 0) + (tokens.cache_read || 0);
}

function dayKeyOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayKey() { return dayKeyOf(new Date()); }

function tokensFromUsage(usage) {
  return {
    input: Number(usage.input_tokens) || 0,
    output: Number(usage.output_tokens) || 0,
    cache_creation: Number(usage.cache_creation_input_tokens) || 0,
    cache_read: Number(usage.cache_read_input_tokens) || 0
  };
}

async function listJsonlFiles() {
  let entries;
  try {
    entries = await fsp.readdir(PROJECTS_ROOT, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(PROJECTS_ROOT, entry.name);
    let inner;
    try {
      inner = await fsp.readdir(projectDir, { withFileTypes: true });
    } catch { continue; }
    for (const f of inner) {
      if (f.isFile() && f.name.endsWith('.jsonl')) {
        files.push(path.join(projectDir, f.name));
      }
    }
  }
  return files;
}

function processLine(line, todayKeyStr, perDay, todayHourly) {
  if (!line) return;
  let obj;
  try { obj = JSON.parse(line); } catch { return; }
  if (obj.type !== 'assistant') return;
  const usage = obj.usage || (obj.message && obj.message.usage);
  if (!usage) return;
  const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;
  if (!Number.isFinite(ts)) return;
  const date = new Date(ts);
  const k = dayKeyOf(date);
  const tokens = tokensFromUsage(usage);

  let bucket = perDay.get(k);
  if (!bucket) { bucket = emptyTokens(); perDay.set(k, bucket); }
  addTokens(bucket, tokens);

  if (k === todayKeyStr) {
    const hour = date.getHours();
    const hb = todayHourly[hour];
    hb.input += tokens.input;
    hb.output += tokens.output;
    hb.cache_creation += tokens.cache_creation;
    hb.cache_read += tokens.cache_read;
  }
}

async function readFileFromOffset(filepath, startOffset) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filepath, { start: startOffset, encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const lines = [];
    rl.on('line', l => lines.push(l));
    rl.on('close', () => resolve(lines));
    rl.on('error', reject);
    stream.on('error', reject);
  });
}

/**
 * Aggregate today's hourly + last `daysBack` days daily across all session JSONL files.
 * Increment-aware cache per file; today's hourly bucket is invalidated when the local day rolls over.
 */
async function aggregateRecent({ daysBack = DEFAULT_DAYS_BACK } = {}) {
  const tKey = todayKey();
  const files = await listJsonlFiles();

  // Aggregate accumulators
  const allPerDay = new Map();   // dayKey -> tokens
  const todayHourly = emptyHourly();

  for (const fp of files) {
    let stat;
    try { stat = await fsp.stat(fp); } catch { continue; }
    const cached = fileCache.get(fp);

    let perDay, fileTodayHourly;
    let startOffset = 0;

    // Reuse cache only when (a) size+mtime match exactly, (b) today's key matches cached today
    if (cached && stat.size === cached.size && stat.mtimeMs === cached.mtimeMs && cached.todayKey === tKey) {
      perDay = cached.perDay;
      fileTodayHourly = cached.todayHourly;
    } else {
      // If today rolled over since cache snapshot, fileTodayHourly must be recomputed from scratch
      const tookOverDayBoundary = cached && cached.todayKey !== tKey;
      const canIncrement = cached
        && stat.size >= cached.size
        && stat.mtimeMs >= cached.mtimeMs
        && !tookOverDayBoundary;

      if (canIncrement) {
        startOffset = cached.size;
        perDay = new Map(cached.perDay);
        // perDay values are objects, must deep-copy so we don't mutate cache
        for (const [k, v] of perDay) perDay.set(k, { ...v });
        fileTodayHourly = cached.todayHourly.map(h => ({ ...h }));
      } else {
        perDay = new Map();
        fileTodayHourly = emptyHourly();
      }

      let lines;
      try { lines = await readFileFromOffset(fp, startOffset); } catch { lines = []; }
      for (const line of lines) processLine(line, tKey, perDay, fileTodayHourly);

      fileCache.set(fp, {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        perDay,
        todayHourly: fileTodayHourly,
        todayKey: tKey
      });
    }

    // Merge file contribution into global aggregates
    for (const [k, v] of perDay) {
      let g = allPerDay.get(k);
      if (!g) { g = emptyTokens(); allPerDay.set(k, g); }
      addTokens(g, v);
    }
    for (let i = 0; i < 24; i++) {
      todayHourly[i].input += fileTodayHourly[i].input;
      todayHourly[i].output += fileTodayHourly[i].output;
      todayHourly[i].cache_creation += fileTodayHourly[i].cache_creation;
      todayHourly[i].cache_read += fileTodayHourly[i].cache_read;
    }
  }

  // Build daily list for last `daysBack` days (oldest -> newest)
  const daily = [];
  const today = new Date();
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const k = dayKeyOf(d);
    const t = allPerDay.get(k) || emptyTokens();
    daily.push({
      date: k,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      ...t,
      total: totalOf(t),
      isToday: k === tKey
    });
  }

  // Today's totals = aggregated today bucket
  const totals = allPerDay.get(tKey) || emptyTokens();

  // Average of last `daysBack` days EXCLUDING today and EXCLUDING zero-activity days
  const priorDays = daily.filter(d => !d.isToday && d.total > 0);
  let average = null;
  if (priorDays.length > 0) {
    const sum = emptyTokens();
    for (const d of priorDays) addTokens(sum, d);
    average = {
      sampleDays: priorDays.length,
      input: sum.input / priorDays.length,
      output: sum.output / priorDays.length,
      cache_creation: sum.cache_creation / priorDays.length,
      cache_read: sum.cache_read / priorDays.length,
      total: totalOf(sum) / priorDays.length
    };
  }

  return {
    totals,
    todayTotal: totalOf(totals),
    hourly: todayHourly,
    daily,
    average,
    fileCount: files.length,
    updatedAt: new Date().toISOString()
  };
}

module.exports = { aggregateRecent, aggregateToday: aggregateRecent, PROJECTS_ROOT };
