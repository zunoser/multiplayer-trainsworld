import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {playwright,ARTIFACTS,buildLine} from './lib.mjs';
const {chromium}=await playwright();
const browser=await chromium.launch({headless:true,executablePath:process.env.TW_CHROME??'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const base=process.argv[2]??'http://127.0.0.1:5173/';
try {
 const errors=[];
 async function fresh(){const ctx=await browser.newContext({viewport:{width:1280,height:950}});await ctx.addInitScript(()=>Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>2}));const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));await p.goto(base+'?debug=1&new=1&paused=1&city=tyo&lang=ja');await p.waitForFunction(()=>window.tw?.world.peek()&&window.tw.client.running,null,{timeout:120000});await p.evaluate(async password=>{window.tw.clock.setRunning(false);await window.tw.multiplayer.loginMultiplayer(password);},process.env.ROOM_PASSWORD??'local-test-password');return p;}
 async function ready(p){await p.waitForFunction(()=>{const s=window.tw.multiplayer.multiplayer.peek();return s.status==='connected'&&s.room.members.some(m=>m.id===s.self&&m.ready)&&s.room.members.some(m=>m.id===s.room.host&&m.ready);},null,{timeout:120000});}
 const state=p=>p.evaluate(()=>window.tw.multiplayer.multiplayer.peek());
 const host=await fresh();await host.evaluate(()=>window.tw.multiplayer.connectMultiplayer('Alpha',undefined,'versus'));await ready(host);
 const code=(await state(host)).code;
 const guest=await fresh();await guest.evaluate(code=>window.tw.multiplayer.connectMultiplayer('Beta',code),code);await ready(guest);
 const own=p=>p.evaluate(()=>{const s=window.tw.multiplayer.multiplayer.peek();return s.room.members.find(m=>m.id===s.self).company;});
 const aid=await own(host),bid=await own(guest);assert.notEqual(aid,bid);
 // Both players build railways in the same map, with distinct wallets and ownership.
 const a=await buildLine(host,[[139.74,35.68],[139.76,35.68]],{name:'Alpha Line',trains:[2,2,2]});assert.equal(a.ok,true,JSON.stringify(a));
 const b=await buildLine(guest,[[139.74,35.70],[139.76,35.70]],{name:'Beta Line',trains:[2,2,2]});assert.equal(b.ok,true,JSON.stringify(b));
 await guest.waitForFunction(()=>window.tw.world.peek().save.lines.length===2);

 const aStops=await host.evaluate(id=>window.tw.world.peek().save.lines.find(l=>Number(l.id)===id).stops.map(Number),a.line);
 const stolen=await guest.evaluate(line=>window.tw.client.edit({op:'lineLook',line,name:'Stolen'}),a.line);assert.equal(stolen.ok,false);
 const station=await guest.evaluate(node=>window.tw.client.edit({op:'stationName',node,name:'Stolen'}),aStops[0]);assert.equal(station.ok,false);
 assert.equal((await guest.evaluate(line=>window.tw.client.edit({op:'lineLook',line,name:'Beta Express'}),b.line)).ok,true);
 await guest.keyboard.press('f');await guest.getByRole('region',{name:'会社ランキング'}).waitFor();
 let rows=await guest.locator('.company-table tbody tr').allTextContents();assert.equal(rows.length,2);assert(rows.some(s=>s.includes('Alpha'))&&rows.some(s=>s.includes('Beta')));
 await mkdir(ARTIFACTS,{recursive:true});await guest.screenshot({path:ARTIFACTS+'/multiplayer-company-competition.png'});
 console.log('PASS distinct company wallets, owned railway construction, server-enforced edit isolation and standings');
 const before=await host.evaluate(async()=>{const m=window.tw.multiplayer;return m.readCooperativeContext();});
 assert.equal(before.competition.companies.length,2);
 assert(before.competition.companies.every(c=>c.cash<10000&&c.spent>0));
 const aWallet=before.competition.companies.find(c=>c.id===aid).cash;
 // Spending on Beta's fleet must not debit Alpha's wallet while the world is paused.
 assert.equal((await guest.evaluate(line=>window.tw.client.edit({op:'setTrainCount',line,trains:[3,3,3]}),b.line)).ok,true);
 const after=await host.evaluate(async()=>{const m=window.tw.multiplayer;return m.readCooperativeContext();});
 assert.equal(after.competition.companies.find(c=>c.id===aid).cash,aWallet);
 assert(after.competition.companies.find(c=>c.id===bid).cash<before.competition.companies.find(c=>c.id===bid).cash);
 // Settling one game hour charges each owner their own infrastructure maintenance.
 await host.evaluate(async()=>{const m=window.tw.multiplayer;const c=await m.readCooperativeContext();window.tw.clock.held.value=false;window.tw.clock.set(c.clock+3600);window.tw.clock.setRunning(true);});
 await guest.waitForFunction(()=>window.tw.clock.running.peek());
 await host.evaluate(()=>window.tw.clock.setRunning(false));
 await host.waitForFunction(async()=>{const m=window.tw.multiplayer;const c=await m.readCooperativeContext();return c.competition.companies.every(c=>c.upkeep>0);});
 await host.evaluate(()=>window.tw.multiplayer.leaveMultiplayer());
 await guest.waitForFunction(()=>{const s=window.tw.multiplayer.multiplayer.peek();return s.room.host===s.self;});
 await host.evaluate(code=>window.tw.multiplayer.connectMultiplayer('Alpha',code),code);await ready(host);assert.equal(await own(host),aid);
 await guest.evaluate(()=>window.tw.multiplayer.leaveMultiplayer());await host.evaluate(()=>window.tw.multiplayer.leaveMultiplayer());
 await host.evaluate(code=>window.tw.multiplayer.connectMultiplayer('Alpha',code),code);await ready(host);assert.equal(await own(host),aid);
 assert.equal(await host.evaluate(()=>window.tw.world.peek().save.lines.length),2);
 assert.deepEqual(errors,[]);
 console.log('PASS isolated fleet charges, maintenance, automatic host transfer and company/world recovery after all leave');
}finally{await browser.close();}
