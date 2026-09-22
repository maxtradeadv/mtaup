const $=id=>document.getElementById(id);let data=[],brokerRows=[],liveEnabled=false,selectedTickers=new Set(),backtestSeries=null,backtestTicker='';const BACKEND_URL=window.STOCKFLOW_BACKEND_URL||window.location.origin,BACKTEST_BUY_COST_PCT=0.15,BACKTEST_SELL_COST_PCT=0.25,PROVIDER_KEY='stockflow-provider',CACHE_KEY='stockflow-auto-cache-v1';let sourceMeta={provider:'',timestamp:'',loading:false};
function makeDemo(){const ts=['BBCA','BBRI','BMRI','TLKM','ASII','BBNI','ICBP','INDF','ANTM','MDKA','GOTO','UNVR','PGAS','ADRO','PTBA','SMGR','JPFA','KLBF','AMRT','ACES'];return ts.map((ticker,k)=>{let p=1000+k*275,rows=[],reg=k<6?'BUY':k>=14?'SELL':'NEUTRAL';for(let i=0;i<140;i++){const d=new Date(Date.now()-(139-i)*86400000),c=Math.sin((i+k)*.37),n=Math.sin((i*7+k*11)*.91)*.004,dir=reg==='BUY'?.0028:reg==='SELL'?-.0028:.0001*c,o=p*(1+n),m=dir+(reg==='BUY'?Math.max(0,c)*.006:reg==='SELL'?-Math.max(0,c)*.006:c*.008)+n*.45,cl=o*(1+m),h=Math.max(o,cl)*(1+(reg==='BUY'?.01:.006)+Math.abs(n)),l=Math.min(o,cl)*(1+(reg==='SELL'?-.01:-.006)-Math.abs(n)),v=Math.round((650000+((i*9301+k*17011)%700000))*(reg==='NEUTRAL'?1:(i%9===0?1.8:1.05)));rows.push({date:d.toISOString().slice(0,10),ticker,open:o,high:h,low:l,close:cl,volume:v,value:v*cl,brokerNetValue:(reg==='BUY'?.16:reg==='SELL'?- .16:.02*c)*v*cl});p=cl}return{ticker,rows,lookback:20}})}
function esc(x){return String(x??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]||m))}
function fmt(x,d=2){return x==null||!Number.isFinite(Number(x))?'-':Number(x).toFixed(d)}
function statCells(s){return `<td>${s.count}</td><td>${fmt(s.hitRate,1)}%</td><td>${fmt(s.avgReturn)}%</td><td>${fmt(s.medianReturn)}%</td><td>${fmt(s.expectancy)}%</td><td>${fmt(s.winLossRatio)}</td><td>${fmt(s.avgMAE)}%</td><td>${fmt(s.avgMFE)}%</td>`}
function table(items,type){return items.length?items.map((x,i)=>`<tr data-ticker="${esc(x.ticker)}"><td>${i+1}</td><td><b>${esc(x.ticker)}</b></td><td>${x.score.toFixed(0)}</td><td>${(type==='BUY'?x.acc:x.dist).toFixed(0)}</td><td>${(type==='BUY'?x.trend:x.breakdown).toFixed(0)}</td></tr>`).join(''):'<tr><td colspan="5">Belum ada kandidat.</td></tr>'}
function momentPareto(all,lookback=20){
  const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
  const pct=(a,b)=>b?((a/b)-1)*100:0;
  const lb=Math.max(2,Number(lookback)||20);
  const rows=all.map(s=>{
    const a=StockFlow.analyze(s.rows,lb);
    if(!a)return null;

    // IMPORTANT: scoreBreakdown.accumulation/distribution are RAW 0-100
    // evidence. The *Weighted variants are already multiplied by their
    // weights (for example broker max=18), so using them as 0-100 inputs
    // compresses the Pareto score into the old 45-48 range.
    const sb=a.scoreBreakdown||{},ae=sb.accumulation||{},de=sb.distribution||{};
    const b=a.broker||{};
    const r=(s.rows||[]).slice().sort((x,y)=>new Date(x.date)-new Date(y.date));
    const recent=r.slice(-Math.min(lb,r.length));
    const prev=recent.length>1?recent[recent.length-2]:null;
    const priceMove1=prev&&prev.close?pct(a.price,prev.close):0;
    // Use the same swing-structure levels as the core analyzer so the
    // timing layer does not fall back to a separate crude high/low range.
    const baseHigh=a.resistance;
    const baseLow=a.support;
    const baseWidth=a.atr>0?(baseHigh-baseLow)/a.atr:99;
    const extension=a.atr>0?Math.max(0,(a.price-a.resistance)/a.atr):0;
    const belowSupport=a.atr>0?(a.support-a.price)/a.atr:0;
    const priceMove5=recent.length>5&&recent[recent.length-6].close
      ?pct(a.price,recent[recent.length-6].close):priceMove1;

    const persistence=b.available?Number(b.persistence5||50):50;
    const concentration=b.available?Number(b.concentration||0):0;

    // "Early" is a separate objective from strength:
    // strong broker/flow evidence is useful, but extension, chase and
    // already-completed breakouts reduce the timing score.
    const trendEarly=100-Math.min(100,Math.abs(Number(a.trend||50)-55)*2);
    const baseScore=clamp(100-baseWidth*14);
    const extensionPenalty=clamp(
      Math.max(0,priceMove5-4)*7+
      Math.max(0,priceMove1-6)*6+
      Math.max(0,extension)*22+
      Math.max(0,Number(a.chasePenalty||0))
    );
    const earlyFactor=clamp(100-extensionPenalty);

    const buyTiming=clamp(
      .20*Number(ae.broker||a.brokerScore||50)+
      .13*Number(ae.absorption||a.absorption||50)+
      .12*Number(ae.flowDivergence||50)+
      .10*Number(ae.support||a.support||50)+
      .10*trendEarly+
      .10*Number(ae.moneyFlow||a.mfNorm||50)+
      .07*Number(ae.pressure||a.pressure||50)+
      .08*Math.min(100,persistence)+
      .05*Math.min(100,100-concentration)+
      .05*baseScore+
      .10*earlyFactor
    );

    const sellEarlyFactor=clamp(
      100-
      Math.max(0,Math.abs(Math.min(0,priceMove5)))*4-
      Math.max(0,belowSupport)*12
    );
    const sellTiming=clamp(
      .20*Number(de.broker||100-(a.brokerScore||50))+
      .13*Number(de.rejection||50)+
      .12*Number(de.flowDivergence||50)+
      .10*Number(de.support||50)+
      .10*Number(de.trend||100-(a.trend||50))+
      .10*Number(de.moneyFlow||100-(a.mfNorm||50))+
      .07*Number(de.pressure||100-(a.pressure||50))+
      .08*Math.min(100,100-persistence)+
      .05*Math.min(100,concentration)+
      .10*Math.min(100,sellEarlyFactor)+
      .05*Math.min(100,Number(a.breakdown||0))
    );

    const buyPhase=
      extensionPenalty>=55?'LATE / CHASE':
      a.pattern==='MARKUP / BREAKOUT'&&Number(a.volRatio)>=1.2?'EARLY BREAKOUT':
      a.pattern==='ABSORPTION'?'ABSORPTION':
      a.pattern==='QUIET ACCUMULATION'?'PRE-ACCUMULATION':
      Number(a.trend)>=65?'MARKUP':
      Number(a.brokerScore)>=60&&Math.abs(priceMove5)<=4?'PRE-ACCUMULATION':
      'TRANSITION';

    const sellPhase=
      priceMove1<=-8&&Number(a.volRatio)>=1.5?'PANIC / LATE EXIT':
      belowSupport>0?'BREAKDOWN':
      Number(a.breakdown)>=55?'BREAKDOWN WARNING':
      Number(de.broker||100-(a.brokerScore||50))>=65&&priceMove5>=-2?'DISTRIBUTION EARLY':
      Number(a.dist)>=65?'DISTRIBUTION CONFIRMED':
      'WEAKENING';

    const buyEligible=
      a.signal==='BUY'||
      a.pattern==='ABSORPTION'||
      a.pattern==='QUIET ACCUMULATION'||
      (Number(a.brokerScore)>=60&&Number(a.acc)>=55);

    const sellEligible=
      a.signal==='SELL'||
      a.pattern==='DISTRIBUTION'||
      a.pattern==='BREAKDOWN RISK'||
      Number(a.dist)>=55||
      belowSupport>0;

    // Keep strength as a secondary component; the Pareto ranking is primarily
    // about phase/timing, so a very strong but already-extended move is penalized.
    const buyScore=clamp(
      .62*buyTiming+
      .23*Number(a.acc||50)+
      .15*Number(a.confidence||50)
    );
    const sellScore=clamp(
      .62*sellTiming+
      .23*Number(a.dist||50)+
      .15*Number(a.confidence||50)
    );

    return {
      ticker:s.ticker||a.ticker,a,b,
      buyScore,sellScore,buyEligible,sellEligible,
      buyPhase,sellPhase,
      diagnostics:{priceMove1,priceMove5,baseWidth,extension,extensionPenalty,belowSupport}
    };
  }).filter(Boolean);

  const buys=rows.filter(x=>x.buyEligible).sort((a,b)=>b.buyScore-a.buyScore).slice(0,5);
  const sells=rows.filter(x=>x.sellEligible).sort((a,b)=>b.sellScore-a.sellScore).slice(0,5);
  return {buys,sells};
}
function phaseIcon(phase,side='buy'){
  const p=String(phase||'').toUpperCase();
  const pos={
    'PRE-ACCUMULATION':[18,30],
    'ABSORPTION':[31,18],
    'EARLY BREAKOUT':[45,23],
    'MARKUP':[58,7],
    'LATE / CHASE':[69,10],
    'DISTRIBUTION EARLY':[69,10],
    'DISTRIBUTION CONFIRMED':[72,13],
    'BREAKDOWN WARNING':[76,20],
    'BREAKDOWN':[80,27],
    'PANIC / LATE EXIT':[82,31]
  };
  const xy=pos[p]||[45,23];
  const color=side==='buy'
    ? (p==='LATE / CHASE'?'#d97706':'#059669')
    : (p==='BREAKDOWN WARNING'?'#d97706':'#dc2626');
  return '<span class="phase-cell '+(side==='buy'?'phase-buy':'phase-sell')+'">'+
    '<svg class="phase-icon" viewBox="0 0 88 38" aria-hidden="true" focusable="false">'+
      '<path d="M4 13 L18 30 L31 18 L45 23 L58 7 L69 10 L82 31" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity=".72"></path>'+
      '<circle cx="'+xy[0]+'" cy="'+xy[1]+'" r="4.4" fill="'+color+'" stroke="#fff" stroke-width="1.4"></circle>'+
    '</svg>'+
    '<span class="phase-name">'+esc(phase)+'</span>'+
  '</span>';
}
function renderMomentPareto(all,lookback=20){
  const el=$('momentPareto');if(!el)return;
  const p=momentPareto(all,lookback);
  const buy=p.buys,sell=p.sells;
  const n=Math.max(buy.length,sell.length,5);
  const rows=Array.from({length:n},(_,i)=>{
    const b=buy[i],s=sell[i];
    return '<tr><td>'+(i+1)+'</td>'+
      '<td><b>'+(b?esc(b.ticker):'—')+'</b></td><td>'+(b?fmt(b.buyScore,0):'—')+'</td><td>'+(b?phaseIcon(b.buyPhase,'buy'):'—')+'</td>'+
      '<td><b>'+(s?esc(s.ticker):'—')+'</b></td><td>'+(s?fmt(s.sellScore,0):'—')+'</td><td>'+(s?phaseIcon(s.sellPhase,'sell'):'—')+'</td></tr>';
  }).join('');
  el.innerHTML='<h3>⚡ Pareto Moment BUY / SELL</h3>'+
    '<div class="condition-guide single"><b>Moment:</b> bukan sekadar strength; mengutamakan fase awal accumulation/absorption untuk BUY dan perubahan flow/distribution/breakdown untuk SELL.</div>'+
    '<div class="tablewrap"><table><thead><tr><th>#</th><th>BUY</th><th>Timing</th><th>Phase</th><th>SELL</th><th>Timing</th><th>Phase</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<small class="moment-note">Timing score = ranking diagnostik berbasis flow, absorption/rejection, support, trend, broker persistence dan chase/breakdown risk. Bukan probabilitas keuntungan.</small>';
}
let renderSeq=0;
function render(){
  const seq=++renderSeq;
  const lb=Math.max(2,+$('lookback').value||20),chosen=[...selectedTickers],
        pool=chosen.length===data.length?data:data.filter(x=>chosen.includes(x.ticker)),
        s=chosen.length===1?chosen[0]:'ALL',
        btPool=backtestTicker&&backtestSeries?[backtestSeries]:pool;

  $('donutText').textContent='… / … / …';
  $('avgAccum').textContent='…';
  $('avgDistrib').textContent='…';
  $('avgVol').textContent='…';
  $('avgRisk').textContent='…';
  $('buyTable').innerHTML='<tr><td colspan="5">Menghitung signal market…</td></tr>';
  $('sellTable').innerHTML='<tr><td colspan="5">Menghitung signal market…</td></tr>';
  $('backtest').innerHTML='<div class="btlegend"><span>Menyiapkan backtest T+1 → T+20…</span></div>';
  $('detailBuy').innerHTML='Klik saham BUY untuk melihat detail.';$('detailSell').innerHTML='Klik saham SELL untuk melihat detail.';

  setTimeout(()=>{
    if(seq!==renderSeq)return;
    try{
      const o=StockFlow.classify(pool,lb),r=o.results,n=r.length||1,
            b=r.filter(x=>x.signal==='BUY').length,
            sl=r.filter(x=>x.signal==='SELL').length;
      if(seq!==renderSeq)return;
      $('donutText').textContent=`${b} / ${r.length-b-sl} / ${sl}`;
      const total=r.length||1, bp=100*b/total, np=100*(r.length-b-sl)/total;
      $('donutBuy').style.strokeDasharray=bp+' '+(100-bp);
      $('donutBuy').style.strokeDashoffset='0';
      $('donutNeutral').style.strokeDasharray=np+' '+(100-np);
      $('donutNeutral').style.strokeDashoffset=(-bp).toString();
      const sp=Math.max(0,100-bp-np);
      $('donutSell').style.strokeDasharray=sp+' '+(100-sp);
      $('donutSell').style.strokeDashoffset=(-(bp+np)).toString();
      $('avgAccum').textContent=(r.reduce((a,x)=>a+x.acc,0)/n).toFixed(0);
      $('avgDistrib').textContent=(r.reduce((a,x)=>a+x.dist,0)/n).toFixed(0);
      $('avgVol').textContent=(r.reduce((a,x)=>a+x.volRatio,0)/n).toFixed(2)+'x';
      $('avgRisk').textContent=(r.reduce((a,x)=>a+x.breakdown,0)/n).toFixed(0);
      $('buyTable').innerHTML=table(o.buy,'BUY');
      $('sellTable').innerHTML=table(o.sell,'SELL');
      renderMomentPareto(pool,lb);
      bindRows();
      if(s!=='ALL'){
        const zone=o.buy.some(x=>x.ticker===s)?'buy':o.sell.some(x=>x.ticker===s)?'sell':'buy';
        detail(s,zone);
      }else{
        $('detailBuy').innerHTML='Klik saham BUY untuk melihat detail.';
        $('detailSell').innerHTML='Klik saham SELL untuk melihat detail.';
      }
      
      setTimeout(async()=>{
        if(seq!==renderSeq)return;
        const horizons=[1,3,5,10,20];
        const box=$('backtest');
        box.innerHTML=`<div class="btchart btcompact"><div class="bt5title"><span>Donut = net outcome · walk-forward · fee beli 0.15% + fee jual 0.25%</span></div><div class="btdonutwrap"><svg id="btDonut" viewBox="0 0 180 180" aria-label="Backtest horizons"><circle cx="90" cy="90" r="62" class="btdonutbase"></circle><g id="btDonutSegs"></g></svg><div class="btdonutcenter"><b id="btBestT">—</b><span id="btBestRet">menghitung</span></div></div><div class="btstats" id="btstats"></div><div class="btlegend"><span>Segmen makin besar = return makin tinggi</span><em>Net setelah biaya transaksi · SELL = potensi penurunan yang dihindari</em></div></div>`;
        const stats=$('btstats'),segRoot=$('btDonutSegs'),results=[];
        horizons.forEach(h=>{
          const st=document.createElement('div');st.dataset.horizon=h;st.innerHTML='<small>T+'+h+'</small><b>…</b><span>menghitung</span>';stats.appendChild(st);
        });
        const update=async(h,x)=>{
          const rawRet=x?.total?.avgReturn,rawHit=x?.total?.hitRate,ret=rawRet==null?NaN:Number(rawRet),hit=rawHit==null?NaN:Number(rawHit),count=Number(x?.total?.count||0);
          results.push({h,ret,hit,count});
          const st=stats.querySelector('[data-horizon="'+h+'"]');
          if(st)st.innerHTML='<small>T+'+h+'</small><b>'+(Number.isFinite(ret)?fmt(ret,2)+'%':'—')+'</b><span>'+(Number.isFinite(hit)?fmt(hit,1)+'% hit · '+count+' signal':count+' signal')+'</span>';

          const valid=results.filter(x=>Number.isFinite(x.ret));
          const best=valid.length?valid.reduce((a,b)=>b.ret>a.ret?b:a,valid[0]):null;
          const C=2*Math.PI*62;
          segRoot.innerHTML='';
          if(best){
            $('btBestT').textContent='T+'+best.h;
            $('btBestRet').textContent=fmt(best.ret,2)+'% avg return';
            const min=Math.min(...valid.map(x=>x.ret));
            const weighted=valid.map(x=>({...x,weight:Math.max(0.05,x.ret-min+0.05)}));
            const sum=weighted.reduce((a,x)=>a+x.weight,0);
            let used=0;
            weighted.forEach(x=>{
              const pct=x.weight/sum*100;
              const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
              circle.setAttribute('cx','90');circle.setAttribute('cy','90');circle.setAttribute('r','62');
              circle.setAttribute('class','btdonutseg '+(x.h===best.h?'btbest':''));
              circle.style.strokeDasharray=(C*pct/100)+' '+(C*(1-pct/100));
              circle.style.strokeDashoffset=-(C*used/100);
              circle.setAttribute('aria-label','T+'+x.h+' '+fmt(x.ret,2)+'%');
              segRoot.appendChild(circle);
              used+=pct;
            });
          }else{
            $('btBestT').textContent='—';
            $('btBestRet').textContent='belum ada signal';
            horizons.forEach((h,i)=>{
              const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
              circle.setAttribute('cx','90');circle.setAttribute('cy','90');circle.setAttribute('r','62');
              circle.setAttribute('class','btdonutseg btplaceholder');
              circle.style.strokeDasharray=(C/5-3)+' '+(C-C/5+3);
              circle.style.strokeDashoffset=-(C*i/5);
              circle.setAttribute('aria-label','T+'+h+' belum ada signal');
              segRoot.appendChild(circle);
            });
          }
        };
        for(const h of horizons){
          if(seq!==renderSeq)break;
          await new Promise(r=>setTimeout(r,20));
          try{
            const x=window.StockFlowCalibration?.walkForward(btPool,{lookback:lb,horizon:h,buyCostPct:BACKTEST_BUY_COST_PCT,sellCostPct:BACKTEST_SELL_COST_PCT});
            await update(h,x);
          }catch(err){
            console.error('[BACKTEST T+'+h+']',err);
            await update(h,{total:{avgReturn:null,hitRate:null,count:0}});
          }
        }
      },0);
    }catch(e){
      $('buyTable').innerHTML=`<tr><td colspan="5">Signal error: ${esc(e.message)}</td></tr>`;
      $('sellTable').innerHTML=`<tr><td colspan="5">Signal error: ${esc(e.message)}</td></tr>`;
      $('detailBuy').innerHTML='<div>Data berhasil masuk, tetapi engine signal gagal diproses.</div>';
      $('detailSell').innerHTML='<div>Data berhasil masuk, tetapi engine signal gagal diproses.</div>';
      console.error('[RENDER]',e);
    }
  },0);
}
const BACKTEST_DAYS=364;
async function fetchStockChunked(t,from,to,p){
  const maxDays=5,prices=[],broker=[],timestamps=[];
  let cur=new Date(from),end=new Date(to);
  while(cur<=end){
    const chunkEnd=new Date(Math.min(end.getTime(),cur.getTime()+(maxDays-1)*86400000));
    const url=BACKEND_URL+'/stock?ticker='+encodeURIComponent(t)+'&from='+ymd(cur)+'&to='+ymd(chunkEnd)+'&provider='+encodeURIComponent(p)+'&includeSourceTimestamp=0';
    const res=await fetch(url,{cache:'no-store'}),j=await res.json();
    if(!res.ok||!j.ok)throw Error(j.error||('HTTP '+res.status));
    prices.push(...(j.prices||[]));
    broker.push(...(j.broker||[]));
    if(j.sourceTimestamp)timestamps.push(j.sourceTimestamp);
    cur=new Date(chunkEnd.getTime()+86400000);
  }
  return {prices,broker,sourceTimestamp:timestamps.sort().at(-1)||'',provider:p};
}
async function loadBacktestSeries(t){
  const p=provider(),to=new Date(),from=new Date(to.getTime()-BACKTEST_DAYS*86400000);
  const j=await fetchStockChunked(t,from,to,p);
  const prices=StockFlowProvider.normalize(j.prices||[]),br=j.broker||[];
  if(!prices.length)throw Error('OHLCV kosong');
  const fresh=StockFlowProvider.group(StockFlowProvider.mergeBrokerRows(prices,br)).find(x=>x.ticker===t);
  const lb=Math.max(2,Number($('lookback')?.value||20));
  const minRows=lb+21;
  if(!fresh||fresh.rows.length<minRows)throw Error('Histori '+t+' kurang dari '+minRows+' baris untuk Lookback '+lb+'D');
  return fresh;
}
async function selectTickerFromPareto(t,zone){
  if(!data.find(x=>x.ticker===t))return;
  backtestTicker=t;
  backtestSeries=null;
  detail(t,zone);
  const box=$('backtest');
  if(box)box.innerHTML='<div class="btlegend"><span>Mengambil histori '+esc(t)+' untuk backtest standar…</span></div>';
  try{
    backtestSeries=await loadBacktestSeries(t);
    renderBacktestOnly();
  }catch(e){
    console.error('[PARETO BACKTEST]',e);
    if(box)box.innerHTML='<div class="btlegend"><span>Backtest '+esc(t)+' gagal mengambil histori: '+esc(e.message)+'</span></div>';
  }
}
function renderBacktestOnly(){const pool=backtestTicker&&backtestSeries?[backtestSeries]:(selectedTickers.size===1?data.filter(x=>selectedTickers.has(x.ticker)):data),lb=+$('lookback').value,horizons=[1,3,5,10,20],box=$('backtest');if(!box)return;box.innerHTML='<div class="btchart btcompact"><div class="bt5title"><span>Donut = net outcome · walk-forward · '+esc(backtestTicker||'ALL')+'</span></div><div class="btdonutwrap"><svg id="btDonut" viewBox="0 0 180 180" aria-label="Backtest horizons"><circle cx="90" cy="90" r="62" class="btdonutbase"></circle><g id="btDonutSegs"></g></svg><div class="btdonutcenter"><b id="btBestT">—</b><span id="btBestRet">menghitung</span></div></div><div class="btstats" id="btstats"></div><div class="btlegend"><span>Segmen makin besar = return makin tinggi</span><em>Net setelah fee beli 0.15% + fee jual 0.25% · sesuaikan bila broker berbeda</em></div></div>';const stats=$('btstats'),segRoot=$('btDonutSegs'),results=[];horizons.forEach(h=>{const st=document.createElement('div');st.dataset.horizon=h;st.innerHTML='<small>T+'+h+'</small><b>…</b><span>menghitung</span>';stats.appendChild(st)});horizons.forEach(h=>{try{const x=window.StockFlowCalibration?.walkForward(pool,{lookback:lb,horizon:h,buyCostPct:BACKTEST_BUY_COST_PCT,sellCostPct:BACKTEST_SELL_COST_PCT}),ret=x?.total?.avgReturn==null?NaN:Number(x.total.avgReturn),hit=x?.total?.hitRate==null?NaN:Number(x.total.hitRate),count=Number(x?.total?.count||0);results.push({h,ret});const st=stats.querySelector('[data-horizon="'+h+'"]');if(st)st.innerHTML='<small>T+'+h+'</small><b>'+(Number.isFinite(ret)?fmt(ret,2)+'%':'—')+'</b><span>'+(Number.isFinite(hit)?fmt(hit,1)+'% hit · '+count+' signal':count+' signal')+'</span>'}catch(err){console.error('[BACKTEST T+'+h+']',err)}});const valid=results.filter(x=>Number.isFinite(x.ret)),best=valid.length?valid.reduce((a,b)=>b.ret>a.ret?b:a):null,C=2*Math.PI*62;segRoot.innerHTML='';if(best){$('btBestT').textContent='T+'+best.h;$('btBestRet').textContent=fmt(best.ret,2)+'% avg return';const min=Math.min(...valid.map(x=>x.ret)),weighted=valid.map(x=>({...x,weight:Math.max(.05,x.ret-min+.05)})),sum=weighted.reduce((a,x)=>a+x.weight,0);let used=0;weighted.forEach(x=>{const pct=x.weight/sum*100,circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('cx','90');circle.setAttribute('cy','90');circle.setAttribute('r','62');circle.setAttribute('class','btdonutseg '+(x.h===best.h?'btbest':''));circle.style.strokeDasharray=(C*pct/100)+' '+(C*(1-pct/100));circle.style.strokeDashoffset=-(C*used/100);circle.setAttribute('aria-label','T+'+x.h+' '+fmt(x.ret,2)+'%');segRoot.appendChild(circle);used+=pct})}else{$('btBestT').textContent='—';$('btBestRet').textContent='belum ada signal'}}
function bindRows(){document.querySelectorAll('#buyTable tr[data-ticker]').forEach(e=>e.onclick=()=>selectTickerFromPareto(e.dataset.ticker,'buy'));document.querySelectorAll('#sellTable tr[data-ticker]').forEach(e=>e.onclick=()=>selectTickerFromPareto(e.dataset.ticker,'sell'))}
function detail(t,zone){const s=data.find(x=>x.ticker===t);if(!s)return;const a=StockFlow.analyze(s.rows,+$('lookback').value),b=a.broker||{};const target=zone==='buy'?'detailBuy':'detailSell';const el=$(target);if(!el)return;const brokerValue=b.available?fmt(a.brokerScore,0):'-',brokerMetric=k=>b.available?fmt(b[k],0):'-';const title=el.closest('.pareto-detail')?.querySelector('h3');if(title)title.textContent='Detail Saham · '+(a.ticker||t);
el.innerHTML=`<div class="detailgrid"><div><small>Signal</small><b>${a.signal}</b></div><div><small>Confidence (Max. 100)</small><b>${fmt(a.confidence,0)}</b></div><div><small>Pattern</small><b>${esc(a.pattern)}</b></div><div><small>Broker score</small><b>${brokerValue}</b></div><div><small>Flow status</small><b>${b.available?'ACTIVE':'NOT AVAILABLE'}</b></div><div><small>Broker persistence 5D</small><b>${brokerMetric('persistence5')}</b></div><div><small>Concentration</small><b>${brokerMetric('concentration')}</b></div><div><small>Flow divergence</small><b>${brokerMetric('divergence')}</b></div><div><small>Rotation</small><b>${brokerMetric('rotation')}</b></div><div><small>Breakdown risk (Max. 100)</small><b>${fmt(a.breakdown,0)}</b></div><div><small>Support</small><b>${fmt(a.support,0)}</b></div><div><small>Resistance</small><b>${fmt(a.resistance,0)}</b></div></div>`}
function refresh(){const el=$('ticker'),list=$('tickerOptions'),search=$('tickerSearch'),combo=search?.closest('.stockcombo');if(!el||!list)return;const current=[...selectedTickers],all=!current.length||current.length===data.length;el.value=all?'ALL':(current[0]||'ALL');list.innerHTML='<button type="button" class="ticker-option ticker-all" data-ticker="ALL" role="option">ALL SAHAM · '+data.length+'</button>'+data.map(x=>'<button type="button" class="ticker-option" data-ticker="'+esc(x.ticker)+'" role="option"><b>'+esc(x.ticker)+'</b>'+(x.name?' — '+esc(x.name):'')+'</button>').join('');if(search){search.value=all?'':(current[0]||'');search.onfocus=()=>openTickerPicker();search.onclick=()=>openTickerPicker();search.oninput=()=>filterTickerOptions();search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const hit=[...list.querySelectorAll('.ticker-option:not([hidden])')].find(o=>o.dataset.ticker!=='ALL');if(hit)chooseTicker(hit.dataset.ticker)}else if(e.key==='Escape')closeTickerPicker()};list.onclick=e=>{const hit=e.target.closest('.ticker-option');if(hit)chooseTicker(hit.dataset.ticker)}}}
function openTickerPicker(){const search=$('tickerSearch'),combo=search?.closest('.stockcombo');combo?.classList.add('open');search?.setAttribute('aria-expanded','true');filterTickerOptions()}
function filterTickerOptions(){const search=$('tickerSearch'),list=$('tickerOptions'),combo=search?.closest('.stockcombo');if(!search||!list)return;const q=search.value.trim().toUpperCase();let first=null;list.querySelectorAll('.ticker-option').forEach(o=>{const isAll=o.dataset.ticker==='ALL',match=isAll||!q||o.textContent.toUpperCase().includes(q);o.hidden=!match;if(!first&&match&&!isAll)first=o});if(q&&first)$('ticker').value=first.dataset.ticker;combo?.classList.add('open');search.setAttribute('aria-expanded','true')}
function chooseTicker(t){const el=$('ticker'),search=$('tickerSearch');if(t==='ALL'){selectedTickers=new Set(data.map(x=>x.ticker));search.value=''}else{selectedTickers=new Set([t]);search.value=t}el.value=t;closeTickerPicker();autoLoad()}
function closeTickerPicker(){const search=$('tickerSearch'),combo=search?.closest('.stockcombo');combo?.classList.remove('open');search?.setAttribute('aria-expanded','false')}
function closeTickerOutside(e){const combo=$('tickerSearch')?.closest('.stockcombo');if(combo&&!combo.contains(e.target))closeTickerPicker()}document.addEventListener('click',closeTickerOutside,true);document.addEventListener('touchstart',closeTickerOutside,{capture:true,passive:true});
function ymd(d){return d.toISOString().slice(0,10).replaceAll('-','')}function provider(){return $('provider').value}
async function loadSourceMeta(p=provider()){if(sourceMeta.loading)return;sourceMeta.loading=true;try{const res=await fetch(BACKEND_URL+'/source-meta?provider='+encodeURIComponent(p),{cache:'no-store'}),j=await res.json();if(res.ok&&j.ok){sourceMeta={provider:p,timestamp:j.sourceTimestamp||'',loading:false};updateSourceNameplate()}else{sourceMeta={provider:p,timestamp:'',loading:false};updateSourceNameplate()}}catch(e){sourceMeta={provider:p,timestamp:'',loading:false};updateSourceNameplate()}}function updateSourceNameplate(){const p=provider();if(sourceMeta.provider!==p)return;const el=$('lastUpdateInline');if(!el)return;if(sourceMeta.timestamp){const t=fmtSourceTime(sourceMeta.timestamp);el.textContent='Data tersedia '+t+' WIB'}else el.textContent='Data tersedia · metadata source belum tersedia'}function fmtSourceTime(v){const dt=new Date(v);return Number.isFinite(dt.getTime())?dt.toLocaleString('id-ID',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'Asia/Jakarta'}).replace(',', ''):'-'}function info(){const p=provider();const msg=p==='idx'?'IDX direct: sumber resmi IDX. Jika 403, data tidak dipalsukan.':p==='yahoo'?'Yahoo Finance: sumber pihak ketiga; historical/delayed OHLCV, bukan IDX dan bukan realtime exchange feed.':p==='indexalpha'?'Index Alpha: API pihak ketiga; broker/OHLCV sesuai akses akun.':p==='remote-csv'?'Daily Remote CSV: CSV publik pihak ketiga, IDX-derived via imq21; bukan API resmi IDX.':'AUTO: Daily Remote CSV (IDX-derived via imq21) → Yahoo Finance historical → cache lokal. IDX direct hanya opsional; tidak perlu upload CSV.';const txt=$('providerInfoText');if(txt)txt.textContent=msg;try{localStorage.setItem(PROVIDER_KEY,p)}catch{}}
function saveCache(){try{localStorage.setItem(CACHE_KEY,JSON.stringify({at:Date.now(),data}))}catch(e){console.warn('[CACHE] save failed',e)}}
function restoreCache(){try{const x=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');if(x?.data?.length){data=x.data;refresh();render();$('status').textContent='OFFLINE CACHE';setLiveStatus(`Cache lokal · ${data.length} saham · bukan data live`);return true}}catch(e){console.warn('[CACHE] restore failed',e)}return false}
async function fetchMarketRangeChunked(from,to,p){const maxDays=15,all=[],timestamps=[];let cur=new Date(from);const end=new Date(to);while(cur<=end){const chunkEnd=new Date(Math.min(end.getTime(),cur.getTime()+(maxDays-1)*86400000));const url=`${BACKEND_URL}/market-range?from=${ymd(cur)}&to=${ymd(chunkEnd)}&provider=${encodeURIComponent(p)}`,res=await fetch(url,{cache:'no-store'}),j=await res.json();if(!res.ok||!j.ok)throw Error(j.error||`HTTP ${res.status}`);all.push(...(j.data||[]));if(j.sourceTimestamp)timestamps.push(j.sourceTimestamp);cur=new Date(chunkEnd.getTime()+86400000)}return{data:all,provider:p,sourceTimestamp:timestamps.sort().at(-1)||'',source:''}}
async function loadLiveAll(){const p=provider(),to=new Date(),from=new Date(to.getTime()-89*86400000),label=p==='auto'?'Daily Remote CSV → Yahoo → Cache':p.toUpperCase();setLiveStatus(`Mengambil ALL via ${label}...`);const j=await fetchMarketRangeChunked(from,to,p);const prices=StockFlowProvider.normalize(j.data||[]);if(!prices.length)throw Error('Data market kosong');data=StockFlowProvider.group(prices);brokerRows=[];selectedTickers=new Set(data.map(x=>x.ticker));refresh();render();$('status').textContent=(j.provider||p).toUpperCase();setLiveStatus(`${p==='auto'?'Community daily CSV (IDX-derived via imq21)':j.source||p} · ALL · ${data.length} saham · ${prices.length} baris OHLCV · tanpa broker detail`);saveCache()}
async function loadLiveStock(){backtestTicker='';backtestSeries=null;const t=[...selectedTickers];if(t.length!==1)return loadLiveAll();const ticker=t[0];const p=provider(),to=new Date(),from=new Date(to.getTime()-364*86400000),url=`${BACKEND_URL}/stock?ticker=${encodeURIComponent(ticker)}&from=${ymd(from)}&to=${ymd(to)}&provider=${encodeURIComponent(p)}`;setLiveStatus(`Mengambil ${ticker} via ${p.toUpperCase()}...`);const res=await fetch(url,{cache:'no-store'}),j=await res.json();if(!res.ok||!j.ok)throw Error(j.error||`HTTP ${res.status}`);const prices=StockFlowProvider.normalize(j.prices||[]),br=j.broker||[];if(!prices.length)throw Error('OHLCV kosong');const fresh=StockFlowProvider.group(StockFlowProvider.mergeBrokerRows(prices,br));const keep=data.filter(x=>x.ticker!==ticker);data=[...keep,...fresh];brokerRows=br;selectedTickers=new Set([ticker]);refresh();render();$('status').textContent=(j.provider||p).toUpperCase();setLiveStatus(`${j.source||p} · ${ticker} · ${prices.length} hari · ${br.length} broker rows`);saveCache()}
function stamp(sourceTime=''){const t=fmtSourceTime(sourceTime||sourceMeta.timestamp);const old=$('lastUpdate');if(old)old.textContent=t;updateSourceNameplate();return t}function appLog(source){const el=$('providerInfoText');if(el)el.textContent=source}function setLiveStatus(x){const old=$('liveStatus');if(old)old.textContent=x;const out=$('liveStatusInline');if(out)out.textContent='Data Connection · '+x;updateSourceNameplate()}
async function autoLoad(){
  // In AUTO mode, paint the last successful dataset immediately, then refresh
  // it in the background. This prevents a slow/temporary provider outage from
  // making the PWA look empty.
  const hadCache=provider()==='auto'&&restoreCache();
  try{
    await loadLiveStock();
  }catch(e){
    if(provider()==='auto'&&hadCache){
      $('status').textContent='CACHE · LIVE REFRESH FAILED';
      setLiveStatus(`Cache lokal tetap dipakai · refresh live gagal: ${e.message}`);
      return;
    }
    if(provider()==='auto'&&restoreCache())return;
    const explicit=provider()!=='auto';
    $('status').textContent=explicit?'LIVE ERROR':'OFFLINE';
    setLiveStatus(explicit
      ? `LIVE ERROR · ${provider().toUpperCase()} gagal: ${e.message} · demo tidak digunakan`
      : `Data live gagal: ${e.message} · kalkulasi lokal tetap aktif`);
    if(explicit){
      data=[];
      selectedTickers=new Set();
      refresh();
      $('buyTable').innerHTML='<tr><td colspan="5">Tidak ada data live. Demo data dinonaktifkan untuk provider eksplisit.</td></tr>';
      $('sellTable').innerHTML='<tr><td colspan="5">Tidak ada data live. Demo data dinonaktifkan untuk provider eksplisit.</td></tr>';
      $('backtest').innerHTML='<div class="btlegend"><span>Backtest menunggu data live.</span></div>';
      $('detailBuy').innerHTML='Data live belum tersedia.';
      $('detailSell').innerHTML='Data live belum tersedia.';
      return;
    }
    data=[];
    selectedTickers=new Set();
    refresh();
    render();
  }
}
$('lookback').onchange=render;
$('provider').onchange=()=>{info();sourceMeta={provider:provider(),timestamp:'',loading:false};updateSourceNameplate();loadSourceMeta(provider());autoLoad()};
info();refresh();render();setTimeout(autoLoad,50);
try{const s=localStorage.getItem(PROVIDER_KEY);if(['auto','idx','yahoo','indexalpha','remote-csv'].includes(s))$('provider').value=s}catch{}if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});