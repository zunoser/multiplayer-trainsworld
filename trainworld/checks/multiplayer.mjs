import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { playwright, ARTIFACTS, buildLine } from './lib.mjs';
const { chromium }=await playwright();
const browser=await chromium.launch({headless:true,...(process.env.TW_CHROME?{executablePath:process.env.TW_CHROME}:{}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const base=process.argv[2]??'http://127.0.0.1:5173/';
const password=process.env.ROOM_PASSWORD??'local-test-password';
const errors=[];
try {
  async function pageFor(name) {
    const ctx=await browser.newContext({viewport:{width:1280,height:900}});
    await ctx.addInitScript(()=>Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>2}));
    const page=await ctx.newPage();page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(base+'?continue=1&debug=1&paused=1&lang=ja');
    await page.waitForFunction(()=>window.tw?.world.peek()&&window.tw.client.running,null,{timeout:120_000});
    await page.evaluate(()=>{window.tw.clock.setRunning(false);window.tw.client.post({kind:'sandbox'});window.tw.client.post({kind:'saveSlot',action:'create',name:'Solo world'});});
    await page.waitForFunction(()=>window.tw.lastSaved.peek()>0);
    await service(page,'loginMultiplayer',password);
    assert.equal((await service(page,'state')).authenticated,true,'shared access password must authenticate');
    return page;
  }
  async function service(page,method,...args) {
    return page.evaluate(async({method,args})=>{const m=window.tw.multiplayer;return method==='state'?m.multiplayer.peek():m[method](...args);},{method,args});
  }
  async function ready(page) {
    await page.waitForFunction(()=>{const s=window.tw.multiplayer.multiplayer.peek();return s.status!=='connecting';},null,{timeout:120_000});
    const s=await service(page,'state');assert.equal(s.status,'connected',JSON.stringify(s));
    await page.waitForFunction(()=>{const s=window.tw.multiplayer.multiplayer.peek();return s.room.members.some(m=>m.id===s.self&&m.ready)&&s.room.members.some(m=>m.id===s.room.host&&m.ready);},null,{timeout:120_000});
  }
  async function original(page) {
    return page.evaluate(async()=>{
      const key=localStorage.getItem('anitabuilder-save-slot');
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('anitabuilder',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const record=await new Promise((resolve,reject)=>{const r=db.transaction('saves').objectStore('saves').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();
      return {key,at:record.at,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',record.bytes)))};
    });
  }
  const host=await pageFor('Alice'),guest=await pageFor('Bob');
  const seed=await buildLine(host,[[14,25],[14.01,25],[14.02,25]],{name:'Original seed'});assert.equal(seed.ok,true);
  assert.equal((await host.evaluate(id=>window.tw.client.edit({op:'removeLine',line:id}),seed.line)).ok,true);
  await service(host,'connectMultiplayer','Alice');await ready(host);
  const room=(await service(host,'state')).code;
  await service(guest,'connectMultiplayer','Bob',room);await ready(guest);
  const originals=await Promise.all([host,guest].map(original));
  console.log('PASS password access and sparse-ID room bootstrap');
  const [a,b]=await Promise.all([
    buildLine(host,[[15,25],[15.01,25],[15.02,25]],{name:'Alice railway'}),
    buildLine(guest,[[15.1,25],[15.11,25],[15.12,25]],{name:'Bob railway'}),
  ]);
  for(const result of [a,b])assert(result.line!==undefined&&(result.ok||result.issues.every(i=>i==='NothingToConstruct')),JSON.stringify(result));
  for(const page of [host,guest])await page.waitForFunction(()=>window.tw.world.peek().save.lines.some(l=>l.name==='Alice railway')&&window.tw.world.peek().save.lines.some(l=>l.name==='Bob railway'),null,{timeout:120_000});
  console.log('PASS concurrent building, both networks visible without checkpoint reload');
  await host.mouse.move(600,400);
  await host.keyboard.press('/');
  const chat=host.getByRole('textbox',{name:'カーソル会話',exact:true});await chat.waitFor({state:'visible'});
  await chat.fill('この駅からつなごう');await chat.press('Enter');
  await guest.locator('.shared-cursor .cursor-chat-bubble').filter({hasText:'この駅からつなごう'}).waitFor({state:'visible'});
  assert.equal(await guest.locator('.shared-cursor-name').filter({hasText:'Alice'}).count(),1);
  await mkdir(ARTIFACTS,{recursive:true});await guest.screenshot({path:ARTIFACTS+'/multiplayer-cursor-chat.png'});
  console.log('PASS named live cursors and slash cursor chat');
  const start=Date.now();
  await Promise.all([
    host.evaluate(id=>window.tw.client.edit({op:'lineLook',line:id,name:'Realtime witness'}),a.line),
    guest.evaluate(id=>window.tw.client.edit({op:'lineLook',line:id,colour:'#245abc'}),a.line),
  ]);
  for(const page of [host,guest])await page.waitForFunction(()=>window.tw.world.peek().save.lines.some(l=>l.name==='Realtime witness'&&l.colour==='#245abc'),null,{timeout:20_000});
  const latency=Date.now()-start;assert(latency<5000,'real-time propagation should not wait for a 10-second checkpoint');
  console.log(`PASS concurrent property edits; observed completion ${latency} ms`);
  const late=await pageFor('Charlie');await service(late,'connectMultiplayer','Charlie',room);await ready(late);
  await late.waitForFunction(()=>window.tw.world.peek().save.lines.some(l=>l.name==='Realtime witness'&&l.colour==='#245abc'));
  console.log('PASS late joining replays committed operations');
  await host.evaluate(()=>{window.tw.clock.held.value=false;window.tw.clock.setRunning(true);});
  await guest.evaluate(()=>{window.tw.clock.held.value=false;});
  await guest.waitForFunction(()=>window.tw.clock.running.peek(),null,{timeout:10_000});
  const times=await Promise.all([host,guest].map(page=>page.evaluate(()=>window.tw.clock.now())));assert(Math.abs(times[0]-times[1])<180);
  await host.evaluate(()=>window.tw.clock.setRunning(false));
  assert.deepEqual(await Promise.all([host,guest].map(original)),originals,'original local saves must remain untouched');
  await host.getByRole('button',{name:'設定',exact:true}).click();await host.getByRole('region',{name:'協力プレイ'}).waitFor();
  await mkdir(ARTIFACTS,{recursive:true});await host.screenshot({path:ARTIFACTS+'/multiplayer-realtime-ja.png'});
  await host.context().close();
  await guest.waitForFunction(()=>window.tw.multiplayer.multiplayer.peek().room?.host===null);
  await service(guest,'claimBuilder');await ready(guest);
  const renamed=await guest.evaluate(id=>window.tw.client.edit({op:'lineLook',line:id,name:'After recovery'}),b.line);assert.equal(renamed.ok,true);
  await late.waitForFunction(()=>window.tw.world.peek().save.lines.some(l=>l.name==='After recovery'));
  await service(guest,'leaveMultiplayer');assert.equal((await service(guest,'state')).status,'offline');
  assert.deepEqual(errors,[]);
  console.log('PASS shared clock, local save preservation, Japanese UI, host recovery and leave');
} finally {await browser.close();}
