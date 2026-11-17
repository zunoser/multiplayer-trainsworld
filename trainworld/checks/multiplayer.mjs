// Real browsers, real WASM, and two isolated save databases. Run against Vite plus the room server.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { playwright, ARTIFACTS, buildLine } from './lib.mjs';
const { chromium } = await playwright();
const browser = await chromium.launch({ headless: true, ...(process.env.TW_CHROME ? { executablePath: process.env.TW_CHROME } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const errors = [];
try {
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(() => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 }));
    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base + '?continue=1&debug=1&paused=1&lang=ja');
    await page.waitForFunction(() => window.tw?.world.peek() && window.tw.client.running, null, { timeout: 120_000 });
    await page.evaluate(() => { window.tw.clock.setRunning(false); window.tw.client.post({ kind: 'sandbox' }); window.tw.client.post({ kind: 'saveSlot', action: 'create', name: 'Solo world' }); });
    await page.waitForFunction(() => window.tw.lastSaved.peek() > 0);
  }
  const [host, guest] = pages;
  async function originalSave(page) {
    return page.evaluate(async () => {
      const key = localStorage.getItem('anitabuilder-save-slot');
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('anitabuilder', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const record = await new Promise((resolve, reject) => { const r = db.transaction('saves').objectStore('saves').get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      db.close();
      const digest = await crypto.subtle.digest('SHA-256', record.bytes);
      return { key, at: record.at, hash: Array.from(new Uint8Array(digest)) };
    });
  }
  async function service(page, method, ...args) {
    return page.evaluate(async ({ method, args }) => {
      const m = window.tw.multiplayer;
      if (method === 'state') return m.multiplayer.peek();
      return m[method](...args);
    }, { method, args });
  }
  async function connected(page) {
    await page.waitForFunction(() => window.tw.multiplayer.multiplayer.peek().status !== 'connecting', null, { timeout: 120_000 });
    const state = await service(page, 'state');
    assert.equal(state.status, 'connected', JSON.stringify(state));
  }
  console.log('Ready: both game workers');
  await service(host, 'connectMultiplayer', 'Alice'); await connected(host); console.log('Ready: host room');
  const room = (await service(host, 'state')).room.room;
  await service(guest, 'connectMultiplayer', 'Bob', room); await connected(guest); console.log('Ready: guest room');
  const originals = await Promise.all(pages.map(originalSave));
  const first = await buildLine(host, [[15, 25], [15.01, 25], [15.02, 25]], { name: 'Alice railway' });
  assert.equal(first.ok, true, JSON.stringify(first));
  const refused = await guest.evaluate(() => window.tw.client.edit({ op: 'undo' }));
  assert.equal(refused.ok, false);
  await service(host, 'publishCheckpoint');
  await guest.waitForFunction(() => window.tw.world.peek().save.lines.some(line => line.name === 'Alice railway'), null, { timeout: 120_000 });
  const g = await service(guest, 'state');
  await service(host, 'publishCheckpoint', g.self);
  await guest.waitForFunction(() => {
    const s = window.tw.multiplayer.multiplayer.peek();
    return s.status === 'connected' && s.room.editor === s.self && !s.busy;
  }, null, { timeout: 120_000 });
  const second = await buildLine(guest, [[15.1, 25], [15.11, 25], [15.12, 25]], { name: 'Bob railway' });
  assert.equal(second.ok, true, JSON.stringify(second));
  await service(guest, 'publishCheckpoint');
  await host.waitForFunction(() => window.tw.world.peek().save.lines.some(line => line.name === 'Bob railway'), null, { timeout: 120_000 });
  assert.equal((await host.evaluate(() => window.tw.client.edit({ op: 'undo' }))).ok, false);
  // Confirm the localized controls can be reached through the real settings UI.
  await host.getByRole('button', { name: '設定', exact: true }).click();
  await host.getByRole('region', { name: '協力プレイ' }).waitFor();
  await mkdir(ARTIFACTS, { recursive: true });
  await host.screenshot({ path: ARTIFACTS + '/multiplayer-ja.png' });
  assert.deepEqual(await Promise.all(pages.map(originalSave)), originals, 'cooperative edits must preserve the original local slots');
  await guest.context().close();
  await host.waitForFunction(() => window.tw.multiplayer.multiplayer.peek().room?.editor === null);
  await service(host, 'claimBuilder');
  await host.waitForFunction(() => { const s = window.tw.multiplayer.multiplayer.peek(); return s.room.editor === s.self && !s.busy; }, null, { timeout: 120_000 });
  await service(host, 'leaveMultiplayer');
  assert.equal((await service(host, 'state')).status, 'offline');
  assert.equal(await host.evaluate(() => window.tw.clock.running.peek()), false);
  assert.deepEqual(errors, []);
  console.log('PASS cooperative building, spectator refusal, checkpoint sync, handoff, owner recovery, Japanese UI, original save preservation, leave');
} finally { await browser.close(); }
