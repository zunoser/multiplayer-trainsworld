# Cooperative play

This fork adds invite-only cooperative rooms. Up to eight players share one railway world, with one builder at a time. Other players can pan and inspect the world, then request building and receive it from the current builder. This is checkpoint-based cooperation, not simultaneous editing.

## Run locally

Build the game's WASM as described in the root README (Node 22+, Rust with the WASM target, wasm-pack 0.15), then use two terminals from the repository root:

```sh
npm --prefix trainworld/multiplayer ci
npm --prefix trainworld/multiplayer start
```

```sh
npm --prefix trainworld/app ci
npm --prefix trainworld/app run wasm
npm --prefix trainworld/app run dev -- --host 0.0.0.0
```

Open the Vite address. Start or open a game, open Settings → Cooperative play, enter a name, and create a room. Send the invite link to another player. They open their own game, then paste that link in Settings → Cooperative play and join. The invite pre-fills the room field when opened directly. All players must use the same server and build.

The builder's changes are shared every ten seconds, or by **Share checkpoint**. **Pass building** freezes new local edits, exports every edit already queued, and atomically publishes that checkpoint with the new builder. The recipient can build only after loading it. Play starts paused; the builder may resume the clock. Spectators see the clock and network at each checkpoint rather than a continuously running local simulation.

Japanese and English controls are included; other languages fall back to English.

## Saves and recovery

Entering a room saves the local game first and opens the shared world as a transient view, without overwriting that game's slot. Cooperative saves carry the existing shared-copy marker, so their figures do not count on the original game's leaderboard. Use the game's save/download controls to keep a local copy. Leaving a room keeps its current world open and paused; save it before closing the page.

Room state is held **in server memory only**. Empty rooms and their invite codes disappear. A server restart loses every room; download or save a copy of a world you want to keep. There is no automatic rejoin or durable room recovery.

If the builder disconnects, the room pauses. The remaining owner can explicitly resume the last confirmed checkpoint. Changes since that checkpoint may be lost (normally up to ten seconds, longer if exporting is slow). If the owner leaves, the first remaining participant becomes owner. A disconnected client cannot continue editing the room until they leave or rejoin it.

A checkpoint is limited to 2 MiB compressed and 32 MiB unpacked using the existing shared-save validator. Large networks may take appreciable time to load. Spectators' selections and unfinished drawings are cleared on checkpoint load because the save format renumbers object IDs. The builder's tools are preserved between their own checkpoints. Simultaneous editing needs persistent object identity and a command protocol; the existing save format cannot provide it by relaying edits alone.

## Hosting

```sh
npm --prefix trainworld/app run build
HOST=0.0.0.0 PORT=8787 TW_ALLOWED_ORIGINS=https://trains.example.com \
  npm --prefix trainworld/multiplayer start
```

The Node server serves `trainworld/app/dist/` and upgrades `/multiplayer` to WebSocket. Use an HTTPS reverse proxy with WebSocket support in front of it; clients choose `wss:` on HTTPS. Serve the application at the domain root. `TW_APP_DIR` overrides the static directory. `HOST` defaults to `127.0.0.1`; `PORT` defaults to `8787`. `TW_ALLOWED_ORIGINS` is a comma-separated allowlist; empty allows all origins, convenient for local development. `/health` reports the protocol version.

Vite proxies `/multiplayer` to port 8787 during development. Build and deploy the frontend and server together. With no local city packs, a production build uses the pinned upstream data version from `trainworld/data-version.txt`, including the separate world-terrain prefix. `TW_DATA=off` opts out. Please respect upstream's data-host guidance, and host your own data for a large audience.

Invites are random 192-bit bearer capabilities, not user accounts: anyone with a link can join and inspect that world. The server has room/player limits, message-size limits, per-connection rate limiting, a heartbeat, and slow-client backpressure. The relay checks the compressed envelope; clients perform bounded decompression and save validation before loading. This initial version trusts the current builder to supply the world; it is not a server-side anti-cheat simulation. Use one server process; independent replicas do not share room memory.

The original project's AGPL-3.0 license and data notices still apply. Before public hosting, offer the modified source and replace upstream branding, donation/support links, and privacy/terms pages with your fork's details as described in the root README.

## Validation

```sh
npm --prefix trainworld/multiplayer test
npm --prefix trainworld/app run check
node trainworld/checks/multiplayer.mjs
```

The browser check requires Vite on port 5173, the room server on 8787, and Playwright/Chromium. Set `PLAYWRIGHT_MODULE` to a Playwright module URL if needed, and `TW_CHROME` to a Chromium executable to override the browser. An optional first argument selects another Vite base URL. The check opens two isolated browser contexts and verifies actual WASM building, spectator refusal, world sync, handoff, disconnect recovery, leaving, and Japanese controls. Screenshots go to the gitignored `artifacts/trainworld/` directory.
