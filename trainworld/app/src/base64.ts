/** Large room checkpoints run on the main thread; use byte-array encoding when available. */
export function encodeBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (native) return native.call(bytes);
  let text = "";
  for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(text);
}

export function decodeBase64(text: string): Uint8Array {
  // Keep atob's validation and acceptance of whitespace and unpadded input. Uint8Array.from
  // iterates a string as characters through a temporary list, stalling large room bootstraps.
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
