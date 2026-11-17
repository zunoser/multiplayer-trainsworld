// Isolated Chrome A/B: the exact old codec and the app's codec on the same bytes, alternated.
// No demand workers or map run while timing. Vite serves the actual app module.
// node trainworld/checks/base64-perf.mjs [http://127.0.0.1:6183/]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchChrome, REAL_SAVE } from './lib.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:6183/';
const moduleUrl = new URL('src/base64.ts', base).href;
const chrome = await launchChrome({ prefix: 'tw-base64-' });
try {
  const page = await chrome.ctx.newPage();
  // A source document gives the module its local origin without starting the game.
  await page.goto(moduleUrl);
  const result = await page.evaluate(async ({ moduleUrl, save }) => {
    const { encodeBase64, decodeBase64 } = await import(moduleUrl);
    const oldEncode = (bytes) => {
      let text = '';
      for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192));
      return btoa(text);
    };
    const oldDecode = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    const summary = (samples) => {
      samples.sort((a, b) => a - b);
      return { p50: samples[samples.length >> 1], p95: samples[Math.floor((samples.length - 1) * .95)] };
    };
    const rows = [];
    for (const [name, bytes] of [['NYC save', new Uint8Array(save)], ['2 MiB limit', new Uint8Array(2 << 20)]]) {
      if (name !== 'NYC save') for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 17) & 255;
      const encoded = oldEncode(bytes);
      if (encodeBase64(bytes) !== encoded || !decodeBase64(encoded).every((b, i) => b === bytes[i])) throw new Error('wire bytes differ');
      for (const [operation, old, next] of [
        ['encode', () => oldEncode(bytes), () => encodeBase64(bytes)],
        ['decode', () => oldDecode(encoded), () => decodeBase64(encoded)],
      ]) {
        for (let i = 0; i < 3; i++) { old(); next(); }
        const times = [[], []];
        for (let rep = 0; rep < 21; rep++) for (const index of rep % 2 ? [1, 0] : [0, 1]) {
          const t = performance.now();
          const value = [old, next][index]();
          times[index].push(performance.now() - t);
          if (value.length !== (operation === 'encode' ? encoded.length : bytes.length)) throw new Error('wrong size');
        }
        rows.push({ fixture: name, bytes: bytes.length, operation, beforeMs: summary(times[0]), afterMs: summary(times[1]) });
      }
      const fallback = bytes.slice();
      Object.defineProperty(fallback, 'toBase64', { value: undefined });
      if (encodeBase64(fallback) !== encoded) throw new Error('fallback differs');
    }
    // This codec also runs in the clock worker for save thumbnails.
    const workerCode = `import { encodeBase64, decodeBase64 } from ${JSON.stringify(moduleUrl)};
      onmessage = ({data}) => { const text = encodeBase64(data); const bytes = decodeBase64(text); postMessage({text, bytes}, [bytes.buffer]); };`;
    const url = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
    const worker = new Worker(url, { type: 'module' });
    try {
      const bytes = new Uint8Array(save);
      const answer = await new Promise((resolve, reject) => {
        worker.onmessage = ({data}) => resolve(data);
        worker.onerror = reject;
        worker.postMessage(bytes);
      });
      if (answer.text !== oldEncode(bytes) || !answer.bytes.every((b, i) => b === bytes[i]) || answer.bytes.length !== bytes.length) throw new Error('worker wire bytes differ');
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
    return { userAgent: navigator.userAgent, native: typeof Uint8Array.prototype.toBase64 === 'function', repetitions: 21, rows, worker: 'PASS' };
  }, { moduleUrl, save: Array.from(await readFile(REAL_SAVE)) });
  assert.equal(result.worker, 'PASS');
  console.log(JSON.stringify(result, null, 2));
} finally { await chrome.close(); }
