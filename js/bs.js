/**
 * Black–Scholes–Merton pricing, Greeks, and implied volatility (Newton + bisection).
 * Pure JS, no dependencies. Rates/vols annualized; T in years (ACT/365).
 */
(function (global) {
  'use strict';

  function erf(x) {
    // Abramowitz & Stegun 7.1.26
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }

  function normCdf(x) {
    return 0.5 * (1 + erf(x / Math.SQRT2));
  }

  function normPdf(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  function d1d2(S, K, T, r, q, sigma) {
    if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
      return { d1: 0, d2: 0, valid: false };
    }
    const volSqrtT = sigma * Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / volSqrtT;
    const d2 = d1 - volSqrtT;
    return { d1, d2, valid: true };
  }

  /**
   * @param {'call'|'put'} type
   */
  function price(S, K, T, r, q, sigma, type) {
    if (T <= 0) {
      const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
      return intrinsic;
    }
    const { d1, d2, valid } = d1d2(S, K, T, r, q, sigma);
    if (!valid) return NaN;
    const dfq = Math.exp(-q * T);
    const dfr = Math.exp(-r * T);
    if (type === 'call') {
      return S * dfq * normCdf(d1) - K * dfr * normCdf(d2);
    }
    return K * dfr * normCdf(-d2) - S * dfq * normCdf(-d1);
  }

  function greeks(S, K, T, r, q, sigma, type) {
    if (T <= 0 || sigma <= 0) {
      const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
      return {
        delta: type === 'call' ? (S > K ? 1 : S === K ? 0.5 : 0) : (S < K ? -1 : S === K ? -0.5 : 0),
        gamma: 0,
        theta: 0,
        vega: 0,
        rho: 0,
        price: intrinsic
      };
    }
    const { d1, d2, valid } = d1d2(S, K, T, r, q, sigma);
    if (!valid) {
      return { delta: NaN, gamma: NaN, theta: NaN, vega: NaN, rho: NaN, price: NaN };
    }
    const dfq = Math.exp(-q * T);
    const dfr = Math.exp(-r * T);
    const sqrtT = Math.sqrt(T);
    const pdf = normPdf(d1);
    const gamma = (dfq * pdf) / (S * sigma * sqrtT);
    const vega = (S * dfq * pdf * sqrtT) / 100; // per 1 vol point
    let delta, theta, rho, p;
    if (type === 'call') {
      delta = dfq * normCdf(d1);
      theta = (
        -(S * dfq * pdf * sigma) / (2 * sqrtT)
        - r * K * dfr * normCdf(d2)
        + q * S * dfq * normCdf(d1)
      ) / 365;
      rho = (K * T * dfr * normCdf(d2)) / 100;
      p = S * dfq * normCdf(d1) - K * dfr * normCdf(d2);
    } else {
      delta = -dfq * normCdf(-d1);
      theta = (
        -(S * dfq * pdf * sigma) / (2 * sqrtT)
        + r * K * dfr * normCdf(-d2)
        - q * S * dfq * normCdf(-d1)
      ) / 365;
      rho = (-K * T * dfr * normCdf(-d2)) / 100;
      p = K * dfr * normCdf(-d2) - S * dfq * normCdf(-d1);
    }
    return { delta, gamma, theta, vega, rho, price: p };
  }

  /**
   * Implied vol from mid price. Newton with analytic vega, bisection fallback.
   */
  function impliedVol(marketPrice, S, K, T, r, q, type, opts) {
    opts = opts || {};
    const lo = opts.lo != null ? opts.lo : 1e-4;
    const hi = opts.hi != null ? opts.hi : 5;
    const tol = opts.tol != null ? opts.tol : 1e-6;
    const maxIter = opts.maxIter != null ? opts.maxIter : 80;

    if (!(marketPrice > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return NaN;

    const dfq = Math.exp(-q * T);
    const dfr = Math.exp(-r * T);
    const intrinsic = type === 'call'
      ? Math.max(S * dfq - K * dfr, 0)
      : Math.max(K * dfr - S * dfq, 0);
    // Market below intrinsic (adjusted) — no real IV
    if (marketPrice < intrinsic * 0.999) return NaN;

    // Newton
    let sigma = 0.3;
    for (let i = 0; i < maxIter; i++) {
      const p = price(S, K, T, r, q, sigma, type);
      const { d1 } = d1d2(S, K, T, r, q, sigma);
      const vegaRaw = S * Math.exp(-q * T) * normPdf(d1) * Math.sqrt(T); // dP/dσ
      if (!(vegaRaw > 1e-12)) break;
      const diff = p - marketPrice;
      if (Math.abs(diff) < tol) return sigma;
      sigma -= diff / vegaRaw;
      if (sigma < lo || sigma > hi || !isFinite(sigma)) break;
    }

    // Bisection fallback
    let a = lo, b = hi;
    const pa = price(S, K, T, r, q, a, type) - marketPrice;
    const pb = price(S, K, T, r, q, b, type) - marketPrice;
    if (pa * pb > 0) {
      // Try widen hi
      b = 8;
      if ((price(S, K, T, r, q, a, type) - marketPrice) * (price(S, K, T, r, q, b, type) - marketPrice) > 0) {
        return NaN;
      }
    }
    for (let i = 0; i < maxIter; i++) {
      const m = 0.5 * (a + b);
      const pm = price(S, K, T, r, q, m, type) - marketPrice;
      if (Math.abs(pm) < tol || (b - a) < tol) return m;
      if ((price(S, K, T, r, q, a, type) - marketPrice) * pm <= 0) b = m;
      else a = m;
    }
    return 0.5 * (a + b);
  }

  function yearsToExpiry(expiryMs, nowMs) {
    nowMs = nowMs != null ? nowMs : Date.now();
    const ms = expiryMs - nowMs;
    return Math.max(ms / (365 * 24 * 3600 * 1000), 0);
  }

  /** Approximate expected ±1σ move: S * σ * sqrt(T) */
  function expectedMove(S, sigma, T) {
    if (!(S > 0) || !(sigma > 0) || !(T > 0)) return 0;
    return S * sigma * Math.sqrt(T);
  }

  global.BS = {
    erf, normCdf, normPdf, d1d2, price, greeks, impliedVol, yearsToExpiry, expectedMove
  };
})(typeof window !== 'undefined' ? window : globalThis);
