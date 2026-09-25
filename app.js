const $=id=>document.getElementById(id);let data=[],brokerRows=[],liveEnabled=false,selectedTickers=new Set(),detailTicker='',backtestSeries=null,backtestTicker='';let fundamentalMap=new Map(),fundamentalMeta={loaded:false,count:0,source:''};const BACKEND_URL=window.STOCKFLOW_BACKEND_URL||window.location.origin,BACKTEST_BUY_COST_PCT=0.15,BACKTEST_SELL_COST_PCT=0.25,PROVIDER_KEY='stockflow-provider',CACHE_KEY='stockflow-auto-cache-v2';let sourceMeta={provider:'',timestamp:'',loading:false};
// Cache the expensive ALL-scanner calculation/evidence. Ticker picker changes are local-only.
let scannerCache={dataRef:null,lookback:null,result:null,evidence:new Map()};let earlyValidationCache={dataRef:null,lookback:null,result:null};
function makeDemo(){const ts=['BBCA','BBRI','BMRI','TLKM','ASII','BBNI','ICBP','INDF','ANTM','MDKA','GOTO','UNVR','PGAS','ADRO','PTBA','SMGR','JPFA','KLBF','AMRT','ACES'];return ts.map((ticker,k)=>{let p=1000+k*275,rows=[],reg=k<6?'BUY':k>=14?'SELL':'NEUTRAL';for(let i=0;i<140;i++){const d=new Date(Date.now()-(139-i)*86400000),c=Math.sin((i+k)*.37),n=Math.sin((i*7+k*11)*.91)*.004,dir=reg==='BUY'?.0028:reg==='SELL'?-.0028:.0001*c,o=p*(1+n),m=dir+(reg==='BUY'?Math.max(0,c)*.006:reg==='SELL'?-Math.max(0,c)*.006:c*.008)+n*.45,cl=o*(1+m),h=Math.max(o,cl)*(1+(reg==='BUY'?.01:.006)+Math.abs(n)),l=Math.min(o,cl)*(1+(reg==='SELL'?-.01:-.006)-Math.abs(n)),v=Math.round((650000+((i*9301+k*17011)%700000))*(reg==='NEUTRAL'?1:(i%9===0?1.8:1.05)));rows.push({date:d.toISOString().slice(0,10),ticker,open:o,high:h,low:l,close:cl,volume:v,value:v*cl,brokerNetValue:(reg==='BUY'?.16:reg==='SELL'?- .16:.02*c)*v*cl});p=cl}return{ticker,rows,lookback:20}})}
function esc(x){return String(x??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]||m))}
function fmt(x,d=2){return x==null||!Number.isFinite(Number(x))?'-':Number(x).toFixed(d)}
function statCells(s){return `<td>${s.count}</td><td>${fmt(s.hitRate,1)}%</td><td>${fmt(s.avgReturn)}%</td><td>${fmt(s.medianReturn)}%</td><td>${fmt(s.expectancy)}%</td><td>${fmt(s.winLossRatio)}</td><td>${fmt(s.avgMAE)}%</td><td>${fmt(s.avgMFE)}%</td>`}
function table(items,type){return items.length?items.map((x,i)=>`<tr data-ticker="${esc(x.ticker)}"><td>${i+1}</td><td><b>${esc(x.ticker)}</b></td><td>${x.score.toFixed(0)}</td><td>${(type==='BUY'?x.acc:x.dist).toFixed(0)}</td><td>${(type==='BUY'?x.trend:x.breakdown).toFixed(0)}</td></tr>`).join(''):'<tr><td colspan="5">Belum ada kandidat.</td></tr>'}
function fundamentalDot(ticker){
  const f=fundamentalMap.get(String(ticker||'').toUpperCase());
  const cls=f?.class||'pending';
  const title=f?esc((f.label||'Fundamental')+' · Score '+fmt(f.score,0)):'Fundamental belum dimuat';
  return '<span class="fundamental-dot '+cls+'" title="'+title+'" aria-label="'+title+'"></span>';
}
async function loadFundamental(){
  try{
    const res=await fetch(BACKEND_URL+'/fundamental',{cache:'no-store'}),j=await res.json();
    if(!res.ok||!j.ok||!Array.isArray(j.data))throw Error(j.error||'Fundamental data kosong');
    const list=window.MTAFundamental?.normalize?window.MTAFundamental.normalize(j.data):j.data;
    fundamentalMap=new Map((list||[]).map(x=>[String(x.ticker||'').toUpperCase(),x]));
    fundamentalMeta={loaded:true,count:fundamentalMap.size,source:j.source||''};
    render();
  }catch(e){
    console.warn('[FUNDAMENTAL]',e);
    fundamentalMeta={loaded:false,count:0,source:''};
    render();
  }
}
function phaseIcon(phase,side='buy'){
  const p=String(phase||'').toUpperCase(),buy=side==='buy';
  const pos={'PRE-ACCUMULATION':[18,30],'ABSORPTION':[31,18],'EARLY BREAKOUT':[45,23],'MARKUP':[58,7],'LATE / CHASE':[69,10],'DISTRIBUTION EARLY':[69,10],'DISTRIBUTION CONFIRMED':[72,13],'BREAKDOWN WARNING':[76,20],'BREAKDOWN':[80,27],'PANIC / LATE EXIT':[82,31]};
  const labels={'PRE-ACCUMULATION':'BUILDING BASE','ABSORPTION':'SUPPLY ABSORPTION','EARLY BREAKOUT':'EARLY BREAKOUT','MARKUP':'UP-MOVE','LATE / CHASE':'TOO EXTENDED','DISTRIBUTION EARLY':'EARLY DISTRIBUTION','DISTRIBUTION CONFIRMED':'DISTRIBUTION CONFIRMED','BREAKDOWN WARNING':'BREAKDOWN WARNING','BREAKDOWN':'BREAKDOWN','PANIC / LATE EXIT':'URGENT EXIT','TRANSITION':'TRANSITION','WEAKENING':'WEAKENING'};
  const xy=pos[p]||[45,23],color=buy?(p==='LATE / CHASE'?'#d97706':'#059669'):(p==='BREAKDOWN WARNING'?'#d97706':'#dc2626');
  return '<span class="phase-cell '+(buy?'phase-buy':'phase-sell')+'"><svg class="phase-icon" viewBox="0 0 100 42" role="img" aria-label="'+(buy?'BUY':'SELL')+' phase"><path d="'+(buy?'M5 32 L18 27 L31 29 L44 20 L57 22 L70 12 L84 15 L95 6':'M5 8 L18 13 L31 11 L44 20 L57 18 L70 28 L84 25 L95 35')+'" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity=".68"/><path d="'+(buy?'M84 6 L95 6 L95 17':'M84 35 L95 35 L95 24')+'" fill="none" stroke="'+color+'" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="'+xy[0]+'" cy="'+xy[1]+'" r="5" fill="'+color+'" stroke="#fff" stroke-width="1.6"/></svg><span class="phase-name">'+esc(phase)+'</span></span>';
}
function paretoFront(items,side){
  const objectives=side==='buy'
    ?['acc','brokerScore','persistence','rotation','trend','volumeConfirm','early']
    :['dist','brokerRisk','persistenceRisk','rotation','breakdown','volumeConfirm','early'];
  const val=(x,k)=>Number(x.objectives?.[k]??50);
  return items.filter(x=>!items.some(y=>y!==x&&objectives.every(k=>val(y,k)>=val(x,k))&&objectives.some(k=>val(y,k)>val(x,k))));
}
function buildParetoRows(all,lookback=20){
  const rows=all.map(s=>{
    const a=StockFlow.analyze(s.rows,lookback); if(!a)return null;
    const b=a.broker||{}, brokerAvailable=!!b.available;
    const persistence=brokerAvailable?Number(b.persistence5):50;
    const rotation=brokerAvailable?Number(b.rotation):50;
    const brokerBuy=brokerAvailable?Number(a.brokerScore):null;
    const brokerRisk=brokerAvailable?100-Number(a.brokerScore):null;
    const volumeConfirm=Number(a.volRatio)>=1?Math.min(100,50+Number(a.volRatio-1)*35):Math.max(0,50-Number(1-a.volRatio)*35);
    const early=100-Math.min(100,Number(a.chasePenalty||0));
    const persistenceRisk=100-persistence;
    // Each ticker belongs to exactly one side. Explicit BUY/SELL signals win;
    // NEUTRAL is assigned to the stronger of accumulation vs distribution so
    // the same ticker can never appear in both tables.
    const buyEligible=a.signal==='BUY'||(a.signal==='NEUTRAL'&&Number(a.acc)>=Number(a.dist));
    const sellEligible=a.signal==='SELL'||(a.signal==='NEUTRAL'&&Number(a.dist)>Number(a.acc));
    return {stock:s,a,b,brokerAvailable,
      buyEligible,sellEligible,
      objectives:{acc:Number(a.acc),brokerScore:brokerBuy??50,persistence,rotation,trend:Number(a.trend),volumeConfirm,early,
        dist:Number(a.dist),brokerRisk:brokerRisk??50,persistenceRisk,breakdown:Number(a.breakdown),rotationSell:rotation},
      buyScore:Number(a.acc)*.30+(brokerBuy??50)*.20+persistence*.12+rotation*.08+Number(a.trend)*.10+volumeConfirm*.10+early*.10,
      sellScore:Number(a.dist)*.30+(brokerRisk??50)*.20+persistenceRisk*.12+rotation*.08+Number(a.breakdown)*.10+volumeConfirm*.10+(100-early)*.10};
  }).filter(Boolean);
  const buys=buildRank(rows,'buy',5);
  const sells=buildRank(rows,'sell',5);
  return {rows,buys,sells};
}
function buildRank(rows,side,limit){
  const eligible=rows.filter(x=>side==='buy'?x.buyEligible:x.sellEligible);
  const front=paretoFront(eligible,side);
  const scoreKey=side==='buy'?'buyScore':'sellScore';
  return eligible.sort((a,b)=>{
    const af=front.includes(a)?1:0,bf=front.includes(b)?1:0;
    return bf-af || b[scoreKey]-a[scoreKey];
  }).slice(0,limit);
}
function momentEvidence(stock,side,lookback=20,universe=null){
  if(!stock?.rows?.length||!window.StockFlowCalibration)return {rows:[]};
  try{
    const a=StockFlow.analyze(stock.rows,lookback),bucket=x=>x<60?'50-59':x<65?'60-64':x<70?'65-69':x<75?'70-74':x<85?'75-84':'85+';
    return {rows:[1,2,3,4,5].map(h=>{
      const wf=window.StockFlowCalibration.walkForward([stock],{lookback,horizon:h,buyCostPct:BACKTEST_BUY_COST_PCT,sellCostPct:BACKTEST_SELL_COST_PCT});
      const sig=side==='buy'?'BUY':'SELL',same=(wf.observations||[]).filter(o=>o.signal===sig&&o.scoreBucket===bucket(Number(a.score||0)));
      const src=same.length>=3?same:(wf.observations||[]).filter(o=>o.signal===sig);
      const ret=src.length?src.reduce((z,o)=>z+Number(o.signedReturn||0),0)/src.length:null;
      const hit=src.length?src.filter(o=>Number(o.signedReturn)>0).length*100/src.length:null;
      return {h,ret,hit,count:src.length};
    })};
  }catch{return {rows:[]}}
}

