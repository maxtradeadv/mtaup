window.MTAFundamental=(()=>{
  const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
  const num=x=>{
    if(x==null||x==='')return null;
    const n=Number(String(x).replace(/,/g,'').replace(/%/g,'').trim());
    return Number.isFinite(n)?n:null;
  };
  const band=(score)=>{
    if(score>=80)return {score,class:'purple',label:'SEHAT + MURAH'};
    if(score>=70)return {score,class:'green',label:'SEHAT'};
    if(score>=45)return {score,class:'yellow',label:'MODERAT'};
    if(score>=30)return {score,class:'orange',label:'LEMAH'};
    return {score,class:'red',label:'BURUK'};
  };
  const valueScore=(per,pbv)=>{
    let s=50;
    if(per!=null&&per>0){
      s=per<=5?100:per<=8?95:per<=12?85:per<=16?75:per<=22?60:per<=30?45:25;
    }else if(per!=null&&per<0)s=10;
    if(pbv!=null&&pbv>0){
      const p=pbv<=0.5?100:pbv<=1?95:pbv<=1.5?85:pbv<=2?75:pbv<=3?60:pbv<=5?45:25;
      s=(s+p)/2;
    }
    return s;
  };
  const scoreRow=x=>{
    const roe=num(x.roe),roa=num(x.roa),der=num(x.der),yoy=num(x.yoy),cfps=num(x.cfps),eps=num(x.eps),per=num(x.per),pbv=num(x.pbv);
    const profit=roe==null?50:clamp(roe<0?20+roe:40+roe*3.0);
    const asset=roa==null?50:clamp(roa<0?20+roa*2:35+roa*5);
    const value=valueScore(per,pbv);
    const debt=der==null?50:clamp(100-der*10);
    const growth=yoy==null?50:clamp(yoy<0?50+yoy*.7:55+yoy*.9);
    const cash=cfps==null||eps==null?50:(cfps>0&&eps>0?90:cfps>0?65:20);
    let score=.24*profit+.14*asset+.27*value+.14*debt+.11*growth+.10*cash;
    score=clamp(score);
    const cheap=(per!=null&&per>0&&per<=12)||(pbv!=null&&pbv>0&&pbv<=1.2);
    if(score>=80&&!cheap)score=79.9;
    return band(score);
  };
  const normalize=(rows)=>{
    const latest=new Map();
    (rows||[]).forEach(x=>{
      const t=String(x.ticker||'').toUpperCase().trim();
      if(!/^[A-Z0-9]{2,6}$/.test(t))return;
      const old=latest.get(t);
      if(!old||String(x.asOf||'')>String(old.asOf||''))latest.set(t,x);
    });
    return [...latest.values()].map(x=>{
      const c=scoreRow(x);
      return {...x,score:Math.round(c.score*10)/10,class:c.class,label:c.label};
    }).sort((a,b)=>a.ticker.localeCompare(b.ticker));
  };
  let cache={at:0,data:null};
  async function load(baseUrl=window.location.origin,force=false){
    if(!force&&cache.data&&Date.now()-cache.at<6*60*60*1000)return cache.data;
    try{
      const res=await fetch(baseUrl+'/fundamental',{cache:'no-store'});
      const j=await res.json();
      if(!res.ok||!j.ok||!Array.isArray(j.data))throw Error(j.error||'Fundamental data kosong');
      const data=normalize(j.data);
      if(!data.length)throw Error('Fundamental data kosong');
      cache={at:Date.now(),data};
      try{localStorage.setItem('mta-fundamental-cache',JSON.stringify({at:Date.now(),data}))}catch{}
      return data;
    }catch(e){
      try{
        const x=JSON.parse(localStorage.getItem('mta-fundamental-cache')||'null');
        if(x?.data?.length)return normalize(x.data);
      }catch{}
      throw e;
    }
  }
  function get(map,ticker){return map?.get(String(ticker||'').toUpperCase())||null}
  return {load,normalize,get,band};
})();