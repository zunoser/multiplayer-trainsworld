import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
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
 // Quotes exclude opponents and disabled pieces, and match the actual debit.
 const planned=await host.evaluate(async()=>{
  const t=window.tw, before=new Set(t.world.peek().edges.map(e=>e.id));
  const from={kind:'free',...t.lngLatToPack(139.80,35.72),level:-1};
  const to={kind:'free',...t.lngLatToPack(139.81,35.72),level:-1};
  const r=await t.client.edit({op:'route',from,to,pis:[],single:false});
  if(!r.ok)throw Error(JSON.stringify(r));
  return t.world.peek().edges.filter(e=>!before.has(e.id)).map(e=>e.id);
 });
 await guest.waitForFunction(ids=>ids.every(id=>window.tw.world.peek().edges.some(e=>e.id===id)),planned);
 const quote=await host.evaluate(company=>window.tw.client.query({what:'companyQuote',company}).then(d=>Array.from(d)),aid);
 const theirs=await guest.evaluate(company=>window.tw.client.query({what:'companyQuote',company}).then(d=>Array.from(d)),bid);
 assert(quote[0]>0);assert.equal(theirs.reduce((a,b)=>a+b,0),0);
 assert.equal((await host.evaluate(edges=>window.tw.client.edit({op:'blueprintOff',edges,stations:[],off:true}),planned)).ok,true);
 const offQuote=await host.evaluate(company=>window.tw.client.query({what:'companyQuote',company}).then(d=>Array.from(d)),aid);
 assert.equal(offQuote.reduce((a,b)=>a+b,0),0);
 await host.evaluate(edges=>window.tw.client.edit({op:'blueprintOff',edges,stations:[],off:false}),planned);
 const construction=await host.evaluate(()=>window.tw.client.edit({op:'constructAll'}));assert.equal(construction.ok,true);
 assert(Math.abs(construction.charge-quote.reduce((a,b)=>a+b,0))<1e-6);
 await guest.evaluate(line=>{window.tw.selection.value={kind:'line',line:String(line)};},a.line);
 assert(await guest.locator('#inspector fieldset[disabled]').count());
 await guest.keyboard.press('b');assert.equal(await guest.locator('.tool-ferry').isDisabled(),true);
 assert.equal(await guest.getByRole('button',{name:'元に戻す',exact:true}).isDisabled(),true);
 console.log('PASS company quote isolation, disabled blueprint pricing, charged total and read-only opponent inspector');
 const unaffordable=await guest.evaluate(async()=>{
  const t=window.tw,before=new Set(t.world.peek().edges.map(e=>e.id));
  const r=await t.client.edit({op:'route',from:{kind:'free',...t.lngLatToPack(139.9,35.8),level:-3},to:{kind:'free',...t.lngLatToPack(141.4,35.8),level:-3},pis:[],single:false});
  if(!r.ok)throw Error(JSON.stringify(r));return t.world.peek().edges.filter(e=>!before.has(e.id)).map(e=>e.id);
 });
 const poorQuote=await guest.evaluate(company=>window.tw.client.query({what:'companyQuote',company}).then(d=>Array.from(d)),bid);
 const walletBefore=await host.evaluate(()=>window.tw.multiplayer.readCooperativeContext());
 assert(poorQuote.reduce((a,b)=>a+b,0)>walletBefore.competition.companies.find(c=>c.id===bid).cash);
 await guest.waitForFunction(()=>document.querySelector('.blueprint-construct')?.disabled);
 const noMoney=await guest.evaluate(()=>window.tw.client.edit({op:'constructAll'}));assert.equal(noMoney.ok,false);
 const walletAfter=await host.evaluate(()=>window.tw.multiplayer.readCooperativeContext());
 for(const c of walletBefore.competition.companies)
  assert.equal(walletAfter.competition.companies.find(next=>next.id===c.id).cash,c.cash);
 assert.equal((await guest.evaluate(edges=>window.tw.client.edit({op:'removePieces',edges,stations:[]}),unaffordable)).ok,true);
 console.log('PASS unaffordable construction leaves every company wallet unchanged');
 const betaBackup=await guest.evaluate(()=>window.tw.multiplayer.roomBackup());
 await host.evaluate(()=>window.tw.multiplayer.leaveMultiplayer());
 await guest.waitForFunction(()=>{const s=window.tw.multiplayer.multiplayer.peek();return s.room.host===s.self;});
 await host.evaluate(code=>window.tw.multiplayer.connectMultiplayer('Alpha',code),code);await ready(host);assert.equal(await own(host),aid);
 await guest.evaluate(()=>window.tw.multiplayer.leaveMultiplayer());await host.evaluate(()=>window.tw.multiplayer.leaveMultiplayer());
 await host.evaluate(code=>window.tw.multiplayer.connectMultiplayer('Alpha',code),code);await ready(host);assert.equal(await own(host),aid);
 assert.equal(await host.evaluate(()=>window.tw.world.peek().save.lines.length),2);
 assert.deepEqual(errors,[]);
 console.log('PASS isolated fleet charges, maintenance, automatic host transfer and company/world recovery after all leave');
 const downloadPromise=host.waitForEvent('download');
 await host.getByRole('button',{name:'対戦をバックアップ',exact:true}).click();
 const download=await downloadPromise,backupBytes=await readFile(await download.path()),alphaBackup=JSON.parse(backupBytes);
 assert.equal(alphaBackup.archive.competition.companies.length,2);
 const ctx=await browser.newContext({viewport:{width:375,height:900}});
 await ctx.addInitScript(()=>Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>2}));
 const restored=await ctx.newPage();restored.on('pageerror',e=>errors.push(String(e)));
 await restored.goto(base+'?debug=1&lang=ja');
 await restored.getByLabel('参加用パスワード',{exact:true}).fill('local-test-password');
 await restored.getByRole('button',{name:'入る',exact:true}).click();
 await restored.locator('#multiplayer-lobby-root input[type=file]').setInputFiles({name:'room-backup.json',mimeType:'application/json',buffer:backupBytes});
 await restored.getByText('room-backup.json',{exact:true}).waitFor();
 assert.equal(await restored.getByRole('textbox',{name:'プレイヤー名',exact:true}).inputValue(),'Alpha');
 await restored.screenshot({path:ARTIFACTS+'/company-restore-mobile.png'});
 await restored.getByRole('button',{name:'ホストを開始',exact:true}).click();
 await restored.locator('#multiplayer-lobby-root').waitFor({state:'detached',timeout:180000});await ready(restored);
 assert.equal(await own(restored),aid);
 const newCode=(await state(restored)).code;assert.notEqual(newCode,code);
 assert.equal(await restored.evaluate(()=>window.tw.world.peek().save.lines.length),2);
 const recovered=await restored.evaluate(()=>window.tw.multiplayer.readCooperativeContext());
 assert.equal(recovered.rate,0);
 assert.equal(await restored.evaluate(()=>window.tw.clock.running.peek()),false);
 assert.deepEqual(recovered.competition.owners,alphaBackup.archive.competition.owners);
 for(const company of alphaBackup.archive.competition.companies)
  assert(Math.abs(recovered.competition.companies.find(c=>c.id===company.id).cash-company.cash)<1e-6);
 await guest.evaluate(code=>window.tw.multiplayer.connectMultiplayer('Beta',code),newCode);await ready(guest);
 assert.equal(await own(guest),bid);
 await guest.evaluate(()=>window.tw.multiplayer.leaveMultiplayer());
 const newDevice=await fresh();
 await newDevice.evaluate(({code,backup})=>window.tw.multiplayer.connectMultiplayer('Beta recovered',code,'versus',backup),{code:newCode,backup:betaBackup});
 await ready(newDevice);assert.equal(await own(newDevice),bid);
 assert.deepEqual(errors,[]);
 console.log('PASS downloaded room backup, mobile restore UI, original-browser recovery and new-device company recovery');
}finally{await browser.close();}