function timingState(x,side){if(side==='buy')return x.buyPhase==='LATE / CHASE'?'WAIT':x.buyPhase==='EARLY BREAKOUT'?'CONFIRM':'EARLY ENTRY';return x.sellPhase==='PANIC / LATE EXIT'||x.sellPhase==='BREAKDOWN'?'URGENT EXIT':x.sellPhase==='BREAKDOWN WARNING'?'EXIT WARNING':'WATCH'}
function phaseFor(x,side){
  const a=x.a;
  if(side==='buy')return Number(a.chasePenalty||0)>=55?'LATE / CHASE':a.pattern==='MARKUP / BREAKOUT'&&Number(a.volRatio)>=1.2?'EARLY BREAKOUT':a.pattern==='ABSORPTION'?'ABSORPTION':a.pattern==='QUIET ACCUMULATION'?'PRE-ACCUMULATION':Number(a.trend)>=65?'MARKUP':Number(a.brokerScore)>=60?'PRE-ACCUMULATION':'TRANSITION';
  const below=a.atr>0?(a.support-a.price)/a.atr:0;
  return Number(a.price&&a.resistance&&a.price>a.resistance&&a.volRatio>=1.5)?'PANIC / LATE EXIT':below>0?'BREAKDOWN':Number(a.breakdown)>=55?'BREAKDOWN WARNING':Number(a.dist)>=65?'DISTRIBUTION CONFIRMED':Number(a.brokerScore)<=35?'DISTRIBUTION EARLY':'WEAKENING';
}
function evidenceHtml(e){
  if(!e||!e.rows||!e.rows.length)return '<span class="moment-evidence-empty">—</span>';
  return '<span class="moment-evidence">'+e.rows.map(function(x){
    const ret=x.ret==null?'—':fmt(x.ret,1)+'%';
    const hit=x.hit==null?'—':fmt(x.hit,0)+'%';
    return '<span><b>T+'+x.h+'</b> '+ret+' <i>'+hit+'</i></span>';
  }).join('')+'</span>';
}
function brokerRotationHtml(stock){
  const rows=(stock?.rows||[]).slice().sort((a,b)=>new Date(a.date)-new Date(b.date)),recent=rows.slice(-5),prev=rows.slice(-10,-5);
  if(!recent.some(r=>Array.isArray(r.brokers)&&r.brokers.length))return '<div class="rotation-empty">BROKER ROTATION: <b>UNAVAILABLE</b> · source ini tidak menyediakan data broker-level yang tervalidasi untuk sesi tersebut.</div>';
  const calc=arr=>{const m={};arr.forEach(r=>(r.brokers||[]).forEach(x=>{const id=String(x.broker||x.code||'').trim();if(id)m[id]=(m[id]||0)+Number(x.buyValue||0)-Number(x.sellValue||0)}));return m};
  const cur=calc(recent),old=calc(prev),ids=[...new Set([...Object.keys(cur),...Object.keys(old)])];
  return '<div class="rotation-row">'+ids.map(id=>({id,delta:(cur[id]||0)-(old[id]||0)})).sort((x,y)=>Math.abs(y.delta)-Math.abs(x.delta)).slice(0,6).map(x=>'<span><b>'+esc(x.id)+'</b> '+(x.delta>=0?'↑':'↓')+(Math.abs(x.delta)>0?'':'·')+'</span>').join('')+'</div>';
}
function brokerRotationAllHtml(stocks){
  const rows=[];
  (stocks||[]).forEach(s=>(s.rows||[]).forEach(r=>{
    if(Array.isArray(r.brokers)&&r.brokers.length)rows.push(r);
  }));
  const dates=[...new Set(rows.map(r=>r.date))].sort();
  if(dates.length<2)return '<div class="rotation-empty">BROKER ROTATION: <b>UNAVAILABLE</b> · tidak ada data broker-per-saham tervalidasi pada source ini.</div>';
  const recentDates=new Set(dates.slice(-5)),prevDates=new Set(dates.slice(-10,-5));
  const calc=ds=>{const m={};rows.filter(r=>ds.has(r.date)).forEach(r=>(r.brokers||[]).forEach(x=>{
    const id=String(x.broker||x.code||'').trim();if(id)m[id]=(m[id]||0)+Number(x.buyValue||0)-Number(x.sellValue||0);
  }));return m};
  const cur=calc(recentDates),old=calc(prevDates);
  const ids=[...new Set([...Object.keys(cur),...Object.keys(old)])];
  return '<div class="rotation-row">'+ids.map(id=>({id,delta:(cur[id]||0)-(old[id]||0)})).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,8).map(x=>'<span><b>'+esc(x.id)+'</b> '+(x.delta>=0?'↑':'↓')+'</span>').join('')+'</div>';
}
function getScannerResult(all,lookback=20){
  if(scannerCache.dataRef===all&&scannerCache.lookback===lookback&&scannerCache.result)return scannerCache.result;
  scannerCache={dataRef:all,lookback,result:buildParetoRows(all,lookback),evidence:new Map()};
  return scannerCache.result;
}
function getMomentEvidenceCached(stock,side,lookback=20){
  const key=String(stock?.ticker||'')+'|'+side+'|'+lookback;
  const hit=scannerCache.evidence.get(key);
  if(hit)return hit;
  const ev=momentEvidence(stock,side,lookback);
  scannerCache.evidence.set(key,ev);
  return ev;
}
function renderMomentPareto(all,lookback=20){
  const el=$('momentPareto');if(!el)return;
  const {rows,buys,sells}=getScannerResult(all,lookback),n=Math.max(buys.length,sells.length,3);
  const selected=[...selectedTickers];
  const selectedStock=selected.length===1?all.find(s=>s.ticker===selected[0]):null;
  const detailStock=detailTicker?all.find(s=>s.ticker===detailTicker):null;
  const list=(arr,side)=>arr.map((x,i)=>{
    const a=x.a,br=x.brokerAvailable,score=side==='buy'?x.buyScore:x.sellScore,phase=phaseFor(x,side),tim=timingState({...x,buyPhase:side==='buy'?phase:'',sellPhase:side==='sell'?phase:''},side);
    const primary=side==='buy'?a.acc:a.dist,broker=br?(side==='buy'?a.brokerScore:100-a.brokerScore):null;
    return '<tr class="moment-row" data-ticker="'+esc(x.stock.ticker)+'" data-zone="'+side+'"><td>' + fundamentalDot(x.stock.ticker) + '</td><td><b>'+esc(x.stock.ticker)+'</b><small>'+tim+'</small></td><td><b>'+fmt(primary,0)+'</b></td><td>'+(broker==null?'—':fmt(broker,0))+'</td><td>'+fmt(side==='buy'?x.broker?.persistence5:x.broker?.persistence5,0)+'</td><td>'+fmt(score,0)+'</td><td>'+phaseIcon(phase,side)+'</td></tr>';
  }).join('');
  const isAll=!selectedStock;
  // In specific-picker mode, always bind the visual detail to the selected
  // ticker. The selected ticker may not be present in the global Pareto
  // shortlist, so do not let a missing shortlist row blank the whole view.
  const selectedRow=selectedStock
    ?(rows.find(x=>x.stock.ticker===selectedStock.ticker)||buildParetoRows([selectedStock],lookback).rows[0]||null)
    :null;
  // ALL = top 5 per side. Specific ticker = show it only in the side it actually qualifies for.
  // A selected ticker must never be duplicated into both BUY and DISTRIBUTION tables.
  const displayBuys=isAll?buys:(selectedRow&&selectedRow.buyEligible?[selectedRow]:[]);
  const displaySells=isAll?sells:(selectedRow&&selectedRow.sellEligible?[selectedRow]:[]);
  const rotation=isAll?brokerRotationAllHtml(all):brokerRotationHtml(selectedStock);
  const activeDetailStock=isAll?detailStock:selectedStock;
  const detail=activeDetailStock?renderStockDetail(activeDetailStock,lookback):'<div class="detail-placeholder">Klik saham pada tabel atau pilih saham untuk membuka detail broker, timing, dan risk.</div>';
  el.innerHTML='<div class="mta-title"><div><h2>'+ (isAll?'ALL STOCK SCANNER':esc(selectedStock.ticker)) +'</h2></div></div><div class="scanner-grid"><section><h3>EARLY BUY CANDIDATES</h3><div class="tablewrap"><table><thead><tr><th>FUND</th><th>Saham</th><th>ACCUM</th><th>BROKER</th><th>FLOW PERSIST</th><th>EARLY SCORE</th><th>PHASE</th></tr></thead><tbody>'+list(displayBuys,'buy')+'</tbody></table></div></section><section><h3 class="sell-head">DISTRIBUTION / EXIT WATCH</h3><div class="tablewrap"><table><thead><tr><th>F</th><th>Saham</th><th>DISTRIB</th><th>BROKER RISK</th><th>FLOW PERSIST</th><th>RISK SCORE</th><th>PHASE</th></tr></thead><tbody>'+list(displaySells,'sell')+'</tbody></table></div></section></div><section class="rotation-panel"><h3>BROKER ROTATION EVIDENCE</h3>'+rotation+'</section>'+(isAll?earlyValidationHtml(all,lookback):'')+'<section class="mta-detail" id="stockDetailPanel"><h3>STOCK DETAIL'+(detailStock?' · '+esc(detailStock.ticker):'')+'</h3>'+detail+'</section><small class="moment-note">ALL menampilkan 5 kandidat teratas per sisi. ACC > DIST hanya berarti kandidat early-entry; bukan konfirmasi entry. Momentum Check adalah konteks tambahan dan tidak menentukan eligibility. Broker hanya ditampilkan jika data broker-level tersedia; OHLCV tidak digunakan untuk menebak broker.</small>';
  el.onclick=e=>{
    const row=e.target.closest('.moment-row');
    if(!row||!el.contains(row))return;
    e.preventDefault();
    e.stopPropagation();
    detailTicker=row.dataset.ticker||'';
    render();
    requestAnimationFrame(()=>{
      const panel=$('stockDetailPanel');
      if(panel)panel.scrollIntoView({behavior:'smooth',block:'start'});
    });
  };
}
function momentumHtml(stock,lookback){
  const m=window.MomentumConfirmation?.analyze(stock?.rows||[]);
  if(!m?.available)return '<div class="momentum-confirmation"><b>MOMENTUM CHECK</b><small>Data belum cukup untuk MACD/SMA10.</small></div>';
  const cls=m.confirmation>=70?'strong':m.confirmation>=55?'medium':'weak';
  return '<div class="momentum-confirmation"><div class="momentum-title"><b>MOMENTUM CHECK</b><span class="'+cls+'">'+esc(({ 'MOMENTUM FADING':'WEAKENING','MOMENTUM EXPANSION':'EXPANDING','BULLISH CONFIRMED':'RISING + VOLUME','MOMENTUM WITHOUT PARTICIPATION':'RISING / LOW VOLUME','PARTICIPATION / MOMENTUM WEAKENING':'VOLUME / MOMENTUM DIVERGENCE' }[m.status]||m.status))+'</span></div><div class="momentum-grid"><div><small>MACD</small><b>'+fmt(m.macd,2)+'</b></div><div><small>Histogram</small><b>'+fmt(m.histogram,2)+' '+(m.histogramRising?'↑':'↓')+'</b></div><div><small>Hist Δ</small><b>'+fmt(m.histogramDelta,2)+'</b></div><div><small>Vol / SMA10</small><b>'+fmt(m.volumeSmaRatio,2)+'×</b></div><div><small>Momentum</small><b>'+fmt(m.momentum,0)+'</b></div><div><small>Participation</small><b>'+fmt(m.participation,0)+'</b></div></div><small>Momentum support '+fmt(m.confirmation,0)+' · '+(m.earlyRecovery?'recovery + participation rising':'MACD + volume context')+'</small></div>';
}
function renderStockDetail(stock,lookback){
  const a=StockFlow.analyze(stock?.rows||[],lookback);
  if(!a) return '<div class="detail-placeholder">Data '+esc(stock?.ticker||'saham')+' belum cukup untuk analisis detail.</div>';
  const b=a.broker||{},eBuy=getMomentEvidenceCached(stock,'buy',lookback),eSell=getMomentEvidenceCached(stock,'sell',lookback);
  const brokerRows=(stock.rows||[]).slice(-5).flatMap(r=>(r.brokers||[]).map(x=>({date:r.date,id:String(x.broker||x.code||''),net:Number(x.buyValue||0)-Number(x.sellValue||0)}))).filter(x=>x.id);
  const leaders=brokerRows.reduce((m,x)=>(m[x.id]=(m[x.id]||0)+x.net,m),{}); const ids=Object.entries(leaders).sort((a,z)=>Math.abs(z[1])-Math.abs(a[1])).slice(0,5);
  const timing=(e,side)=>e.rows.map(x=>'<div><b>T+'+x.h+'</b><span class="timingbar"><i style="width:'+Math.max(4,Math.min(100,50+(x.ret||0)*8))+'%"></i></span><em>'+(x.ret==null?'—':fmt(x.ret,1)+'%')+' · '+(x.hit==null?'—':fmt(x.hit,0)+'%')+'</em></div>').join('');
  const risk=[1,2,3,4,5].map(h=>{const d=eSell.rows.find(x=>x.h===h);const r=a.breakdown+(d?.ret!=null&&d.ret>0?0:10);return '<div><b>T+'+h+'</b><span class="risk-pill '+(r<35?'low':r<60?'medium':'high')+'">'+(r<35?'LOW':r<60?'MEDIUM':'HIGH')+'</span></div>'}).join('');
  const tickerName=String(stock.name||a.name||'').trim(); return '<div class="stock-detail-head"><b>'+esc(a.ticker||stock.ticker)+(tickerName?' — '+esc(tickerName):'')+'</b><span>Price '+fmt(a.price,0)+'</span></div>'+momentumHtml(stock,lookback)+'<div class="detail-block"><h4>Broker Flow Evidence</h4><div class="broker-bars">'+(b.available&&ids.length?ids.map(x=>'<span><b>'+esc(x[0])+'</b><i>'+(x[1]>=0?'+++++++ ↑':'--- ↓')+'</i></span>').join(''):'<small>Broker-level data tidak tersedia pada source ini.</small>')+'</div></div><div class="detail-metrics"><div><small>Accumulation score</small><b>'+fmt(a.acc,0)+'</b></div><div><small>Distribution score</small><b>'+fmt(a.dist,0)+'</b></div><div><small>Flow Persistence</small><b>'+(b.available?fmt(b.persistence5,0):'—')+'</b></div><div><small>Broker Rotation</small><b>'+(b.available?fmt(b.rotation,0):'—')+'</b></div></div><div class="timing-grid"><div><h4>BUY SIGNAL FOLLOW-THROUGH</h4>'+timing(eBuy,'buy')+'</div><div><h4>DISTRIBUTION FORWARD CHECK</h4>'+risk+'</div></div>';
}
function earlyValidationHtml(all,lookback){
  if(!Array.isArray(all)||!all.length||!window.StockFlowCalibration?.earlyMultiHorizon)return '';
  if(earlyValidationCache.dataRef===all&&earlyValidationCache.lookback===lookback&&earlyValidationCache.result)return earlyValidationCache.result;
  let rows='';
  try{
    const horizons=[1,3,5,10,20];
    const early=window.StockFlowCalibration.earlyMultiHorizon(all,horizons,{lookback,buyCostPct:BACKTEST_BUY_COST_PCT,sellCostPct:BACKTEST_SELL_COST_PCT});
    const baseline=horizons.map(h=>window.StockFlowCalibration.walkForward(all,{lookback,horizon:h,buyCostPct:BACKTEST_BUY_COST_PCT,sellCostPct:BACKTEST_SELL_COST_PCT}));
    rows=horizons.map((h,i)=>{
      const e=early[i]?.total||{},b=baseline[i]?.buy||{};
      return '<tr><td>T+'+h+'</td><td>'+fmt(e.count,0)+'</td><td>'+fmt(e.hitRate,1)+'%</td><td>'+fmt(e.avgReturn,2)+'%</td><td>'+fmt(e.medianReturn,2)+'%</td><td>'+fmt(e.avgMAE,2)+'%</td><td>'+fmt(e.avgMFE,2)+'%</td><td>'+fmt(b.count,0)+' / '+fmt(b.avgReturn,2)+'%</td></tr>';
    }).join('');
  }catch(err){
    console.error('[EARLY VALIDATION]',err);
    rows='<tr><td colspan="8">Backtest belum tersedia untuk data ini.</td></tr>';
  }
  const html='<section class="early-validation"><h3>EARLY-CANDIDATE VALIDATION</h3><div class="early-rule"><b>Rule:</b> ACC &gt; DIST + phase PRE-ACCUMULATION / ABSORPTION / EARLY BREAKOUT / TRANSITION.</div><div class="early-tablewrap"><table><thead><tr><th>HORIZON</th><th>SAMPLE</th><th>HIT</th><th>AVG NET</th><th>MEDIAN</th><th>AVG MAE</th><th>AVG MFE</th><th>BUY BASELINE</th></tr></thead><tbody>'+rows+'</tbody></table></div><small class="early-note">Walk-forward: signal dihitung hanya dari data sampai T. AVG NET memakai fee beli 0.15% + fee jual 0.25%. MAE = adverse move maksimum setelah T dalam horizon; ini ukuran drawdown, bukan jaminan tanpa cut loss. BUY BASELINE = jumlah BUY eksplisit / avg net.</small></section>';
  earlyValidationCache={dataRef:all,lookback,result:html};
  return html;
}

