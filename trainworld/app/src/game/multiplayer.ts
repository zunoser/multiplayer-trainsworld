import { effect, signal } from "@preact/signals";
import { clock } from "./clock";
import { cooperative, cooperativeReadOnly } from "./multiplayerGate";
import { copyFromShare, forShare } from "./sharedSave";
import { applyCooperativeSave, clockRunning, exportForShare } from "../workers/clockClient";
import { t, type MessageKey } from "../i18n";

type Member = { id: string; name: string };
type Room = { room: string; revision: number; owner: string; editor: string | null; members: Member[] };
type RoomMessage = Room & { type: "welcome" | "room"; self?: string; snapshot?: string; writer?: string | null };
export const multiplayer = signal<{ status: "offline" | "connecting" | "connected" | "disconnected"; self: string; room: Room | null; busy: boolean; error: string; request: string | null }>({ status: "offline", self: "", room: null, busy: false, error: "", request: null });
let socket: WebSocket | null = null;
let appliedRevision = 0;
let generation = 0;
let pending: { revision: number; timer: ReturnType<typeof setTimeout> } | null = null;
let busy = false;
let loading: Promise<void> | null = null;
const MAX_SAVE = 2 << 20;

function update(patch: Partial<typeof multiplayer.value>) { multiplayer.value = { ...multiplayer.peek(), ...patch }; updateGate(); }
function updateGate() {
  const s = multiplayer.peek();
  cooperativeReadOnly.value = cooperative.peek() && (s.status !== "connected" || busy || !s.room || s.room.editor !== s.self || appliedRevision !== s.room.revision);
}
effect(() => {
  const s = multiplayer.value;
  const watching = cooperative.value && (s.status !== "connected" || !s.room || s.room.editor !== s.self);
  if (watching && clock.running.value) clock.setRunning(false);
});
function encode(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(text);
}
function decode(text: string): Uint8Array {
  if (text.length > Math.ceil(MAX_SAVE / 3) * 4) throw new Error(t("multiplayer.error.snapshot"));
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}
async function checkpointBytes(): Promise<string> {
  const bytes = await exportForShare();
  const checked = bytes && await forShare(bytes);
  if (!checked) throw new Error(t("multiplayer.error.snapshot"));
  return encode(checked);
}
function send(message: unknown) {
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error(t("multiplayer.error.connection"));
  socket.send(JSON.stringify(message));
}
function clearPending() { if (pending) clearTimeout(pending.timer); pending = null; }
function failure(error: unknown) { update({ error: error instanceof Error ? error.message : String(error) }); }

export function roomInvite(): string {
  const u = new URL(location.href);
  u.hash = new URLSearchParams({ room: multiplayer.peek().room?.room ?? "" }).toString();
  return u.href;
}
export function invitedRoom(): string { return new URLSearchParams(location.hash.slice(1)).get("room") ?? ""; }

export async function connectMultiplayer(name: string, room?: string) {
  if (socket || cooperative.peek()) return;
  if (!clockRunning()) { failure(new Error(t("multiplayer.error.game"))); return; }
  const mine = ++generation;
  busy = true;
  cooperative.value = true;
  update({ status: "connecting", busy: true, error: "", room: null, self: "", request: null });
  try {
    const snapshot = room ? undefined : await checkpointBytes();
    if (mine !== generation) return;
    const url = new URL("/multiplayer", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    socket = ws;
    let queue = Promise.resolve();
    const timeout = setTimeout(() => { if (multiplayer.peek().status === "connecting") ws.close(); }, 15_000);
    ws.onopen = () => ws.send(JSON.stringify({ type: room ? "join" : "create", protocol: 1, name, ...(room ? { room } : { snapshot }) }));
    ws.onmessage = e => {
      queue = queue.then(async () => {
        if (mine !== generation) return;
        const m = JSON.parse(e.data);
        if (m.type === "error") {
          clearPending();
          // A rejected handoff/checkpoint cannot silently unlock a possibly stale editor.
          failure(new Error(t(("multiplayer.error." + (m.code in ERROR_CODES ? m.code : "message")) as MessageKey)));
          ws.close();
          return;
        }
        if (m.type === "request") { update({ request: m.member }); return; }
        if (m.type !== "welcome" && m.type !== "room") return;
        const message = m as RoomMessage;
        const self = message.self ?? multiplayer.peek().self;
        const first = multiplayer.peek().room === null;
        if (message.snapshot && (first || message.writer !== self)) {
          busy = true;
          updateGate();
          const bytes = await copyFromShare(decode(message.snapshot), "coop:" + message.room);
          loading = applyCooperativeSave(bytes, first);
          try { await loading; } finally { loading = null; }
          if (mine !== generation) return;
          appliedRevision = message.revision;
        } else if (message.snapshot && message.writer === self) {
          appliedRevision = message.revision;
        }
        if (pending && message.revision > pending.revision) clearPending();
        if (mine !== generation || ws.readyState !== WebSocket.OPEN) return;
        if (message.snapshot) busy = !!pending;
        clearTimeout(timeout);
        update({ status: "connected", self, room: message, busy, error: "", request: message.editor === self ? multiplayer.peek().request : null });
      }).catch(error => { if (mine === generation) { failure(error); ws.close(); } });
    };
    ws.onerror = () => { if (mine === generation) failure(new Error(t("multiplayer.error.connection"))); };
    ws.onclose = () => {
      clearTimeout(timeout);
      if (mine !== generation) return;
      generation++;
      socket = null;
      clearPending();
      busy = true;
      update({ status: "disconnected", busy: false, error: multiplayer.peek().error || t("multiplayer.error.connection") });
    };
  } catch (error) {
    if (mine !== generation) return;
    cooperative.value = false;
    busy = false;
    update({ status: "offline", busy: false });
    failure(error);
  }
}
const ERROR_CODES: Record<string, true> = Object.fromEntries(["message", "version", "name", "capacity", "snapshot", "missing", "full", "editor", "revision", "member"].map(k => [k, true]));

export async function publishCheckpoint(nextEditor?: string) {
  const s = multiplayer.peek();
  if (busy || s.status !== "connected" || !s.room || s.room.editor !== s.self) return;
  const mine = generation;
  // Freeze before export so a successful handoff includes every accepted local edit.
  busy = true;
  update({ busy: true, error: "" });
  try {
    const snapshot = await checkpointBytes();
    if (mine !== generation) return;
    const revision = multiplayer.peek().room!.revision;
    pending = { revision, timer: setTimeout(() => { failure(new Error(t("multiplayer.error.connection"))); socket?.close(); }, 15_000) };
    send({ type: "checkpoint", revision, snapshot, ...(nextEditor ? { nextEditor } : {}) });
  } catch (error) {
    if (mine !== generation) return;
    clearPending(); busy = false; update({ busy: false }); failure(error);
  }
}
export function requestBuilder() { try { send({ type: "request" }); } catch (error) { failure(error); } }
export function claimBuilder() { try { send({ type: "claim" }); } catch (error) { failure(error); } }
export async function leaveMultiplayer() {
  const mine = ++generation;
  socket?.close(); socket = null;
  clearPending();
  busy = true; updateGate();
  // A worker load cannot be interrupted safely: do not unlock local edits underneath it.
  if (loading) await loading.catch(() => {});
  if (mine !== generation) return;
  busy = false; appliedRevision = 0;
  cooperative.value = false;
  update({ status: "offline", self: "", room: null, busy: false, error: "", request: null });
  // Stay paused. The received world can be saved as a separate local copy using Saves.
}
setInterval(() => { void publishCheckpoint(); }, 10_000);
