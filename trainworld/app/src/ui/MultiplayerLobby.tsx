import { effect } from "@preact/signals";
import { h, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n";
import { choosing } from "../game/loading";
import { world } from "../game/world";
import { clockRunning, type GameChoice } from "../workers/clockClient";
import { checkMultiplayerSession, claimBuilder, connectMultiplayer, invitedRoom, leaveMultiplayer, loginMultiplayer, multiplayer, normalizeRoomCode } from "../game/multiplayer";
import { blockKeysOutside } from "./keys";
import { Icon } from "./widgets";

function waitUntil(read:()=>boolean):Promise<void> {
  return new Promise((resolve,reject)=>{
    let stop=()=>{};let finished=false;
    const timer=setTimeout(()=>{stop();reject(new Error(t("multiplayer.error.connection")));},120_000);
    const check=()=>{
      if(finished)return;
      try {
        if(read()){finished=true;clearTimeout(timer);queueMicrotask(()=>stop());resolve();}
      } catch(error) {finished=true;clearTimeout(timer);queueMicrotask(()=>stop());reject(error);}
    };
    stop=effect(check);if(finished)stop();
  });
}
function Lobby({start,done}:{start:(choice:GameChoice)=>void;done:()=>void}) {
  const invited=invitedRoom();
  const [mode,setMode]=useState<"host"|"join">(invited?"join":"host");
  const [name,setName]=useState(()=>{try{return localStorage.getItem("tw-player-name")??"";}catch{return "";}});
  const [password,setPassword]=useState("");
  const [code,setCode]=useState(invited);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const started=useRef(false);
  const s=multiplayer.value;
  useEffect(()=>{void checkMultiplayerSession();},[]);
  async function submit(e:SubmitEvent) {
    e.preventDefault();if(busy)return;setBusy(true);setError("");
    try{
      if(!multiplayer.peek().authenticated){await loginMultiplayer(password);if(!multiplayer.peek().authenticated)throw new Error(multiplayer.peek().error);setPassword("");}
      if(multiplayer.peek().status!=="offline")await leaveMultiplayer();
      try{localStorage.setItem("tw-player-name",name.trim());}catch{}
      if(!started.current){started.current=true;choosing.value=false;document.documentElement.classList.remove("choosing");start({newGame:true,newSlot:t("multiplayer.world"),game:{mode:"sandbox",start:"tyo",rightHand:false}});}
      await waitUntil(()=>!!world.value&&clockRunning());
      await connectMultiplayer(name.trim(),mode==="join"?normalizeRoomCode(code):undefined);
      let claimed=false;
      await waitUntil(()=>{
        const current=multiplayer.value;
        if(current.status==="disconnected"||current.status==="offline")throw new Error(current.error||t("multiplayer.error.connection"));
        if(current.status!=="connected"||!current.room)return false;
        const own=current.room.members.find(m=>m.id===current.self);
        if(own?.ready&&!current.room.host&&!claimed&&current.room.members[0]?.id===current.self){claimed=true;queueMicrotask(claimBuilder);}
        return !!own?.ready&&current.room.members.some(m=>m.id===current.room?.host&&m.ready);
      });
      done();
    }catch(error){setError(error instanceof Error?error.message:String(error));setBusy(false);}
  }
  return <main class="multiplayer-lobby">
    <div class="lobby-shell">
      <div class="lobby-brand"><span class="lobby-logo"><Icon.route /></span><span>Trainsworld<span class="lobby-brand-sub">Multiplayer</span></span><span class="lobby-private">{t("lobby.private")}</span></div>
      <div class="lobby-intro"><div class="lobby-kicker">{t("lobby.kicker")}</div><h1>{t("lobby.title")}</h1><p>{t("lobby.subtitle")}</p></div>
      <div class="lobby-card">
        <div class="lobby-modes" role="tablist" aria-label={t("lobby.choose")}>
          <button type="button" role="tab" aria-selected={mode==="host"} class={mode==="host"?"selected":""} disabled={busy} onClick={()=>{setMode("host");setError("");}}><Icon.people /><strong>{t("lobby.host")}</strong><span>{t("lobby.hostHint")}</span></button>
          <button type="button" role="tab" aria-selected={mode==="join"} class={mode==="join"?"selected":""} disabled={busy} onClick={()=>{setMode("join");setError("");}}><Icon.link /><strong>{t("lobby.join")}</strong><span>{t("lobby.joinHint")}</span></button>
        </div>
        <form class="lobby-form" onSubmit={submit}>
          <label>{t("multiplayer.name")}<input required maxLength={40} autoComplete="nickname" placeholder={t("lobby.namePlaceholder")} value={name} disabled={busy} onInput={e=>setName(e.currentTarget.value)} /></label>
          {mode==="join"&&<label>{t("lobby.code")}<input class="lobby-code" required autoCapitalize="characters" autoComplete="off" spellcheck={false} placeholder="ABCDE-FG234" value={code} disabled={busy} onInput={e=>setCode(e.currentTarget.value)} /></label>}
          {!s.authenticated&&<label>{t("multiplayer.password")}<input required type="password" autoComplete="current-password" placeholder={t("lobby.passwordPlaceholder")} value={password} disabled={busy} onInput={e=>setPassword(e.currentTarget.value)} maxLength={128} /></label>}
          {s.authenticated&&<span class="lobby-authenticated">● {t("lobby.authenticated")}</span>}
          {error&&<p class="lobby-error" role="alert">{error}</p>}
          <button class="lobby-submit" type="submit" disabled={busy}>{busy?t("lobby.preparing"):t(mode==="host"?"lobby.host":"lobby.joinAction")}<span aria-hidden="true">→</span></button>
          <p class="lobby-form-note">{t(mode==="host"?"lobby.hostNote":"lobby.joinNote")}</p>
        </form>
      </div>
      <div class="lobby-features"><span><Icon.people />{t("lobby.five")}</span><span><Icon.route />{t("lobby.together")}</span><span class="lobby-slash">/</span><span>{t("lobby.chat")}</span></div>
      <footer><a href="https://github.com/aomona/multiplayer-trainsworld" target="_blank" rel="noopener">{t("multiplayer.source")}</a><span>·</span><a href="privacy.html">{t("lobby.privacy")}</a><span>·</span><a href="terms.html">{t("lobby.terms")}</a></footer>
    </div>
  </main>;
}
export function showMultiplayerLobby(start:(choice:GameChoice)=>void) {
  choosing.value=true;document.documentElement.classList.add("choosing");
  const root=document.createElement("div");root.id="multiplayer-lobby-root";document.body.append(root);
  const unblock=blockKeysOutside(root,()=>true);
  const done=()=>{unblock();render(null,root);root.remove();choosing.value=false;document.documentElement.classList.remove("choosing");};
  render(h(Lobby,{start,done}),root);
}
