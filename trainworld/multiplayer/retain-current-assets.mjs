import { rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
const root = fileURLToPath(new URL('./.cloudflare/', import.meta.url));
const retained = resolve(root, 'retained-assets');
const current = resolve(root, 'current-assets');
if (!retained.startsWith(resolve(root) + sep) || !current.startsWith(resolve(root) + sep)) throw new Error('Invalid asset cache path');
await rm(retained, { recursive: true, force: true });
await rename(current, retained);
