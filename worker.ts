import { yahooOhlcv } from './providers/yahoo.ts';
import { remoteCsvRange, remoteCsvServerTimestamp } from './providers/remote-csv.ts';
import { idxMarketRange, idxSourceTimestamp, idxStock } from './providers/idx-official.ts';

type Provider='auto'|'yahoo'|'remote-csv'|'idx';
interface Env { ASSETS: Fetcher; APP_ACCESS_CODE?: string; APP_SESSION_SECRET?: string; DATA_PROVIDER?: string; }
let runtimeEnv: Env;
const envGet=(k:keyof Env)=>runtimeEnv?.[k] ?? '';
const providerOf=(v:string|null):Provider=>['yahoo','remote-csv','auto','idx'].includes(v||'')?v as Provider:(['yahoo','remote-csv','idx'].includes(envGet('DATA_PROVIDER')||'')?envGet('DATA_PROVIDER') as Provider:'auto');

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
      const rows=await (await fetch('https://raw.githubusercontent.com/nofendian17/idx_dataset/main/data/stock_data_'+ds.slice(0,4)+'-'+ds.slice(4,6)+'-'+ds.slice(6,8)+'.csv',{headers:{Accept:'text/csv'}})).text();
      const lines=rows.split(/\r?\n/).filter(Boolean);
      if(lines.length<2)continue;
      const h=lines[0].split(',').map(x=>x.replaceAll('"','').trim());
      const ti=h.findIndex(x=>x.toLowerCase()==='stock code');
      if(ti<0)continue;
      for(const line of lines.slice(1)){
        const c=line.split(',').map(x=>x.replaceAll('"','').trim());
        const ticker=String(c[ti]||'').toUpperCase();
        if(ticker)out.push({ticker,name:ticker});
      }
      if(out.length>=500)break;
    }catch(e){console.warn('[UNIVERSE]',ds,String(e))}
  }
  const uniq=[...new Map(out.map(x=>[x.ticker,x])).values()];
  if(!uniq.length)throw Error('Daily CSV returned no Indonesia equities');
  yahooUniverseCache={at:Date.now(),data:uniq};
  return uniq;
}

const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}});
const valid=(x:string|null)=>!!x&&/^\d{8}$/.test(x);
const cache=new Map<string,{at:number;data:any[]}>();
async function range(a:string,b:string,p:Provider,ts=ytickers,names?:Map<string,string>){
  const key=`${p}:${a}:${b}:${ts.join(',')}`,hit=cache.get(key);
  if(hit&&Date.now()-hit.at<300000)return hit.data;
  let d:any[]=[];
  if(p==='yahoo'){
    const jobs=ts.map(t=>yahooOhlcv(t,a,b,names?.get(t.toUpperCase())));
    for(let i=0;i<jobs.length;i+=8){
      const batch=await Promise.allSettled(jobs.slice(i,i+8));
      for(const x of batch)if(x.status==='fulfilled')d.push(...x.value);else console.warn('[YAHOO]',String(x.reason));
    }
  }else{
    d=await remoteCsvRange(a,b,ts);
  }
  cache.set(key,{at:Date.now(),data:d});
  return d;
}
async function stock(t:string,a:string,b:string,p:Provider){
  const ticker=t.toUpperCase();
  const prices=p==='yahoo'?await yahooOhlcv(ticker,a,b):p==='idx'?await idxStock(ticker,a,b):await remoteCsvRange(a,b,[ticker]);
  let broker:any[]=[];)(\d{2})(\d{2})$/,'$1-$2-$3'));
  }
  return {ticker,from:a,to:b,prices,broker};
}

