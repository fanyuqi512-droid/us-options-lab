/**
 * Option chain data: Yahoo Finance public endpoints + CORS proxies + demo fallback.
 */
(function (global) {
  'use strict';

  const CACHE_KEY = 'us-options-lab:lastChain';
  const CACHE_TTL_MS = 15 * 60 * 1000;

  const YAHOO_OPTIONS = (sym) =>
    `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(sym)}`;
  const YAHOO_OPTIONS_EXP = (sym, exp) =>
    `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(sym)}?date=${exp}`;
  const YAHOO_QUOTE = (sym) =>
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;

  const PROXIES = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ];

  async function fetchJsonVia(url) {
    const attempts = [url, ...PROXIES.map((p) => p(url))];
    let lastErr = null;
    for (const u of attempts) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 12000);
        const res = await fetch(u, {
          signal: ctrl.signal,
          headers: u === url ? { Accept: 'application/json' } : {}
        });
        clearTimeout(t);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const data = JSON.parse(text);
        return { data, via: u === url ? 'direct' : 'proxy' };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('All fetch attempts failed');
  }

  function midOf(bid, ask, last) {
    const b = Number(bid), a = Number(ask), l = Number(last);
    if (b > 0 && a > 0) return (b + a) / 2;
    if (l > 0) return l;
    if (a > 0) return a;
    if (b > 0) return b;
    return NaN;
  }

  function normalizeYahoo(payload, symbol) {
    const result = payload && payload.optionChain && payload.optionChain.result && payload.optionChain.result[0];
    if (!result) throw new Error('Unexpected Yahoo payload');
    const quote = result.quote || {};
    const spot = Number(quote.regularMarketPrice || quote.postMarketPrice || quote.preMarketPrice || 0);
    const expirations = (result.expirationDates || []).map(Number);
    const opts = result.options && result.options[0] ? result.options[0] : { calls: [], puts: [] };
    const mapContract = (c, type) => ({
      contractSymbol: c.contractSymbol,
      type,
      strike: Number(c.strike),
      bid: Number(c.bid) || 0,
      ask: Number(c.ask) || 0,
      last: Number(c.lastPrice) || 0,
      mid: midOf(c.bid, c.ask, c.lastPrice),
      volume: Number(c.volume) || 0,
      openInterest: Number(c.openInterest) || 0,
      impliedVolatility: Number(c.impliedVolatility) || NaN,
      inTheMoney: !!c.inTheMoney,
      expiration: Number(c.expiration || opts.expirationDate)
    });
    const calls = (opts.calls || []).map((c) => mapContract(c, 'call'));
    const puts = (opts.puts || []).map((c) => mapContract(c, 'put'));
    return {
      symbol: (result.underlyingSymbol || symbol || '').toUpperCase(),
      spot,
      currency: quote.currency || 'USD',
      name: quote.shortName || quote.longName || symbol,
      change: Number(quote.regularMarketChange) || 0,
      changePercent: Number(quote.regularMarketChangePercent) || 0,
      expirations,
      selectedExpiration: Number(opts.expirationDate || expirations[0] || 0),
      calls,
      puts,
      fetchedAt: Date.now(),
      source: 'yahoo'
    };
  }

  function buildDemoChain(symbol, expirationUnix) {
    symbol = (symbol || 'AAPL').toUpperCase();
    const spot = symbol === 'TSLA' ? 248.5 : symbol === 'SPY' ? 572.2 : 227.4;
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    // Next Fridays-ish expirations
    const expirations = [7, 14, 30, 60, 90].map((d) => {
      const t = new Date(now + d * day);
      t.setUTCHours(21, 0, 0, 0); // ~US market close
      return Math.floor(t.getTime() / 1000);
    });
    let selectedExpiration = expirations[2];
    if (expirationUnix && expirations.includes(Number(expirationUnix))) {
      selectedExpiration = Number(expirationUnix);
    } else if (expirationUnix) {
      // allow arbitrary unix from UI while keeping list
      selectedExpiration = Number(expirationUnix);
      if (!expirations.includes(selectedExpiration)) expirations.push(selectedExpiration);
      expirations.sort((a, b) => a - b);
    }
    const T = Math.max((selectedExpiration * 1000 - now) / (365 * day), 1 / 365);
    const r = 0.045, q = 0.005, sigmaAtm = 0.28;
    const strikes = [];
    for (let i = -8; i <= 8; i++) {
      const step = spot > 400 ? 5 : spot > 100 ? 2.5 : 1;
      strikes.push(Math.round((spot + i * step) / step) * step);
    }
    const uniq = [...new Set(strikes)].sort((a, b) => a - b);

    function synth(type, K) {
      const moneyness = Math.log(K / spot);
      const skew = type === 'put' ? 0.08 * Math.max(0, -moneyness) : 0.04 * Math.max(0, moneyness);
      const smile = 0.35 * moneyness * moneyness;
      const sigma = Math.max(0.12, sigmaAtm + skew + smile);
      const theo = global.BS.price(spot, K, T, r, q, sigma, type);
      const spread = Math.max(0.05, theo * 0.02);
      const mid = Math.max(0.01, theo * (1 + (Math.random() - 0.5) * 0.04));
      const bid = Math.max(0, +(mid - spread / 2).toFixed(2));
      const ask = +(mid + spread / 2).toFixed(2);
      return {
        contractSymbol: `${symbol}${selectedExpiration}${type === 'call' ? 'C' : 'P'}${K}`,
        type,
        strike: K,
        bid,
        ask,
        last: +mid.toFixed(2),
        mid: +((bid + ask) / 2).toFixed(2),
        volume: Math.floor(50 + Math.random() * 2000),
        openInterest: Math.floor(200 + Math.random() * 8000),
        impliedVolatility: sigma,
        inTheMoney: type === 'call' ? K < spot : K > spot,
        expiration: selectedExpiration
      };
    }

    return {
      symbol,
      spot,
      currency: 'USD',
      name: symbol === 'AAPL' ? 'Apple Inc.' : symbol === 'TSLA' ? 'Tesla, Inc.' : symbol === 'SPY' ? 'SPDR S&P 500 ETF' : symbol,
      change: spot * 0.008,
      changePercent: 0.8,
      expirations,
      selectedExpiration,
      calls: uniq.map((k) => synth('call', k)),
      puts: uniq.map((k) => synth('put', k)),
      fetchedAt: now,
      source: 'demo'
    };
  }

  function saveCache(chain) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(chain));
    } catch (_) { /* ignore quota */ }
  }

  function loadCache(symbol) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const chain = JSON.parse(raw);
      if (!chain || !chain.symbol) return null;
      if (symbol && chain.symbol !== symbol.toUpperCase()) return null;
      if (Date.now() - (chain.fetchedAt || 0) > CACHE_TTL_MS) return null;
      chain.source = (chain.source || 'yahoo') + '+cache';
      return chain;
    } catch (_) {
      return null;
    }
  }

  async function fetchQuoteSpot(symbol) {
    const url = YAHOO_QUOTE(symbol);
    const { data } = await fetchJsonVia(url);
    const meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
    if (!meta) throw new Error('No quote meta');
    return {
      spot: Number(meta.regularMarketPrice || meta.previousClose || 0),
      currency: meta.currency || 'USD',
      name: meta.symbol || symbol
    };
  }

  /**
   * @returns {Promise<{chain: object, mode: 'live'|'proxy'|'cache'|'demo', error?: string}>}
   */
  async function loadOptionChain(symbol, expirationUnix, preferDemo) {
    symbol = (symbol || 'AAPL').trim().toUpperCase();
    if (!/^[A-Z.\-]{1,10}$/.test(symbol)) {
      throw new Error('无效代码 / Invalid ticker');
    }

    if (preferDemo) {
      return { chain: buildDemoChain(symbol, expirationUnix), mode: 'demo' };
    }

    try {
      const url = expirationUnix
        ? YAHOO_OPTIONS_EXP(symbol, expirationUnix)
        : YAHOO_OPTIONS(symbol);
      const { data, via } = await fetchJsonVia(url);
      const chain = normalizeYahoo(data, symbol);
      if (!(chain.spot > 0) && chain.calls.length) {
        try {
          const q = await fetchQuoteSpot(symbol);
          chain.spot = q.spot;
        } catch (_) { /* keep */ }
      }
      saveCache(chain);
      return { chain, mode: via === 'direct' ? 'live' : 'proxy' };
    } catch (err) {
      const cached = loadCache(symbol);
      if (cached) {
        return { chain: cached, mode: 'cache', error: String(err && err.message || err) };
      }
      return {
        chain: buildDemoChain(symbol, expirationUnix),
        mode: 'demo',
        error: String(err && err.message || err)
      };
    }
  }

  global.OptionsData = {
    loadOptionChain,
    buildDemoChain,
    loadCache,
    saveCache,
    midOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
