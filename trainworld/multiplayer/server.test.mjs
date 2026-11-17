import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createMultiplayerServer, MAX_SAVE } from './server.mjs';

const snapshot = gzipSync('checkpoint one').toString('base64');
const newer = gzipSync('checkpoint two').toString('base64');
async function fixture(t, options) {
  const app = createMultiplayerServer(options);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const url = `ws://127.0.0.1:${app.server.address().port}/multiplayer`;
  async function connect() {
    const ws = new WebSocket(url);
    const messages = [], waiters = [];
    ws.on('message', bytes => {
      const m = JSON.parse(bytes);
      const i = waiters.findIndex(w => w.match(m));
      if (i >= 0) { const [w] = waiters.splice(i, 1); clearTimeout(w.timer); w.resolve(m); }
      else messages.push(m);
    });
    await once(ws, 'open');
    return {
      ws,
      send: m => ws.send(JSON.stringify(m)),
      next(match) {
        const i = messages.findIndex(match);
        if (i >= 0) return Promise.resolve(messages.splice(i, 1)[0]);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Message timeout')), 2500);
          waiters.push({ match, resolve, timer });
        });
      },
    };
  }
  async function host() {
    const client = await connect();
    client.send({ type: 'create', protocol: 1, name: 'Host', snapshot });
    return { client, state: await client.next(m => m.type === 'welcome') };
  }
  async function join(room) {
    const client = await connect();
    client.send({ type: 'join', protocol: 1, name: 'Guest', room });
    return { client, state: await client.next(m => m.type === 'welcome') };
  }
  return { app, connect, host, join };
}

test('shares a checkpoint and atomically hands building to the guest', async t => {
  const f = await fixture(t);
  const h = await f.host(), g = await f.join(h.state.room);
  assert.equal(g.state.snapshot, snapshot);
  assert.equal(g.state.editor, h.state.self);
  assert.equal(g.state.members.length, 2);
  g.client.send({ type: 'request' });
  assert.equal((await h.client.next(m => m.type === 'request')).member, g.state.self);
  h.client.send({ type: 'checkpoint', revision: 1, snapshot: newer, nextEditor: g.state.self });
  for (const c of [h.client, g.client]) {
    const m = await c.next(m => m.type === 'room' && m.revision === 2);
    assert.equal(m.snapshot, newer);
    assert.equal(m.editor, g.state.self);
    assert.equal(m.writer, h.state.self);
  }
  g.client.send({ type: 'checkpoint', revision: 2, snapshot });
  assert.equal((await h.client.next(m => m.type === 'room' && m.revision === 3)).snapshot, snapshot);
  const late = await f.join(h.state.room);
  assert.equal(late.state.revision, 3);
  assert.equal(late.state.snapshot, snapshot);
});

test('rejects spectator writes, stale revisions and transfers to missing members', async t => {
  const f = await fixture(t);
  const h = await f.host(), g = await f.join(h.state.room);
  g.client.send({ type: 'checkpoint', revision: 1, snapshot: newer });
  assert.equal((await g.client.next(m => m.type === 'error')).code, 'editor');
  h.client.send({ type: 'checkpoint', revision: 0, snapshot: newer });
  assert.equal((await h.client.next(m => m.type === 'error')).code, 'revision');
  h.client.send({ type: 'checkpoint', revision: 1, snapshot: newer, nextEditor: 'missing' });
  assert.equal((await h.client.next(m => m.type === 'error')).code, 'member');
  const late = await f.join(h.state.room);
  assert.equal(late.state.snapshot, snapshot);
  assert.equal(late.state.revision, 1);
});

test('pauses on editor disconnect, elects an owner, and explicitly resumes the last checkpoint', async t => {
  const f = await fixture(t);
  const h = await f.host(), g = await f.join(h.state.room);
  const closed = once(h.client.ws, 'close');
  h.client.ws.close(); await closed;
  const paused = await g.client.next(m => m.type === 'room' && m.editor === null);
  assert.equal(paused.owner, g.state.self);
  g.client.send({ type: 'claim' });
  const resumed = await g.client.next(m => m.type === 'room' && m.editor === g.state.self);
  assert.equal(resumed.snapshot, snapshot);
  assert.equal(resumed.revision, 1);
  assert.equal(resumed.writer, null);
});

test('isolates rooms and deletes empty rooms', async t => {
  const f = await fixture(t);
  const h = await f.host(), other = await f.host();
  assert.notEqual(h.state.room, other.state.room);
  const closed = once(h.client.ws, 'close'); h.client.ws.close(); await closed;
  const c = await f.connect();
  c.send({ type: 'join', protocol: 1, name: 'Late', room: h.state.room });
  assert.equal((await c.next(m => m.type === 'error')).code, 'missing');
  const guest = await f.join(other.state.room);
  assert.equal(guest.state.snapshot, snapshot);
});

test('validates names, protocol and snapshots; caps room and member counts', async t => {
  const f = await fixture(t, { maxRooms: 1, maxPlayers: 2 });
  const c = await f.connect();
  c.send({ type: 'create', protocol: 99, name: 'Test', snapshot });
  assert.equal((await c.next(m => m.type === 'error')).code, 'version');
  c.send({ type: 'create', protocol: 1, name: ' ', snapshot });
  assert.equal((await c.next(m => m.type === 'error')).code, 'name');
  c.send({ type: 'create', protocol: 1, name: 'Test', snapshot: 'garbage' });
  assert.equal((await c.next(m => m.type === 'error')).code, 'snapshot');
  const h = await f.host();
  c.send({ type: 'create', protocol: 1, name: 'Test', snapshot });
  assert.equal((await c.next(m => m.type === 'error')).code, 'capacity');
  await f.join(h.state.room);
  c.send({ type: 'join', protocol: 1, name: 'Test', room: h.state.room });
  assert.equal((await c.next(m => m.type === 'error')).code, 'full');
  h.client.send({ type: 'checkpoint', revision: 1, snapshot: Buffer.alloc(MAX_SAVE + 1, 0x61).toString('base64') });
  // The payload is within the frame envelope but exceeds the decoded snapshot cap.
  assert.equal((await h.client.next(m => m.type === 'error')).code, 'snapshot');
});

test('rejects malformed JSON without crashing and serves health status', async t => {
  const f = await fixture(t);
  const c = await f.connect(); c.ws.send('{');
  assert.equal((await c.next(m => m.type === 'error')).code, 'message');
  c.ws.send('null'); assert.equal((await c.next(m => m.type === 'error')).code, 'message');
  const r = await fetch(`http://127.0.0.1:${f.app.server.address().port}/health`);
  assert.deepEqual(await r.json(), { ok: true, protocol: 1 });
});
