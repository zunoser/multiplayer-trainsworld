// Upload the exact Vite build through the Workers Static Assets API. No Wrangler project is required.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
const TYPES={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.otf':'font/otf','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8','.pbf':'application/x-protobuf','.mp3':'audio/mpeg','.ogg':'audio/ogg'};
const contentType=file=>TYPES[extname(file).toLowerCase()]??'application/octet-stream';
const root=resolve(new URL('../app/dist/',import.meta.url).pathname);
async function files(dir){const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,entry.name);if(entry.isDirectory())out.push(...await files(p));else if(entry.isFile())out.push(p);}return out;}
async function manifest(){const result={},paths={};for(const file of await files(root)){const bytes=await readFile(file);if(bytes.length>25*1024*1024)throw new Error('Asset exceeds 25 MiB');const hash=createHash('sha256').update(contentType(file)).update('\0').update(bytes).digest('hex').slice(0,32);result['/'+relative(root,file).split('\\').join('/')]={hash,size:bytes.length};paths[hash]=file;}return {manifest:result,paths};}
const [mode, input, output]=process.argv.slice(2);
if(mode==='manifest') {
 const m=await manifest();await writeFile(input,JSON.stringify(m));console.log(`Prepared ${Object.keys(m.manifest).length} static assets`);
}else if(mode==='upload'){
 const data=JSON.parse(await readFile(input,'utf8'));
 let complete=data.session.jwt;
 const api=`https://api.cloudflare.com/client/v4/accounts/${data.account}/workers/assets/upload?base64=true`;
 for(let i=0;i<data.session.buckets.length;i++){
  const form=new FormData();
  for(const hash of data.session.buckets[i]){const file=data.paths[hash];if(!file)throw new Error('Unknown asset requested');const bytes=await readFile(file);form.append(hash,new Blob([bytes.toString('base64')],{type:contentType(file)}),hash);}
  const response=await fetch(api,{method:'POST',headers:{Authorization:`Bearer ${data.session.jwt}`},body:form});
  const r=await response.json();if(!response.ok||r.success===false)throw new Error(`Asset upload failed (${response.status}): ${JSON.stringify(r.errors)}`);
  if(r.result?.jwt)complete=r.result.jwt;
  console.log(`Uploaded asset bucket ${i+1}/${data.session.buckets.length}`);
 }
 await writeFile(output,JSON.stringify({jwt:complete}),{mode:0o600});
}else throw new Error('Usage: node assets.mjs manifest <manifest.json> | upload <session.json> <completion.json>');
