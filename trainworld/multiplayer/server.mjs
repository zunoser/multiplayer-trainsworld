import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

export const PROTOCOL = 1;
export const MAX_SAVE = 2 << 20;
const MAX_MESSAGE = Math.ceil(MAX_SAVE / 3) * 4 + 4096;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.bin': 'application/octet-stream' };

// A room is a capability: only people holding its random invite can enter. No account or public directory.
export function createMultiplayerServer({ appDir = fileURLToPath(new URL('../app/dist/', import.meta.url)), maxRooms = 100, maxPlayers = 8, allowedOrigins = [] } = {}) {
  const rooms = new Map();
  const root = resolve(appDir);
  const server = createServer(async (req, res) => {
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, protocol: PROTOCOL })); return; }
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
      if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) throw new Error();
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' });
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/multiplayer' || (allowedOrigins.length && !allowedOrigins.includes(req.headers.origin))) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  const send = (ws, message) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_MESSAGE * 2) { ws.close(1013, 'Connection too slow'); return; }
    ws.send(JSON.stringify(message));
  };
  const state = room => ({ room: room.id, revision: room.revision, owner: room.owner, editor: room.editor, members: [...room.members.values()].map(m => ({ id: m.id, name: m.name })) });
  const broadcast = (room, snapshot = false, writer = null) => {
    for (const member of room.members.values()) send(member.ws, { type: 'room', ...state(room), ...(snapshot ? { snapshot: room.snapshot, writer } : {}) });
  };
  const validSave = value => {
    if (typeof value !== 'string' || value.length > Math.ceil(MAX_SAVE / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
    const bytes = Buffer.from(value, 'base64');
    return bytes.length >= 10 && bytes.length <= MAX_SAVE && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes.toString('base64') === value;
  };
  wss.on('connection', ws => {
    const member = { id: randomUUID(), name: '', ws };
    let room = null;
    let tokens = 30, refilledAt = Date.now();
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    const timeout = setTimeout(() => ws.close(1008, 'Join timeout'), 15_000);
    const error = code => send(ws, { type: 'error', code });
    ws.on('message', raw => {
      tokens = Math.min(30, tokens + (Date.now() - refilledAt) / 1000 * 3);
      refilledAt = Date.now();
      if (tokens < 1) { ws.close(1008, 'Too many messages'); return; }
      tokens--;
      let m;
      try { m = JSON.parse(raw.toString()); } catch { error('message'); return; }
      if (!m || typeof m !== 'object') { error('message'); return; }
      if (!room) {
        if (m.protocol !== PROTOCOL) { error('version'); return; }
        if (typeof m.name !== 'string' || !m.name.trim() || m.name.trim().length > 40) { error('name'); return; }
        member.name = m.name.trim();
        if (m.type === 'create') {
          if (rooms.size >= maxRooms) { error('capacity'); return; }
          if (!validSave(m.snapshot)) { error('snapshot'); return; }
          const id = randomBytes(24).toString('base64url');
          room = { id, owner: member.id, editor: member.id, revision: 1, snapshot: m.snapshot, members: new Map() };
          rooms.set(id, room);
        } else if (m.type === 'join') {
          room = rooms.get(m.room) ?? null;
          if (!room) { error('missing'); return; }
          if (room.members.size >= maxPlayers) { room = null; error('full'); return; }
        } else { error('message'); return; }
        clearTimeout(timeout);
        room.members.set(member.id, member);
        send(ws, { type: 'welcome', self: member.id, ...state(room), snapshot: room.snapshot, writer: m.type === 'create' ? member.id : null });
        broadcast(room);
        return;
      }
      if (m.type === 'checkpoint') {
        if (room.editor !== member.id) { error('editor'); return; }
        if (m.revision !== room.revision) { error('revision'); return; }
        if (!validSave(m.snapshot)) { error('snapshot'); return; }
        if (m.nextEditor !== undefined && !room.members.has(m.nextEditor)) { error('member'); return; }
        room.snapshot = m.snapshot;
        room.revision++;
        room.editor = m.nextEditor ?? room.editor;
        broadcast(room, true, member.id);
      } else if (m.type === 'claim') {
        // No automatic promotion: the surviving owner explicitly resumes the last confirmed checkpoint.
        if (room.editor !== null || room.owner !== member.id) { error('editor'); return; }
        room.editor = member.id;
        broadcast(room, true);
      } else if (m.type === 'request') {
        if (!room.editor) { error('editor'); return; }
        send(room.members.get(room.editor).ws, { type: 'request', member: member.id });
      } else error('message');
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(timeout);
      if (!room) return;
      room.members.delete(member.id);
      if (!room.members.size) { rooms.delete(room.id); return; }
      if (room.owner === member.id) room.owner = room.members.keys().next().value;
      if (room.editor === member.id) room.editor = null;
      broadcast(room);
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 15_000);
  heartbeat.unref();
  return {
    server,
    close: async () => {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
      await new Promise(resolve => server.close(resolve));
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createMultiplayerServer({
    ...(process.env.TW_APP_DIR ? { appDir: process.env.TW_APP_DIR } : {}),
    allowedOrigins: (process.env.TW_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
  });
  app.server.listen(Number(process.env.PORT ?? 8787), process.env.HOST ?? '127.0.0.1', () => console.log('trainsworld multiplayer listening', app.server.address()));
}
