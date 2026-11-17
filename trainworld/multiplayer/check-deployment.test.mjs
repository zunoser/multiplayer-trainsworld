import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkDeployment} from './check-deployment.mjs';

function fixture({failures=0,badMime=false}={}) {
  let rounds=0;
  return {get rounds(){return rounds;},async request(url) {
    const path=new URL(url).pathname;
    if(path==='/') {rounds++;return new Response('<script src="./assets/game.js"></script><link href="./assets/game.css">',{headers:{'Content-Type':'text/html'}});}
    if(path==='/health')return Response.json({protocol:2});
    if(path.endsWith('.js')&&rounds<=failures)return new Response(null,{status:404});
    const type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'application/wasm';
    return new Response(null,{headers:{'Content-Type':badMime?'text/plain':type}});
  }};
}
const options=f=>({request:f.request,wasmNames:['sim.wasm'],attempts:3,wait:async()=>{}});
test('retries the whole deployment check when new HTML precedes asset availability',async()=>{
  const f=fixture({failures:1});assert.equal(await checkDeployment('https://game.test/',options(f)),3);assert.equal(f.rounds,2);
});
test('persistent missing assets still fail after bounded retries',async()=>{
  const f=fixture({failures:99});await assert.rejects(checkDeployment('https://game.test/',options(f)),/404/);assert.equal(f.rounds,3);
});
test('assets with incorrect MIME types never pass the deployment check',async()=>{
  const f=fixture({badMime:true});await assert.rejects(checkDeployment('https://game.test/',options(f)),/text\/plain/);assert.equal(f.rounds,3);
});