const ACCESS_CODE_ENV='APP_ACCESS_CODE';
const SESSION_SECRET_ENV='APP_SESSION_SECRET';
function accessCodes(){
  return [...new Set(String(envGet(ACCESS_CODE_ENV)||'').split(/[\\n,;]+/).map(x=>x.trim()).filter(Boolean))];
}
const SESSION_TTL_MS=7*24*60*60*1000;
const failedLogins=new Map<string,{count:number;resetAt:number}>();
const enc=new TextEncoder();
function b64url(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')}
function fromB64url(s:string){s=s.replaceAll('-','+').replaceAll('_','/');while(s.length%4)s+='=';const bin=atob(s);return Uint8Array.from(bin,c=>c.charCodeAt(0))}
async function sessionKey(){const codes=accessCodes();if(!codes.length)return null;const secret=(envGet(SESSION_SECRET_ENV)?.trim()||codes.join('|'));return crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])}
async function makeSession(){const key=await sessionKey();if(!key)return null;const payload=`${Date.now()}.${crypto.randomUUID()}`;const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(payload)));return `${b64url(enc.encode(payload))}.${b64url(sig)}`}
async function validSession(req:Request){const key=await sessionKey();if(!key)return false;const m=(req.headers.get('Cookie')||'').match(/(?:^|;\\s*)sf_session=([^;]+)/);if(!m)return false;try{const [p,s]=m[1].split('.');if(!p||!s)return false;const payload=new TextDecoder().decode(fromB64url(p));const ts=Number(payload.split('.')[0]);if(!Number.isFinite(ts)||Date.now()-ts<0||Date.now()-ts>SESSION_TTL_MS)return false;return await crypto.subtle.verify('HMAC',key,fromB64url(s),enc.encode(payload))}catch{return false}}
function clientKey(req:Request){return(req.headers.get('x-forwarded-for')||req.headers.get('cf-connecting-ip')||'unknown').split(',')[0].trim().slice(0,80)||'unknown'}
function loginPage(message=''){const safe=message.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');return new Response(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#111827"><title>Stock Flow · Private</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f4f6;color:#111827;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.box{width:min(92vw,380px);background:#fff;border:1px solid #e5e7eb;border-radius:20px;padding:26px;box-shadow:0 12px 40px #0001}h1{margin:0 0 6px;font-size:24px}p{margin:0 0 22px;color:#6b7280;font-size:13px}label{font-size:11px;font-weight:800;color:#6b7280}input{width:100%;height:48px;margin:6px 0 12px;border:1px solid #d1d5db;border-radius:10px;padding:10px 12px;font-size:20px;letter-spacing:.18em;text-align:center}button{width:100%;height:46px;border:0;border-radius:10px;background:#111827;color:#fff;font-weight:800;font-size:14px}.err{margin:0 0 12px;padding:9px;border-radius:9px;background:#fef2f2;color:#b91c1c;font-size:12px;text-align:center}</style></head><body><form class="box" method="post" action="/auth/login"><h1>🔒 Stock Flow Scanner</h1><p>Aplikasi ini private. Masukkan security code untuk melanjutkan.</p>${safe?`<div class="err">${safe}</div>`:''}<label>SECURITY CODE</label><input name="code" type="password" inputmode="numeric" autocomplete="current-password" maxlength="64" autofocus required><button type="submit">Buka Scanner</button></form></body></html>`,{status:message?401:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
async function authGuard(req:Request){const configured=accessCodes().length>0;if(!configured)return new Response('Private access is not configured. Set Cloudflare secret APP_ACCESS_CODE.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});if(await validSession(req))return null;return loginPage()}
const files:any={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/analysis.js':'analysis.js','/data-provider.js':'data-provider.js','/calibration.js':'calibration.js','/app.js':'app.js','/manifest.webmanifest':'manifest.webmanifest','/icon.svg':'icon.svg','/icon-180.png':'icon-180.png','/sw.js':'sw.js'};
const types:any={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'application/javascript; charset=utf-8',webmanifest:'application/manifest+json; charset=utf-8',svg:'image/svg+xml',png:'image/png'};
const textExt=new Set(['html','css','js','webmanifest','svg']);
async function file(path:string,req:Request){
  try{
    const target=new URL(path,req.url);
    return await runtimeEnv.ASSETS.fetch(new Request(target.toString(),req));
  }catch(e){
    console.error('[STATIC]',path,e);
    return new Response('Frontend file not found',{status:500,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  }
}
export default {async fetch(req:Request,env:Env){runtimeEnv=env;const u=new URL(req.url);try{
  if(req.method==='OPTIONS')return json({ok:true});
  if(u.pathname==='/auth/login'&&req.method==='POST'){const code=(await req.formData()).get('code');const codes=accessCodes();if(!codes.length)return new Response('Private access is not configured. Set Cloudflare secret APP_ACCESS_CODE.',{status:503});const key=clientKey(req),now=Date.now(),rec=failedLogins.get(key);if(rec&&now<rec.resetAt&&rec.count>=5)return loginPage('Terlalu banyak percobaan. Coba lagi beberapa menit.');if(!codes.includes(String(code||'').trim())){const next=rec&&now<rec.resetAt?{count:rec.count+1,resetAt:rec.resetAt}:{count:1,resetAt:now+10*60*1000};failedLogins.set(key,next);return loginPage('Security code salah.')}failedLogins.delete(key);const token=await makeSession();if(!token)return new Response('Session configuration error',{status:503});return new Response(null,{status:303,headers:{Location:'/', 'Set-Cookie':`sf_session=${token}; Max-Age=${Math.floor(SESSION_TTL_MS/1000)}; Path=/; HttpOnly; Secure; SameSite=Lax`,'Cache-Control':'no-store'}})}
  if(u.pathname==='/auth/logout')return new Response(null,{status:303,headers:{Location:'/', 'Set-Cookie':'sf_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax','Cache-Control':'no-store'}});
  if(u.pathname==='/health'){const p=providerOf(null);return json({ok:true,provider:p,accessConfigured:!!envGet(ACCESS_CODE_ENV)?.trim(),sessionConfigured:!!envGet(SESSION_SECRET_ENV)?.trim(),sources:{idx:'Official IDX public endpoints via IDX-API reverse-engineered wrapper',remoteCsv:'Community daily CSV (IDX-derived via imq21)',yahoo:'Yahoo Finance (third-party historical)',}})}
  // Service worker must be reachable without auth so browser/iOS can update it.
  if(u.pathname==='/sw.js'){
    const r=await file('/sw.js',req);
    const h=new Headers(r.headers);
    h.set('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
    h.set('CDN-Cache-Control','no-store');
    h.set('Pragma','no-cache');
    return new Response(r.body,{status:r.status,statusText:r.statusText,headers:h});
  }
  const guard=await authGuard(req);if(guard)return guard;
  if(files[u.pathname])return file(u.pathname,req);
  if(u.pathname==='/source-meta'){const requested=providerOf(u.searchParams.get('provider'));let sourceTimestamp='';if(requested==='idx'){sourceTimestamp=await idxSourceTimestamp()}else if(requested==='yahoo'){try{const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EJKSE?range=5d&interval=1d',{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0'}});if(r.ok){const j=await r.json() as any;const ts=j?.chart?.result?.[0]?.meta?.regularMarketTime;if(ts)sourceTimestamp=new Date(Number(ts)*1000).toISOString()}}catch(e){console.warn('[YAHOO META]',String(e))}}return json({ok:true,provider:requested,source:requested==='remote-csv'||requested==='auto'?'Community daily CSV (IDX-derived via imq21; not official IDX API)':requested==='idx'?'Official IDX API':'Yahoo Finance (third-party historical)',sourceTimestamp})}
  if(u.pathname==='/universe'){const requested=providerOf(u.searchParams.get('provider'));if(requested==='yahoo'){const ulist=await yahooUniverse();return json({ok:true,provider:'yahoo',source:'Yahoo Finance screener universe backed by daily CSV ticker list',count:ulist.length,data:ulist})}return json({ok:true,provider:requested,data:ytickers.map(t=>({ticker:t,name:t}))})}
  if(u.pathname==='/market-range'){const a=u.searchParams.get('from'),b=u.searchParams.get('to'),requested=providerOf(u.searchParams.get('provider'));if(!valid(a)||!valid(b))return json({error:'from and to must be YYYYMMDD'},400);let ts=(u.searchParams.get('tickers')||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);let names=new Map<string,string>();if(!ts.length){const ulist=await yahooUniverse();ts=ulist.map(x=>x.ticker);names=new Map(ulist.map(x=>[x.ticker,x.name]));}let used=requested,d:any[]=[];if(requested==='idx'){try{d=await idxMarketRange(a!,b!,ts);if(!d.length)throw Error('IDX returned no stock summary rows');used='idx'}catch(e){console.warn('[IDX] Official endpoint blocked/unavailable, falling back to community IDX-derived CSV:',String(e));const fallbackTs=ts.length?ts:ytickers;d=await range(a!,b!,'remote-csv',fallbackTs);if(!d.length)throw Error(`IDX unavailable and Remote CSV returned no rows: ${String(e)}`);used='remote-csv'}}else if(requested==='auto'){try{d=await range(a!,b!,'remote-csv',ts);if(!d.length)throw Error('Remote CSV returned no rows');used='remote-csv'}catch(e){console.warn('[AUTO] remote CSV unavailable, using Yahoo Finance:',String(e));const ulist=ts.length?ts:await yahooUniverse();if(!ts.length){ts=ulist.map(x=>x.ticker);names=new Map(ulist.map(x=>[x.ticker,x.name]));}d=await range(a!,b!,'yahoo',ts,names);if(!d.length)throw Error('Yahoo returned no rows');used='yahoo'}}else d=await range(a!,b!,requested,ts,names);return json({ok:true,provider:used,requestedProvider:requested,source:used==='remote-csv'?'Community daily CSV (IDX-derived via imq21; not official IDX API)':used==='idx'?'Official IDX API':'Yahoo Finance (third-party historical)',sourceTimestamp:'',from:a,to:b,count:d.length,data:d})
  if(u.pathname==='/stock'){const t=u.searchParams.get('ticker'),a=u.searchParams.get('from'),b=u.searchParams.get('to'),requested=providerOf(u.searchParams.get('provider'));if(!t||!valid(a)||!valid(b))return json({error:'ticker, from and to required'},400);let used=requested,result:any;if(requested==='auto'){try{result=await stock(t,a!,b!,'remote-csv');if(!result.prices.length)throw Error('Remote CSV returned no rows');used='remote-csv'}catch(e){console.warn('[AUTO] remote CSV stock unavailable, using Yahoo Finance:',String(e));result=await stock(t,a!,b!,'yahoo');if(!result.prices.length)throw Error('Yahoo returned no rows');used='yahoo'}}else result=await stock(t,a!,b!,requested);return json({ok:true,provider:used,requestedProvider:requested,source:requested==='idx'?'Official IDX API':used==='remote-csv'?'Community daily CSV (IDX-derived via imq21; not official IDX API)':'Yahoo Finance (third-party historical)',sourceTimestamp:'',...result})}
  return env.ASSETS.fetch(req);
}catch(e){console.error(e);return json({ok:false,error:e instanceof Error?e.message:String(e)},502)}}};
