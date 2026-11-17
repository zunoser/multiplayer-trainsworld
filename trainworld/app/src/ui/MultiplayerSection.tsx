import { useState } from "preact/hooks";
import { clockRunning } from "../workers/clockClient";
import { claimBuilder, connectMultiplayer, invitedRoom, leaveMultiplayer, multiplayer, publishCheckpoint, requestBuilder, roomInvite } from "../game/multiplayer";
import { t } from "../i18n";

export function MultiplayerSection() {
  const [name, setName] = useState("");
  const [invite, setInvite] = useState(invitedRoom);
  const [copied, setCopied] = useState(false);
  const s = multiplayer.value;
  const active = s.status !== "offline";
  const editor = s.room?.members.find(m => m.id === s.room?.editor);
  const me = s.room?.editor === s.self;
  function roomCode() {
    try { return new URLSearchParams(new URL(invite).hash.slice(1)).get("room") ?? invite.trim(); }
    catch { return invite.trim(); }
  }
  return <section class="coop" aria-label={t("multiplayer.title")}>
    <div class="h">{t("multiplayer.title")}</div>
    {!active ? <>
      <label class="coop-field">{t("multiplayer.name")}<input value={name} maxLength={40} autoComplete="nickname" onInput={e => setName(e.currentTarget.value)} /></label>
      <label class="coop-field">{t("multiplayer.invite")}<input value={invite} autoComplete="off" onInput={e => setInvite(e.currentTarget.value)} /></label>
      <div class="coop-actions">
        <button class="btn text" disabled={!name.trim() || !clockRunning()} onClick={() => void connectMultiplayer(name.trim())}>{t("multiplayer.create")}</button>
        <button class="btn text" disabled={!name.trim() || !roomCode() || !clockRunning()} onClick={() => void connectMultiplayer(name.trim(), roomCode())}>{t("multiplayer.join")}</button>
      </div>
    </> : <>
      <p role="status">{t(("multiplayer.status." + s.status) as "multiplayer.status.connecting" | "multiplayer.status.connected" | "multiplayer.status.disconnected")}</p>
      {s.room && <>
        <label class="coop-field">{t("multiplayer.invite")}<input readOnly value={roomInvite()} onFocus={e => e.currentTarget.select()} /></label>
        <div class="coop-actions"><button class="btn text" onClick={async () => { try { await navigator.clipboard.writeText(roomInvite()); setCopied(true); } catch { setCopied(false); } }}>{t(copied ? "multiplayer.copied" : "multiplayer.copy")}</button></div>
        <p>{t("multiplayer.builder", { name: editor?.name ?? t("multiplayer.noBuilder") })}</p>
        <ul class="coop-members">{s.room.members.map(member => <li key={member.id}>
          <span>{member.name}{member.id === s.self ? t("multiplayer.you") : ""}{s.request === member.id ? " · " + t("multiplayer.requested") : ""}</span>
          {me && member.id !== s.self && <button class="btn text" disabled={s.busy || s.status !== "connected"} onClick={() => void publishCheckpoint(member.id)}>{t("multiplayer.pass")}</button>}
        </li>)}</ul>
        <div class="coop-actions">
          {me && <button class="btn text" disabled={s.busy || s.status !== "connected"} onClick={() => void publishCheckpoint()}>{t(s.busy ? "multiplayer.syncing" : "multiplayer.sync")}</button>}
          {!me && editor && <button class="btn text" disabled={s.status !== "connected"} onClick={requestBuilder}>{t("multiplayer.request")}</button>}
          {!editor && s.room.owner === s.self && <button class="btn text" disabled={s.status !== "connected"} onClick={claimBuilder}>{t("multiplayer.claim")}</button>}
        </div>
      </>}
      <div class="coop-actions"><button class="btn text" onClick={leaveMultiplayer}>{t("multiplayer.leave")}</button></div>
    </>}
    {s.error && <p role="alert">{s.error}</p>}
  </section>;
}
