const BASE='https://www.idx.co.id';
const headers={Accept:'application/json, text/plain, */*','Accept-Language':'id-ID,id;q=0.9,en-US;q=0.8',Referer:'https://www.idx.co.id/', 'X-Requested-With':'XMLHttpRequest','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36',Origin:'https://www.idx.co.id'};
let session:{cookie:string;at:number}|null=null;
async function init(){
  if(session&&Date.now()-session.at<10*60*1000)return session.cookie;
  const r=await fetch(BASE+'/id',{headers});
  const cookies=r.headers.getSetCookie?.()||[];
  const cookie=cookies.map(x=>x.split(';')[0]).join('; ');
  session={cookie,at:Date.now()};
  return cookie;
}
async function getJson(url:string){
  const cookie=await init();
  const r=await fetch(url,{headers:{...headers,...(cookie?{Cookie:cookie}:{})}});
  if(!r.ok)throw Error(`IDX HTTP ${r.status}`);
  return r.json();
}
const ymd=(d:Date)=>d.toISOString().slice(0,10).replaceAll('-','');
function days(a:string,b:string){const out:string[]=[];let d=new Date(`${a.slice(0,4)}-${a.slice(4,6)}-${a.slice(6,8)}T00:00:00Z`),e=new Date(`${b.slice(0,4)}-${b.slice(4,6)}-${b.slice(6,8)}T00:00:00Z`);for(;d<=e;d.setUTCDate(d.getUTCDate()+1))out.push(ymd(d));return out}
function mapStock(x:any){return {date:String(x.Date||'').slice(0,10),ticker:String(x.StockCode||'').toUpperCase(),name:String(x.StockName||'').trim(),open:Number(x.OpenPrice),high:Number(x.High),low:Number(x.Low),close:Number(x.Close),volume:Number(x.Volume||0),value:Number(x.Value||0),foreignBuy:Number(x.ForeignBuy||0),foreignSell:Number(x.ForeignSell||0),frequency:Number(x.Frequency||0)}}
export async function idxStock(ticker:string,from:string,to:string){
  const u=`https://www.idx.co.id/primary/ListedCompany/GetTradingInfoSS?code=${encodeURIComponent(ticker)}&start=0&length=1000`;
  const j=await getJson(u); const rows=(Array.isArray(j?.replies)?j.replies:[]).map(mapStock).filter((r:any)=>r.date>=from&&r.date<=to);
  return rows;
}
export async function idxMarketRange(from:string,to:string,tickers?:string[]){
  const wanted=new Set((tickers||[]).map(x=>x.toUpperCase()).filter(Boolean));
  const ds=days(from,to).slice(-35);
  const out:any[]=[];
  for(let i=0;i<ds.length;i+=3){
    const batch=await Promise.all(ds.slice(i,i+3).map(async date=>{
      try{const j=await getJson(`${BASE}/primary/TradingSummary/GetStockSummary?length=9999&start=0&date=${date}`);return (Array.isArray(j)?j:(Array.isArray(j?.data)?j.data:Array.isArray(j?.replies)?j.replies:[])).map(mapStock)}
      catch(e){console.warn('[IDX]',date,String(e));return []}
    }));
    for(const rows of batch)for(const r of rows)if((!wanted.size||wanted.has(r.ticker))&&r.date)out.push(r);
  }
  return out;
}
export async function idxSourceTimestamp(){
  try{const j=await getJson(`${BASE}/primary/Home/GetTradeSummary?lang=id`);const x=Array.isArray(j)?j[0]:null;return String(x?.Dates||'')}
  catch{return ''}
}
