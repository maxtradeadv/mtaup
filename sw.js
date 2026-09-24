const CACHE='stock-flow-v37';
const ASSETS=[
  './styles.css?v=20260923d',
  './analysis.js?v=20260923d',
  './data-provider.js?v=20260923d',
  './calibration.js?v=20260923d',
  './app.js?v=20260924a',
  './manifest.webmanifest?v=10',
  './icon.svg?v=10',
  './icon-180.png?v=10'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const u=new URL(event.request.url);
  if(u.pathname.endsWith('/sw.js'))return;
  event.respondWith(
    fetch(event.request,{cache:'no-store'}).then(response=>{
      if(response.ok)caches.open(CACHE).then(c=>c.put(event.request,response.clone())).catch(()=>{});
      return response;
    }).catch(()=>caches.match(event.request))
  );
});