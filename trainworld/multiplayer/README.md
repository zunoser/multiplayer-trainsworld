# Realtime cooperative multiplayer on Cloudflare

Up to five invited players can build in the same world simultaneously. The browser that creates a room hosts the authoritative Rust/WASM simulation; a SQLite Durable Object orders commands, broadcasts confirmed edits immediately, and stores checkpoints and the operation journal. Other browsers replay confirmed operations. Native object IDs survive checkpoint loading, and cooperative allocation is independent of local previews. Rendering, demand calculation, and train movement stay in browsers.

Participants see each other’s named cursors. Press `/` over the game to type at the cursor, Enter to send, and Esc to cancel. Cursor updates are capped at ten per second, animated between updates, and are not written into the world operation journal. Chat text is capped at 200 characters and disappears after a few seconds.

There is no ten-second save polling or building baton. Every player can lay track, place stations, create lines, and edit services using the ordinary tools. The host controls the common clock and continues running it when its tab is in the background. This is cooperative, trusted-player hosting, not a server-side anti-cheat engine.

## Access and recovery

Multiplayer endpoints require a shared access password. Login sets a signed HttpOnly, SameSite cookie for seven days (Secure on HTTPS). Login is limited to ten attempts per minute per IP in production. A random 50-bit, ten-character code identifies the world, in addition to the shared-password access check; there is no public room directory. Names are capped at 40 characters. Rooms accept at most five connections, command bursts of twenty and a sustained five commands per second per player, and bounded message/operation queues. Never commit `ROOM_PASSWORD` or share it in a public issue.

The application is multiplayer-only. The landing screen offers **Start hosting** and **Join with a code**, with the player name and shared access password in one form. New rooms start in Tokyo in sandbox mode. Hosts receive a readable ten-character room code (displayed as `ABCDE-FG234`); friends enter that code or paste the invite link. An invite pre-selects the join screen. Existing 40-character invite links remain supported. A persistent room bar shows the code, invite link, participants, backup download and exit; exiting returns to the lobby.

A checkpoint is stored every 100 confirmed operations. The original solo save is saved before entering a transient cooperative view. Cooperative results are tagged as shared copies so they never rank on the original leaderboard. Save or download a local copy before leaving. A checkpoint is limited to 2 MiB compressed, with the existing 32 MiB unpacked validator, plus a bounded identity sidecar. A new/returning participant loads the checkpoint and replays subsequent operations.

If the host disconnects, editing and the clock pause. The first remaining participant may resume as host. Confirmed operations and the checkpoint are retained by the Durable Object; an operation that the host had not confirmed can be lost. A diverging replica stops editing and asks the player to leave/rejoin. Currently, auxiliary global settings outside the edit protocol (such as switching the whole game to sandbox or changing running side) are blocked during a session. The dedicated host flow starts with unlimited construction funds and left-hand running in Tokyo. A room is scheduled for deletion seven days after its latest join; delete timing is not a backup guarantee.

## Run locally

From the repository root, with Node 22+, Rust and wasm-pack 0.15 installed:

```sh
npm --prefix trainworld/app ci
npm --prefix trainworld/app run wasm
npm --prefix trainworld/multiplayer ci
npm --prefix trainworld/multiplayer start
```

In a second terminal:

```sh
npm --prefix trainworld/app run dev -- --host 0.0.0.0
```

Open `http://127.0.0.1:5173/`. The development password defaults to `local-test-password`; override it with `ROOM_PASSWORD`. Miniflare runs the real Workers/Durable Objects implementation on port 8787 with local SQLite persistence under gitignored `artifacts/multiplayer-state`. Vite proxies `/api` and `/multiplayer` to it. The local origin exception is set only in the development runner, never in production bindings.

## Production

`cloudflare.config.ts` declares the Worker, SQLite Durable Object, secret, rate limiter and observability. This project uses the Cloudflare `cf` configuration model, not a hand-maintained Wrangler project. Static assets are the Vite output in `trainworld/app/dist/`.

Build with `npm --prefix trainworld/app run build`. Upload that exact directory through Workers Static Assets (the `assets.mjs` helper prepares media-type-aware SHA-256 asset keys and uploads the buckets with the correct per-file Content-Type from a Cloudflare upload session). Deploy `src/index.mjs` with:

- `ROOMS`: a SQLite Durable Object namespace for the `RailwayRoom` export.
- `ROOM_PASSWORD`: a secret text binding with a strong shared password.
- `LOGIN_LIMIT`: a rate limit binding, namespace `901762011`, ten requests per sixty seconds.
- `ASSETS`: the uploaded static assets binding; route only `/api/*`, `/multiplayer` and `/health` through the Worker first.
- Static response headers from `headers.txt` keep HTML uncached and hashed assets immutable. Retain prior hashed asset paths during a deployment to protect clients already playing.
- Compatibility date `2026-11-17`; per-invocation CPU limit 50 ms; sampled logs and traces enabled.

