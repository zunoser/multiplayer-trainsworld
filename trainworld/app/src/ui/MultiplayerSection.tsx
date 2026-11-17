import { useEffect, useState } from "preact/hooks";
import { clockRunning } from "../workers/clockClient";
import { checkMultiplayerSession, claimBuilder, connectMultiplayer, invitedRoom, leaveMultiplayer, loginMultiplayer, multiplayer, roomInvite, leaveToLobby, formattedRoomCode } from "../game/multiplayer";
import { t } from "../i18n";
export function MultiplayerSection() {
  const [name,setName]=useState("");
  const [invite,setInvite]=useState(invitedRoom);
  const [password,setPassword]=useState("");
  const [copied,setCopied]=useState(false);
  useEffect(()=>{void checkMultiplayerSession();},[]);
  const s=multiplayer.value;
  const active=s.status!=="offline";
  const host=s.room?.members.find(m=>m.id===s.room?.host);
  const roomCode=()=>{try{return new URLSearchParams(new URL(invite).hash.slice(1)).get("room")??invite.trim();}catch{return invite.trim();}};
  return <section class="coop" aria-label={t("multiplayer.title")}>
    <div class="h">{t("multiplayer.title")}</div>
    {!s.authenticated ? <form onSubmit={e=>{e.preventDefault();void loginMultiplayer(password).then(()=>setPassword(""));}}>
      <label class="coop-field">{t("multiplayer.password")}<input type="password" autoComplete="current-password" value={password} onInput={e=>setPassword(e.currentTarget.value)} maxLength={128} /></label>
      <button class="btn text" disabled={!password} type="submit">{t("multiplayer.unlock")}</button>
    </form> : !active ? <>
      <label class="coop-field">{t("multiplayer.name")}<input value={name} maxLength={40} autoComplete="nickname" onInput={e=>setName(e.currentTarget.value)} /></label>
      <label class="coop-field">{t("multiplayer.invite")}<input value={invite} autoComplete="off" onInput={e=>setInvite(e.currentTarget.value)} /></label>
      <div class="coop-actions">
        <button class="btn text" disabled={!name.trim()||!clockRunning()} onClick={()=>void connectMultiplayer(name.trim())}>{t("multiplayer.create")}</button>
        <button class="btn text" disabled={!name.trim()||!roomCode()||!clockRunning()} onClick={()=>void connectMultiplayer(name.trim(),roomCode())}>{t("multiplayer.join")}</button>
      </div>
    </> : <>
      <p role="status">{t(("multiplayer.status."+s.status) as "multiplayer.status.connecting"|"multiplayer.status.connected"|"multiplayer.status.disconnected")}</p>
      {s.room&&<>
        <label class="coop-field">{t("multiplayer.invite")}<input readOnly value={roomInvite()} onFocus={e=>e.currentTarget.select()} /></label>
        <div class="coop-actions"><button class="btn text" onClick={async()=>{try{await navigator.clipboard.writeText(roomInvite());setCopied(true);}catch{setCopied(false);}}}>{t(copied?"multiplayer.copied":"multiplayer.copy")}</button></div>
        <p><b>{t("lobby.code")}：{formattedRoomCode(s.code)}</b></p>
        <p>{t("multiplayer.cursorHint")}</p>
        <p>{t("multiplayer.host",{name:host?.name??t("multiplayer.noBuilder")})}</p>
        <ul class="coop-members">{s.room.members.map(m=><li key={m.id}><span>{m.name}{m.id===s.self?t("multiplayer.you"):""}{!m.ready?" · "+t("multiplayer.syncing"):""}</span></li>)}</ul>
        {!host&&s.room.members[0]?.id===s.self&&<button class="btn text" onClick={claimBuilder}>{t("multiplayer.claim")}</button>}
      </>}
      <div class="coop-actions"><button class="btn text" disabled={s.busy} onClick={()=>void leaveToLobby()}>{t("multiplayer.leave")}</button></div>
    </>}
    {s.error&&<p role="alert">{s.error}</p>}
    <div class="coop-actions"><a href="https://github.com/zunoser/multiplayer-trainsworld" target="_blank" rel="noopener">{t("multiplayer.source")}</a></div>
  </section>;
}
