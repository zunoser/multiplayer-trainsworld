import { DurableObject } from 'cloudflare:workers';
const VERSION = 2;
const MAX_SAVE = 2 << 20, MAX_PACKET = 8 << 20, MAX_EVENT = 256 << 10;
const enc = new TextEncoder();
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers });
const token = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().slice(0, 8);
const opNames = new Set('route removeEdge edgePis moveNode addPoint moveNodes edgeLevel edgesLevel edgesKind edgesTracks rebuild removePieces flying stationUpgrade addStation crossover doubleUp oneWay stationProps stationTracks stationWay reverseStation stationName removeStation construct addBusLine busRoute busSpacing busHand busHandStop addFerryLine ferryRoute constructAll blueprintOff constructLine addLine copyLine setStops insertStop dropStop endLineAt stopPassed orderStops sortStops turnEnd openLoop setTrainCount setHeadway lineLook removeLine lineCars lineFast lineOneWay linePairs lineLimit lineGroup groupName groupLook fares fareScale fareRef fareHsr fareFerry fareBus fareTransfer borrow repay link addBuilding reshapeBuilding renameBuilding removeBuilding undo redo'.split(' '));
function validTree(v, depth = 0, budget = { n: 0 }) {
  if (++budget.n > 100_000 || depth > 10) return false;
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length <= 64_000;
  if (Array.isArray(v)) return v.every(x => validTree(x, depth + 1, budget));
  if (typeof v !== 'object') return false;
  return Object.entries(v).every(([k,x]) => !['__proto__','constructor','prototype'].includes(k) && validTree(x, depth + 1, budget));
}
function validSnapshot(s) {
  return s && typeof s.save === 'string' && s.save.length <= Math.ceil(MAX_SAVE / 3) * 4 && /^H4sI[A-Za-z0-9+/]*={0,2}$/.test(s.save)
    && Array.isArray(s.ids) && s.ids.length <= 1_000_009 && s.ids.every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000);
}
async function signature(secret, value) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value))), b=>b.toString(16).padStart(2,'0')).join('');
}
async function authenticated(request, env) {
  const match = /(?:^|; )tw_session=([0-9]+)\.([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('Cookie') ?? '');
  if (!match || Number(match[1]) < Date.now() || !env.ROOM_PASSWORD) return false;
  const expected = await signature(env.ROOM_PASSWORD, match[1]);
  let diff = 0; for (let i=0;i<expected.length;i++) diff |= expected.charCodeAt(i) ^ match[2].charCodeAt(i);
  return diff === 0;
}
export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === '/api/login' && request.method === 'POST') {
      if (request.headers.get('Origin') !== u.origin && request.headers.get('Origin') !== env.DEV_ORIGIN) return json({error:'origin'},403);
      if (!env.ROOM_PASSWORD) return json({error:'not_configured'},503);
      if (env.LOGIN_LIMIT && !(await env.LOGIN_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'local' })).success) return json({error:'rate'},429);
      if (Number(request.headers.get('Content-Length') ?? 0) > 2048) return json({error:'size'},413);
      let body; try { body=await request.text(); } catch { return json({error:'message'},400); }
      if (body.length > 2048) return json({error:'size'},413);
      let password; try { password=JSON.parse(body).password; } catch { return json({error:'message'},400); }
      if (typeof password !== 'string') return json({error:'password'},401);
      const actual = await signature(env.ROOM_PASSWORD, password), expected = await signature(env.ROOM_PASSWORD, env.ROOM_PASSWORD);
      let diff = 0; for(let i=0;i<actual.length;i++) diff |= actual.charCodeAt(i)^expected.charCodeAt(i);
      if(diff) return json({error:'password'},401);
      const expiry=String(Date.now()+7*86400_000), sig=await signature(env.ROOM_PASSWORD,expiry);
      return json({ok:true},200,{'Set-Cookie':`tw_session=${expiry}.${sig}; HttpOnly; ${u.protocol==='https:'?'Secure; ':''}SameSite=Strict; Path=/; Max-Age=604800`,'Cache-Control':'no-store'});
    }
    if(u.pathname==='/api/session') return json({authenticated:await authenticated(request,env)},200,{'Cache-Control':'no-store'});
    if(u.pathname==='/health') return json({ok:true,protocol:VERSION});
    if(u.pathname==='/multiplayer') {
      if((request.headers.get('Origin')!==u.origin && request.headers.get('Origin')!==env.DEV_ORIGIN) || !await authenticated(request,env)) return json({error:'unauthorized'},401);
      const room=u.searchParams.get('room');
      if(!room || !/^(?:[A-HJ-NP-Z2-9]{10}|[a-f0-9]{40})$/.test(room)) return json({error:'room'},400);
      if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket') return json({error:'websocket'},426);
      return env.ROOMS.getByName(room).fetch(request);
    }
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found',{status:404});
  },
};

