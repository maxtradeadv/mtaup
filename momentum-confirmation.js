/* MTA-UP Momentum Confirmation Layer
 * Standalone and non-invasive: does not modify StockFlow scoring.
 */
window.MomentumConfirmation = (() => {
  const finite=x=>Number.isFinite(Number(x))?Number(x):0;
  const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
  const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));

  function ema(values,period){
    if(!values.length)return 0;
    const k=2/(period+1);
    let e=values[0];
    for(let i=1;i<values.length;i++)e=values[i]*k+e*(1-k);
    return e;
  }

  function analyze(rows,opts={}){
    const r=(rows||[]).slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
    const fast=opts.fast||12, slow=opts.slow||26, signalPeriod=opts.signal||9, smaPeriod=opts.volumeSma||10;
    if(r.length<Math.max(slow+signalPeriod,smaPeriod+2))return {available:false,reason:'insufficient history'};
    const closes=r.map(x=>finite(x.close));
    const macdSeries=[];
    for(let i=0;i<closes.length;i++){
      const fastE=ema(closes.slice(0,i+1),fast);
      const slowE=ema(closes.slice(0,i+1),slow);
      macdSeries.push(fastE-slowE);
    }
    const macd=macdSeries.at(-1);
    const prevMacd=macdSeries.at(-2)||macd;
    const signalSeries=[];
    for(let i=signalPeriod-1;i<macdSeries.length;i++)signalSeries.push(ema(macdSeries.slice(0,i+1),signalPeriod));
    const signal=signalSeries.at(-1);
    const prevSignal=signalSeries.at(-2)||signal;
    const histogram=macd-signal;
    const prevHistogram=prevMacd-prevSignal;
    const histogramDelta=histogram-prevHistogram;

    // Exclude current volume from the SMA10 baseline.
    const volumes=r.map(x=>finite(x.volume));
    const baseline=avg(volumes.slice(-(smaPeriod+1),-1));
    const volume=volumes.at(-1);
    const volumeSmaRatio=baseline>0?volume/baseline:1;

    const macdBull=macd>signal;
    const histogramRising=histogram>prevHistogram;
    const acceleration=histogramDelta>0;
    const participation=clamp(50+(volumeSmaRatio-1)*35);
    const momentum=clamp(
      35+(macdBull?20:0)+(histogramRising?20:0)+(acceleration?10:0)+(macd>=0?15:0)
    );
    const confirmation=clamp(.60*momentum+.40*participation);

    let status='NEUTRAL';
    if(histogramRising&&volumeSmaRatio>=1.5)status='MOMENTUM EXPANSION';
    else if(histogramRising&&volumeSmaRatio>=1)status='BULLISH CONFIRMED';
    else if(histogramRising&&volumeSmaRatio<1)status='MOMENTUM WITHOUT PARTICIPATION';
    else if(!histogramRising&&volumeSmaRatio>=1.5)status='PARTICIPATION / MOMENTUM WEAKENING';
    else if(!histogramRising&&volumeSmaRatio<1)status='MOMENTUM FADING';

    const earlyRecovery=histogram<0&&histogramRising&&volumeSmaRatio>=1;
    return {
      available:true,macd,signal,histogram,prevHistogram,histogramDelta,
      macdBull,histogramRising,acceleration,volume,volumeSma:baseline,volumeSmaRatio,
      momentum,participation,confirmation,status,earlyRecovery
    };
  }

  return {analyze};
})();