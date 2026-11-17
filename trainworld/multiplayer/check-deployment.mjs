import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

export async function checkDeployment(base, {request=fetch, wasmNames, attempts=31, wait=delay}={}) {
  base=new URL(base);
  wasmNames??=(await readdir(new URL('../app/dist/assets/',import.meta.url))).filter(name=>name.endsWith('.wasm'));
  for(let attempt=0;attempt<attempts;attempt++) {
    try {
      const html=await request(base,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});
      assert.equal(html.status,200);assert.match(html.headers.get('Content-Type')??'',/^text\/html\b/);
      const source=await html.text();
      const urls=[...source.matchAll(/(?:src|href)="(\.\/assets\/[^" ]+\.(?:js|css))"/g)].map(m=>new URL(m[1],base));
      urls.push(...wasmNames.map(name=>new URL('assets/'+name,base)));
      assert(urls.some(u=>u.pathname.endsWith('.js'))&&urls.some(u=>u.pathname.endsWith('.css'))&&urls.some(u=>u.pathname.endsWith('.wasm')));
      await Promise.all(urls.map(async url=>{
        const response=await request(url,{method:'HEAD',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});
        assert.equal(response.status,200,url.href);
        const type=response.headers.get('Content-Type')??'';
        assert(url.pathname.endsWith('.js')?/javascript/.test(type):url.pathname.endsWith('.css')?/text\/css/.test(type):/application\/wasm/.test(type),url.pathname+': '+type);
      }));
      const health=await request(new URL('health',base),{signal:AbortSignal.timeout(15000)});
      assert.equal(health.status,200);assert.equal((await health.json()).protocol,2);
      return urls.length;
    } catch(error) {
      if(attempt===attempts-1)throw error;
      if(attempt===0)console.log('Waiting for the deployed HTML and assets to become available together');
      await wait(2000);
    }
  }
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  const count=await checkDeployment(process.argv[2]??'https://trains.aomona.me/');
  console.log('PASS production HTML, JavaScript, CSS, WASM MIME types and health ('+count+' assets)');
}
