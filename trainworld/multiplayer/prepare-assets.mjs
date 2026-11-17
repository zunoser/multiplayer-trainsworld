import { cp, copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(here, '../app/dist');
const cache = resolve(here, '.cloudflare/retained-assets');
const next = resolve(here, '.cloudflare/current-assets');
await stat(resolve(dist, 'index.html'));
if (!next.startsWith(resolve(here, '.cloudflare') + sep)) throw new Error('Invalid current asset cache path');
await rm(next, { recursive: true, force: true });
await mkdir(next, { recursive: true });
// Save only this release, so retaining the previous release stays bounded.
await cp(resolve(dist, 'assets'), next, { recursive: true });
let previous = [];
try { previous = await readdir(cache, { withFileTypes: true }); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
let kept = 0;
for (const entry of previous) {
  if (!entry.isFile()) continue;
  const destination = resolve(dist, 'assets', entry.name);
  try { await stat(destination); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await copyFile(resolve(cache, entry.name), destination);
    kept++;
  }
}
await copyFile(resolve(here, 'headers.txt'), resolve(dist, '_headers'));
console.log(`Prepared static assets; retained ${kept} files from the previous release`);
