const BASE_URL='https://api.indexalpha.id';
function apiKey(key?:string){const k=String(key||'').trim();if(!k)throw Error('INDEX_ALPHA_API_KEY is not configured');return k}
function checkDate(d:string){if(!/^\d{8}$/.test(d))throw Error('date must be YYYYMMDD');return d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8)}
function headers(){return{Accept:'application/json',Authorization:'Bearer '+apiKey(key)}}
export async function brokerSummary(ticker:string,date:string,key?:string){
  const d=checkDate(date),p=new URLSearchParams({ticker:ticker.toUpperCase(),from:d,to:d,investor:'all',market:'RG'});
  const r=await fetch(BASE_URL+'/stocks/broker-summary?'+p,{headers:headers()});
  const b=await r.json().catch(()=>null);
  if(!r.ok)throw Error('Index Alpha broker HTTP '+r.status);
  return(Array.isArray(b?.data)?b.data:[]).map((x:any)=>({
    date,ticker:ticker.toUpperCase(),broker:String(x.code??''),brokerName:String(x.code??''),
    buyValue:Number(x.buy_value??0),sellValue:Number(x.sell_value??0),
    totalValue:Number(x.buy_value??0)+Number(x.sell_value??0),
    buyVolume:Number(x.buy_volume??0),sellVolume:Number(x.sell_volume??0),
    volume:Number(x.buy_volume??0)+Number(x.sell_volume??0),
    buyFrequency:Number(x.buy_freq??0),sellFrequency:Number(x.sell_freq??0),
    frequency:Number(x.buy_freq??0)+Number(x.sell_freq??0),
    buyAvg:Number(x.buy_avg??0),sellAvg:Number(x.sell_avg??0),
    netValue:Number(x.buy_value??0)-Number(x.sell_value??0)
  })).filter((x:any)=>x.broker)
}
