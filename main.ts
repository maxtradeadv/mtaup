import { brokerSummary as indexAlphaBrokerSummary, ohlcv as indexAlphaOhlcv } from './providers/indexalpha.ts';
import { yahooOhlcv } from './providers/yahoo.ts';

import { remoteCsvDay, remoteCsvRange } from './providers/remote-csv.ts';
const IDX_HOME='https://www.idx.co.id/id';
const IDX_STOCK_SUMMARY='https://www.idx.co.id/primary/TradingSummary/GetStockSummary';
const IDX_BROKER_SUMMARY='https://www.idx.co.id/primary/TradingSummary/GetBrokerSummary';
type Provider='auto'|'idx'|'indexalpha'|'yahoo'|'remote-csv';
const providerOf=(v:string|null):Provider=>['idx','indexalpha','yahoo','remote-csv','auto'].includes(v||'')?v as Provider:(['idx','indexalpha','yahoo','remote-csv'].includes(Deno.env.get('DATA_PROVIDER')||'')?Deno.env.get('DATA_PROVIDER') as Provider:'auto');
const hasIA=()=>!!Deno.env.get('INDEX_ALPHA_API_KEY')?.trim();
const HEAD:HeadersInit={Accept:'application/json, text/plain, */*','Accept-Language':'id-ID,id;q=0.9,en;q=0.8',Referer:IDX_HOME,Origin:'https://www.idx.co.id','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36','X-Requested-With':'XMLHttpRequest'};
let cookie='',cookieAt=0;
const cache=new Map<string,{at:number;data:any[]}>();
const ytickers=['BBCA','BBRI','BMRI','TLKM','ASII','BBNI','ICBP','INDF','ANTM','MDKA','GOTO','UNVR','PGAS','ADRO','PTBA','SMGR','JPFA','KLBF','AMRT','ACES'];
let yahooUniverseCache:{at:number;data:{ticker:string;name:string}[]}|null=null;
async function yahooUniverse(){
  if(yahooUniverseCache&&Date.now()-yahooUniverseCache.at<3600000)return yahooUniverseCache.data;
  const out:{ticker:string;name:string}[]=[];
  const now=new Date();
  for(let back=0;back<10;back++){
    const d=new Date(now.getTime()-back*86400000);
    const ds=d.toISOString().slice(0,10).replaceAll('-','');
    try{
      const rows=await remoteCsvDay(ds);
      for(const x of rows){
        const ticker=String(x.ticker||'').toUpperCase();
        if(ticker)out.push({ticker,name:ticker});
      }
      if(out.length>=500)break;
    }catch(e){if(!String(e).includes('HTTP 404'))console.warn('[YAHOO UNIVERSE]',ds,String(e))}
  }
  const uniq=[...new Map(out.map(x=>[x.ticker,x])).values()];
  if(!uniq.length)throw Error('IDX-derived CSV returned no Indonesia equities');
  yahooUniverseCache={at:Date.now(),data:uniq};
  return uniq;
}