function render(){
  const el=$('momentPareto');
  if(!el)return;
  const lb=Math.max(2,+$('lookback')?.value||20);
  // Use the cached ALL scanner result; picker controls scanner scope,
  // while clicking a Pareto row only changes STOCK DETAIL.
  renderMomentPareto(data,lb);
}
function renderBacktestOnly(){const pool=backtestTicker&&backtestSeries?[backtestSeries]:(selectedTickers.size===1?data.filter(x=>selectedTickers.has(x.ticker)):data),lb=+$('lookback').value,horizons=[1,3,5,10,20],box=$('backtest');if(!box)return;box.innerHTML='<div class="btchart btcompact"><div class="bt5title"><span>Donut = net outcome · walk-forward · '+esc(backtestTicker||'ALL')+'</span></div><div class="btdonutwrap"><svg id="btDonut" viewBox="0 0 180 180" aria-label="Backtest horizons"><circle cx="90" cy="90" r="62" class="btdonutbase"></circle><g id="btDonutSegs"></g></svg><div class="btdonutcenter"><b id="btBestT">—</b><span id="btBestRet">menghitung</span></div></div><div class="btstats" id="btstats"></div><div class="btlegend"><span>Segmen makin besar = return makin tinggi</span><em>Net setelah fee beli 0.15% + fee jual 0.25% · sesuaikan bila broker berbeda</em></div></div>';const stats=$('btstats'),segRoot=$('btDonutSegs'),results=[];horizons.forEach(h=>{const st=document.createElement('div');st.dataset.horizon=h;st.innerHTML='<small>T+'+h+'</small><b>…</b><span>menghitung</span>';stats.appendChild(st)});horizons.forEach(h=>{try{const x=window.StockFlowCalibration?.walkForward(pool,{lookback:lb,horizon:h,buyCostPct:BACKTEST_BUY_COST_PCT,sellCostPct:BACKTEST_SELL_COST_PCT}),ret=x?.total?.avgReturn==null?NaN:Number(x.total.avgReturn),hit=x?.total?.hitRate==null?NaN:Number(x.total.hitRate),count=Number(x?.total?.count||0);results.push({h,ret});const st=stats.querySelector('[data-horizon="'+h+'"]');if(st)st.innerHTML='<small>T+'+h+'</small><b>'+(Number.isFinite(ret)?fmt(ret,2)+'%':'—')+'</b><span>'+(Number.isFinite(hit)?fmt(hit,1)+'% hit · '+count+' signal':count+' signal')+'</span>'}catch(err){console.error('[BACKTEST T+'+h+']',err)}});const valid=results.filter(x=>Number.isFinite(x.ret)),best=valid.length?valid.reduce((a,b)=>b.ret>a.ret?b:a):null,C=2*Math.PI*62;segRoot.innerHTML='';if(best){$('btBestT').textContent='T+'+best.h;$('btBestRet').textContent=fmt(best.ret,2)+'% avg return';const min=Math.min(...valid.map(x=>x.ret)),weighted=valid.map(x=>({...x,weight:Math.max(.05,x.ret-min+.05)})),sum=weighted.reduce((a,x)=>a+x.weight,0);let used=0;weighted.forEach(x=>{const pct=x.weight/sum*100,circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('cx','90');circle.setAttribute('cy','90');circle.setAttribute('r','62');circle.setAttribute('class','btdonutseg '+(x.h===best.h?'btbest':''));circle.style.strokeDasharray=(C*pct/100)+' '+(C*(1-pct/100));circle.style.strokeDashoffset=-(C*used/100);circle.setAttribute('aria-label','T+'+x.h+' '+fmt(x.ret,2)+'%');segRoot.appendChild(circle);used+=pct})}else{$('btBestT').textContent='—';$('btBestRet').textContent='belum ada signal'}}
function refresh(){const el=$('ticker'),list=$('tickerOptions'),search=$('tickerSearch'),combo=search?.closest('.stockcombo');if(!el||!list)return;const current=[...selectedTickers],all=!current.length||current.length===data.length;el.value=all?'ALL':(current[0]||'ALL');list.innerHTML='<button type="button" class="ticker-option ticker-all" data-ticker="ALL" role="option">ALL SAHAM · '+data.length+'</button>'+data.map(x=>'<button type="button" class="ticker-option" data-ticker="'+esc(x.ticker)+'" role="option"><b>'+esc(x.ticker)+'</b>'+(x.name?' — '+esc(x.name):'')+'</button>').join('');if(search){search.value=all?'':(current[0]||'');search.onfocus=()=>openTickerPicker();search.onclick=()=>openTickerPicker();search.oninput=()=>filterTickerOptions();search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const hit=[...list.querySelectorAll('.ticker-option:not([hidden])')].find(o=>o.dataset.ticker!=='ALL');if(hit)chooseTicker(hit.dataset.ticker)}else if(e.key==='Escape')closeTickerPicker()};list.onclick=e=>{const hit=e.target.closest('.ticker-option');if(hit)chooseTicker(hit.dataset.ticker)}}}
function openTickerPicker(){const search=$('tickerSearch'),combo=search?.closest('.stockcombo');combo?.classList.add('open');search?.setAttribute('aria-expanded','true');filterTickerOptions()}
function filterTickerOptions(){const search=$('tickerSearch'),list=$('tickerOptions'),combo=search?.closest('.stockcombo');if(!search||!list)return;const q=search.value.trim().toUpperCase();let first=null;list.querySelectorAll('.ticker-option').forEach(o=>{const isAll=o.dataset.ticker==='ALL',match=isAll||!q||o.textContent.toUpperCase().includes(q);o.hidden=!match;if(!first&&match&&!isAll)first=o});if(q&&first)$('ticker').value=first.dataset.ticker;combo?.classList.add('open');search.setAttribute('aria-expanded','true')}
function chooseTicker(t){const el=$('ticker'),search=$('tickerSearch');if(t==='ALL'){selectedTickers=new Set(data.map(x=>x.ticker));detailTicker='';search.value=''}else{selectedTickers=new Set([t]);detailTicker=t;search.value=t}el.value=t;closeTickerPicker();render();}
function closeTickerPicker(){const search=$('tickerSearch'),combo=search?.closest('.stockcombo');combo?.classList.remove('open');search?.setAttribute('aria-expanded','false')}
function closeTickerOutside(e){const combo=$('tickerSearch')?.closest('.stockcombo');if(combo&&!combo.contains(e.target))closeTickerPicker()}document.addEventListener('click',closeTickerOutside,true);document.addEventListener('touchstart',closeTickerOutside,{capture:true,passive:true});
function ymd(d){return d.toISOString().slice(0,10).replaceAll('-','')}
function trimToLast90(rows){
  const dates=(rows||[]).map(r=>String(r.date||'')).filter(Boolean).sort();
  if(!dates.length)return rows||[];
  const end=new Date(dates[dates.length-1]+'T00:00:00Z');
  const start=new Date(end.getTime()-119*86400000);
  const from=start.toISOString().slice(0,10);
  return (rows||[]).filter(r=>String(r.date||'')>=from&&String(r.date||'')<=dates[dates.length-1]);
}function provider(){return $('provider').value}
async function loadSourceMeta(p=provider()){if(sourceMeta.loading)return;sourceMeta.loading=true;try{const res=await fetch(BACKEND_URL+'/source-meta?provider='+encodeURIComponent(p),{cache:'no-store'}),j=await res.json();if(res.ok&&j.ok){sourceMeta={provider:p,timestamp:j.sourceTimestamp||'',loading:false};updateSourceNameplate()}else{sourceMeta={provider:p,timestamp:'',loading:false};updateSourceNameplate()}}catch(e){sourceMeta={provider:p,timestamp:'',loading:false};updateSourceNameplate()}}function updateSourceNameplate(){const p=provider();if(sourceMeta.provider!==p)return;const el=$('lastUpdateInline');if(!el)return;if(sourceMeta.timestamp){const t=fmtSourceTime(sourceMeta.timestamp);el.textContent='Data tersedia '+t+' WIB'}else el.textContent='Data tersedia · metadata source belum tersedia'}function fmtSourceTime(v){const dt=new Date(v);return Number.isFinite(dt.getTime())?dt.toLocaleString('id-ID',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'Asia/Jakarta'}).replace(',', ''):'-'}function info(){const p=provider();const msg=p==='yahoo'?'Yahoo Finance: sumber pihak ketiga; historical/delayed OHLCV, bukan IDX dan bukan realtime exchange feed.':p==='remote-csv'?'Daily Remote CSV: CSV publik pihak ketiga, IDX-derived via imq21; bukan API resmi IDX.':p==='idx'?'IDX Official: OHLCV, value, volume, frequency, foreign flow dari endpoint publik IDX.':p==='remote-csv'?'':'AUTO: Daily Remote CSV → Yahoo Finance historical → cache lokal. Broker Rotation hanya ditampilkan bila ada data broker tervalidasi.';const txt=$('providerInfoText');if(txt)txt.textContent=msg;try{localStorage.setItem(PROVIDER_KEY,p)}catch{}}
function saveCache(){try{localStorage.setItem(CACHE_KEY,JSON.stringify({at:Date.now(),data}))}catch(e){console.warn('[CACHE] save failed',e)}}
function restoreCache(){try{const x=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');if(x?.data?.length){data=x.data;refresh();render();$('status').textContent='OFFLINE CACHE';setLiveStatus(`Cache lokal · ${data.length} saham · bukan data live`);return true}}catch(e){console.warn('[CACHE] restore failed',e)}return false}
async function fetchMarketRangeChunked(from,to,p){
  const all=[],timestamps=[];
  const diag={universe:0,requested:0,success:0,failed:0,empty:0,rows:0,failedTickers:[]};
  if(p==='yahoo'){
    // Cloudflare Workers Free limits one invocation to ~50 subrequests.
    // Do not send the full 949-ticker universe in one /market-range call.
    // Yahoo can return the full date window per ticker, so batch tickers instead.
    const ures=await fetch(BACKEND_URL+'/universe?provider=yahoo',{cache:'no-store'});
    const uj=await ures.json();
    if(!ures.ok||!uj.ok||!Array.isArray(uj.data)||!uj.data.length)throw Error(uj.error||'Yahoo universe kosong');
    const tickers=uj.data.map(x=>String(x.ticker||'').toUpperCase()).filter(Boolean);
    const batchSize=30;
    diag.universe=tickers.length;
    for(let i=0;i<tickers.length;i+=batchSize){
      const batch=tickers.slice(i,i+batchSize);
      const url=`${BACKEND_URL}/market-range?from=${ymd(from)}&to=${ymd(to)}&provider=yahoo&tickers=${encodeURIComponent(batch.join(','))}`;
      const res=await fetch(url,{cache:'no-store'}),j=await res.json();
      if(!res.ok||!j.ok)throw Error(j.error||`HTTP ${res.status}`);
      all.push(...(j.data||[]));
      if(j.diagnostics){
        diag.requested+=Number(j.diagnostics.requested)||batch.length;
        diag.success+=Number(j.diagnostics.success)||0;
        diag.failed+=Number(j.diagnostics.failed)||0;
        diag.empty+=Number(j.diagnostics.empty)||0;
        diag.rows+=Number(j.diagnostics.rows)||0;
        if(Array.isArray(j.diagnostics.failedTickers)) diag.failedTickers=[...(diag.failedTickers||[]),...j.diagnostics.failedTickers];
        console.info('[YAHOO DIAGNOSTIC]',j.diagnostics);
      }
    }
    return{data:all,provider:p,sourceTimestamp:timestamps.sort().at(-1)||'',source:'',diagnostics:diag};
  }
  const maxDays=15;
  let cur=new Date(from);const end=new Date(to);
  while(cur<=end){
    const chunkEnd=new Date(Math.min(end.getTime(),cur.getTime()+(maxDays-1)*86400000));
    const url=`${BACKEND_URL}/market-range?from=${ymd(cur)}&to=${ymd(chunkEnd)}&provider=${encodeURIComponent(p)}`;
    const res=await fetch(url,{cache:'no-store'}),j=await res.json();
    if(!res.ok||!j.ok)throw Error(j.error||`HTTP ${res.status}`);
    all.push(...(j.data||[]));
    if(j.sourceTimestamp)timestamps.push(j.sourceTimestamp);
    cur=new Date(chunkEnd.getTime()+86400000);
  }
  return{data:all,provider:p,sourceTimestamp:timestamps.sort().at(-1)||'',source:'',diagnostics:diag};
}
async function loadLiveAll(){
  const p=provider(); await loadSourceMeta(p);
  const to=sourceMeta.timestamp?new Date(sourceMeta.timestamp):new Date(),from=new Date(to.getTime()-89*86400000),
    label=p==='auto'?'Daily Remote CSV → Yahoo → Cache':p.toUpperCase();
  setLiveStatus(`Mengambil ALL via ${label}...`);
  const j=await fetchMarketRangeChunked(from,to,p);
  let prices=StockFlowProvider.normalize(j.data||[]);
  prices=trimToLast90(prices);
  if(!prices.length)throw Error('Data market kosong');
  data=StockFlowProvider.group(prices);
  brokerRows=[];
  selectedTickers=new Set(data.map(x=>x.ticker));
  refresh();render();
  $('status').textContent=(j.provider||p).toUpperCase();
  const d=j.diagnostics;
  const failedList=p==='yahoo'&&d?.failedTickers?.length ? [...new Set(d.failedTickers)].join(',') : '';
  const diagText=p==='yahoo'&&d
    ? ` · universe ${d.universe} · request ${d.requested} · success ${d.success} · failed ${d.failed} · empty ${d.empty}${failedList?` · failed tickers ${failedList}`:''}`
    : '';
  setLiveStatus(`${j.source||p} · ALL · ${data.length} saham · ${prices.length} baris OHLCV · tanpa broker detail${diagText}`);
  saveCache();
}
async function loadLiveStock(){backtestTicker='';backtestSeries=null;const t=[...selectedTickers];if(t.length!==1)return loadLiveAll();const ticker=t[0];const p=provider(); await loadSourceMeta(p); const to=sourceMeta.timestamp?new Date(sourceMeta.timestamp):new Date(),from=new Date(to.getTime()-89*86400000),url=`${BACKEND_URL}/stock?ticker=${encodeURIComponent(ticker)}&from=${ymd(from)}&to=${ymd(to)}&provider=${encodeURIComponent(p)}`;setLiveStatus(`Mengambil ${ticker} via ${p.toUpperCase()}...`);const res=await fetch(url,{cache:'no-store'}),j=await res.json();if(!res.ok||!j.ok)throw Error(j.error||`HTTP ${res.status}`);let prices=StockFlowProvider.normalize(j.prices||[]),br=j.broker||[];
  prices=trimToLast90(prices);if(!prices.length)throw Error('OHLCV kosong');const fresh=StockFlowProvider.group(StockFlowProvider.mergeBrokerRows(prices,br));const keep=data.filter(x=>x.ticker!==ticker);data=[...keep,...fresh];brokerRows=br;selectedTickers=new Set([ticker]);refresh();render();$('status').textContent=(j.provider||p).toUpperCase();setLiveStatus(`${j.source||p} · ${ticker} · ${prices.length} hari · ${br.length} broker rows`);saveCache()}
function stamp(sourceTime=''){const t=fmtSourceTime(sourceTime||sourceMeta.timestamp);const old=$('lastUpdate');if(old)old.textContent=t;updateSourceNameplate();return t}function appLog(source){const el=$('providerInfoText');if(el)el.textContent=source}function setLiveStatus(x){const old=$('liveStatus');if(old)old.textContent=x;const out=$('liveStatusInline');if(out)out.textContent='Data Connection · '+x;updateSourceNameplate()}
async function autoLoad(){
  const p=provider();
  const hadCache=p==='auto'&&restoreCache();
  setLiveStatus(`Mengambil data ${p==='auto'?'AUTO':'LIVE '+p.toUpperCase()}...`);
  try{
    await loadLiveStock();
  }catch(e){
    console.error('[LIVE]',e);
    if(p==='auto'&&hadCache){
      $('status').textContent='CACHE';
      setLiveStatus(`Cache lokal dipakai · live refresh gagal: ${e.message}`);
      return;
    }
    if(p==='auto'){
      $('status').textContent='OFFLINE';
      setLiveStatus(`Data live gagal: ${e.message}`);
      const el=$('momentPareto');
      if(el)el.innerHTML='<div class="detail-placeholder">Data live belum tersedia. Periksa koneksi/provider.</div>';
      return;
    }
    $('status').textContent='LIVE ERROR';
    setLiveStatus(`${p.toUpperCase()} gagal: ${e.message}`);
    const el=$('momentPareto');
    if(el)el.innerHTML='<div class="detail-placeholder">Data live belum tersedia untuk provider ini.</div>';
  }
}
$('lookback').onchange=render;
$('provider').onchange=()=>{info();sourceMeta={provider:provider(),timestamp:'',loading:false};updateSourceNameplate();loadSourceMeta(provider());autoLoad()};
info();refresh();render();setTimeout(()=>{loadFundamental();autoLoad()},50);
try{const s=localStorage.getItem(PROVIDER_KEY);if(['auto','yahoo','remote-csv','idx'].includes(s))$('provider').value=s}catch{}