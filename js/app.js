(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const state = {
    chain: null,
    mode: 'demo',
    side: 'call', // call | put | both
    selected: null, // contract
    r: 0.045,
    q: 0,
    useMarketIV: true,
    hv: 0.28,
    smileChart: null,
    payoffChart: null
  };

  function fmt(n, d) {
    if (n == null || !isFinite(n)) return '—';
    return Number(n).toFixed(d != null ? d : 2);
  }
  function fmtPct(n, d) {
    if (n == null || !isFinite(n)) return '—';
    return (n * 100).toFixed(d != null ? d : 1) + '%';
  }
  function fmtInt(n) {
    if (n == null || !isFinite(n)) return '—';
    return Math.round(n).toLocaleString('en-US');
  }
  function expiryLabel(unix) {
    const d = new Date(unix * 1000);
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/New_York' });
  }

  function setBadge(mode) {
    const el = $('#dataBadge');
    el.className = 'badge ' + (mode === 'live' ? 'live' : mode === 'demo' ? 'demo' : 'proxy');
    const map = {
      live: '● 实时 Yahoo',
      proxy: '● 代理 Yahoo',
      cache: '● 本地缓存',
      demo: '● 演示数据 Demo'
    };
    el.textContent = map[mode] || mode;
  }

  function showBanner(msg, warn) {
    const b = $('#statusBanner');
    if (!msg) {
      b.classList.remove('show', 'warn');
      b.textContent = '';
      return;
    }
    b.textContent = msg;
    b.classList.add('show');
    b.classList.toggle('warn', !!warn);
  }

  function T_years(expUnix) {
    return BS.yearsToExpiry(expUnix * 1000);
  }

  function sigmaFor(contract) {
    if (state.useMarketIV) {
      const mid = contract.mid;
      const chain = state.chain;
      const T = T_years(contract.expiration || chain.selectedExpiration);
      const iv = BS.impliedVol(mid, chain.spot, contract.strike, T, state.r, state.q, contract.type);
      if (isFinite(iv) && iv > 0) return iv;
      if (isFinite(contract.impliedVolatility) && contract.impliedVolatility > 0) {
        // Yahoo sometimes returns decimal already (0.28) or percent — normalize
        return contract.impliedVolatility > 3 ? contract.impliedVolatility / 100 : contract.impliedVolatility;
      }
    }
    return state.hv;
  }

  function enrich(contract) {
    const chain = state.chain;
    const T = T_years(contract.expiration || chain.selectedExpiration);
    const sigma = sigmaFor(contract);
    const g = BS.greeks(chain.spot, contract.strike, T, state.r, state.q, sigma, contract.type);
    const fair = g.price;
    const mid = contract.mid;
    const mis = isFinite(mid) && isFinite(fair) && fair !== 0 ? (mid - fair) / fair : NaN;
    return { ...contract, T, sigma, fair, greeks: g, mispricing: mis };
  }

  function atmStrike(strikes, spot) {
    let best = strikes[0], bestDiff = Infinity;
    for (const k of strikes) {
      const d = Math.abs(k - spot);
      if (d < bestDiff) { bestDiff = d; best = k; }
    }
    return best;
  }

  function renderSpot() {
    const c = state.chain;
    if (!c) return;
    $('#spotName').textContent = `${c.symbol} · ${c.name || ''}`;
    $('#spotPrice').textContent = `$${fmt(c.spot, 2)}`;
    const chg = c.change || 0;
    const pct = c.changePercent || 0;
    const el = $('#spotChg');
    el.textContent = `${chg >= 0 ? '+' : ''}${fmt(chg, 2)} (${pct >= 0 ? '+' : ''}${fmt(pct, 2)}%)`;
    el.className = 'spot-chg ' + (chg >= 0 ? 'up' : 'down');
    $('#spotMeta').textContent = `更新 ${new Date(c.fetchedAt).toLocaleString('zh-CN', { hour12: false })} · ${c.currency || 'USD'}`;
  }

  function fillExpirations() {
    const sel = $('#expirySelect');
    const c = state.chain;
    sel.innerHTML = '';
    (c.expirations || []).forEach((u) => {
      const opt = document.createElement('option');
      opt.value = String(u);
      opt.textContent = expiryLabel(u);
      if (u === c.selectedExpiration) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function renderTable() {
    const c = state.chain;
    const tbody = $('#chainBody');
    tbody.innerHTML = '';
    if (!c) return;

    let rows = [];
    if (state.side === 'call' || state.side === 'both') rows = rows.concat(c.calls.map(enrich));
    if (state.side === 'put' || state.side === 'both') rows = rows.concat(c.puts.map(enrich));
    rows.sort((a, b) => a.strike - b.strike || (a.type < b.type ? -1 : 1));

    const atm = atmStrike(rows.map((r) => r.strike), c.spot);

    if (!state.selected && rows.length) {
      state.selected = rows.find((r) => r.strike === atm && r.type === (state.side === 'put' ? 'put' : 'call')) || rows[0];
    }

    for (const row of rows) {
      const tr = document.createElement('tr');
      const isSel = state.selected &&
        state.selected.strike === row.strike &&
        state.selected.type === row.type;
      if (isSel) tr.classList.add('selected');
      if (row.strike === atm) tr.classList.add('atm');

      let misClass = 'fair', misText = '—';
      if (isFinite(row.mispricing)) {
        misText = (row.mispricing >= 0 ? '+' : '') + (row.mispricing * 100).toFixed(1) + '%';
        if (row.mispricing > 0.05) misClass = 'rich';
        else if (row.mispricing < -0.05) misClass = 'cheap';
      }

      tr.innerHTML = `
        <td><span class="tag-${row.type}">${row.type === 'call' ? 'Call' : 'Put'}</span></td>
        <td>${fmt(row.strike, 2)}</td>
        <td>${fmt(row.bid, 2)}</td>
        <td>${fmt(row.ask, 2)}</td>
        <td>${fmt(row.mid, 2)}</td>
        <td>${fmt(row.fair, 2)}</td>
        <td class="${misClass}">${misText}</td>
        <td>${fmtPct(row.sigma, 1)}</td>
        <td>${fmtInt(row.volume)}</td>
        <td>${fmtInt(row.openInterest)}</td>
      `;
      tr.addEventListener('click', () => {
        state.selected = row;
        renderTable();
        renderDetail();
        renderPayoff();
      });
      tbody.appendChild(tr);
    }

    renderDetail();
    renderSmile(rows);
    renderExpectedMove(rows);
  }

  function renderDetail() {
    const row = state.selected ? enrich(state.selected) : null;
    const box = $('#greeksPanel');
    if (!row) {
      box.innerHTML = '<p class="meta">选择合约查看 Greeks</p>';
      return;
    }
    const g = row.greeks;
    const misLabel = !isFinite(row.mispricing) ? '—'
      : row.mispricing > 0.05 ? '偏贵 Rich'
      : row.mispricing < -0.05 ? '偏便宜 Cheap'
      : '接近公允 Fair';
    const misClass = row.mispricing > 0.05 ? 'rich' : row.mispricing < -0.05 ? 'cheap' : 'fair';

    box.innerHTML = `
      <div class="stat-grid">
        <div class="stat"><div class="k">合约</div><div class="v" style="font-size:.9rem">${row.type.toUpperCase()} ${fmt(row.strike,2)}</div></div>
        <div class="stat"><div class="k">到期 T</div><div class="v">${fmt(row.T * 365, 1)} 天</div></div>
        <div class="stat"><div class="k">市场 Mid</div><div class="v">$${fmt(row.mid,2)}</div></div>
        <div class="stat"><div class="k">BS 公允价</div><div class="v">$${fmt(row.fair,2)}</div></div>
        <div class="stat"><div class="k">偏离 Mispricing</div><div class="v ${misClass}">${isFinite(row.mispricing) ? ((row.mispricing>=0?'+':'')+(row.mispricing*100).toFixed(1)+'%') : '—'} <span style="font-size:.75rem;font-weight:500">${misLabel}</span></div></div>
        <div class="stat"><div class="k">IV σ</div><div class="v">${fmtPct(row.sigma,1)}</div></div>
        <div class="stat"><div class="k">Delta Δ</div><div class="v">${fmt(g.delta,3)}</div></div>
        <div class="stat"><div class="k">Gamma Γ</div><div class="v">${fmt(g.gamma,4)}</div></div>
        <div class="stat"><div class="k">Theta Θ /天</div><div class="v">${fmt(g.theta,3)}</div></div>
        <div class="stat"><div class="k">Vega ν /1%</div><div class="v">${fmt(g.vega,3)}</div></div>
        <div class="stat"><div class="k">Rho ρ /1%</div><div class="v">${fmt(g.rho,3)}</div></div>
        <div class="stat"><div class="k">内在价值</div><div class="v">$${fmt(row.type==='call'?Math.max(state.chain.spot-row.strike,0):Math.max(row.strike-state.chain.spot,0),2)}</div></div>
      </div>
      <p class="meta" style="margin-top:10px">教育用途：偏便宜 / 偏贵基于 BS 模型与当前参数，非交易建议。</p>
    `;
  }

  function renderExpectedMove(rows) {
    const c = state.chain;
    const T = T_years(c.selectedExpiration);
    const atm = atmStrike((c.calls || []).map((x) => x.strike), c.spot);
    const callAtm = (c.calls || []).find((x) => x.strike === atm);
    const putAtm = (c.puts || []).find((x) => x.strike === atm);
    let iv = state.hv;
    if (callAtm) {
      const e = enrich(callAtm);
      if (isFinite(e.sigma)) iv = e.sigma;
    } else if (putAtm) {
      const e = enrich(putAtm);
      if (isFinite(e.sigma)) iv = e.sigma;
    }
    const move = BS.expectedMove(c.spot, iv, T);
    $('#expectedMove').innerHTML = `
      <div class="stat-grid">
        <div class="stat"><div class="k">ATM IV</div><div class="v">${fmtPct(iv,1)}</div></div>
        <div class="stat"><div class="k">到期天数</div><div class="v">${fmt(T*365,1)}</div></div>
        <div class="stat"><div class="k">±1σ 预期波动</div><div class="v">±$${fmt(move,2)}</div></div>
        <div class="stat"><div class="k">区间</div><div class="v" style="font-size:.95rem">$${fmt(c.spot-move,2)} – $${fmt(c.spot+move,2)}</div></div>
      </div>
    `;
  }

  function renderSmile(rows) {
    const calls = rows.filter((r) => r.type === 'call' && isFinite(r.sigma));
    const puts = rows.filter((r) => r.type === 'put' && isFinite(r.sigma));
    // Prefer OTM: calls above spot, puts below — combine into smile
    const spot = state.chain.spot;
    const pts = [];
    const strikes = [...new Set(rows.map((r) => r.strike))].sort((a, b) => a - b);
    for (const k of strikes) {
      const c = calls.find((x) => x.strike === k);
      const p = puts.find((x) => x.strike === k);
      let iv = NaN;
      if (k >= spot && c) iv = c.sigma;
      else if (k < spot && p) iv = p.sigma;
      else if (c) iv = c.sigma;
      else if (p) iv = p.sigma;
      if (isFinite(iv)) pts.push({ k, iv: iv * 100 });
    }

    const ctx = $('#smileChart');
    if (state.smileChart) state.smileChart.destroy();
    state.smileChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: pts.map((p) => p.k),
        datasets: [{
          label: 'IV %',
          data: pts.map((p) => p.iv),
          borderColor: '#3d9cf0',
          backgroundColor: 'rgba(61,156,240,.15)',
          fill: true,
          tension: 0.25,
          pointRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'IV Smile（选定到期）', color: '#8b9bb4', font: { size: 12 } }
        },
        scales: {
          x: { ticks: { color: '#8b9bb4', maxTicksLimit: 10 }, grid: { color: 'rgba(36,48,68,.6)' }, title: { display: true, text: 'Strike', color: '#8b9bb4' } },
          y: { ticks: { color: '#8b9bb4' }, grid: { color: 'rgba(36,48,68,.6)' }, title: { display: true, text: 'IV %', color: '#8b9bb4' } }
        }
      }
    });
  }

  function renderPayoff() {
    const row = state.selected ? enrich(state.selected) : null;
    if (!row || !state.chain) return;
    const S0 = state.chain.spot;
    const K = row.strike;
    const prem = isFinite(row.mid) ? row.mid : row.fair;
    const xs = [];
    const ys = [];
    const lo = S0 * 0.75, hi = S0 * 1.25;
    for (let i = 0; i <= 40; i++) {
      const S = lo + (hi - lo) * (i / 40);
      const intrinsic = row.type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
      xs.push(+S.toFixed(2));
      ys.push(+(intrinsic - prem).toFixed(2));
    }
    const ctx = $('#payoffChart');
    if (state.payoffChart) state.payoffChart.destroy();
    state.payoffChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: xs,
        datasets: [{
          label: '到期盈亏（买权）',
          data: ys,
          borderColor: row.type === 'call' ? '#22c55e' : '#f43f5e',
          backgroundColor: 'transparent',
          tension: 0.05,
          pointRadius: 0,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Payoff sketch @ expiry（扣权利金）', color: '#8b9bb4', font: { size: 12 } }
        },
        scales: {
          x: { ticks: { color: '#8b9bb4', maxTicksLimit: 8 }, grid: { color: 'rgba(36,48,68,.6)' } },
          y: { ticks: { color: '#8b9bb4' }, grid: { color: 'rgba(36,48,68,.6)' } }
        }
      }
    });
  }

  async function load(symbol, exp, forceDemo) {
    const btn = $('#btnLoad');
    btn.disabled = true;
    btn.classList.add('loading-dot');
    showBanner('正在加载期权链…');
    try {
      const preferDemo = forceDemo || $('#chkDemo').checked;
      const { chain, mode, error } = await OptionsData.loadOptionChain(symbol, exp, preferDemo);
      state.chain = chain;
      state.mode = mode;
      state.selected = null;
      setBadge(mode);
      renderSpot();
      fillExpirations();
      renderTable();
      renderPayoff();
      if (mode === 'demo') {
        showBanner('当前为演示数据 Demo：Yahoo 不可用或已勾选演示模式。界面功能完整，数值为模拟。', true);
      } else if (mode === 'cache') {
        showBanner('使用本地缓存期权链' + (error ? `（在线失败：${error}）` : ''), true);
      } else if (mode === 'proxy') {
        showBanner('已通过 CORS 代理获取 Yahoo Finance 数据。');
      } else {
        showBanner('已加载 Yahoo Finance 实时期权链。');
      }
    } catch (e) {
      showBanner('加载失败：' + (e && e.message || e), true);
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading-dot');
    }
  }

  function runManual() {
    const S = +$('#mS').value;
    const K = +$('#mK').value;
    const Tdays = +$('#mT').value;
    const r = +$('#mR').value / 100;
    const q = +$('#mQ').value / 100;
    const sigma = +$('#mVol').value / 100;
    const type = $('#mType').value;
    const T = Tdays / 365;
    const g = BS.greeks(S, K, T, r, q, sigma, type);
    $('#manualOut').innerHTML = `
      <div class="stat-grid">
        <div class="stat"><div class="k">BS 价格</div><div class="v">$${fmt(g.price,4)}</div></div>
        <div class="stat"><div class="k">Delta</div><div class="v">${fmt(g.delta,4)}</div></div>
        <div class="stat"><div class="k">Gamma</div><div class="v">${fmt(g.gamma,5)}</div></div>
        <div class="stat"><div class="k">Theta/天</div><div class="v">${fmt(g.theta,4)}</div></div>
        <div class="stat"><div class="k">Vega/1%</div><div class="v">${fmt(g.vega,4)}</div></div>
        <div class="stat"><div class="k">Rho/1%</div><div class="v">${fmt(g.rho,4)}</div></div>
      </div>
    `;
  }

  function bind() {
    $('#btnLoad').addEventListener('click', () => {
      load($('#tickerInput').value.trim() || 'AAPL');
    });
    $('#tickerInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') load($('#tickerInput').value.trim() || 'AAPL');
    });
    $('#expirySelect').addEventListener('change', () => {
      const exp = +$('#expirySelect').value;
      load(state.chain ? state.chain.symbol : $('#tickerInput').value, exp, state.mode === 'demo' || $('#chkDemo').checked);
    });
    $$('.side-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.side-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.side = btn.dataset.side;
        state.selected = null;
        renderTable();
        renderPayoff();
      });
    });
    $('#rateInput').addEventListener('change', () => {
      state.r = +$('#rateInput').value / 100;
      renderTable();
      renderPayoff();
    });
    $('#divInput').addEventListener('change', () => {
      state.q = +$('#divInput').value / 100;
      renderTable();
      renderPayoff();
    });
    $('#hvInput').addEventListener('change', () => {
      state.hv = +$('#hvInput').value / 100;
      renderTable();
      renderPayoff();
    });
    $('#chkUseIV').addEventListener('change', () => {
      state.useMarketIV = $('#chkUseIV').checked;
      renderTable();
      renderPayoff();
    });
    $('#btnManual').addEventListener('click', runManual);
    $('#btnDemo').addEventListener('click', () => {
      $('#chkDemo').checked = true;
      load($('#tickerInput').value.trim() || 'AAPL', null, true);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    // Initial: try live AAPL, fall back to demo automatically
    load('AAPL');
  });
})();