export class RailwayRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql=ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS checkpoint (part INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS events (revision INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS requests (seq INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, id TEXT NOT NULL, op TEXT NOT NULL, UNIQUE(actor,id))');
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  }
  get(key, fallback=null) { const r=this.sql.exec('SELECT value FROM meta WHERE key=?',key).toArray()[0]; return r?JSON.parse(r.value):fallback; }
  put(key,value) { this.sql.exec('INSERT OR REPLACE INTO meta VALUES (?,?)',key,JSON.stringify(value)); }
  peers() { return this.ctx.getWebSockets().filter(ws=>ws.readyState===1 && ws.deserializeAttachment()?.name).sort((x,y)=>(this.member(x).joined-this.member(y).joined)||this.member(x).id.localeCompare(this.member(y).id)); }
  member(ws) { return ws.deserializeAttachment(); }
  state() { return {revision:this.get('revision',0),host:this.get('host'),members:this.peers().map(ws=>{const a=this.member(ws);return {id:a.id,name:a.name,ready:a.ready,...(a.cursor?{cursor:a.cursor}:{})};})}; }
  send(ws, value) { try { ws.send(JSON.stringify(value)); } catch { try { ws.close(1013,'Slow connection'); } catch {} } }
  broadcast(value) { for(const ws of this.peers()) this.send(ws,value); }
  presence() { this.broadcast({type:'room',...this.state()}); }
  saveCheckpoint(snapshot, revision) {
    const text=JSON.stringify(snapshot);
    this.sql.exec('DELETE FROM checkpoint');
    for(let at=0, part=0;at<text.length;at+=64_000,part++) this.sql.exec('INSERT INTO checkpoint VALUES (?,?)',part,text.slice(at,at+64_000));
    this.put('baseRevision',revision);
    this.sql.exec('DELETE FROM events WHERE revision<=?',revision);
  }
  bootstrap(ws) {
    const text=JSON.stringify({type:'welcome',...this.state(),self:this.member(ws).id,baseRevision:this.get('baseRevision',0),snapshot:JSON.parse(this.sql.exec('SELECT value FROM checkpoint ORDER BY part').toArray().map(r=>r.value).join('')),events:this.sql.exec('SELECT value FROM events ORDER BY revision').toArray().map(r=>JSON.parse(r.value)),time:this.get('time')});
    const parts=Math.ceil(text.length/64_000);
    this.send(ws,{type:'bootstrap',parts});
    for(let i=0;i<parts;i++) this.send(ws,{type:'chunk',index:i,data:text.slice(i*64_000,(i+1)*64_000)});
  }
  async fetch(request) {
    if(this.ctx.getWebSockets().length>=5) return json({error:'full'},409);
    const pair=new WebSocketPair(), [client,server]=Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({id:token(),name:'',ready:false,tokens:20,at:Date.now(),expires:Date.now()+7*86400_000});
    return new Response(null,{status:101,webSocket:client});
  }
  async webSocketMessage(ws, raw) {
    const reject=(code,id)=>this.send(ws,{type:'error',code,...(typeof id==='string'?{id}:{})});
    if(typeof raw!=='string' || raw.length>MAX_PACKET) { ws.close(1009,'Message too large'); return; }
    let m; try { m=JSON.parse(raw); } catch { reject('message'); return; }
    if(!m || typeof m!=='object') {reject('message');return;}
    const a=this.member(ws);
    if(a.expires<Date.now()) {ws.close(1008,'Session expired');return;}
    if(!a.name) {
      if(m.protocol!==VERSION) {reject('version');return;}
      if(typeof m.name!=='string'||!m.name.trim()||m.name.trim().length>40) {reject('name');return;}
      if(m.type==='create') {
        if(this.get('revision',0)) {reject('exists');return;}
        if(!validSnapshot(m.snapshot)) {reject('snapshot');return;}
        this.ctx.storage.transactionSync(()=>{this.saveCheckpoint(m.snapshot,1);this.put('revision',1);this.put('host',a.id);});
      } else if(m.type!=='join'||!this.get('revision',0)) {reject('missing');return;}
      a.name=m.name.trim();a.joined=Date.now(); ws.serializeAttachment(a);
      await this.ctx.storage.setAlarm(Date.now()+7*86400_000);
      this.bootstrap(ws); this.presence(); return;
    }
    if(m.type==='ready') {
      if(m.revision!==this.get('revision')) { this.send(ws,{type:'catchup',events:this.sql.exec('SELECT value FROM events WHERE revision>? ORDER BY revision',m.revision).toArray().map(r=>JSON.parse(r.value))}); return; }
      a.ready=true;ws.serializeAttachment(a);this.electHost();this.presence();this.pump();return;
    }
    if(m.type==='cursor') {
      if(!a.ready || (!m.hidden && Date.now()-(a.cursorAt??0)<80)) return;
      a.cursorAt=Date.now();
      if(m.hidden) a.cursor=null;
      else {
        if(!Number.isFinite(m.lng)||!Number.isFinite(m.lat)||Math.abs(m.lng)>180||Math.abs(m.lat)>85.1||typeof m.text!=='string'||m.text.length>200)return;
        a.cursor={lng:m.lng,lat:m.lat,text:m.text};
      }
      ws.serializeAttachment(a);
      const packet={type:'cursor',id:a.id,name:a.name,cursor:a.cursor};
      for(const peer of this.peers())if(peer!==ws)this.send(peer,packet);
      return;
    }
    if(m.type==='command') {
      if(!a.ready||!this.get('host')) {reject('paused',m.id);return;}
      a.tokens=Math.min(20,a.tokens+(Date.now()-a.at)/1000*5);a.at=Date.now();
      if(a.tokens<1) {reject('rate',m.id);return;} a.tokens--;ws.serializeAttachment(a);
      if(typeof m.id!=='string'||m.id.length>60||!m.op||!opNames.has(m.op.op)||JSON.stringify(m.op).length>64_000||!validTree(m.op)) {reject('message',m.id);return;}
      if(this.sql.exec('SELECT count(*) AS n FROM requests').one().n>=50) {reject('busy',m.id);return;}
      this.sql.exec('INSERT OR IGNORE INTO requests(actor,id,op) VALUES (?,?,?)',a.id,m.id,JSON.stringify(m.op));this.pump();return;
    }
    if(m.type==='result') {
      const p=this.get('pending');
      if(a.id!==this.get('host')||!p||m.id!==p.id||m.actor!==p.actor) {reject('host');return;}
      if(!m.result?.answer||!validTree(m.result)||JSON.stringify(m.result).length>MAX_EVENT) {ws.close(1008,'Invalid result');return;}
      const revision=this.get('revision')+1;
      if(m.snapshot&&!validSnapshot(m.snapshot)) {ws.close(1008,'Invalid checkpoint');return;}
      const event={type:'commit',revision,actor:p.actor,id:p.id,op:p.op,...m.result};
      this.ctx.storage.transactionSync(()=>{
        this.sql.exec('INSERT INTO events VALUES (?,?)',revision,JSON.stringify(event));
        this.put('revision',revision);this.put('time',m.result.after);this.put('pending',null);
        this.sql.exec('DELETE FROM requests WHERE seq=?',p.seq);
        if(m.snapshot) this.saveCheckpoint(m.snapshot,revision);
      });
      this.broadcast(event);this.pump();return;
    }
    if(m.type==='time') {
      if(a.id!==this.get('host')||!a.ready||this.get('pending')||m.revision!==this.get('revision')) return;
      const last=this.get('timeAt',0);if(Date.now()-last<800)return;
      if(!m.context||!validTree(m.context)||JSON.stringify(m.context).length>MAX_EVENT)return;
      this.put('timeAt',Date.now());this.put('time',m.context);
      this.broadcast({type:'time',revision:this.get('revision'),context:m.context});return;
    }
    if(m.type==='claim') {
      if(this.get('host')||!a.ready||this.peers()[0]!==ws) {reject('host');return;}
      this.put('host',a.id);this.presence();this.pump();return;
    }
    reject('message');
  }
  pump() {
    if(this.get('pending')) return;
    const host=this.peers().find(ws=>this.member(ws).id===this.get('host')&&this.member(ws).ready);
    if(!host)return;
    const row=this.sql.exec('SELECT * FROM requests ORDER BY seq LIMIT 1').toArray()[0];
    if(!row)return;
    const pending={seq:row.seq,id:row.id,actor:row.actor,op:JSON.parse(row.op),at:Date.now()};
    this.put('pending',pending);
    this.send(host,{type:'execute',...pending,revision:this.get('revision'),checkpoint:this.get('revision')-this.get('baseRevision',0)>=99});
  }
  electHost() {
    if(this.get('host'))return;
    const next=this.peers().find(ws=>this.member(ws).ready);
    if(!next)return;
    // Apply the last confirmed clock before granting simulation authority.
    const time=this.get('time');
    if(time)this.broadcast({type:'time',revision:this.get('revision'),context:time});
    this.put('host',this.member(next).id);
  }
  webSocketClose(ws) {
    const a=this.member(ws);
    ws.serializeAttachment({...a,name:'',ready:false});
    try { ws.close(1000,'Disconnected'); } catch {}
    this.sql.exec('DELETE FROM requests WHERE actor=?',a.id);
    if(a.id===this.get('host')) {
      this.put('host',null);this.put('pending',null);
      this.electHost();
      if(!this.get('host')) {
        const time=this.get('time');if(time)this.put('time',{...time,rate:0});
        this.broadcast({type:'paused'});
      }
    }
    this.presence();this.pump();
  }
  webSocketError(ws) { try{ws.close(1011,'Connection failed');}catch{} this.webSocketClose(ws); }
  async alarm() {
    for(const ws of this.ctx.getWebSockets()) try{ws.close(1001,'Room expired');}catch{}
    await this.ctx.storage.deleteAll();
  }
}
