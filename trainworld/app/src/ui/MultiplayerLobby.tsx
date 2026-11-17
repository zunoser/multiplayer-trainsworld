import { effect } from "@preact/signals";
import { h, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n";
import { choosing } from "../game/loading";
import { world } from "../game/world";
import { clockRunning, type GameChoice } from "../workers/clockClient";
import { checkMultiplayerSession, claimBuilder, connectMultiplayer, invitedRoom, leaveMultiplayer, loginMultiplayer, multiplayer, normalizeRoomCode, readRoomBackup, type RoomBackup } from "../game/multiplayer";
import { blockKeysOutside } from "./keys";

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
  const [gameMode,setGameMode]=useState<"coop"|"versus">("coop");
  const [backup,setBackup]=useState<RoomBackup|null>(null);
  const [backupName,setBackupName]=useState("");
  const backupInput=useRef<HTMLInputElement>(null);
  const [code,setCode]=useState(invited);
  const [busy,setBusy]=useState(false);
  const [checked,setChecked]=useState(false);
  const [error,setError]=useState("");
  const started=useRef(false);
  const s=multiplayer.value;
  useEffect(()=>{void checkMultiplayerSession().finally(()=>setChecked(true));},[]);
  useEffect(()=>{
    const invite=()=>{const room=invitedRoom();if(room){setCode(room);setMode("join");setError("");}};
    window.addEventListener("hashchange",invite);window.addEventListener("popstate",invite);
    return ()=>{window.removeEventListener("hashchange",invite);window.removeEventListener("popstate",invite);};
  },[]);
  async function unlock(e:SubmitEvent) {
    e.preventDefault();if(busy)return;setBusy(true);setError("");
    await loginMultiplayer(password);
    if(multiplayer.peek().authenticated)setPassword("");
    else setError(multiplayer.peek().error);
    setBusy(false);
  }
  async function submit(e:SubmitEvent) {
    e.preventDefault();if(busy)return;setBusy(true);setError("");
    try{
      if(!multiplayer.peek().authenticated)throw new Error(t("multiplayer.error.password"));
      if(multiplayer.peek().status!=="offline")await leaveMultiplayer();
      try{localStorage.setItem("tw-player-name",name.trim());}catch{}
      if(!started.current){started.current=true;choosing.value=false;document.documentElement.classList.remove("choosing");start({newGame:true,newSlot:t("multiplayer.world"),game:{mode:gameMode==="versus"?"normal":"sandbox",start:"tyo",rightHand:false}});}
      await waitUntil(()=>!!world.value&&clockRunning());
      await connectMultiplayer(name.trim(),mode==="join"?normalizeRoomCode(code):undefined,gameMode,backup??undefined);
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
  return <main class="start-menu multiplayer-lobby">
    <div class="start-box lobby-shell">
      <h1>Trainsworld</h1>
      {!checked?<p role="status">{t("lobby.checking")}</p>:!s.authenticated?
        <form class="lobby-form" onSubmit={unlock}>
          <label>{t("multiplayer.password")}<input required autoFocus type="password" autoComplete="current-password" value={password} disabled={busy} onInput={e=>setPassword(e.currentTarget.value)} maxLength={128} /></label>
          {error&&<p class="lobby-error" role="alert">{error}</p>}
          <button class="btn text lobby-submit" type="submit" disabled={busy}>{t(busy?"lobby.checking":"lobby.unlock")}</button>
        </form>:
        <>
          <div class="lobby-modes" role="tablist" aria-label={t("lobby.choose")}>
            <button type="button" role="tab" aria-selected={mode==="host"} class={"btn text"+(mode==="host"?" on":"")} disabled={busy} onClick={()=>{setMode("host");setError("");}}>{t("lobby.host")}</button>
            <button type="button" role="tab" aria-selected={mode==="join"} class={"btn text"+(mode==="join"?" on":"")} disabled={busy} onClick={()=>{setMode("join");setError("");}}>{t("lobby.join")}</button>
          </div>
          <form class="lobby-form" onSubmit={submit}>
            {mode==="host"&&<label>{t("competition.mode")}<select value={gameMode} disabled={busy||!!backup} onChange={e=>setGameMode(e.currentTarget.value as "coop"|"versus")}><option value="coop">{t("competition.coop")}</option><option value="versus">{t("competition.versus")}</option></select></label>}
            <label>{t("multiplayer.name")}<input required maxLength={40} autoComplete="nickname" value={name} disabled={busy} onInput={e=>setName(e.currentTarget.value)} /></label>
            {mode==="join"&&<label>{t("lobby.code")}<input class="lobby-code" required autoCapitalize="characters" autoComplete="off" spellcheck={false} placeholder="ABCDE-FG234" value={code} disabled={busy} onInput={e=>setCode(e.currentTarget.value)} /></label>}
            <input hidden type="file" accept=".json,application/json" ref={backupInput} onChange={async e=>{
              const input=e.currentTarget,file=input.files?.[0];if(!file)return;
              try { const value=await readRoomBackup(file);setBackup(value);setBackupName(file.name);setGameMode("versus");if(!name.trim())setName(value.name);setError(""); }
              catch {setError(t("multiplayer.error.backup"));}
              input.value="";
            }} />
            <div class="coop-actions">
              <button class="btn text" type="button" disabled={busy} data-tip={t("competition.backupTip")} onClick={()=>backupInput.current?.click()}>{t(mode==="host"?"competition.restore":"competition.recover")}</button>
              {backup&&<button class="btn text" type="button" disabled={busy} onClick={()=>{setBackup(null);setBackupName("");}}>{t("competition.clearBackup")}</button>}
            </div>
            {backup&&<span class="small muted">{backupName}</span>}
            {error&&<p class="lobby-error" role="alert">{error}</p>}
            <button class="btn text lobby-submit" type="submit" disabled={busy}>{busy?t("lobby.preparing"):t(mode==="host"?"lobby.host":"lobby.joinAction")}</button>
            {mode==="host"&&!backup&&<p class="muted small lobby-form-note">{t(gameMode==="versus"?"competition.startingFunds":"lobby.hostNote")}</p>}
          </form>
        </>}
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
