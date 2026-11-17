import { fileURLToPath } from "node:url";
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { Miniflare } from './miniflare-v4.mjs';
const ORIGIN='https://game.test';
const snap={save:gzipSync('fixture').toString('base64'),ids:[1,0,0,0,0,0,0,0,0]};
const context={clock:100,cash:10000,fares:{base:1,perKm:1},ledger:[],rate:0};
async function fixture(t){
 const mf=new Miniflare({modules:true,scriptPath:fileURLToPath(new URL('./src/index.mjs',import.meta.url)),compatibilityDate:'2026-07-30',durableObjects:{ROOMS:{className:'RailwayRoom',useSQLite:true}},bindings:{ROOM_PASSWORD:'test-password'},cf:false});
 t.after(()=>mf.dispose());
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
 async function host(){const c=await connect();c.send({type:'create',protocol:2,name:'Host',snapshot:snap});const state=await c.next(m=>m.type==='welcome');c.send({type:'ready',revision:state.revision});await c.next(m=>m.type==='room'&&m.members.some(p=>p.id===state.self&&p.ready));return {c,state};}
 async function join(){const c=await connect();c.send({type:'join',protocol:2,name:'Guest'});const state=await c.next(m=>m.type==='welcome');c.send({type:'ready',revision:state.revision});const readyState=await c.next(m=>m.type==='room'&&m.members.some(p=>p.id===state.self&&p.ready));return {c,state,readyState};}
 const result=(request,ok=true)=>({type:'result',id:request.id,actor:request.actor,result:{answer:{ok,issues:[],charge:0},before:context,after:context}});
 return {mf,cookie,connect,host,join,result};
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
