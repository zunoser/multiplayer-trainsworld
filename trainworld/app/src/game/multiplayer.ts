import { askBeforeLeaving } from "./saveSafety";
import { effect, signal } from "@preact/signals";
import { clock, SPEEDS } from "./clock";
import { cooperative, cooperativeAuthority, cooperativeEditSink, cooperativeReadOnly } from "./multiplayerGate";
import { copyFromShare, forShare } from "./sharedSave";
import { applyCooperativeSave, clockRunning, exportCooperativeSave, readCooperativeContext, runCooperativeCommand, takeCooperativeTime, type EditAnswer } from "../workers/clockClient";
import type { CooperativeContext, CooperativeResult, EditOp } from "../workers/protocol";
import { t, type MessageKey } from "../i18n";

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
type Member = { id: string; name: string; ready: boolean };
type Room = { revision: number; host: string | null; members: Member[] };
type Snapshot = { save: string; ids: number[] };
type Event = CooperativeResult & { type: "commit"; revision: number; actor: string; id: string; op: EditOp };
type State = { status: "offline" | "connecting" | "connected" | "disconnected"; self: string; code: string; room: Room | null; busy: boolean; error: string; authenticated: boolean };
export const multiplayer = signal<State>({ status: "offline", self: "", code: "", room: null, busy: false, error: "", authenticated: false });
let socket: WebSocket | null = null, generation = 0, applied = 0;
let loading: Promise<void> | null = null;
let executing = false, ticking = false;
const executed = new Set<string>();
const pending = new Map<string, { done: (answer: EditAnswer) => void; timer: ReturnType<typeof setTimeout> }>();
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
function encode(bytes: Uint8Array): string {
  let text = ""; for(let at=0;at<bytes.length;at+=8192) text += String.fromCharCode(...bytes.subarray(at,at+8192));
  return btoa(text);
}
function decode(text: string): Uint8Array {
  if(text.length > Math.ceil((2<<20)/3)*4) throw new Error(errorText("snapshot"));
  return Uint8Array.from(atob(text), c=>c.charCodeAt(0));
}
async function snapshot(): Promise<Snapshot> {
  const exported = await exportCooperativeSave();
  const bytes = await forShare(exported.bytes);
  if(!bytes) throw new Error(errorText("snapshot"));
  return { save: encode(bytes), ids: Array.from(exported.ids) };
}
function rejectPending() {
  for(const p of pending.values()) { clearTimeout(p.timer); p.done({ok:false,issues:[errorText("connection")],charge:0}); }
  pending.clear();
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
  if(cooperativeAuthority.peek()) return;
  takeCooperativeTime(c);
  clock.set(c.clock);
  if(c.rate>0) clock.setMultiple(c.rate/SPEEDS[0]);
  clock.setRunning(c.rate>0);
}
async function applyEvent(e: Event) {
  if(e.revision<=applied)return;
  if(e.revision!==applied+1)throw new Error(errorText("revision"));
  if(!executed.delete(e.id)) {
    const local=await runCooperativeCommand(e.op,e.before);
    if(!sameAnswer(local.answer,e.answer)) throw new Error(errorText("diverged"));
    takeCooperativeTime(e.after);
  }
  applied=e.revision;
  const s=multiplayer.peek();
  if(s.room)update({room:{...s.room,revision:applied}});
  if(e.actor===s.self) { const p=pending.get(e.id);pending.delete(e.id);if(p){clearTimeout(p.timer);p.done(e.answer);} }
  askBeforeLeaving(pending.size>0);
}
export function normalizeRoomCode(input:string):string {
  let code=input.trim();try{code=new URLSearchParams(new URL(code).hash.slice(1)).get("room")??code;}catch{}
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
export function invitedRoom() { return new URLSearchParams(location.hash.slice(1)).get("room")??""; }
export function roomInvite() {
  const u=new URL(location.href);u.search="";u.hash=new URLSearchParams({room:multiplayer.peek().code}).toString();return u.href;
}
export async function checkMultiplayerSession() {
  try { const r=await fetch("/api/session",{cache:"no-store"});const result=await r.json();update({authenticated:!!result.authenticated}); } catch { update({authenticated:false}); }
}
export async function loginMultiplayer(password: string) {
  try { const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});if(!r.ok)throw new Error(errorText(r.status===429?"rate":"password"));update({authenticated:true,error:""}); } catch(error){failure(error);}
}
export async function connectMultiplayer(name: string, code?: string) {
  if(socket||cooperative.peek())return;
  if(!clockRunning()) {failure(new Error(errorText("game")));return;}
  const mine=++generation;
  cooperative.value=true;cooperativeEditSink.value=command;
  const roomCode=code?normalizeRoomCode(code):createRoomCode();
  update({status:"connecting",busy:true,error:"",code:roomCode,room:null,self:""});
  try {
    const initial=code?undefined:await snapshot();
    if(mine!==generation)return;
    const url=new URL("/multiplayer",location.href);url.protocol=location.protocol==="https:"?"wss:":"ws:";url.searchParams.set("room",roomCode);
    const ws=new WebSocket(url);socket=ws;
    let queue=Promise.resolve(), chunks:string[]=[], expected=0;
    const timeout=setTimeout(()=>{if(multiplayer.peek().status==="connecting")ws.close();},120_000);
    ws.onopen=()=>send({type:code?"join":"create",protocol:2,name,...(initial?{snapshot:initial}:{})});
    const receive=async(m: Record<string, any>)=>{
      if(mine!==generation)return;
      if(m.type==="bootstrap") {expected=m.parts;chunks=[];if(!Number.isInteger(expected)||expected<1||expected>1024)throw new Error(errorText("snapshot"));return;}
      if(m.type==="chunk") {
        if(m.index!==chunks.length||typeof m.data!=="string"||m.data.length>64_000)throw new Error(errorText("message"));
        chunks.push(m.data);if(chunks.length===expected){const welcome=JSON.parse(chunks.join(""));chunks=[];await receive(welcome);}return;
      }
      if(m.type==="error") {
        failure(new Error(errorText(m.code)));
        const p = pending.get(m.id);
        if(p) { clearTimeout(p.timer);pending.delete(m.id);p.done({ok:false,issues:[errorText(m.code)],charge:0}); }
        if(multiplayer.peek().status==="connecting")ws.close();
        return;
      }
      if(m.type==="welcome") {
        update({self:m.self,room:{revision:m.revision,host:m.host,members:m.members},busy:true});
        const bytes=await copyFromShare(decode(m.snapshot.save),"coop:"+roomCode);
        loading=applyCooperativeSave(bytes,true,new Uint32Array(m.snapshot.ids));
        try{await loading;}finally{loading=null;}
        if(mine!==generation)return;
        applied=m.baseRevision;
        for(const e of m.events)await applyEvent(e);
        update({status:"connected",busy:false,room:{revision:applied,host:m.host,members:m.members}});
        if(m.time)takeTime(m.time);
        send({type:"ready",revision:applied});
        if(new URLSearchParams(location.search).get("debug")!=="1")history.replaceState(null,"",roomInvite());
        clearTimeout(timeout);return;
      }
      if(m.type==="catchup") {for(const e of m.events)await applyEvent(e);send({type:"ready",revision:applied});return;}
      if(m.type==="room") {
        update({room:{revision:m.revision,host:m.host,members:m.members}});
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
          const result=await runCooperativeCommand(m.op);
          executed.add(m.id);
          const checkpoint=m.checkpoint?await snapshot():undefined;
          if(mine===generation)send({type:"result",id:m.id,actor:m.actor,result,...(checkpoint?{snapshot:checkpoint}:{})});
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
  }catch(error){if(mine!==generation)return;cooperative.value=false;cooperativeEditSink.value=null;update({status:"offline",busy:false});failure(error);}
}
export function claimBuilder() {try{send({type:"claim"});}catch(error){failure(error);}}
export async function leaveMultiplayer() {
  const mine=++generation;socket?.close();socket=null;rejectPending();
  update({busy:true});if(loading)await loading.catch(()=>{});if(mine!==generation)return;
  applied=0;executed.clear();sharedCursors.value=new Map();cursorPending=null;cursorHidden=true;cursorDirty=false;cooperative.value=false;cooperativeEditSink.value=null;clock.setRunning(false);
  update({status:"offline",self:"",room:null,busy:false,error:"",code:""});
}
setInterval(()=>{
  const s=multiplayer.peek();if(!cooperativeAuthority.peek()||s.status!=="connected"||executing||ticking||s.busy)return;
  ticking=true;const mine=generation;
  void readCooperativeContext().then(context=>{if(mine===generation&&!executing)send({type:"time",revision:applied,context});}).catch(failure).finally(()=>{ticking=false;});
},1000);
setInterval(()=>{if(socket?.readyState===WebSocket.OPEN)socket.send("ping");},20_000);

setInterval(()=>{
  if(!cursorDirty||multiplayer.peek().status!=="connected"||multiplayer.peek().busy||socket?.readyState!==WebSocket.OPEN)return;
  cursorDirty=false;
  send(cursorHidden?{type:"cursor",hidden:true}:{type:"cursor",...cursorPending});
},100);
