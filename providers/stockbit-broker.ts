const STOCKBIT_BASE='https://exodus.stockbit.com';

function stockbitToken(){return (envGet('STOCKBIT_ACCESS_TOKEN')||'').trim()}

function stockbitHeaders(){const token=stockbitToken();if(!token)throw Error('Stockbit broker source belum dikonfigurasi. Set Cloudflare secret STOCKBIT_ACCESS_TOKEN.');return {Accept:'application/json','Authorization':`Bearer ${token}`,'Origin':'https://stockbit.com','Referer':'https://stockbit.com/','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36'}}

function num(v:any){const n=Number(v);return Number.isFinite(n)?n:0}

function stockbitBrokerRows(payload:any,ticker:string,date:string){
  const bs=payload?.data?.broker_summary||{};
  const map=new Map<string,any>();
  const add=(r:any,side:'buy'|'sell')=>{
    const code=String(r?.netbs_broker_code||r?.broker_code||r?.code||'').trim().toUpperCase();
    if(!code)return;
    const x=map.get(code)||{date,ticker,broker:code,buyValue:0,sellValue:0,buyVolume:0,sellVolume:0,investorType:r?.type||''};
    if(side==='buy'){x.buyValue+=Math.max(0,num(r?.bval));x.buyVolume+=Math.max(0,num(r?.blot));}
    else {x.sellValue+=Math.abs(num(r?.sval));x.sellVolume+=Math.abs(num(r?.slot));}
    map.set(code,x);
  };
  (Array.isArray(bs.brokers_buy)?bs.brokers_buy:[]).forEach((r:any)=>add(r,'buy'));
  (Array.isArray(bs.brokers_sell)?bs.brokers_sell:[]).forEach((r:any)=>add(r,'sell'));
  return [...map.values()];
}

export async function stockbitBrokerSummary(ticker:string,dates:string[]){
  const token=stockbitToken();if(!token)throw Error('Stockbit broker source belum dikonfigurasi. Set Cloudflare secret STOCKBIT_ACCESS_TOKEN.');
  const unique=[...new Set(dates.map(x=>x.slice(0,10)).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)))].slice(-10);
  const out:any[]=[];
  for(let i=0;i<unique.length;i+=5){
    const batch=unique.slice(i,i+5).map(async date=>{
      const q=new URLSearchParams({transaction_type:'TRANSACTION_TYPE_NET',market_board:'MARKET_BOARD_REGULER',investor_type:'INVESTOR_TYPE_ALL',limit:'100',from:date,to:date});
      const res=await fetch(`${STOCKBIT_BASE}/marketdetectors/${encodeURIComponent(ticker.toUpperCase())}?${q.toString()}`,{headers:stockbitHeaders()});
      if(res.status===401||res.status===403)throw Error(`Stockbit broker authentication failed (HTTP ${res.status}). Refresh STOCKBIT_ACCESS_TOKEN.`);
      if(!res.ok)throw Error(`Stockbit broker HTTP ${res.status}`);
      const payload=await res.json();
      return stockbitBrokerRows(payload,ticker.toUpperCase(),date);
    });
    const results=await Promise.all(batch);
    results.forEach(rows=>out.push(...rows));
  }
  return out;
}
