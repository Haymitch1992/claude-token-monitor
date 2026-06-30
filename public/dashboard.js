const $ = id => document.getElementById(id);
const fmt = n => Math.round(n || 0).toLocaleString('zh-CN');
const fmtShort = n => {
  n = Math.round(n || 0);
  if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
  if (n >= 1e4) return (n / 1e4).toFixed(2) + ' 万';
  return n.toLocaleString('zh-CN');
};

const SERIES = [
  { key: 'input',          label: '输入',     color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
  { key: 'output',         label: '输出',     color: '#f472b6', bg: 'rgba(244,114,182,0.15)' },
  { key: 'cache_creation', label: '缓存创建', color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
  { key: 'cache_read',     label: '缓存读取', color: '#34d399', bg: 'rgba(52,211,153,0.15)' }
];

let chart = null;
let chartMode = 'daily';       // default to daily comparison
let lastUsage = null;
const HOURLY_WINDOW = 5;       // show only most recent N hours in 按小时 mode

function chartConfigFor(mode, data) {
  if (!data) return { labels: [], datasets: [] };
  if (mode === 'hourly') {
    const hourly = data.hourly || [];
    const currentHour = new Date().getHours();
    const start = Math.max(0, currentHour - (HOURLY_WINDOW - 1));
    const slice = hourly.slice(start, currentHour + 1);
    return {
      labels: slice.map(h => String(h.hour).padStart(2, '0') + ' 时'),
      datasets: SERIES.map(s => ({
        label: s.label,
        data: slice.map(h => h[s.key] || 0),
        borderColor: s.color, backgroundColor: s.bg,
        tension: 0.35, borderWidth: 2, pointRadius: 3, fill: true
      }))
    };
  }
  const daily = data.daily || [];
  return {
    labels: daily.map(d => d.label + (d.isToday ? ' (今)' : '')),
    datasets: SERIES.map(s => ({
      label: s.label,
      data: daily.map(d => d[s.key] || 0),
      borderColor: s.color, backgroundColor: s.bg,
      tension: 0.3, borderWidth: 2, pointRadius: 3, fill: true
    }))
  };
}

function buildOrUpdateChart() {
  const ctx = $('usageChart').getContext('2d');
  const cfg = chartConfigFor(chartMode, lastUsage);

  if (chart) {
    chart.data.labels = cfg.labels;
    chart.data.datasets.forEach((ds, i) => { ds.data = cfg.datasets[i].data; });
    chart.update('none');
    return;
  }
  chart = new Chart(ctx, {
    type: 'line',
    data: cfg,
    options: {
      responsive: true,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: '#e6e8ec', boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: c => `${c.dataset.label}: ${fmt(c.parsed.y)}`,
            footer: items => {
              const sum = items.reduce((a, x) => a + (x.parsed.y || 0), 0);
              return '合计: ' + fmt(sum);
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: '#8b94a3' }, grid: { color: '#262b36' } },
        y: { ticks: { color: '#8b94a3', callback: v => fmtShort(v) }, grid: { color: '#262b36' }, beginAtZero: true }
      }
    }
  });
}

function renderCompare(data) {
  const el = $('totalCompare');
  if (!data.average || !data.average.total) {
    el.textContent = '日均数据不足，暂无对比';
    el.className = 'metric-compare neutral';
    return;
  }
  const today = data.todayTotal || 0;
  const avg = data.average.total;
  const delta = today - avg;
  const pct = (delta / avg) * 100;
  const arrow = delta >= 0 ? '↑' : '↓';
  const cls = delta >= 0 ? 'up' : 'down';
  const sign = delta >= 0 ? '高于' : '低于';
  el.innerHTML =
    `${sign}日均 <strong>${Math.abs(pct).toFixed(1)}%</strong> ${arrow} `
    + `<span class="sub">日均 ${fmtShort(avg)} · 样本 ${data.average.sampleDays} 天</span>`;
  el.className = 'metric-compare ' + cls;
}

async function refreshUsage() {
  try {
    const r = await fetch('/api/usage?days=7');
    const data = await r.json();
    lastUsage = data;
    const t = data.totals || {};
    $('totalAll').textContent = fmt(data.todayTotal || 0);
    $('totalInput').textContent = fmt(t.input);
    $('totalOutput').textContent = fmt(t.output);
    $('totalCacheCreation').textContent = fmt(t.cache_creation);
    $('totalCacheRead').textContent = fmt(t.cache_read);
    $('updatedAt').textContent = new Date(data.updatedAt).toLocaleTimeString('zh-CN');
    renderCompare(data);
    buildOrUpdateChart();
  } catch (e) {
    console.error('refreshUsage error', e);
  }
}

function applyStatus(s) {
  if (!s) return;
  const card = $('statusCard');
  card.classList.remove('running', 'waiting', 'idle');
  card.classList.add(s.state || (s.running ? 'running' : 'idle'));
  const secs = s.secondsSinceActivity ?? s.secondsSinceLastWrite;
  const tsIso = s.lastActivity || s.lastWriteTime;
  const tStr = tsIso ? new Date(tsIso).toLocaleTimeString('zh-CN') : null;

  if (s.state === 'running' || s.running) {
    $('statusLabel').textContent = 'Claude 正在运行';
    $('statusSub').textContent =
      secs == null ? '—' : secs <= 0 ? '刚刚有事件' : `${secs} 秒前有事件`;
  } else if (s.state === 'waiting') {
    $('statusLabel').textContent = '等待用户授权';
    $('statusSub').textContent = secs == null ? '—' : `${secs} 秒前请求授权`;
  } else {
    $('statusLabel').textContent = 'Claude 空闲';
    $('statusSub').textContent = tStr ? `上次活动 ${tStr}` : '本次启动后尚未检测到活动';
  }
  if (s.fallbackWindowSeconds || s.windowSeconds) {
    $('windowSeconds').textContent = s.fallbackWindowSeconds || s.windowSeconds;
  }
}

async function refreshStatus() {
  try {
    const r = await fetch('/api/status');
    applyStatus(await r.json());
  } catch (e) { console.error('refreshStatus', e); }
}

function connectSSE() {
  const es = new EventSource('/events');
  es.addEventListener('hello', evt => { try { applyStatus(JSON.parse(evt.data)); } catch {} });
  es.addEventListener('state-change', evt => {
    try { applyStatus(JSON.parse(evt.data)); } catch {}
    refreshUsage();
  });
  es.addEventListener('file-change', evt => {
    try { applyStatus(JSON.parse(evt.data)); } catch {}
    refreshUsage();
  });
  es.onerror = () => {
    es.close();
    setTimeout(connectSSE, 3000);
  };
}

// Chart mode toggle (Switch component)
const miniSwitch = document.querySelector('.mini-switch');
for (const btn of document.querySelectorAll('.mini-switch-side')) {
  btn.addEventListener('click', () => {
    chartMode = btn.dataset.mode;
    for (const b of document.querySelectorAll('.mini-switch-side')) {
      b.classList.toggle('active', b === btn);
    }
    miniSwitch.dataset.state = chartMode === 'hourly' ? 'left' : 'right';
    $('chartTitle').textContent = chartMode === 'hourly' ? `最近 ${HOURLY_WINDOW} 小时分布` : '最近 7 天按日对比';
    if (chart) { chart.destroy(); chart = null; }
    buildOrUpdateChart();
  });
}

refreshUsage();
refreshStatus();
connectSSE();
setInterval(refreshStatus, 5000);
setInterval(refreshUsage, 30000);