const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}});
const valid=(x:string|null)=>!!x&&/^\d{8}$/.test(x);
const rows=(p:any)=>Array.isArray(p)?p:Array.isArray(p?.data)?p.data:Array.isArray(p?.rows)?p.rows:Array.isArray(p?.Data)?p.Data:Array.isArray(p?.Rows)?p.Rows:[];
async function session(){if(cookie&&Date.now()-cookieAt<600000)return;const r=await fetch(IDX_HOME,{headers:HEAD});if(!r.ok)throw Error(`IDX home HTTP ${r.status}`);cookie=(r.headers.getSetCookie?.()??[]).map(x=>x.split(';')[0]).join('; ')||((r.headers.get('set-cookie')||'').split(/,(?=[^;,]+=)/).map(x=>x.trim().split(';')[0]).filter(Boolean).join('; '));cookieAt=Date.now();await r.body?.cancel()}
async function idx(url:string){await session();let h={...HEAD,...(cookie?{Cookie:cookie}:{})};let r=await fetch(url,{headers:h});if(r.status===401||r.status===403){await r.body?.cancel();cookie='';cookieAt=0;await session();h={...HEAD,...(cookie?{Cookie:cookie}:{})};r=await fetch(url,{headers:h})}return r}
async function idxMarket(date:string){const k='idx:'+date,c=cache.get(k);if(c&&Date.now()-c.at<300000)return c.data;const r=await idx(`${IDX_STOCK_SUMMARY}?length=9999&start=0&date=${date}`);if(!r.ok)throw Error(`IDX market HTTP ${r.status}`);const d=rows(await r.json()).map((x:any)=>({date,ticker:String(x.StockCode||''),open:+(x.OpenPrice||0),high:+(x.High||0),low:+(x.Low||0),close:+(x.Close||0),volume:+(x.Volume||0),value:+(x.Value||0)})).filter((x:any)=>x.ticker&&Number.isFinite(x.close));cache.set(k,{at:Date.now(),data:d});return d}
const dates=(a:string,b:string)=>{const z=[];for(let d=new Date(`${a.slice(0,4)}-${a.slice(4,6)}-${a.slice(6,8)}Z`),e=new Date(`${b.slice(0,4)}-${b.slice(4,6)}-${b.slice(6,8)}Z`);d<=e;d=new Date(+d+86400000))z.push(d.toISOString().slice(0,10).replaceAll('-',''));return z};
async function range(a:string,b:string,p:Provider,ts=ytickers,names?:Map<string,string>){const k=`${p}:${a}:${b}:${ts.join(',')}`,c=cache.get(k);if(c&&Date.now()-c.at<300000)return c.data;let d:any[]=[];if(p==='yahoo'){const jobs=ts.map(t=>yahooOhlcv(t,a,b,names?.get(t.toUpperCase())));for(let i=0;i<jobs.length;i+=8){const batch=await Promise.allSettled(jobs.slice(i,i+8));for(const x of batch)if(x.status==='fulfilled')d.push(...x.value);else console.warn('[YAHOO]',String(x.reason))}}else if(p==='remote-csv')d=await remoteCsvRange(a,b,ts);else if(p==='indexalpha'){const jobs=ts.map(t=>indexAlphaOhlcv(t,a,b));for(let i=0;i<jobs.length;i+=5){const batch=await Promise.allSettled(jobs.slice(i,i+5));for(const x of batch)if(x.status==='fulfilled')d.push(...x.value);else console.warn('[INDEXALPHA]',String(x.reason))}}else for(const day of dates(a,b))d.push(...await idxMarket(day));cache.set(k,{at:Date.now(),data:d});return d}
async function idxBroker(date:string){const r=await idx(`${IDX_BROKER_SUMMARY}?length=9999&start=0&date=${date}`);if(!r.ok)throw Error(`IDX broker HTTP ${r.status}`);return rows(await r.json()).map((x:any)=>({date,broker:String(x.IDFirm||''),brokerName:String(x.FirmName||''),totalValue:+(x.Value||0),volume:+(x.Volume||0),frequency:+(x.Frequency||0)})).filter((x:any)=>x.broker)}
async function stock(t:string,a:string,b:string,p:Provider){const prices=p==='yahoo'?await yahooOhlcv(t,a,b):p==='remote-csv'?await remoteCsvRange(a,b,[t]):p==='indexalpha'?await indexAlphaOhlcv(t,a,b):(await range(a,b,'idx')).filter(x=>x.ticker.toUpperCase()===t.toUpperCase());let br:any[]=[];if(p==='indexalpha'){const ds=[...new Set(prices.map((x:any)=>String(x.date)).filter(Boolean))].slice(-20);for(let i=0;i<ds.length;i+=5)br.push(...(await Promise.all(ds.slice(i,i+5).map(d=>indexAlphaBrokerSummary(t,d.replaceAll('-',''))))).flat())}else if(p==='idx')br=await idxBroker(b);return{ticker:t.toUpperCase(),from:a,to:b,prices,broker:br}}
const ACCESS_CODE_ENV='APP_ACCESS_CODE';
const SESSION_SECRET_ENV='APP_SESSION_SECRET';
const SESSION_TTL_MS=7*24*60*60*1000;
const failedLogins=new Map<string,{count:number;resetAt:number}>();
const enc=new TextEncoder();

