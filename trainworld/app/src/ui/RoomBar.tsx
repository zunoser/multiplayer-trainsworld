import { useState } from "preact/hooks";
import { formattedRoomCode, leaveToLobby, multiplayer, roomInvite, claimBuilder } from "../game/multiplayer";
import { exportGame } from "../workers/clockClient";
import { t } from "../i18n";
import { cursorColor } from "./SharedCursors";
import { Icon } from "./widgets";
export function RoomBar() {
  const s=multiplayer.value;
  const [copied,setCopied]=useState(false);
  if(s.status==="offline"||s.status==="connecting")return null;
  async function copy(value:string){try{await navigator.clipboard.writeText(value);setCopied(true);setTimeout(()=>setCopied(false),1800);}catch{setCopied(false);}}
  return <section class="room-bar" aria-label={t("lobby.room")}>
    {s.room?.mode==="versus"&&<span>{t("competition.versus")}</span>}
    <span class={"room-status"+(s.status==="connected"?" online":"")}><i />{t(s.status==="connected"?"lobby.connected":"multiplayer.status.disconnected")}</span>
    <div class="room-code-box"><span>{t("lobby.code")}</span><button class="room-code-value" aria-label={t("lobby.copyCode")} data-tip={t("lobby.copyCode")} onClick={()=>void copy(s.code)}>{formattedRoomCode(s.code)}<Icon.copy /></button></div>
    <button class="btn text room-invite" onClick={()=>void copy(roomInvite())}><Icon.link />{t(copied?"multiplayer.copied":"lobby.invite")}</button>
    <div class="room-members" aria-label={t("lobby.members")}>{s.room?.members.map(m=><span class="room-member" data-tip={m.name+(m.id===s.room?.host?" · "+t("lobby.hostRole"):"")}><i style={{background:cursorColor(m.id)}} />{m.name}{m.id===s.self?" · "+t("lobby.youShort"):""}</span>)}</div>
    <span class="room-chat-hint"><kbd>/</kbd>{t("lobby.chat")}</span>
    {!s.room?.host&&s.room?.members[0]?.id===s.self&&<button class="btn text" onClick={claimBuilder}>{t("multiplayer.claim")}</button>}
    <button class="btn icon" aria-label={t("lobby.backup")} data-tip={t("lobby.backup")} onClick={exportGame}><Icon.save /></button>
    <button class="btn text room-exit" onClick={()=>void leaveToLobby()}><Icon.leaveGroup />{t("lobby.leave")}</button>
  </section>;
}
