// Snapshot/picture wire bytes must stay identical, including subarray views and legacy input.
// From the repo root: vp test base64
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vite-plus/test";
import { encodeBase64, decodeBase64 } from "../app/src/base64.ts";
const REAL_SAVE = new URL("../T-007-real-nyc.save", import.meta.url);

test("base64 preserves native and fallback bytes, malformed inputs and real save", async () => {
  const oldEncode = (bytes) => {
    let text = "";
    for (let at = 0; at < bytes.length; at += 8192)
      text += String.fromCharCode(...bytes.subarray(at, at + 8192));
    return btoa(text);
  };
  const oldDecode = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  for (const size of [0, 1, 2, 3, 255, 256, 8191, 8192, 8193, 32768, 2 << 20]) {
    const backing = new Uint8Array(size + 13);
    for (let i = 0; i < backing.length; i++) backing[i] = (i * 31 + 17) & 255;
    const bytes = backing.subarray(7, 7 + size),
      expected = oldEncode(bytes);
    assert.equal(encodeBase64(bytes), expected);
    assert.deepEqual(decodeBase64(expected), new Uint8Array(bytes));
    // Exercise native dispatch even on a Node/browser that has no toBase64 yet.
    let calls = 0;
    Object.defineProperty(bytes, "toBase64", {
      configurable: true,
      value() {
        assert.equal(this, bytes);
        calls++;
        return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
      },
    });
    assert.equal(encodeBase64(bytes), expected);
    assert.equal(calls, 1);
    Object.defineProperty(bytes, "toBase64", { value: undefined });
    assert.equal(encodeBase64(bytes), expected);
  }
  for (const text of ["", "AA", "AAA", "AA==", "AAA=", " /+7d\n", "\tYQ\r\n==\f"]) {
    assert.deepEqual(decodeBase64(text), oldDecode(text));
  }
  for (const text of ["A", "A===", "AA=A", "AA===", "____", "你好", "AA\u00a0=="]) {
    assert.throws(() => oldDecode(text));
    assert.throws(() => decodeBase64(text), { name: "InvalidCharacterError" });
  }
  const real = new Uint8Array(await readFile(REAL_SAVE));
  assert.equal(encodeBase64(real), oldEncode(real));
  assert.deepEqual(decodeBase64(oldEncode(real)), real);
  console.log(
    "PASS native dispatch, fallback, offset views, chunk boundaries, 2 MiB, malformed input and real NYC save",
  );
});
