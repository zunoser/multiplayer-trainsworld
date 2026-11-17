import { fileURLToPath } from "node:url";
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Miniflare } from './miniflare-v4.mjs';
const ORIGIN='https://game.test';
const snap={save:gzipSync('fixture').toString('base64'),ids:[1,0,0,0,0,0,0,0,0]};
const context={clock:100,cash:10000,fares:{base:1,perKm:1},ledger:[],rate:0};
async function fixture(t,options={}){
 const mf=new Miniflare({modules:['index.mjs','competition.mjs'].map(name=>({type:'ESModule',path:fileURLToPath(new URL('./src/'+name,import.meta.url))})),compatibilityDate:'2026-07-30',durableObjects:{ROOMS:{className:'RailwayRoom',useSQLite:true}},bindings:{ROOM_PASSWORD:'test-password'},cf:false,...options});
 let disposed=false;const dispose=async()=>{if(!disposed){disposed=true;await mf.dispose();}};
 t.after(dispose);
 const login=await mf.dispatchFetch(ORIGIN+'/api/login',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({password:'test-password'})});
 const cookie=login.headers.get('Set-Cookie').split(';')[0];
 async function connect(code='a'.repeat(40)){
  const r=await mf.dispatchFetch(ORIGIN+'/multiplayer?room='+code,{headers:{Origin:ORIGIN,Upgrade:'websocket',Cookie:cookie}});
  assert.equal(r.status,101);const ws=r.webSocket;ws.accept();
  const messages=[],waiters=[];let chunks=[],parts=0;
  function deliver(m){const i=waiters.findIndex(w=>w.match(m));if(i<0)messages.push(m);else{const [w]=waiters.splice(i,1);clearTimeout(w.timer);w.resolve(m);}}
  ws.addEventListener('message',e=>{if(e.data==='pong')return;const m=JSON.parse(e.data);if(m.type==='bootstrap'){parts=m.parts;chunks=[];}else if(m.type==='chunk'){chunks.push(m.data);if(chunks.length===parts)deliver(JSON.parse(chunks.join('')));}else deliver(m);});
  return {ws,send:m=>ws.send(JSON.stringify(m)),next(match){const i=messages.findIndex(match);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Message timeout')),4000);waiters.push({match,resolve,timer});});}};
 }
 async function host(options={}){const c=await connect();c.send({type:'create',protocol:2,name:'Host',snapshot:snap,...options});const state=await c.next(m=>m.type==='welcome');c.send({type:'ready',revision:state.revision});await c.next(m=>m.type==='room'&&m.members.some(p=>p.id===state.self&&p.ready));return {c,state};}
 async function join(options={}){const c=await connect();c.send({type:'join',protocol:2,name:'Guest',...options});const state=await c.next(m=>m.type==='welcome');c.send({type:'ready',revision:state.revision});const readyState=await c.next(m=>m.type==='room'&&m.members.some(p=>p.id===state.self&&p.ready));return {c,state,readyState};}
 const result=(request,ok=true)=>({type:'result',id:request.id,actor:request.actor,result:{answer:{ok,issues:[],charge:0},before:context,after:context}});
 return {mf,cookie,connect,host,join,result,dispose};
}
test('password and same-origin checks guard WebSocket access',async t=>{
 const f=await fixture(t);
 assert.equal((await f.mf.dispatchFetch(ORIGIN+'/multiplayer?room='+'a'.repeat(40),{headers:{Origin:ORIGIN,Upgrade:'websocket'}})).status,401);
 assert.equal((await f.mf.dispatchFetch(ORIGIN+'/api/login',{method:'POST',headers:{Origin:ORIGIN},body:JSON.stringify({password:'wrong'})})).status,401);
 assert.equal((await f.mf.dispatchFetch(ORIGIN+'/api/login',{method:'POST',headers:{Origin:'https://elsewhere.test'},body:JSON.stringify({password:'test-password'})})).status,403);
 const r=await f.mf.dispatchFetch(ORIGIN+'/api/session',{headers:{Cookie:f.cookie}});assert.equal((await r.json()).authenticated,true);
});
test('simultaneous edits are executed one at a time and broadcast in a single order',async t=>{
 const f=await fixture(t),h=await f.host(),g=await f.join();
 h.c.send({type:'command',id:'one',op:{op:'repay'}});g.c.send({type:'command',id:'two',op:{op:'repay'}});
 const one=await h.c.next(m=>m.type==='execute');assert(['one','two'].includes(one.id));h.c.send(f.result(one));
 const e=await g.c.next(m=>m.type==='commit');assert.equal(e.revision,2);
 const two=await h.c.next(m=>m.type==='execute');assert.notEqual(two.id,one.id);assert.equal(two.revision,2);h.c.send(f.result(two));
 assert.equal((await h.c.next(m=>m.type==='commit'&&m.id===two.id)).revision,3);
 const late=await f.join();assert.equal(late.state.events.length,2);assert.equal(late.state.revision,3);
});
test('spectators cannot forge host results; unknown operations are refused',async t=>{
 const f=await fixture(t),h=await f.host(),g=await f.join();
 g.c.send({type:'result',id:'fake',actor:g.state.self,result:{answer:{ok:true},before:context,after:context}});assert.equal((await g.c.next(m=>m.type==='error')).code,'host');
 g.c.send({type:'command',id:'panic',op:{op:'debugPanic'}});assert.equal((await g.c.next(m=>m.type==='error')).code,'message');
});
test('checkpoint compaction retains the latest world for late joiners',async t=>{
 const f=await fixture(t),h=await f.host();h.c.send({type:'command',id:'one',op:{op:'repay'}});const request=await h.c.next(m=>m.type==='execute');
 const next={...snap,save:gzipSync('new world').toString('base64')};h.c.send({...f.result(request),snapshot:next});await h.c.next(m=>m.type==='commit');
 const g=await f.join();assert.equal(g.state.baseRevision,2);assert.equal(g.state.snapshot.save,next.save);assert.equal(g.state.events.length,0);
});
test('disconnect automatically transfers the host to a ready participant',async t=>{
 const f=await fixture(t),h=await f.host(),g=await f.join();await f.join();h.c.ws.close(1000,'bye');const state=await g.c.next(m=>m.type==='room'&&m.host===g.state.self);assert.equal(state.host,g.state.self);
 g.c.send({type:'command',id:'after',op:{op:'repay'}});const r=await g.c.next(m=>m.type==='execute');g.c.send(f.result(r));assert.equal((await g.c.next(m=>m.type==='commit')).revision,2);
});

test('cursors and chat use authenticated participant identities without changing the world revision',async t=>{
 const f=await fixture(t),h=await f.host(),g=await f.join();
 g.c.send({type:'cursor',id:'forged',name:'Forged',lng:15,lat:25,text:'hello'});
 const cursor=await h.c.next(m=>m.type==='cursor');
 assert.equal(cursor.id,g.state.self);assert.equal(cursor.name,'Guest');assert.equal(cursor.cursor.text,'hello');
 g.c.send({type:'cursor',hidden:true});assert.equal((await h.c.next(m=>m.type==='cursor')).cursor,null);
 const late=await f.join();assert.equal(late.state.revision,1);assert.equal(late.state.events.length,0);
});

test('the same code restores the checkpoint and journal after everyone leaves',async t=>{
 const f=await fixture(t),h=await f.host(),g=await f.join();
 h.c.send({type:'command',id:'saved',op:{op:'repay'}});
 const request=await h.c.next(m=>m.type==='execute');h.c.send(f.result(request));
 await g.c.next(m=>m.type==='commit'&&m.id==='saved');
 h.c.ws.close(1000,'bye');await g.c.next(m=>m.type==='room'&&m.host===g.state.self);
 await new Promise(resolve=>{g.c.ws.addEventListener('close',resolve,{once:true});g.c.ws.close(1000,'bye');});
 const back=await f.join();assert.equal(back.state.host,null);
 assert.equal(back.state.snapshot.save,snap.save);assert.equal(back.state.revision,2);
 assert.equal(back.state.events[0].id,'saved');
 assert.equal(back.readyState.host,back.state.self);
 back.c.send({type:'command',id:'resumed',op:{op:'repay'}});
 const next=await back.c.next(m=>m.type==='execute');back.c.send(f.result(next));
 assert.equal((await back.c.next(m=>m.type==='commit'&&m.id==='resumed')).revision,3);
});

test('handover preserves the running clock and retries an unconfirmed guest operation once',async t=>{
 const f=await fixture(t),h=await f.host(),g=await f.join();
 const running={...context,clock:234,rate:2};
 h.c.send({type:'time',revision:1,context:running});
 await g.c.next(m=>m.type==='time'&&m.context.clock===234);
 g.c.send({type:'command',id:'in-flight',op:{op:'repay'}});
 await h.c.next(m=>m.type==='execute'&&m.id==='in-flight');
 h.c.ws.close(1000,'bye');
 const time=await g.c.next(m=>m.type==='time');assert.deepEqual(time.context,running);
 await g.c.next(m=>m.type==='room'&&m.host===g.state.self);
 const retry=await g.c.next(m=>m.type==='execute'&&m.id==='in-flight');
 assert.equal(retry.revision,1);g.c.send(f.result(retry));
 assert.equal((await g.c.next(m=>m.type==='commit'&&m.id==='in-flight')).revision,2);
 const late=await f.join();assert.equal(late.state.events.length,1);
});


test('competitive rooms keep companies across reconnects and reject opponent edits',async t=>{
 const f=await fixture(t),key='host-key-123456789012345678901234567890';
 const h=await f.host({mode:'versus',companyKey:key,context});
 const g=await f.join({companyKey:'guest-key-123456789012345678901234567890'});
 const hc=h.state.company,gc=g.state.company;assert.notEqual(hc,gc);
 assert.equal(g.state.competition.companies.length,2);
 assert.equal(g.state.competition.companies[1].cash,10000);
 // The authenticated host reports the native model's new asset ownership.
 h.c.send({type:'command',id:'build',op:{op:'route',from:{kind:'free',x:0,y:0,level:0},to:{kind:'free',x:1,y:0,level:0},pis:[],single:false}});
 const request=await h.c.next(m=>m.type==='execute');assert.equal(request.company,hc);
 const before={...context,competition:g.state.competition};
 const after={...before,competition:{...before.competition,owners:{'edge:1':hc,'node:1':hc,'line:1':hc}}};
 h.c.send({type:'result',id:request.id,actor:request.actor,result:{answer:{ok:true,issues:[],charge:0},before,after}});
 await g.c.next(m=>m.type==='commit');
 for(const op of [{op:'removeEdge',edge:1},{op:'lineLook',line:1,name:'Stolen'},{op:'route',from:{kind:'node',node:1},to:{kind:'free',x:2,y:0,level:0},pis:[],single:true},{op:'undo'},{op:'fares',base:0,perKm:0}]){
  g.c.send({type:'command',company:hc,id:op.op,op});assert.equal((await g.c.next(m=>m.type==='error'&&m.id===op.op)).code,'ownership');
 }
 g.c.send({type:'command',id:'mine',op:{op:'constructAll'}});
 const own=await h.c.next(m=>m.type==='execute'&&m.id==='mine');assert.deepEqual(own.op,{op:'construct',edges:[],stations:[],buses:[],enabledOnly:true});
 h.c.ws.close(1000,'bye');await g.c.next(m=>m.type==='room'&&m.host===g.state.self);
 g.c.ws.close(1000,'bye');
 const returning=await f.join({companyKey:key});assert.equal(returning.state.company,hc);
 assert.equal(returning.state.competition.owners['edge:1'],hc);
 assert.equal(returning.state.competition.companies.length,2);
});
test('five companies remain reserved after disconnect and an existing company can return',async t=>{
 const f=await fixture(t);
 await f.host({mode:'versus',companyKey:'company-host-123456789012345678901234567890',context});
 const keys=Array.from({length:4},(_,i)=>`company-guest-${i}-123456789012345678901234567890`);
 let original;
 for(const companyKey of keys){
  const g=await f.join({companyKey});original??=g.state.company;
  await new Promise(resolve=>{g.c.ws.addEventListener('close',resolve,{once:true});g.c.ws.close(1000,'bye');});
 }
 const sixth=await f.connect();sixth.send({type:'join',protocol:2,name:'Sixth',companyKey:'sixth-company-123456789012345678901234567890'});
 assert.equal((await sixth.next(m=>m.type==='error')).code,'full');sixth.ws.close(1000,'bye');
 const back=await f.join({companyKey:keys[0]});
 assert.equal(back.state.company,original);assert.equal(back.state.competition.companies.length,5);
});
test('company backups restore confirmed journal, credentials and offline company balances into another room',async t=>{
 const f=await fixture(t),key='backup-host-123456789012345678901234567890';
 const h=await f.host({mode:'versus',companyKey:key,context});
 const g=await f.join({companyKey:'backup-guest-123456789012345678901234567890'});
 const competition=g.state.competition;
 h.c.send({type:'command',id:'archive-build',op:{op:'route',from:{kind:'free',x:0,y:0,level:0},to:{kind:'free',x:100,y:0,level:0},pis:[],single:false}});
 const request=await h.c.next(m=>m.type==='execute');
 const after={...context,competition:{companies:competition.companies.map(c=>({...c,cash:c.id===h.state.company?9000:c.cash})),owners:{}}};
 const before={...context,competition:{...competition,owners:{}},ownershipOmitted:true};
 after.ownershipOmitted=true;
 h.c.send({type:'result',id:request.id,actor:request.actor,result:{answer:{ok:true,issues:[],charge:1000},before,after,ownershipDelta:{'edge:7':h.state.company}}});
 await g.c.next(m=>m.type==='commit');
 g.c.send({type:'backup',id:'archive'});const packet=await g.c.next(m=>m.type==='roomBackup');
 assert.equal(packet.archive.events.length,1);assert.equal(packet.archive.competition.owners['edge:7'],h.state.company);
 assert.equal(packet.archive.competition.companies.find(c=>c.id===h.state.company).cash,9000);
 assert.equal(JSON.stringify(packet.archive).includes(key),false);
 const restored=await f.connect('b'.repeat(40));restored.send({type:'create',protocol:2,name:'Restored',mode:'versus',companyKey:key,restore:packet.archive});
 const welcome=await restored.next(m=>m.type==='welcome');
 assert.equal(welcome.company,h.state.company);assert.equal(welcome.competition.companies.length,2);
 assert.equal(welcome.events[0].id,'archive-build');assert.equal(welcome.time.rate,0);
 const bad=structuredClone(packet.archive);bad.credentials={'bad':'unknown'};
 const invalid=await f.connect('c'.repeat(40));invalid.send({type:'create',protocol:2,name:'Invalid',mode:'versus',companyKey:key,restore:bad});
 assert.equal((await invalid.next(m=>m.type==='error')).code,'backup');
});

test('ownership deltas cannot reassign or delete another company asset',async t=>{
 const f=await fixture(t),h=await f.host({mode:'versus',companyKey:'delta-host-123456789012345678901234567890',context});
 const g=await f.join({companyKey:'delta-guest-123456789012345678901234567890'});
 h.c.send({type:'command',id:'first',op:{op:'addBusLine',route:[],name:'Host',colour:'#123456'}});
 const first=await h.c.next(m=>m.type==='execute');
 const shared={...context,competition:{...g.state.competition,owners:{'edge:1':h.state.company}}};
 h.c.send({type:'result',id:first.id,actor:first.actor,result:{answer:{ok:true,issues:[],charge:0},before:shared,after:shared}});
 await g.c.next(m=>m.type==='commit');
 g.c.send({type:'command',id:'steal',op:{op:'addBusLine',route:[],name:'Guest',colour:'#123456'}});
 const request=await h.c.next(m=>m.type==='execute');
 h.c.send({type:'result',id:request.id,actor:request.actor,result:{answer:{ok:true,issues:[],charge:0},before:shared,after:shared,ownershipDelta:{'edge:1':g.state.company}}});
 assert.equal((await h.c.next(m=>m.type==='error')).code,'ownership');
});
test('competition checkpoint and journal survive a new Durable Object runtime',async t=>{
 const root=resolve(tmpdir());
 await mkdir(root,{recursive:true});const directory=await mkdtemp(resolve(root,'tw-state-'));
 if(!directory.startsWith(root+sep))throw Error('Invalid test storage directory');
 const options={resourcePersistencePath:directory};
 const f=await fixture(t,options),key='cold-host-123456789012345678901234567890';
 const h=await f.host({mode:'versus',companyKey:key,context});
 const g=await f.join({companyKey:'cold-guest-123456789012345678901234567890'});
 let companies=g.state.competition.companies;
 const packed=()=>({...context,ownershipOmitted:true,competition:{companies,owners:{}}});
 for(const [i,actor,company] of [[0,h.c,h.state.company],[1,g.c,g.state.company]]){
  actor.send({type:'command',id:'cold-'+i,op:{op:'addBusLine',route:[],name:'Route',colour:'#123456'}});
  const request=await h.c.next(m=>m.type==='execute');
  h.c.send({type:'result',id:request.id,actor:request.actor,...(i===0?{snapshot:{...snap,save:gzipSync('checkpoint world').toString('base64')}}:{}),result:{answer:{ok:true,issues:[],charge:0},before:packed(),after:packed(),ownershipDelta:{['line:'+i]:company}}});
  await g.c.next(m=>m.type==='commit'&&m.id==='cold-'+i);
 }
 await f.dispose();
 const fresh=await fixture(t,options);
 const back=await fresh.join({companyKey:key});
 assert.equal(back.state.company,h.state.company);
 assert.equal(back.state.baseRevision,2);assert.equal(back.state.revision,3);
 assert.equal(back.state.events.length,1);assert.equal(back.state.events[0].id,'cold-1');
 assert.equal(back.state.baseCompetition.owners['line:0'],h.state.company);
 assert.equal(back.state.baseCompetition.owners['line:1'],undefined);
 assert.equal(back.state.competition.owners['line:1'],g.state.company);
 await fresh.dispose();await rm(directory,{recursive:true,force:true});
});

test('large competitive rooms keep committed events bounded',async t=>{
 const f=await fixture(t),key='scale-host-123456789012345678901234567890';
 const h=await f.host({mode:'versus',companyKey:key,context});
 h.c.send({type:'backup',id:'seed'});const {archive}=await h.c.next(m=>m.type==='roomBackup');
 const companies=archive.competition.companies;
 const owners=Object.fromEntries(Array.from({length:10000},(_,i)=>['edge:'+i,h.state.company]));
 archive.competition={companies,owners};archive.baseCompetition={companies,owners};
 const large=await f.connect('d'.repeat(40));large.send({type:'create',protocol:2,name:'Large',mode:'versus',companyKey:key,restore:archive});
 const welcome=await large.next(m=>m.type==='welcome');large.send({type:'ready',revision:welcome.revision});
 await large.next(m=>m.type==='room'&&m.members.some(p=>p.ready));
 const contextSmall={...context,ownershipOmitted:true,competition:{companies,owners:{}}};
 const elapsed=[],bytes=[];
 for(let i=0;i<10;i++){
  large.send({type:'command',id:'scale-'+i,op:{op:'addBusLine',route:[],name:'New',colour:'#123456'}});
  const request=await large.next(m=>m.type==='execute');
  const result={answer:{ok:true,issues:[],charge:0},before:contextSmall,after:contextSmall,ownershipDelta:{['edge:'+(10000+i)]:h.state.company}};
  const started=performance.now();large.send({type:'result',id:request.id,actor:request.actor,result});
  const committed=await large.next(m=>m.type==='commit'&&m.id===request.id);
  elapsed.push(performance.now()-started);bytes.push(Buffer.byteLength(JSON.stringify(committed)));
 }
 assert(Math.max(...bytes)<4096);
 elapsed.sort((a,b)=>a-b);
 console.log('competition 10000-asset coordination benchmark',JSON.stringify({events:10,eventBytesMax:Math.max(...bytes),medianMs:elapsed[5],maxMs:elapsed[9]}));
});
test('a company joining during an outstanding command survives the result and checkpoint',async t=>{
 const f=await fixture(t),h=await f.host({mode:'versus',companyKey:'roster-host-123456789012345678901234567890',context});
 h.c.send({type:'command',id:'in-progress',op:{op:'addBusLine',route:[],name:'Route',colour:'#123456'}});
 const request=await h.c.next(m=>m.type==='execute');
 const g=await f.join({companyKey:'roster-guest-123456789012345678901234567890'});
 const old={...context,ownershipOmitted:true,competition:{...h.state.competition,owners:{}}};
 h.c.send({type:'result',id:request.id,actor:request.actor,snapshot:snap,result:{answer:{ok:true,issues:[],charge:0},before:old,after:old,ownershipDelta:{'line:1':h.state.company}}});
 const committed=await g.c.next(m=>m.type==='commit');
 assert.equal(committed.after.competition.companies.length,2);assert.equal(committed.after.cash,20000);
 const late=await f.join({companyKey:'roster-third-123456789012345678901234567890'});
 assert.equal(late.state.baseCompetition.companies.length,2);
 assert.equal(late.state.baseCompetition.owners['line:1'],h.state.company);
 assert.equal(late.state.time.competition.companies.length,3);assert.equal(late.state.time.cash,30000);
});