function b64url(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')}
function fromB64url(s:string){s=s.replaceAll('-','+').replaceAll('_','/');while(s.length%4)s+='=';const bin=atob(s);return Uint8Array.from(bin,c=>c.charCodeAt(0))}
async function sessionKey(){
  const access=Deno.env.get(ACCESS_CODE_ENV)?.trim();
  if(!access)return null;
  const secret=(Deno.env.get(SESSION_SECRET_ENV)?.trim()||access);
  return crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
async function makeSession(){
  const key=await sessionKey();if(!key)return null;
  const payload=`${Date.now()}.${crypto.randomUUID()}`;
  const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(payload)));
  return `${b64url(enc.encode(payload))}.${b64url(sig)}`;
}
async function validSession(req:Request){
  const key=await sessionKey();if(!key)return false;
  const m=(req.headers.get('Cookie')||'').match(/(?:^|;\\s*)sf_session=([^;]+)/);
  if(!m)return false;
  try{
    const [p,s]=m[1].split('.');
    if(!p||!s)return false;
    const payload=new TextDecoder().decode(fromB64url(p));
    const ts=Number(payload.split('.')[0]);
    if(!Number.isFinite(ts)||Date.now()-ts<0||Date.now()-ts>SESSION_TTL_MS)return false;
    return await crypto.subtle.verify('HMAC',key,fromB64url(s),enc.encode(payload));
  }catch{return false}
}
function clientKey(req:Request){
  return (req.headers.get('x-forwarded-for')||req.headers.get('cf-connecting-ip')||'unknown').split(',')[0].trim().slice(0,80)||'unknown';
}
function loginPage(message=''){
  const safe=message.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  return new Response(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#111827"><title>Stock Flow · Private</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f4f6;color:#111827;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.box{width:min(92vw,380px);background:#fff;border:1px solid #e5e7eb;border-radius:20px;padding:26px;box-shadow:0 12px 40px #0001}h1{margin:0 0 6px;font-size:24px}p{margin:0 0 22px;color:#6b7280;font-size:13px}label{font-size:11px;font-weight:800;color:#6b7280}input{width:100%;height:48px;margin:6px 0 12px;border:1px solid #d1d5db;border-radius:10px;padding:10px 12px;font-size:20px;letter-spacing:.18em;text-align:center}button{width:100%;height:46px;border:0;border-radius:10px;background:#111827;color:#fff;font-weight:800;font-size:14px}.err{margin:0 0 12px;padding:9px;border-radius:9px;background:#fef2f2;color:#b91c1c;font-size:12px;text-align:center}</style></head><body><form class="box" method="post" action="/auth/login"><h1>🔒 Stock Flow Scanner</h1><p>Aplikasi ini private. Masukkan security code untuk melanjutkan.</p>${safe?`<div class="err">${safe}</div>`:''}<label>SECURITY CODE</label><input name="code" type="password" inputmode="numeric" autocomplete="current-password" maxlength="64" autofocus required><button type="submit">Buka Scanner</button></form></body></html>`,{status:message?401:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
async function authGuard(req:Request){
  const configured=!!Deno.env.get(ACCESS_CODE_ENV)?.trim();
  if(!configured)return new Response('Private access is not configured. Set Deno secret APP_ACCESS_CODE.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  if(await validSession(req))return null;
  return loginPage();
}
const ROOT=new URL('.',import.meta.url);
const files:any={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/analysis.js':'analysis.js','/data-provider.js':'data-provider.js','/calibration.js':'calibration.js','/app.js':'app.js','/manifest.webmanifest':'manifest.webmanifest','/icon.svg':'icon.svg','/icon-180.png':'icon-180.png','/icon-192.png':'icon-192.png','/apple-touch-icon.png':'apple-touch-icon.png','/sw.js':'sw.js'};
const types:any={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'application/javascript; charset=utf-8',webmanifest:'application/manifest+json; charset=utf-8',svg:'image/svg+xml',png:'image/png'};
const textExt=new Set(['html','css','js','webmanifest','svg']);
async function file(path:string){try{const name=files[path];const url=new URL(name,ROOT);const ext=name.split('.').pop()||'html';const headers={'Content-Type':types[ext]||'application/octet-stream','Cache-Control':path==='/'||path==='/index.html'?'no-store, no-cache, must-revalidate':'no-store','X-Content-Type-Options':'nosniff'};if(textExt.has(ext)){const text=await Deno.readTextFile(url);return new Response(text,{headers})}const b=await Deno.readFile(url);return new Response(b,{headers})}catch(e){console.error('[STATIC]',path,e);return new Response('Frontend file not found',{status:500,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}})}}
Deno.serve(async req=>{const u=new URL(req.url);try{
  if(req.method==='OPTIONS')return json({ok:true});
  if(u.pathname==='/auth/login'&&req.method==='POST'){
    const code=(await req.formData()).get('code');
    const expected=Deno.env.get(ACCESS_CODE_ENV)?.trim()||'';
    if(!expected)return new Response('Private access is not configured. Set Deno secret APP_ACCESS_CODE.',{status:503});
    const key=clientKey(req),now=Date.now(),rec=failedLogins.get(key);
    if(rec&&now<rec.resetAt&&rec.count>=5)return loginPage('Terlalu banyak percobaan. Coba lagi beberapa menit.');
    if(String(code||'')!==expected){
      const next=rec&&now<rec.resetAt?{count:rec.count+1,resetAt:rec.resetAt}:{count:1,resetAt:now+10*60*1000};
      failedLogins.set(key,next);
      return loginPage('Security code salah.');
    }
    failedLogins.delete(key);
    const token=await makeSession();
    if(!token)return new Response('Session configuration error',{status:503});
    return new Response(null,{status:303,headers:{Location:'/', 'Set-Cookie':`sf_session=${token}; Max-Age=${Math.floor(SESSION_TTL_MS/1000)}; Path=/; HttpOnly; Secure; SameSite=Lax`,'Cache-Control':'no-store'}});
  }
  if(u.pathname==='/auth/logout'){
    return new Response(null,{status:303,headers:{Location:'/', 'Set-Cookie':'sf_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax','Cache-Control':'no-store'}});
  }
  const guard=await authGuard(req);if(guard)return guard;
  if(files[u.pathname])return file(u.pathname);
  if(u.pathname==='/health')return json({ok:true,provider:providerOf(null),indexAlphaConfigured:hasIA(),sources:{idx:'IDX direct',remoteCsv:'Community daily CSV (IDX-derived via imq21)',yahoo:'Yahoo Finance (third-party fallback)'}});if(u.pathname==='/universe'){const requested=providerOf(u.searchParams.get('provider'));if(requested!=='yahoo')return json({ok:true,provider:requested,data:ytickers.map(t=>({ticker:t,name:t}))});const ulist=await yahooUniverse();return json({ok:true,provider:'yahoo',source:'Yahoo Finance screener · Indonesia (JKT)',count:ulist.length,data:ulist})}if(u.pathname==='/market-range'){const a=u.searchParams.get('from'),b=u.searchParams.get('to'),requested=providerOf(u.searchParams.get('provider'));if(!valid(a)||!valid(b))return json({error:'from and to must be YYYYMMDD'},400);let ts=(u.searchParams.get('tickers')||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);let names=new Map<string,string>();if(requested==='indexalpha'&&!ts.length)ts=ytickers;if(requested==='yahoo'&&!ts.length){const ulist=await yahooUniverse();ts=ulist.map(x=>x.ticker);names=new Map(ulist.map(x=>[x.ticker,x.name]));}let used=requested,d:any[]=[];if(requested==='auto'){try{d=await range(a!,b!,'remote-csv',ts);if(!d.length)throw Error('Remote CSV returned no rows');used='remote-csv'}catch(e){console.warn('[AUTO] remote CSV unavailable, using Yahoo Finance:',String(e));try{const ulist=await yahooUniverse();ts=ts.length?ts:ulist.map(x=>x.ticker);names=new Map(ulist.map(x=>[x.ticker,x.name]));d=await range(a!,b!,'yahoo',ts,names);if(!d.length)throw Error('Yahoo returned no rows');used='yahoo'}catch(e2){console.warn('[AUTO] Yahoo unavailable, trying IDX:',String(e2));d=await range(a!,b!,'idx',ts.length?ts:ytickers);used='idx'}}}else d=await range(a!,b!,requested,ts,names);return json({ok:true,provider:used,requestedProvider:requested,source:used==='remote-csv'?'Community daily CSV (IDX-derived via imq21; not official IDX API)':used==='yahoo'?'Yahoo Finance (third-party fallback; not IDX)':used==='indexalpha'?'Index Alpha OHLCV':'IDX direct',from:a,to:b,count:d.length,data:d})}if(u.pathname==='/stock'){const t=u.searchParams.get('ticker'),a=u.searchParams.get('from'),b=u.searchParams.get('to'),requested=providerOf(u.searchParams.get('provider'));if(!t||!valid(a)||!valid(b))return json({error:'ticker, from and to required'},400);let used=requested,result:any;if(requested==='auto'){try{result=await stock(t,a!,b!,'remote-csv');if(!result.prices.length)throw Error('Remote CSV returned no rows');used='remote-csv'}catch(e){console.warn('[AUTO] remote CSV stock unavailable, using Yahoo Finance:',String(e));try{result=await stock(t,a!,b!,'yahoo');if(!result.prices.length)throw Error('Yahoo returned no rows');used='yahoo'}catch(e2){console.warn('[AUTO] Yahoo stock unavailable, trying IDX:',String(e2));result=await stock(t,a!,b!,'idx');used='idx'}}}else result=await stock(t,a!,b!,requested);return json({ok:true,provider:used,requestedProvider:requested,source:used==='remote-csv'?'Community daily CSV (IDX-derived via imq21; not official IDX API)':used==='yahoo'?'Yahoo Finance (third-party fallback; not IDX)':used==='idx'?'IDX direct':'Index Alpha',...result})}if(u.pathname==='/broker'){const d=u.searchParams.get('date'),t=u.searchParams.get('ticker'),p=providerOf(u.searchParams.get('provider'));if(!valid(d))return json({error:'date must be YYYYMMDD'},400);if(p==='indexalpha'){if(!t)return json({error:'ticker required'},400);return json({ok:true,provider:'indexalpha',date:d,ticker:t,data:await indexAlphaBrokerSummary(t,d)})}return json({ok:true,provider:'idx',date:d,ticker:t,data:await idxBroker(d)})}return json({error:'not found'},404)}catch(e){console.error(e);return json({ok:false,error:e instanceof Error?e.message:String(e)},502)}});