import { signal } from "@preact/signals";
import type { ToClock } from "../workers/protocol";

export const cooperative = signal(false);
export const cooperativeReadOnly = signal(false);
// Rendering and demand reads stay local; world changes belong to the current builder.
const MUTATIONS = new Set<ToClock["kind"]>(["edit", "flipSide", "sandbox", "home", "listOrder", "lineShape", "newGame", "import"]);
export function cooperativeBlocks(msg: ToClock): boolean {
  if (!cooperative.peek()) return false;
  if (msg.kind === "newGame" || msg.kind === "import") return true;
  if (msg.kind === "saveSlot" && ["open", "restore", "delete"].includes(msg.action)) return true;
  return cooperativeReadOnly.peek() && MUTATIONS.has(msg.kind);
}
