import { DurableObject } from 'cloudflare:workers';
import { newCompany, ownedOperation, compactContext, applyOwnershipDelta } from './competition.mjs';
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
function validContext(c) {
  return c&&Number.isFinite(c.clock)&&Number.isFinite(c.cash)&&Number.isFinite(c.rate)&&validTree(c);
}
function validResult(r) {
  return r&&r.answer&&typeof r.answer.ok==='boolean'&&Number.isFinite(r.answer.charge)&&
    Array.isArray(r.answer.issues)&&r.answer.issues.every(s=>typeof s==='string'&&s.length<=2048)&&
    validContext(r.before)&&validContext(r.after)&&validTree(r);
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
  state() { return {revision:this.get('revision',0),host:this.get('host'),mode:this.get('mode','coop'),competition:this.get('competition'),members:this.peers().map(ws=>{const a=this.member(ws);return {id:a.id,name:a.name,ready:a.ready,company:a.company??null,...(a.cursor?{cursor:a.cursor}:{})};})}; }
  send(ws, value) { try { ws.send(JSON.stringify(value)); } catch { try { ws.close(1013,'Slow connection'); } catch {} } }
  broadcast(value) { for(const ws of this.peers()) this.send(ws,value); }
  presence() { this.broadcast({type:'room',...this.state()}); }
  saveCheckpoint(snapshot, revision) {
    const text=JSON.stringify(snapshot);
    this.sql.exec('DELETE FROM checkpoint');
    for(let at=0, part=0;at<text.length;at+=64_000,part++) this.sql.exec('INSERT INTO checkpoint VALUES (?,?)',part,text.slice(at,at+64_000));
    this.put('baseRevision',revision);
    const competition=this.get('competition');if(competition)this.put('baseCompetition',competition);
    this.sql.exec('DELETE FROM events WHERE revision<=?',revision);
  }
  checkpoint() { return JSON.parse(this.sql.exec('SELECT value FROM checkpoint ORDER BY part').toArray().map(r=>r.value).join('')); }
  events() { return this.sql.exec('SELECT value FROM events ORDER BY revision').toArray().map(r=>JSON.parse(r.value)); }
  sendLarge(ws,value) {
    const text=JSON.stringify(value);
    const parts=Math.ceil(text.length/64_000);
    this.send(ws,{type:'bootstrap',parts});
    for(let i=0;i<parts;i++) this.send(ws,{type:'chunk',index:i,data:text.slice(i*64_000,(i+1)*64_000)});
  }
  bootstrap(ws) {
    this.sendLarge(ws,{type:'welcome',...this.state(),self:this.member(ws).id,company:this.member(ws).company??null,baseRevision:this.get('baseRevision',0),baseCompetition:this.get('baseCompetition'),snapshot:this.checkpoint(),events:this.events(),time:this.get('time')});
  }
  async fetch(request) {
    if(this.ctx.getWebSockets().length>=5) return json({error:'full'},409);
    const pair=new WebSocketPair(), [client,server]=Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({id:token(),room:new URL(request.url).searchParams.get('room'),name:'',ready:false,tokens:20,at:Date.now(),expires:Date.now()+7*86400_000});
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
      let companyKey=null;
      if(m.mode==='versus'||m.restore||this.get('mode')==='versus') {
        if(typeof m.companyKey!=='string'||!/^[-a-zA-Z0-9]{32,80}$/.test(m.companyKey)) {reject('company');return;}
        companyKey=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(m.companyKey))),b=>b.toString(16).padStart(2,'0')).join('');
      }
      if(m.type==='create') {
        if(this.get('revision',0)) {reject('exists');return;}
        if(m.restore) {
          if(!this.validArchive(m.restore)||!m.restore.credentials[companyKey]) {reject('backup');return;}
          const r=m.restore;
          this.ctx.storage.transactionSync(()=>{
            this.put('competition',r.baseCompetition);this.saveCheckpoint(r.snapshot,r.baseRevision);
            for(const event of r.events)this.sql.exec('INSERT INTO events VALUES (?,?)',event.revision,JSON.stringify(event));
            this.put('revision',r.revision);this.put('competition',r.competition);
            this.put('companyCredentials',r.credentials);this.put('keyRoom',r.keyRoom);
            this.put('time',compactContext({...r.time,rate:0,competition:r.competition}));
            this.put('mode','versus');this.put('host',a.id);
          });
        } else {
        if(m.mode==='versus'&&(!m.context||!validTree(m.context))) {reject('message');return;}
        if(!validSnapshot(m.snapshot)) {reject('snapshot');return;}
        this.ctx.storage.transactionSync(()=>{this.saveCheckpoint(m.snapshot,1);this.put('revision',1);this.put('host',a.id);this.put('mode',m.mode==='versus'?'versus':'coop');});
        }
      } else if(m.type!=='join'||!this.get('revision',0)) {reject('missing');return;}
      if(this.get('mode')==='versus') {
        let competition=this.get('competition',{companies:[],owners:{}});
        const credentials=this.get('companyCredentials',{});
        let id=credentials[companyKey];
        if(!id&&this.get('keyRoom')&&!m.recoveryAttempt&&!m.restore) {
          this.send(ws,{type:'recoverCompany',room:this.get('keyRoom')});return;
        }
        if(!id) {
          if(competition.companies.length>=5) {reject('full');return;}
          id=token();credentials[companyKey]=id;
          competition.companies.push(newCompany(id,m.name.trim()));
          this.put('companyCredentials',credentials);
        }
        a.company=id;this.put('competition',competition);
        const storedTime=this.get('time');if(storedTime)this.put('time',compactContext({...storedTime,competition}));
        if(m.type==='create'&&!m.restore) {
          if(!m.context||!validTree(m.context)) {reject('message');return;}
          this.put('time',compactContext({...m.context,competition}));
          this.put('baseCompetition',competition);
        }
      }
      a.name=m.name.trim();a.joined=Date.now(); ws.serializeAttachment(a);
      await this.ctx.storage.setAlarm(Date.now()+7*86400_000);
      this.bootstrap(ws); this.presence(); return;
    }
    if(m.type==='ready') {
      if(m.revision!==this.get('revision')) { this.send(ws,{type:'catchup',events:this.sql.exec('SELECT value FROM events WHERE revision>? ORDER BY revision',m.revision).toArray().map(r=>JSON.parse(r.value))}); return; }
      a.ready=true;ws.serializeAttachment(a);this.electHost();this.presence();this.pump();return;
    }
    if(m.type==='backup') {
      if(!a.ready||this.get('mode')!=='versus'||typeof m.id!=='string'||m.id.length>60){reject('backup',m.id);return;}
      const now=Date.now();if(now-(a.backupAt??0)<1000){reject('rate',m.id);return;}
      a.backupAt=now;ws.serializeAttachment(a);
      const archive={schema:1,mode:'versus',keyRoom:this.get('keyRoom',a.room),
        revision:this.get('revision'),baseRevision:this.get('baseRevision'),snapshot:this.checkpoint(),
        baseCompetition:this.get('baseCompetition',this.get('competition')),events:this.events(),
        time:this.get('time'),competition:this.get('competition'),credentials:this.get('companyCredentials')};
      if(enc.encode(JSON.stringify(archive)).byteLength>MAX_PACKET-4096){reject('backupSize',m.id);return;}
      this.sendLarge(ws,{type:'roomBackup',id:m.id,archive});return;
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
      if(this.get('mode')==='versus'&&!ownedOperation(m.op,a.company,this.get('competition').owners)) {reject('ownership',m.id);return;}
      if(this.sql.exec('SELECT count(*) AS n FROM requests').one().n>=50) {reject('busy',m.id);return;}
      this.sql.exec('INSERT OR IGNORE INTO requests(actor,id,op) VALUES (?,?,?)',a.id,m.id,JSON.stringify(m.op));this.pump();return;
    }
    if(m.type==='result') {
      const p=this.get('pending');
      if(a.id!==this.get('host')||!p||m.id!==p.id||m.actor!==p.actor) {reject('host');return;}
      if(!validResult(m.result)||JSON.stringify(m.result).length>MAX_EVENT) {ws.close(1008,'Invalid result');return;}
      const revision=this.get('revision')+1;
      if(m.snapshot&&!validSnapshot(m.snapshot)) {ws.close(1008,'Invalid checkpoint');return;}
      if(this.get('mode')==='versus'&&(!m.result.after.competition||!validTree(m.result.after.competition))) {reject('company');return;}
      let competition=null;
      if(this.get('mode')==='versus') {
        competition=this.mergeCompetition(m.result.after.competition,true);
        if(m.result.ownershipDelta) {
          const owners=applyOwnershipDelta(this.get('competition').owners,m.result.ownershipDelta,p.company,competition.companies);
          if(!owners){reject('ownership',m.id);ws.close(1008,'Invalid ownership result');return;}
          competition={...competition,owners};
        }
        if(!this.validCompetition(competition)){reject('company',m.id);ws.close(1008,'Invalid company result');return;}
        m.result.after=compactContext({...m.result.after,competition});
        if(!m.result.ownershipDelta){
          delete m.result.after.ownershipOmitted;
          m.result.after.competition=competition;
        }
      }
      const event={type:'commit',revision,actor:p.actor,id:p.id,op:p.op,...(p.company?{company:p.company}:{}),...m.result};
      this.ctx.storage.transactionSync(()=>{
        this.sql.exec('INSERT INTO events VALUES (?,?)',revision,JSON.stringify(event));
        this.put('revision',revision);this.put('time',compactContext(m.result.after));if(competition)this.put('competition',competition);this.put('pending',null);
        this.sql.exec('DELETE FROM requests WHERE seq=?',p.seq);
        if(m.snapshot) this.saveCheckpoint(m.snapshot,revision);
      });
      this.broadcast(event);this.pump();return;
    }
    if(m.type==='time') {
      if(a.id!==this.get('host')||!a.ready||this.get('pending')||m.revision!==this.get('revision')) return;
      const last=this.get('timeAt',0);if(Date.now()-last<800)return;
      if(!validContext(m.context)||JSON.stringify(m.context).length>MAX_EVENT)return;
      if(this.get('mode')==='versus')m.context.competition=this.mergeCompetition(m.context.competition);
      if(this.get('mode')==='versus'&&!this.validCompetition(m.context.competition)){ws.close(1008,'Invalid company accounts');return;}
      this.put('timeAt',Date.now());this.put('time',compactContext(m.context));if(this.get('mode')==='versus'&&m.context.competition)this.put('competition',m.context.competition);
      this.broadcast({type:'time',revision:this.get('revision'),context:compactContext(m.context)});return;
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
    let op=JSON.parse(row.op),company=null;
    if(this.get('mode')==='versus') {
      const actor=this.peers().find(ws=>this.member(ws).id===row.actor);
      company=actor&&this.member(actor).company;
      op=company&&ownedOperation(op,company,this.get('competition').owners);
      if(!op) {
        this.sql.exec('DELETE FROM requests WHERE seq=?',row.seq);
        if(actor)this.send(actor,{type:'error',code:'ownership',id:row.id});
        this.pump();return;
      }
    }
    const pending={seq:row.seq,id:row.id,actor:row.actor,op,...(company?{company}:{}),at:Date.now()};
    this.put('pending',pending);
    const competition=this.get('competition');
    this.send(host,{type:'execute',...pending,revision:this.get('revision'),competition:competition?{companies:competition.companies,owners:{}}:null,checkpoint:this.get('revision')-this.get('baseRevision',0)>=99});
  }
  validArchive(r) {
    if(r.schema!==1||r.mode!=='versus'||!validSnapshot(r.snapshot)||!Number.isSafeInteger(r.revision)||
      !Number.isSafeInteger(r.baseRevision)||r.baseRevision<1||r.revision<r.baseRevision||
      !Array.isArray(r.events)||r.events.length>100||r.events.length!==r.revision-r.baseRevision||
      typeof r.keyRoom!=='string'||!/^(?:[A-HJ-NP-Z2-9]{10}|[a-f0-9]{40})$/.test(r.keyRoom)||
      !validContext(r.time)||!this.validCompetition(r.competition)||!this.validCompetition(r.baseCompetition)||
      !r.credentials||Array.isArray(r.credentials)||typeof r.credentials!=='object')return false;
    const ids=new Set(r.competition.companies.map(c=>c.id));
    if(Object.keys(r.credentials).length!==ids.size||new Set(Object.values(r.credentials)).size!==ids.size||
      !Object.entries(r.credentials).every(([key,id])=>/^[a-f0-9]{64}$/.test(key)&&ids.has(id)))return false;
    if(!r.baseCompetition.companies.every(c=>ids.has(c.id)))return false;
    const same=(a,b)=>Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>b[key]===value);
    const owners={...r.baseCompetition.owners};
    for(const [i,e] of r.events.entries()) {
      if(e.revision!==r.baseRevision+i+1||typeof e.id!=='string'||!opNames.has(e.op?.op)||!ids.has(e.company)||
        !validResult(e)||!validTree(e)||JSON.stringify(e).length>MAX_EVENT||
        !this.validCompetition(e.before.competition)||!this.validCompetition(e.after.competition)||
        !e.before.competition.companies.every(c=>ids.has(c.id))||!e.after.competition.companies.every(c=>ids.has(c.id)))return false;
      if(!e.before.ownershipOmitted&&!same(owners,e.before.competition.owners))return false;
      let delta=e.ownershipDelta;
      if(!delta) {
        delta={};
        for(const [key,owner] of Object.entries(e.after.competition.owners))if(owners[key]!==owner)delta[key]=owner;
        for(const key of Object.keys(owners))if(!(key in e.after.competition.owners))delta[key]=null;
      }
      if(!applyOwnershipDelta(owners,delta,e.company,r.competition.companies,false))return false;
    }
    return same(owners,r.competition.owners);
  }
  validCompetition(c) {
    if(!c||!Array.isArray(c.companies)||c.companies.length<1||c.companies.length>5||!c.owners||Array.isArray(c.owners)||typeof c.owners!=='object')return false;
    const ids=new Set();
    for(const company of c.companies) {
      if(!company||typeof company.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(company.id)||ids.has(company.id)||
        typeof company.name!=='string'||company.name.length>40||
        !['cash','revenue','running','upkeep','spent'].every(k=>Number.isFinite(company[k]))||
        !Array.isArray(company.fleet)||company.fleet.length!==5||!company.fleet.every(n=>Number.isSafeInteger(n)&&n>=0))return false;
      ids.add(company.id);
    }
    return Object.entries(c.owners).every(([key,owner])=>/^(edge|node|line):(?:0|[1-9][0-9]{0,6})$/.test(key)&&ids.has(owner));
  }
  mergeCompetition(incoming, owners=false) {
    const stored=this.get('competition');
    if(!stored||!incoming||!Array.isArray(incoming.companies))return stored;
    return {companies:stored.companies.map(c=>incoming.companies.find(next=>next.id===c.id)??c),owners:owners?incoming.owners:stored.owners};
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
