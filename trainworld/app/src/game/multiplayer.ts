import { companies, myCompanyId } from "./companies";
import { askBeforeLeaving } from "./saveSafety";
import { encodeBase64, decodeBase64 } from "../base64";
import { effect, signal } from "@preact/signals";
import { clock, SPEEDS } from "./clock";
import { cooperative, cooperativeAuthority, cooperativeEditSink, cooperativeReadOnly } from "./multiplayerGate";
import { copyFromShare, forShare } from "./sharedSave";
import { applyCooperativeSave, clockRunning, exportCooperativeSave, readCooperativeContext, runCooperativeCommand, takeCooperativeTime, type EditAnswer } from "../workers/clockClient";
import type { CooperativeContext, CooperativeResult, EditOp } from "../workers/protocol";
import { t, type MessageKey } from "../i18n";
import { compactContext, compactResult, expandContext, expandResult } from "./competitionWire";

export type SharedCursor = { id: string; name: string; lng: number; lat: number; text: string; textAt: number };
export const sharedCursors = signal<Map<string, SharedCursor>>(new Map());
let cursorPending: {lng:number;lat:number;text:string} | null = null;
let cursorHidden = true, cursorDirty = false;
export function publishCursor(cursor: {lng:number;lat:number;text:string} | null) {
  cursorPending=cursor;cursorHidden=!cursor;cursorDirty=true;
}
function receiveCursor(id: string, name: string, cursor: {lng:number;lat:number;text:string}|null) {
  if(id===multiplayer.peek().self)return;
  const next=new Map(sharedCursors.peek()), previous=next.get(id);
  if(!cursor)next.delete(id);
  else next.set(id,{id,name,...cursor,textAt:previous?.text===cursor.text?previous.textAt:Date.now()});
  sharedCursors.value=next;
}
type Member = { id: string; name: string; ready: boolean; company?: string };
type Room = { revision: number; host: string | null; members: Member[]; mode?: "coop"|"versus" };
type Snapshot = { save: string; ids: number[] };
type Event = CooperativeResult & { type: "commit"; revision: number; actor: string; id: string; op: EditOp; company?: string };
type State = { status: "offline" | "connecting" | "connected" | "disconnected"; self: string; code: string; room: Room | null; busy: boolean; error: string; authenticated: boolean };
export const multiplayer = signal<State>({ status: "offline", self: "", code: "", room: null, busy: false, error: "", authenticated: false });
let socket: WebSocket | null = null, generation = 0, applied = 0;
let loading: Promise<void> | null = null;
let executing = false, ticking = false;
const executed = new Set<string>();
const pending = new Map<string, { done: (answer: EditAnswer) => void; timer: ReturnType<typeof setTimeout> }>();
export type RoomBackup = {
  format: "trainsworld-company-room"; version: 1; name: string; companyKey: string;
  archive: { schema: 1; mode: "versus"; snapshot: Snapshot; events: Event[]; [key: string]: unknown };
};
const backupRequests = new Map<string, { resolve: (value: RoomBackup["archive"]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
export async function readRoomBackup(file: File): Promise<RoomBackup> {
  if (file.size > 8 * 1024 * 1024) throw new Error(errorText("backupSize"));
  const data = JSON.parse(await file.text());
  if (data?.format !== "trainsworld-company-room" || data.version !== 1 ||
    typeof data.name !== "string" || typeof data.companyKey !== "string" || !/^[-a-zA-Z0-9]{32,80}$/.test(data.companyKey) ||
    data.archive?.schema !== 1 || data.archive.mode !== "versus" || !data.archive.snapshot || !Array.isArray(data.archive.events))
    throw new Error(errorText("backup"));
  return data;
}
export async function roomBackup(): Promise<RoomBackup> {
  const s = multiplayer.peek();
  if (s.status !== "connected" || s.room?.mode !== "versus" || pending.size) throw new Error(errorText("busy"));
  const companyKey = localStorage.getItem("tw-company:" + s.code);
  if (!companyKey) throw new Error(errorText("company"));
  const archive = await new Promise<RoomBackup["archive"]>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { backupRequests.delete(id); reject(new Error(errorText("connection"))); }, 30000);
    backupRequests.set(id, { resolve, reject, timer });
    try { send({ type: "backup", id }); } catch (error) { clearTimeout(timer); backupRequests.delete(id); reject(error); }
  });
  return { format: "trainsworld-company-room", version: 1, name: s.room.members.find(m => m.id === s.self)?.name ?? "", companyKey, archive };
}
export async function downloadRoomBackup() {
  try {
    const backup = await roomBackup(), blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "trainsworld-company-" + multiplayer.peek().code + ".json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { failure(error); }
}
const errorText = (code: string) => t(("multiplayer.error." + code) as MessageKey);
function update(patch: Partial<State>) { multiplayer.value = { ...multiplayer.peek(), ...patch }; gate(); }
function gate() {
  const s = multiplayer.peek();
  cooperativeAuthority.value = s.status === "connected" && s.room?.host === s.self;
  cooperativeReadOnly.value = cooperative.peek() && (s.status !== "connected" || s.busy || !s.room?.members.some(m=>m.id===s.room?.host&&m.ready));
}
effect(() => { if (cooperative.value && (multiplayer.value.status !== "connected" || !multiplayer.value.room?.host) && clock.running.value) clock.setRunning(false); });
function failure(error: unknown) { update({ error: error instanceof Error ? error.message : String(error) }); }
function send(message: unknown) {
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error(errorText("connection"));
  socket.send(JSON.stringify(message));
}
function decode(text: string): Uint8Array {
  if(text.length > Math.ceil((2<<20)/3)*4) throw new Error(errorText("snapshot"));
  return decodeBase64(text);
}
async function snapshot(): Promise<Snapshot> {
  const exported = await exportCooperativeSave();
  const bytes = await forShare(exported.bytes);
  if(!bytes) throw new Error(errorText("snapshot"));
  return { save: encodeBase64(bytes), ids: Array.from(exported.ids) };
}
function rejectPending() {
  for(const p of pending.values()) { clearTimeout(p.timer); p.done({ok:false,issues:[errorText("connection")],charge:0}); }
  pending.clear();
  for (const request of backupRequests.values()) { clearTimeout(request.timer); request.reject(new Error(errorText("connection"))); }
  backupRequests.clear();
}
async function command(op: EditOp): Promise<EditAnswer> {
  if(cooperativeReadOnly.peek()) return {ok:false,issues:[t("multiplayer.readOnly")],charge:0};
  const id=crypto.randomUUID();
  return new Promise(resolve=>{
    const timer=setTimeout(()=>{pending.delete(id);resolve({ok:false,issues:[errorText("connection")],charge:0});socket?.close();},60_000);
    pending.set(id,{done:resolve,timer});askBeforeLeaving(true);
    try { send({type:"command",id,op}); } catch(error) { clearTimeout(timer);pending.delete(id);failure(error);resolve({ok:false,issues:[errorText("connection")],charge:0}); }
  });
}
function sameAnswer(a: CooperativeResult["answer"], b: CooperativeResult["answer"]) { return a.ok===b.ok&&a.line===b.line&&a.node===b.node&&a.skipped===b.skipped; }
function takeTime(c: CooperativeContext) {
  c = expandContext(c, companies.peek()?.owners ?? {});
  if(c.competition)companies.value=c.competition;
  if(cooperativeAuthority.peek()) return;
  takeCooperativeTime(c);
  clock.set(c.clock);
  if(c.rate>0) clock.setMultiple(c.rate/SPEEDS[0]);
  clock.setRunning(c.rate>0);
}
async function applyEvent(e: Event) {
  if(e.revision<=applied)return;
  if(e.revision!==applied+1)throw new Error(errorText("revision"));
  e = { ...e, ...expandResult(e, companies.peek()?.owners ?? {}) };
  const localExecution=executed.delete(e.id);
  if(!localExecution) {
    const local=await runCooperativeCommand(e.op,e.before,e.company);
    if(!sameAnswer(local.answer,e.answer)) throw new Error(errorText("diverged"));
  }
  if(!localExecution||e.before.competition?.companies.length!==e.after.competition?.companies.length)takeCooperativeTime(e.after);
  applied=e.revision;
  if(e.after.competition)companies.value=e.after.competition;
  const s=multiplayer.peek();
  if(s.room)update({room:{...s.room,revision:applied}});
  if(e.actor===s.self) { const p=pending.get(e.id);pending.delete(e.id);if(p){clearTimeout(p.timer);p.done(e.answer);} }
  askBeforeLeaving(pending.size>0);
}
export function normalizeRoomCode(input:string):string {
  let code=input.trim();try{const url=new URL(code);code=new URLSearchParams(url.hash.slice(1)).get("room")??url.searchParams.get("room")??code;}catch{}
  if(/^[a-f0-9]{40}$/.test(code))return code;
  return code.replace(/[\s-]/g,"").toUpperCase();
}
export function formattedRoomCode(code:string):string {return code.length===10?code.slice(0,5)+"-"+code.slice(5):code;}
function createRoomCode():string {const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";return Array.from(crypto.getRandomValues(new Uint8Array(10)),n=>alphabet[n%32]).join("");}
export async function leaveToLobby() {
  await leaveMultiplayer();
  const {askBeforeLeaving}=await import("./saveSafety");askBeforeLeaving(false);
  const url=new URL(location.href);url.search="";url.hash="";location.assign(url.href);
}
export function invitedRoom() { return new URLSearchParams(location.hash.slice(1)).get("room")??new URLSearchParams(location.search).get("room")??""; }
export function roomInvite() {
  const u=new URL(location.href);u.search="";u.hash=new URLSearchParams({room:multiplayer.peek().code}).toString();return u.href;
}
export async function checkMultiplayerSession() {
  try { const r=await fetch("/api/session",{cache:"no-store"});const result=await r.json();update({authenticated:!!result.authenticated}); } catch { update({authenticated:false}); }
}
export async function loginMultiplayer(password: string) {
  try { const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});if(!r.ok)throw new Error(errorText(r.status===429?"rate":"password"));update({authenticated:true,error:""}); } catch(error){failure(error);}
}
export async function connectMultiplayer(name: string, code?: string, mode: "coop"|"versus" = "coop", backup?: RoomBackup) {
  if(socket||cooperative.peek())return;
  if(!clockRunning()) {failure(new Error(errorText("game")));return;}
  if (!code && mode === "versus" && !backup) {
    const { world } = await import("./world");
    const w = world.peek();
    if (!w || w.edges.length || w.save.stations.length || w.save.lines.length) { failure(new Error(errorText("competitionStart"))); return; }
  }
  const mine=++generation;
  cooperative.value=true;cooperativeEditSink.value=command;
  const roomCode=code?normalizeRoomCode(code):createRoomCode();
  update({status:"connecting",busy:true,error:"",code:roomCode,room:null,self:""});
  try {
    const initial=code||backup?undefined:await snapshot();
    if(mine!==generation)return;
    const url=new URL("/multiplayer",location.href);url.protocol=location.protocol==="https:"?"wss:":"ws:";url.searchParams.set("room",roomCode);
    const context=initial?await readCooperativeContext():undefined;
    const ws=new WebSocket(url);socket=ws;
    let queue=Promise.resolve(), chunks:string[]=[], expected=0;
    const timeout=setTimeout(()=>{if(multiplayer.peek().status==="connecting")ws.close();},120_000);
    const keyName="tw-company:"+roomCode;
    let companyKey=backup?.companyKey ?? localStorage.getItem(keyName);
    if(!companyKey){companyKey=crypto.randomUUID();localStorage.setItem(keyName,companyKey);}
    localStorage.setItem(keyName,companyKey);
    const handshake=(recoveryAttempt=false)=>send({type:code?"join":"create",protocol:2,name,mode,companyKey,recoveryAttempt,...(context?{context}:{}),...(initial?{snapshot:initial}:{}),...(!code&&backup?{restore:backup.archive}:{})});
    ws.onopen=()=>handshake();
    const receive=async(m: Record<string, any>)=>{
      if(mine!==generation)return;
      if(m.type==="bootstrap") {expected=m.parts;chunks=[];if(!Number.isInteger(expected)||expected<1||expected>1024)throw new Error(errorText("snapshot"));return;}
      if(m.type==="chunk") {
        if(m.index!==chunks.length||typeof m.data!=="string"||m.data.length>64_000)throw new Error(errorText("message"));
        chunks.push(m.data);if(chunks.length===expected){const welcome=JSON.parse(chunks.join(""));chunks=[];await receive(welcome);}return;
      }
      if(m.type==="error") {
        failure(new Error(errorText(m.code)));
        const request=backupRequests.get(m.id);
        if(request){clearTimeout(request.timer);backupRequests.delete(m.id);request.reject(new Error(errorText(m.code)));}
        const p = pending.get(m.id);
        if(p) { clearTimeout(p.timer);pending.delete(m.id);p.done({ok:false,issues:[errorText(m.code)],charge:0}); }
        if(multiplayer.peek().status==="connecting")ws.close();
        return;
      }
      if(m.type==="recoverCompany") {
        if(typeof m.room!=="string")throw new Error(errorText("backup"));
        companyKey=backup?.companyKey??localStorage.getItem("tw-company:"+m.room)??companyKey;
        localStorage.setItem(keyName,companyKey!);handshake(true);return;
      }
      if(m.type==="roomBackup") {
        const request=backupRequests.get(m.id);
        if(request){clearTimeout(request.timer);backupRequests.delete(m.id);request.resolve(m.archive);}
        return;
      }
      if(m.type==="welcome") {
        myCompanyId.value=m.company??null;companies.value=m.baseCompetition??m.competition??null;
        update({self:m.self,room:{revision:m.revision,host:m.host,members:m.members,mode:m.mode},busy:true});
        const bytes=await copyFromShare(decode(m.snapshot.save),"coop:"+roomCode);
        loading=applyCooperativeSave(bytes,true,new Uint32Array(m.snapshot.ids));
        try{await loading;}finally{loading=null;}
        if(mine!==generation)return;
        applied=m.baseRevision;
        for(const e of m.events)await applyEvent(e);
        update({status:"connected",busy:false,room:{revision:applied,host:m.host,members:m.members,mode:m.mode}});
        if(m.time)takeTime(m.time);
        send({type:"ready",revision:applied});
        if(new URLSearchParams(location.search).get("debug")!=="1")history.replaceState(null,"",roomInvite());
        clearTimeout(timeout);return;
      }
      if(m.type==="catchup") {for(const e of m.events)await applyEvent(e);send({type:"ready",revision:applied});return;}
      if(m.type==="room") {
        if(m.competition)companies.value=m.competition;
        update({room:{revision:m.revision,host:m.host,members:m.members,mode:m.mode}});
        const members = new Set(m.members.map((member: Member)=>member.id));
        sharedCursors.value=new Map([...sharedCursors.peek()].filter(([id])=>members.has(id)));
        for(const member of m.members)if(member.cursor)receiveCursor(member.id,member.name,member.cursor);
        return;
      }
      if(m.type==="paused") {rejectPending();clock.setRunning(false);update({room:multiplayer.peek().room?{...multiplayer.peek().room!,host:null}:null});return;}
      if(m.type==="commit") {await applyEvent(m as Event);return;}
      if(m.type==="time") {if(m.revision===applied)takeTime(m.context);return;}
      if(m.type==="execute") {
        if(m.revision!==applied)throw new Error(errorText("revision"));
        executing=true;
        try {
          let context: CooperativeContext | undefined;
          if(m.competition) {
            context=await readCooperativeContext();
            const local=context.competition;
            context.competition={...m.competition,owners:local?.owners??{},companies:m.competition.companies.map((c: import("../workers/protocol").Company)=>local?.companies.find(own=>own.id===c.id)??c)};
          }
          const result=await runCooperativeCommand(m.op,context,m.company);
          executed.add(m.id);
          const checkpoint=m.checkpoint?await snapshot():undefined;
          if(mine===generation)send({type:"result",id:m.id,actor:m.actor,result:compactResult(result),...(checkpoint?{snapshot:checkpoint}:{})});
        }finally{executing=false;}
      }
    };
    ws.onmessage=e=>{
      if(e.data==="pong")return;
      const message=JSON.parse(e.data);
      if(message.type==="cursor") { if(mine===generation)receiveCursor(message.id,message.name,message.cursor);return; }
      queue=queue.then(()=>receive(message)).catch(error=>{if(mine===generation){failure(error);ws.close();}});};
    ws.onerror=()=>{if(mine===generation)failure(new Error(errorText("connection")));};
    ws.onclose=()=>{clearTimeout(timeout);if(mine!==generation)return;generation++;socket=null;rejectPending();update({status:"disconnected",busy:false,error:multiplayer.peek().error||errorText("connection")});};
  }catch(error){if(mine!==generation)return;socket?.close();socket=null;rejectPending();cooperative.value=false;cooperativeEditSink.value=null;update({status:"offline",busy:false});failure(error);}
}
export function claimBuilder() {try{send({type:"claim"});}catch(error){failure(error);}}
export async function leaveMultiplayer() {
  const mine=++generation;socket?.close();socket=null;rejectPending();
  update({busy:true});if(loading)await loading.catch(()=>{});if(mine!==generation)return;
  companies.value=null;myCompanyId.value=null;
  applied=0;executed.clear();sharedCursors.value=new Map();cursorPending=null;cursorHidden=true;cursorDirty=false;cooperative.value=false;cooperativeEditSink.value=null;clock.setRunning(false);
  update({status:"offline",self:"",room:null,busy:false,error:"",code:""});
}
setInterval(()=>{
  const s=multiplayer.peek();if(!cooperativeAuthority.peek()||s.status!=="connected"||executing||ticking||s.busy)return;
  ticking=true;const mine=generation;
  void readCooperativeContext().then(context=>{if(mine===generation&&!executing)send({type:"time",revision:applied,context:compactContext(context)});}).catch(failure).finally(()=>{ticking=false;});
},1000);
setInterval(()=>{if(socket?.readyState===WebSocket.OPEN)socket.send("ping");},20_000);

setInterval(()=>{
  if(!cursorDirty||multiplayer.peek().status!=="connected"||multiplayer.peek().busy||socket?.readyState!==WebSocket.OPEN)return;
  cursorDirty=false;
  send(cursorHidden?{type:"cursor",hidden:true}:{type:"cursor",...cursorPending});
},100);

export { readCooperativeContext };
