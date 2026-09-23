const RAPID_HOST='indonesia-stock-exchange-idx.p.rapidapi.com';
const RAPID_BASE='https://'+RAPID_HOST;

function num(v:any){
  if(typeof v==='number')return Number.isFinite(v)?v:0;
  const n=Number(String(v??'').replace(/,/g,''));
  return Number.isFinite(n)?n:0;
}
function records(payload:any):any[]{
  const preferred=['brokers','brokerSummary','broker_summary','summary','items','results','records','data'];
  const walk=(x:any):any[]=>{
    if(Array.isArray(x))return x.every(v=>v&&typeof v==='object'&&!Array.isArray(v))?x:[];
    if(!x||typeof x!=='object')return [];
    for(const k of preferred){
      const r=walk(x[k]); if(r.length)return r;
    }
    for(const v of Object.values(x)){const r=walk(v);if(r.length)return r;}
    return [];
  };
  return walk(payload);
}
function pick(r:any,...keys:string[]){
  for(const k of keys)if(r?.[k]!==undefined&&r?.[k]!==null)return r[k];
  return undefined;
}
function mapBroker(r:any,ticker:string,queryDate:string){
  const broker=String(pick(r,'brokerCode','broker_code','netbs_broker_code','broker','code','IDFirm','idFirm')||'').trim().toUpperCase();
  if(!broker)return null;
  const date=String(pick(r,'date','Date','tradeDate','trade_date')||queryDate).slice(0,10);
  const buyValue=num(pick(r,'buyValue','buy_value','bval','buyVal'));
  const sellValue=Math.abs(num(pick(r,'sellValue','sell_value','sval','sellVal')));
  const buyVolume=Math.max(0,num(pick(r,'buyVolume','buy_volume','blot','buyLot','buy_lot')));
  const sellVolume=Math.abs(num(pick(r,'sellVolume','sell_volume','slot','sellLot','sell_lot')));
  const netValue=pick(r,'netValue','net_value','netVal');
  const netVolume=pick(r,'netVolume','net_volume','netVol');
  return {
    date,ticker,broker,buyValue,sellValue,
    buyVolume,sellVolume,
    netValue:num(netValue!==undefined?netValue:buyValue-sellValue),
    netVolume:num(netVolume!==undefined?netVolume:buyVolume-sellVolume),
    investorType:String(pick(r,'investorType','investor_type','type')||''),
    source:'IDX RapidAPI'
  };
}
async function rapidGet(path:string,params:Record<string,string>,apiKey:string){
  const u=new URL(RAPID_BASE+path);
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
  const r=await fetch(u.toString(),{
    headers:{
      Accept:'application/json',
      'Content-Type':'application/json',
      'x-rapidapi-host':RAPID_HOST,
      'x-rapidapi-key':apiKey
    }
  });
  const body=await r.text();
  if(!r.ok)throw Error(`IDX RapidAPI HTTP ${r.status}: ${body.slice(0,220).replace(/\\s+/g,' ')}`);
  try{return JSON.parse(body)}catch{throw Error(`IDX RapidAPI invalid JSON: ${body.slice(0,220).replace(/\\s+/g,' ')}`)}
}

export async function rapidBrokerSummary(ticker:string,from:string,to:string,apiKey?:string){
  const key=String(apiKey||'').trim();
  if(!key)throw Error('IDX RapidAPI belum dikonfigurasi. Set Cloudflare secret RAPIDAPI_KEY.');
  const j=await rapidGet(`/api/market-detector/broker-summary/${encodeURIComponent(ticker)}`,{
    limit:'100',
    marketBoard:'MARKET_BOARD_ALL',
    transactionType:'TRANSACTION_TYPE_NET',
    investorType:'INVESTOR_TYPE_ALL',
    from,to
  },key);
  return records(j).map(r=>mapBroker(r,ticker,to)).filter(Boolean);
}
