import { signal } from "@preact/signals";
import type { EditOp, ToClock } from "../workers/protocol";
import type { EditAnswer } from "../workers/clockClient";
export const cooperative = signal(false);
export const cooperativeReadOnly = signal(false);
export const cooperativeAuthority = signal(false);
export const cooperativeEditSink = signal<((op: EditOp) => Promise<EditAnswer>) | null>(null);
const MUTATIONS = new Set<ToClock["kind"]>(["edit", "flipSide", "sandbox", "home", "listOrder", "lineShape", "newGame", "import"]);
export function cooperativeBlocks(msg: ToClock): boolean {
  if (!cooperative.peek()) return false;
  if (MUTATIONS.has(msg.kind)) return true;
  return msg.kind === "saveSlot" && ["open", "restore", "delete"].includes(msg.action);
}