Keep Workers CacheW disabled: ordinary Workers Static Assets requests are free and unlimited, while opted-in Workers caching has different billing. Do not add a paid TURN service, R2, D1, cron job, or another service to this deployment without reviewing its costs. No Oracle VM is required. Bind the custom domain to this Worker only after the authenticated endpoints and application are verified.

Cloudflare's API/connected tooling can create the asset-upload session and final multipart deployment; `node trainworld/multiplayer/assets.mjs manifest <file>` and `... upload <session-file> <completion-file>` handle local files without exposing API credentials. Upload session files and completion JWTs are temporary secrets and belong outside Git. Ordinary cf project deployment should use an appropriate build adapter to supply these Vite assets; the Worker config itself deliberately has no unsupported `assets.directory` option.

## Expected cost for five people

Assume one room, all five connected for two hours each day for thirty days, and **one edit per person per second continuously** (a deliberately busy session):

| Dimension | Conservative monthly estimate | Workers Paid included allocation |
| --- | ---: | ---: |
| Confirmed edit requests + host replies | 2,160,000 WebSocket messages ÷ 20 = 108,000 request units | 1,000,000 DO request units |
| One host time update per second | 216,000 messages ÷ 20 = 10,800 request units | Same DO allocation |
| Cursor movement at 10 updates/second/player for all 60 hours | 10,800,000 messages ÷ 20 = 540,000 request units | Same DO allocation |
| Reconnects, acknowledgments, login/room setup | Small compared with the above | 10,000,000 Worker requests |
| Duration, even with the room active for all 60 hours | 216,000 seconds × 0.125 GB = 27,000 GB-s | 400,000 GB-s |
| SQLite reads/writes and stored data | Bounded live checkpoint + roughly 100 recent events per room | 25 billion rows read; 50 million rows written; 5 GB storage |

Combined DO request usage including constant cursor movement is about 659,000 request units, plus small connection/setup overhead (roughly 670,000 in the operating estimate).

At this scale, this application's expected incremental usage charge is **$0 beyond an existing $5/month Workers Paid subscription**, provided the account has remaining included allocation. This is an estimate, not an invoice cap: allocations are shared with other applications, usage can differ, and public endpoint abuse is still possible. Shared-password access and rate/size limits bound normal gameplay. WebSocket hibernation and automatic ping/pong avoid idle duration charges; outgoing WebSocket messages do not count as incoming DO message requests.

Cloudflare's optional account-wide spending limits can interrupt other applications and do not guarantee a maximum invoice (metering delay, existing sockets, and storage exceptions). This deployment does not silently change those account-wide settings.

Sources checked 2026-11-17: [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [spending limit behavior](https://developers.cloudflare.com/durable-objects/platform/spend-management/).

## Validation

```sh
npm --prefix trainworld/multiplayer test
npm --prefix trainworld/app run check
NODE_USE_ENV_PROXY=1 node trainworld/multiplayer/check-deployment.mjs https://trains.aomona.me/
cargo test --manifest-path trainworld/sim/Cargo.toml --release
cargo test --manifest-path trainworld/sim/Cargo.toml --release --features demand --lib
node trainworld/checks/multiplayer.mjs
```

Run `node trainworld/checks/lobby.mjs` for the host/join onboarding flow, formatted code entry, return-to-lobby behavior and mobile layout. The normal UI no longer exposes solo save/new-game menus; the existing debug URL startup is retained for automated kernel checks.

The browser test needs Vite and Miniflare, Playwright and Chromium; `PLAYWRIGHT_MODULE` and `TW_CHROME` override their locations. `ROOM_PASSWORD` overrides the test login. An optional first argument selects another base URL (including the production build). It verifies real simultaneous WASM construction, overlapping edits, propagation latency, sparse identity preservation, late joining, shared time, original save protection, Japanese controls, host recovery, and leaving. It writes a screenshot to `artifacts/trainworld/multiplayer-realtime-ja.png`.

The upstream AGPL-3.0 and data/font notices still apply. The application links to this fork's source. Privacy/terms describe this deployment rather than upstream's account service.

Validation note: the demand-feature suite currently reports eight failures in `demand::intercity::tests`. The same eight failures were reproduced from untouched upstream commit `6b8ef91` in a separate checkout in this environment. The changes introduce no additional demand-test failures; the complete ordinary native suite (564 passed, 9 ignored), cooperative identity tests, Workers tests and browser checks pass.
