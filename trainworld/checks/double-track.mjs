import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {playwright,ARTIFACTS} from './lib.mjs';
const {chromium}=await playwright();
const browser=await chromium.launch({headless:true,executablePath:process.env.TW_CHROME??'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const base=process.argv[2]??'http://127.0.0.1:5173/';
const password=process.env.ROOM_PASSWORD??'local-test-password';
try {
 async function page(){const c=await browser.newContext({viewport:{width:1280,height:900}});await c.addInitScript(()=>Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>2}));const p=await c.newPage();await p.goto(base+'?debug=1&continue=1&paused=1&lang=ja');await p.waitForFunction(()=>window.tw?.world.peek()&&window.tw.client.running);await p.evaluate(async password=>{window.tw.clock.setRunning(false);window.tw.client.post({kind:'sandbox'});await window.tw.multiplayer.loginMultiplayer(password);},password);return p;}
 async function ready(p){await p.waitForFunction(()=>{const s=window.tw.multiplayer.multiplayer.peek();return s.status==='connected'&&s.room.members.some(m=>m.id===s.self&&m.ready)&&s.room.members.some(m=>m.id===s.room.host&&m.ready);},null,{timeout:120000});}
 const host=await page();await host.evaluate(()=>window.tw.multiplayer.connectMultiplayer('Host'));await ready(host);
 const code=await host.evaluate(()=>window.tw.multiplayer.multiplayer.peek().code);
 const guest=await page();await guest.evaluate(code=>window.tw.multiplayer.connectMultiplayer('Guest',code),code);await ready(guest);
 // Draw one single track and one double track, then exercise both conversion paths.
 const ids=await host.evaluate(async()=>{
  const t=window.tw,c=t.client;
  for(const [lat,single] of [[25,true],[25.03,false]]){
   const a=t.lngLatToPack(14,lat),b=t.lngLatToPack(14.05,lat);
   const r=await c.edit({op:'route',from:{kind:'free',...a,level:-1},to:{kind:'free',...b,level:-1},pis:[],single});if(!r.ok)throw Error(JSON.stringify(r));
  }
  return t.world.peek().edges.map(e=>e.id);
 });
 await guest.waitForFunction(ids=>ids.every(id=>window.tw.world.peek().edges.some(e=>e.id===id)),ids);
 const single=await host.evaluate(ids=>ids.find(id=>window.tw.world.peek().edges.find(e=>e.id===id)?.tracks===1),ids);assert.notEqual(single,undefined);
 assert.equal((await guest.evaluate(edge=>window.tw.client.edit({op:'edgesTracks',edges:[edge],tracks:2}),single)).ok,true);
 await host.waitForFunction(edge=>window.tw.world.peek().edges.find(e=>e.id===edge)?.tracks===2,single);
 const built=await host.evaluate(edges=>window.tw.client.edit({op:'construct',edges,stations:[]}),ids);assert.equal(built.ok,true,JSON.stringify(built));
 assert.equal((await guest.evaluate(edge=>window.tw.client.edit({op:'rebuild',edges:[edge],stations:[],level:null,kind:0,tracks:1}),single)).ok,true);
 assert.equal((await host.evaluate(edge=>window.tw.client.edit({op:'rebuild',edges:[edge],stations:[],level:null,kind:0,tracks:2}),single)).ok,true);
 await guest.waitForFunction(edge=>{const e=window.tw.world.peek().edges.find(e=>e.id===edge);return e?.built&&e.tracks===2;},single);
 const late=await page();await late.evaluate(code=>window.tw.multiplayer.connectMultiplayer('Late',code),code);await ready(late);
 assert.equal(await late.evaluate(edge=>window.tw.world.peek().edges.find(e=>e.id===edge)?.tracks,single),2);
 await host.context().close();await guest.waitForFunction(()=>{const s=window.tw.multiplayer.multiplayer.peek();return s.room.host===s.self;});
 assert.equal(await guest.evaluate(edge=>window.tw.world.peek().edges.find(e=>e.id===edge)?.tracks,single),2);
 // The original toolbar controls retain their icons and now have visible track-count labels.
 await guest.keyboard.press('1');
 const bar=guest.getByRole('group',{name:'線路',exact:true});
 await bar.getByRole('button',{name:'単線',exact:true}).click();
 await bar.getByRole('button',{name:'複線',exact:true}).click();
 assert.equal(await bar.getByRole('button',{name:'複線',exact:true}).getAttribute('aria-pressed'),'true');
 await mkdir(ARTIFACTS,{recursive:true});await guest.screenshot({path:ARTIFACTS+'/multiplayer-double-track.png'});
 console.log('PASS single/double construction, blueprint and built conversion, late join, host transfer, and labeled controls');
}finally{await browser.close();}
