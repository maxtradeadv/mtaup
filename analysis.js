window.StockFlow = (() => {
  const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
  const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
  const sum=a=>a.reduce((s,x)=>s+x,0);
  const sma=(a,n)=>a.length<n?null:avg(a.slice(-n));
  const pct=(a,b)=>b?((a/b)-1)*100:0;
  const sign=x=>x>0?1:x<0?-1:0;
  const finite=x=>Number.isFinite(Number(x))?Number(x):0;

  // V2: broker flow is evidence of broker-level trading flow, not proof of
  // "smart money". The engine scores persistence, consistency, divergence,
  // concentration and rotation rather than treating one-day net flow as enough.
  function brokerMetrics(rows,windowSize=10){
    const recent=rows.slice(-windowSize);
    const sessions=recent.map(r=>({
      date:r.date,
      brokers:Array.isArray(r.brokers)?r.brokers:(Array.isArray(r.brokerDetails)?r.brokerDetails:[])
    })).filter(x=>x.brokers.length);
    if(!sessions.length)return {
      available:false,netValue:0,persistence3:50,persistence5:50,persistence10:50,
      concentration:0,consistency:50,divergence:50,rotation:50,score:50,netBias:50,
      activeBrokers:0
    };

    const nets=sessions.map(s=>sum(s.brokers.map(b=>finite(b.buyValue)-finite(b.sellValue))));
    const totalNet=avg(nets);
    const positiveRatio=avg(nets.map(x=>x>0?1:x<0?0:.5));
    const persistence3=100*avg(nets.slice(-3).map(x=>x>0?1:x<0?0:.5));
    const persistence5=100*avg(nets.slice(-5).map(x=>x>0?1:x<0?0:.5));
    const persistence10=100*positiveRatio;

    const latest=sessions[sessions.length-1].brokers.map(b=>({...b,net:finite(b.buyValue)-finite(b.sellValue)}));
    const absTotal=sum(latest.map(b=>Math.abs(b.net)));
    const top=Math.max(0,...latest.map(b=>Math.abs(b.net)));
    const concentration=absTotal?100*top/absTotal:0;

    const brokerStats={};
    sessions.forEach(s=>s.brokers.forEach(b=>{
      const id=String(b.broker||b.code||'').trim();
      if(!id)return;
      if(!brokerStats[id])brokerStats[id]={pos:0,neg:0,flat:0,net:0,sessions:0};
      const net=finite(b.buyValue)-finite(b.sellValue);
      brokerStats[id].net+=net; brokerStats[id].sessions++;
      if(net>0)brokerStats[id].pos++; else if(net<0)brokerStats[id].neg++; else brokerStats[id].flat++;
    }));
    const active=Object.values(brokerStats);
    const consistency=active.length
      ?100*avg(active.map(x=>Math.max(x.pos,x.neg)/Math.max(x.sessions-x.flat,1)))
      :50;

    const priceRows=rows.slice(-Math.min(windowSize+1,rows.length));
    const priceMove=priceRows.length>1?pct(priceRows.at(-1).close,priceRows[0].close):0;
    const flowSign=sign(totalNet);
    let divergence=50;
    if(flowSign>0)divergence=clamp(50+Math.max(0,-priceMove)*5);
    if(flowSign<0)divergence=clamp(50+Math.max(0,priceMove)*5);
    // Divergence is deliberately capped; a 10% price move is already a strong
    // condition and should not single-handedly dominate the score.

    const previous=sessions.length>3?sessions.slice(0,-3):[];
    const latestTop=new Set(latest.filter(b=>b.net!==0)
      .sort((a,b)=>Math.abs(b.net)-Math.abs(a.net)).slice(0,3)
      .map(b=>String(b.broker||b.code||'')));
    const prevMap={};
    previous.forEach(s=>s.brokers.forEach(b=>{
      const id=String(b.broker||b.code||'').trim(); if(!id)return;
      prevMap[id]=(prevMap[id]||0)+Math.abs(finite(b.buyValue)-finite(b.sellValue));
    }));
    const prevTop=new Set(Object.entries(prevMap).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]));
    const overlap=[...latestTop].filter(x=>prevTop.has(x)).length;
    const rotation=latestTop.size&&prevTop.size?100*(1-overlap/Math.max(latestTop.size,prevTop.size)):50;

    const netScale=absTotal||1;
    const latestNet=sum(latest.map(b=>b.net));
    const netBias=clamp(50+50*latestNet/netScale);
    const persistenceBias=avg([persistence3,persistence5,persistence10]);
    const divergenceBias=flowSign>0?divergence:flowSign<0?100-divergence:50;
    const concentrationPenalty=clamp((concentration-33.33)*1.5,0,50);
    const score=clamp(
      .35*netBias+
      .25*persistenceBias+
      .20*divergenceBias+
      .10*consistency+
      .10*(100-concentrationPenalty)
    );
    return {available:true,netValue:totalNet,persistence3,persistence5,persistence10,
      concentration,consistency,divergence,rotation,score,netBias,activeBrokers:active.length};
  }

  function trueRange(r,i){
    const x=r[i], prev=i>0?r[i-1].close:x.open;
    return Math.max(x.high-x.low,Math.abs(x.high-prev),Math.abs(x.low-prev));
  }

  function analyze(rows,lookback=20){
    const r=rows.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
    if(r.length<2)return null;
    const closes=r.map(x=>finite(x.close)), n=Math.min(lookback,r.length), w=r.slice(-n), last=w.at(-1);
    const start=Math.max(0,r.length-n);
    const ranges=w.map((_,i)=>trueRange(r,start+i));
    const atr=avg(ranges)||Math.max(last.high-last.low,1);
    // Exclude the current bar from the volume baseline so a volume spike is
    // not diluted by its own abnormal volume.
    const baselineVol=w.length>1?avg(w.slice(0,-1).map(x=>finite(x.volume))):finite(last.volume);
    const volRatio=baselineVol>0?finite(last.volume)/baselineVol:1;

    // Money flow uses CLV x volume and is normalized by the average absolute
    // CLV-volume contribution, preventing a few high-volume bars from exploding.
    const mfVals=w.map(x=>{
      const h=finite(x.high), l=finite(x.low), c=finite(x.close);
      const clv=h===l?0:((c-l)-(h-c))/(h-l);
      return clv*finite(x.volume);
    });
    const mfScale=avg(w.map(x=>Math.abs(finite(x.volume))))||1;
    const mfNorm=clamp(50+50*avg(mfVals)/mfScale);

    // Up/down volume pressure is centered on candle direction, with dojis
    // contributing half to avoid an arbitrary bullish classification.
    const upVol=sum(w.map(x=>x.close>x.open?finite(x.volume):x.close===x.open?0.5*finite(x.volume):0));
    const downVol=sum(w.map(x=>x.close<x.open?finite(x.volume):x.close===x.open?0.5*finite(x.volume):0));
    const pressure=upVol+downVol?100*upVol/(upVol+downVol):50;

    // Trend is intentionally constrained to the selected lookback window.
    // A 5D/10D scan must not silently import 20D/60D trend evidence.
    const trendRows=w;
    const trendCloses=trendRows.map(x=>finite(x.close));
    const fastLen=Math.min(5,trendCloses.length);
    const slowLen=Math.min(20,trendCloses.length);
    const smaFast=avg(trendCloses.slice(-fastLen));
    const smaSlow=avg(trendCloses.slice(-slowLen));
    const atrPct=last.close?atr/last.close*100:0;
    const distSlow=smaSlow?((last.close/smaSlow)-1)*100:0;
    const slopeFast=trendCloses.length>=Math.min(10,trendCloses.length)
      ?pct(smaFast,avg(trendCloses.slice(-Math.min(10,trendCloses.length),-fastLen))||smaFast):0;
    const slopeSlow=trendCloses.length>=Math.min(2*slowLen,trendCloses.length)&&slowLen>1
      ?pct(smaSlow,avg(trendCloses.slice(-2*slowLen,-slowLen))||smaSlow):0;
    // Volatility-adjusted trend: all inputs come from the selected lookback.
    const trendRaw=50+
      (distSlow/Math.max(atrPct,0.1))*12+
      (slopeFast/Math.max(atrPct,0.1))*4+
      (slopeSlow/Math.max(atrPct,0.1))*6;
    const trend=clamp(trendRaw);

    // Structure-based support/resistance: use confirmed one-bar swing points
    // inside the selected lookback, excluding the current bar. If there are
    // too few pivots, fall back to the recent extrema so short windows remain usable.
    const recent=w.slice(0,-1);
    const swingHighs=[],swingLows=[];
    for(let i=1;i<recent.length-1;i++){
      const p=recent[i],prev=recent[i-1],next=recent[i+1];
      if(finite(p.high)>=finite(prev.high)&&finite(p.high)>=finite(next.high))swingHighs.push(finite(p.high));
      if(finite(p.low)<=finite(prev.low)&&finite(p.low)<=finite(next.low))swingLows.push(finite(p.low));
    }
    const priorClose=finite(last.close);
    const supportCandidates=swingLows.filter(x=>x<=priorClose);
    const resistanceCandidates=swingHighs.filter(x=>x>=priorClose);
    const support=supportCandidates.length?Math.max(...supportCandidates):(
      swingLows.length?Math.min(...swingLows):(
        recent.length?Math.min(...recent.map(x=>finite(x.low))):finite(last.low)
      )
    );
    const resistance=resistanceCandidates.length?Math.min(...resistanceCandidates):(
      swingHighs.length?Math.max(...swingHighs):(
        recent.length?Math.max(...recent.map(x=>finite(x.high))):finite(last.high)
      )
    );
    const supportDist=atr?(last.close-support)/atr:0;
    const resistanceDist=atr?(resistance-last.close)/atr:0;
    const supportScore=clamp(100-Math.abs(supportDist)*18);
    const breakoutPressure=clamp(resistanceDist<=0?100:(100-resistanceDist*18));
    const chasePenalty=clamp(Math.max(0,(last.close-resistance)/Math.max(atr,0.000001))*25);

    const bm=brokerMetrics(r,10);
    const brokerNet=last.brokerNetValue;
    const legacyBrokerScore=brokerNet==null?50:
      clamp(50+(finite(brokerNet)/Math.max(Math.abs(finite(last.value)||finite(last.volume)*finite(last.close)),1))*50);
    const brokerScore=bm.available?clamp(.85*bm.score+.15*legacyBrokerScore):legacyBrokerScore;

    // Price-volume efficiency: large volume with little price progress is
    // absorption/possible supply rather than automatic accumulation.
    const prevClose=w.length>1?w[w.length-2].close:last.open;
    const priceMovePct=prevClose?pct(last.close,prevClose):0;
    const efficiency=volRatio>0?Math.abs(priceMovePct)/volRatio:0;
    const absorption=clamp(100-efficiency*25);
    const volumeScore=clamp(50+25*Math.log2(Math.max(volRatio,0.25)));
    const pvBull=priceMovePct>0?volumeScore:priceMovePct<0?100-volumeScore:50;

    // V3: accumulation and distribution are modeled independently.
    // Distribution is NOT simply 100 - accumulation; that caused bearish
    // evidence to be diluted when unrelated bullish factors were present.
    const candleRange=Math.max(last.high-last.low,1e-9);
    const closeLocation=(last.close-last.low)/candleRange; // 0 = close at low
    const bearishVolume=last.close<last.open&&volRatio>=1 ? clamp(50+25*(volRatio-1)) : 25;
    const bullishVolume=last.close>last.open&&volRatio>=1 ? clamp(50+25*(volRatio-1)) : 25;
    const rejection=last.high>resistance && last.close<resistance
      ? clamp(70+15*Math.min((last.high-resistance)/Math.max(atr,1e-9),2))
      : clamp(50-closeLocation*20);
    const supportWeakness=clamp(50-(supportDist*12)+(trend<45?18:0));
    const flowDivergenceBull=bm.available && bm.netBias>=55 && priceMovePct<=0 ? 80 : 50;
    const flowDivergenceBear=bm.available && bm.netBias<=45 && priceMovePct>=0 ? 80 : 50;
    const accumulationEvidence=[
      mfNorm, pressure, volumeScore, pvBull, trend, supportScore,
      brokerScore, absorption, flowDivergenceBull
    ];
    const distributionEvidence=[
      100-mfNorm, 100-pressure, bearishVolume, 100-pvBull,
      100-trend, supportWeakness, 100-brokerScore, rejection,
      flowDivergenceBear
    ];
    const acc=clamp(
      .16*mfNorm+.13*pressure+.08*bullishVolume+.10*pvBull+
      .13*trend+.10*supportScore+.18*brokerScore+.07*absorption+
      .05*flowDivergenceBull
    );
    const dist=clamp(
      .14*(100-mfNorm)+.14*(100-pressure)+.12*bearishVolume+
      .10*(100-pvBull)+.10*(100-trend)+.10*supportWeakness+
      .18*(100-brokerScore)+.07*rejection+.05*flowDivergenceBear
    );

    const breakdown=clamp(
      (last.close<support?55:0)+
      (volRatio>1.5&&last.close<last.open?25:0)+
      (trend<35?20:0)+
      (supportDist<0?25:0)
    );
    const scoreBreakdown={
      accumulation:{moneyFlow:mfNorm,pressure,volume:bullishVolume,priceVolume:pvBull,trend,support:supportScore,broker:brokerScore,absorption,flowDivergence:flowDivergenceBull},
      distribution:{moneyFlow:100-mfNorm,pressure:100-pressure,volume:bearishVolume,priceVolume:100-pvBull,trend:100-trend,support:supportWeakness,broker:100-brokerScore,rejection,flowDivergence:flowDivergenceBear},
      accumulationWeighted:{moneyFlow:.16*mfNorm,pressure:.13*pressure,volume:.08*bullishVolume,priceVolume:.10*pvBull,trend:.13*trend,support:.10*supportScore,broker:.18*brokerScore,absorption:.07*absorption,flowDivergence:.05*flowDivergenceBull},
      distributionWeighted:{moneyFlow:.14*(100-mfNorm),pressure:.14*(100-pressure),volume:.12*bearishVolume,priceVolume:.10*(100-pvBull),trend:.10*(100-trend),support:.10*supportWeakness,broker:.18*(100-brokerScore),rejection:.07*rejection,flowDivergence:.05*flowDivergenceBear}
    };
    const signal=acc>=68&&dist<58&&chasePenalty<35?'BUY':
      dist>=65&&acc<58?'SELL':'NEUTRAL';
    const score=signal==='BUY'?acc:signal==='SELL'?dist:Math.max(acc,dist);

    // Confidence measures agreement of independent evidence and data quality.
    const evidence=[mfNorm,pressure,volumeScore,pvBull,trend,supportScore,brokerScore];
    const mean=avg(evidence);
    const dispersion=avg(evidence.map(x=>Math.abs(x-mean)));
    const agreement=clamp(100-dispersion*1.6);
    const dataQuality=clamp(70+(bm.available?20:0)+(r.length>=60?10:r.length>=20?7:0));
    const confidence=clamp(.65*agreement+.35*dataQuality);

    let pattern='NEUTRAL';
    if(brokerScore>=65&&priceMovePct<=0&&volRatio>=1)pattern='ABSORPTION';
    if(brokerScore>=65&&trend<55&&priceMovePct<=2&&persistencePositive(bm))pattern='QUIET ACCUMULATION';
    if(brokerScore<=35&&priceMovePct>=0&&volRatio>=1)pattern='DISTRIBUTION';
    if(volRatio>=1.5&&last.close>resistance)pattern='MARKUP / BREAKOUT';
    if(breakdown>=55)pattern='BREAKDOWN RISK';

    return {ticker:last.ticker||'',date:last.date,price:last.close,acc,dist,score,signal,
      confidence,dataQuality,pattern,volRatio,volumeScore,pressure,mfNorm,pvBull,absorption,
      trend,trendSlope5:slopeFast,trendSlope20:slopeSlow,breakdown,brokerScore,chasePenalty,scoreBreakdown,
      atr,atrPct,support,resistance,supportDist,resistanceDist,broker:bm};
  }

  function persistencePositive(bm){
    return bm&&avg([bm.persistence3,bm.persistence5,bm.persistence10])>=60;
  }

  function classify(all,lookback=20){
    const lb=Math.max(2,Number(lookback)||20);
    const results=all.map(s=>{const a=analyze(s.rows,lb);return a?{...a,ticker:s.ticker}:null}).filter(Boolean);
    const buy=results.filter(x=>x.signal==='BUY').sort((a,b)=>b.score-a.score).slice(0,5);
    const sell=results.filter(x=>x.signal==='SELL').sort((a,b)=>b.score-a.score).slice(0,5);
    return {results,buy,sell,lookback:lb};
  }

  function backtest(series,horizon=5,lookback=20){
    const observations=[];
    const lb=Math.max(2,Number(lookback)||20);
    series.forEach(s=>{
      const r=s.rows.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
      // Simulate one position at a time per stock: after a signal, hold
      // until the selected horizon before allowing another entry. This avoids
      // counting overlapping T+h outcomes as independent trades.
      for(let i=lb;i<r.length-horizon;){
        const a=analyze(r.slice(0,i+1),lb);
        if(!a||a.signal==='NEUTRAL'){i++;continue;}
        const entry=Number(r[i].close),future=Number(r[i+horizon].close);
        if(Number.isFinite(entry)&&entry>0&&Number.isFinite(future)){
          const ret=(future/entry-1)*100;
          observations.push({signal:a.signal,ret,score:a.score,confidence:a.confidence,ticker:s.ticker,date:r[i].date});
          i+=horizon;
        }else{
          i++;
        }
      }
    });
    if(!observations.length)return {hitRate:null,avgReturn:null,medianReturn:null,winLossRatio:null,expectancy:null,count:0,weightedReturn:null};
    const signed=observations.map(x=>x.signal==='BUY'?x.ret:-x.ret);
    const wins=signed.filter(x=>x>0), losses=signed.filter(x=>x<=0);
    const sorted=[...signed].sort((a,b)=>a-b);
    const median=sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
    const hits=wins.length,avgReturn=avg(signed);
    const avgWin=avg(wins),avgLoss=Math.abs(avg(losses));
    const winLossRatio=avgLoss?avgWin/avgLoss:null;
    // Weighted return is a diagnostic: stronger score + confidence get more weight,
    // while the raw average remains unchanged for transparency.
    const weighted=observations.map((x,i)=>{
      const strength=clamp(Number(x.score)/100)*clamp(Number(x.confidence)/100);
      return {v:signed[i],w:Math.max(.05,strength)};
    });
    const wsum=sum(weighted.map(x=>x.w));
    const weightedReturn=wsum?sum(weighted.map(x=>x.v*x.w))/wsum:null;
    return {hitRate:100*hits/observations.length,avgReturn,medianReturn,
      winLossRatio,expectancy:avgReturn,count:observations.length,weightedReturn};
  }

  return {analyze,classify,backtest,brokerMetrics};
})();