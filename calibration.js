window.StockFlowCalibration = (() => {
  const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const median = a => {
    if (!a.length) return null;
    const x = [...a].sort((a,b) => a-b), m = Math.floor(x.length / 2);
    return x.length % 2 ? x[m] : (x[m-1] + x[m]) / 2;
  };
  const pct = (a,b) => b ? (a / b - 1) * 100 : null;
  const num = x => Number.isFinite(Number(x)) ? Number(x) : null;
  const fmt0 = x => x == null ? '-' : Number(x).toFixed(2);

  // Default retail-equity fee reference. Actual fees vary by broker/account;
  // callers can override both percentages. We model buy and sell separately
  // instead of subtracting an arbitrary flat 1% from every outcome.
  const DEFAULT_BUY_COST_PCT = 0.15;
  const DEFAULT_SELL_COST_PCT = 0.25;

  function netOutcome(signal, entry, finalClose, buyCostPct, sellCostPct) {
    if (!(entry > 0) || !(finalClose > 0)) return null;
    const buyFee = Math.max(0, Number(buyCostPct) || 0) / 100;
    const sellFee = Math.max(0, Number(sellCostPct) || 0) / 100;
    if (signal === 'BUY') {
      // Long-only round trip: pay buy fee on entry, sell fee on exit.
      return ((finalClose * (1 - sellFee)) / (entry * (1 + buyFee)) - 1) * 100;
    }
    // SELL is treated as an exit signal for an existing long position, not
    // as a short sale. The metric therefore measures the future move avoided,
    // net of the sale fee at the signal date.
    return -(finalClose / entry - 1) * 100 - Number(sellCostPct || 0);
  }

  const scoreBucket = score => score < 60 ? '50-59' :
    score < 65 ? '60-64' : score < 70 ? '65-69' :
    score < 75 ? '70-74' : score < 85 ? '75-84' : '85+';

  const confidenceBucket = confidence => confidence < 60 ? '<60' :
    confidence < 70 ? '60-69' : confidence < 80 ? '70-79' :
    confidence < 90 ? '80-89' : '90+';

  function summarize(obs) {
    const signed = obs.map(x => x.signedReturn).filter(Number.isFinite);
    const wins = signed.filter(x => x > 0), losses = signed.filter(x => x <= 0);
    const avgWin = avg(wins), avgLoss = losses.length ? Math.abs(avg(losses)) : null;
    return {
      count: signed.length,
      hitRate: signed.length ? 100 * wins.length / signed.length : null,
      avgReturn: avg(signed),
      medianReturn: median(signed),
      winLossRatio: avgWin != null && avgLoss ? avgWin / avgLoss : null,
      expectancy: avg(signed),
      avgMAE: avg(obs.map(x => Math.abs(x.mae)).filter(Number.isFinite)),
      avgMFE: avg(obs.map(x => x.mfe).filter(Number.isFinite)),
      worstMAE: obs.length ? Math.max(...obs.map(x => Math.abs(x.mae)).filter(Number.isFinite)) : null,
      bestMFE: obs.length ? Math.max(...obs.map(x => x.mfe).filter(Number.isFinite)) : null
    };
  }

  function byDimension(obs, key, values) {
    return values.map(value => {
      const rows = obs.filter(x => x[key] === value);
      return {bucket:value, ...summarize(rows)};
    });
  }

  function walkForward(series, options = {}) {
    const horizon = Math.max(1, Number(options.horizon || 5));
    const lookback = Math.max(2, Number(options.lookback || 20));
    const buyCostPct = Math.max(0, Number(
      options.buyCostPct == null ? DEFAULT_BUY_COST_PCT : options.buyCostPct
    ));
    const sellCostPct = Math.max(0, Number(
      options.sellCostPct == null ? DEFAULT_SELL_COST_PCT : options.sellCostPct
    ));
    const rowsByStock = Array.isArray(series) ? series : [];
    const observations = [];

    rowsByStock.forEach(s => {
      const r = (s.rows || []).slice().sort((a,b) => new Date(a.date) - new Date(b.date));
      for (let i = lookback; i < r.length - horizon; i++) {
        // Signal is calculated only from bars through T. Nothing after T is
        // passed into the engine before the signal is frozen.
        const history = r.slice(0, i + 1);
        const a = window.StockFlow.analyze(history, lookback);
        if (!a || a.signal === 'NEUTRAL') continue;
        const entry = num(r[i].close);
        if (!entry) continue;

        const path = r.slice(i + 1, i + horizon + 1);
        if (path.length < horizon) continue;
        const finalClose = num(path[path.length - 1].close);
        if (!finalClose) continue;

        const rawReturn = pct(finalClose, entry);
        const signedGross = a.signal === 'BUY' ? rawReturn : -rawReturn;
        const signedNet = netOutcome(a.signal, entry, finalClose, buyCostPct, sellCostPct);
        if (!Number.isFinite(signedNet)) continue;

        // True path-based excursions after the signal close through T+horizon.
        // BUY: downside is low/entry - 1; upside is high/entry - 1.
        // SELL: adverse upside is entry/high - 1; favorable downside is entry/low - 1.
        const maePath = path.map(x => {
          const high = num(x.high), low = num(x.low);
          if (high == null || low == null) return null;
          return a.signal === 'BUY' ? Math.max(0, -pct(low, entry)) : Math.max(0, pct(high, entry));
        }).filter(Number.isFinite);
        const mfePath = path.map(x => {
          const high = num(x.high), low = num(x.low);
          if (high == null || low == null) return null;
          return a.signal === 'BUY' ? Math.max(0, pct(high, entry)) : Math.max(0, pct(entry, low));
        }).filter(Number.isFinite);
        if (!maePath.length || !mfePath.length) continue;

        observations.push({
          ticker: s.ticker || a.ticker || '',
          date: r[i].date,
          signal: a.signal,
          signedReturn: signedNet,
          grossReturn: signedGross,
          score: num(a.score) ?? 0,
          confidence: num(a.confidence) ?? 0,
          pattern: a.pattern || 'NEUTRAL',
          buyCostPct,
          sellCostPct,
          brokerAvailable: !!(a.broker && a.broker.available),
          mae: Math.max(...maePath),
          mfe: Math.max(...mfePath)
        });
      }
    });

    const scoreBuckets = ['50-59','60-64','65-69','70-74','75-84','85+'];
    const confidenceBuckets = ['<60','60-69','70-79','80-89','90+'];
    const enriched = observations.map(x => ({
      ...x,
      scoreBucket: scoreBucket(x.score),
      confidenceBucket: confidenceBucket(x.confidence)
    }));
    const buyObs = enriched.filter(x => x.signal === 'BUY');
    const sellObs = enriched.filter(x => x.signal === 'SELL');

    return {
      horizon, lookback, buyCostPct, sellCostPct,
      costModel: 'BUY entry fee + SELL exit fee; SELL signal = avoided downside net of exit fee',
      total: summarize(enriched),
      buy: summarize(buyObs),
      sell: summarize(sellObs),
      bySignal: ['BUY','SELL'].map(signal => ({signal, ...summarize(enriched.filter(x => x.signal === signal))})),
      byScore: byDimension(enriched, 'scoreBucket', scoreBuckets),
      byConfidence: byDimension(enriched, 'confidenceBucket', confidenceBuckets),
      patterns: [...new Set(enriched.map(x => x.pattern))].sort().map(pattern => ({
        pattern, ...summarize(enriched.filter(x => x.pattern === pattern))
      })),
      observations: enriched
    };
  }

  function multiHorizon(series, horizons = [1,3,5,10,20], options = {}) {
    return horizons.map(h => walkForward(series, {...options, horizon:h}));
  }

  function compareBrokerEvidence(series, options = {}) {
    const full = walkForward(series, options);
    const withBroker = full.observations.filter(x => x.brokerAvailable);
    const withoutBroker = full.observations.filter(x => !x.brokerAvailable);
    return {
      ...full,
      brokerCoveragePct: full.total.count ? 100 * withBroker.length / full.total.count : null,
      withBroker: summarize(withBroker),
      withoutBroker: summarize(withoutBroker),
      warning: withBroker.length && withoutBroker.length
        ? 'Coverage is observational, not causal: broker availability may differ by date/source.'
        : null
    };
  }

  return {walkForward, multiHorizon, compareBrokerEvidence, fmt0};
})();