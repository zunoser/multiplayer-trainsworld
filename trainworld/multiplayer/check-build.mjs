import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const createMiniflare = options => new Miniflare(convertV4MiniflareOptions(options));

const root = new URL('./.cloudflare/output/v1/workers/default/', import.meta.url);
const config = JSON.parse(await readFile(new URL('worker.config.json', root), 'utf8'));
assert.equal(config.name, 'multiplayer-trainsworld');
assert.equal(config.workersDev, false);
assert.equal(config.previewUrls, false);
assert.equal(config.cache.enabled, false);
assert.equal(config.limits.cpuMs, 50);
assert.deepEqual(config.assets.runWorkerFirst, ['/api/*', '/multiplayer', '/health']);
assert.deepEqual(config.domains, ['trains.aomona.me']);
assert.equal(config.env.ROOM_PASSWORD.type, 'secret');
assert.equal(config.env.ROOMS.exportName, 'RailwayRoom');
assert.equal(config.env.ROOMS.worker, 'multiplayer-trainsworld');
assert.equal(config.env.LOGIN_LIMIT.namespace, '901762011');
assert.equal(config.exports.RailwayRoom.storage, 'sqlite');
const directory = fileURLToPath(new URL('assets/', root));
const mf = createMiniflare({
  modules: true, scriptPath: fileURLToPath(new URL(`bundle/${config.manifest.mainModule}`, root)),
  compatibilityDate: config.compatibilityDate,
  durableObjects: { ROOMS: { className: 'RailwayRoom', useSQLite: true } },
  bindings: { ROOM_PASSWORD: 'build-test-password' },
  assets: { directory, binding: 'ASSETS', routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: false } },
  cf: false,
});
try {
  const base = 'https://game.test/';
  const html = await mf.dispatchFetch(base);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type'), /^text\/html/);
  assert.match(html.headers.get('cache-control'), /no-store/);
  const source = await html.text();
  const assets = [...source.matchAll(/(?:src|href)="(\.\/assets\/[^" ]+\.(?:js|css))"/g)].map(m => m[1]);
  const wasm = (await readdir(new URL('assets/assets/', root))).filter(n => n.endsWith('.wasm'));
  assert(wasm.length >= 2);
  assets.push(...wasm.map(n => './assets/' + n));
  assert(assets.some(n => n.endsWith('.js')) && assets.some(n => n.endsWith('.css')));
  for (const name of assets) {
    const response = await mf.dispatchFetch(new URL(name, base).href);
    assert.equal(response.status, 200, name);
    assert.match(response.headers.get('content-type'), name.endsWith('.wasm') ? /application\/wasm/ : name.endsWith('.css') ? /text\/css/ : /javascript/);
  }
  const health = await mf.dispatchFetch(base + 'health');
  assert.equal((await health.json()).protocol, 2);
  console.log(`PASS bundled Worker, protected settings and HTML/JS/CSS/WASM MIME (${assets.length} assets)`);
} finally { await mf.dispose(); }
