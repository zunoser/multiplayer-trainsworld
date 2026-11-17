# Realtime cooperative multiplayer on Cloudflare

Up to five invited players can build in the same world simultaneously. The browser that creates a room hosts the authoritative Rust/WASM simulation; a SQLite Durable Object orders commands, broadcasts confirmed edits immediately, and stores checkpoints and the operation journal. Other browsers replay confirmed operations. Native object IDs survive checkpoint loading, and cooperative allocation is independent of local previews. Rendering, demand calculation, and train movement stay in browsers.

Participants see each other’s named cursors. Press `/` over the game to type at the cursor, Enter to send, and Esc to cancel. Cursor updates are capped at ten per second, animated between updates, and are not written into the world operation journal. Chat text is capped at 200 characters and disappears after a few seconds.

There is no ten-second save polling or building baton. Every player can lay track, place stations, create lines, and edit services using the ordinary tools. The host controls the common clock and continues running it when its tab is in the background. This is cooperative, trusted-player hosting, not a server-side anti-cheat engine.

## Access and recovery

Multiplayer endpoints require a shared access password. Login sets a signed HttpOnly, SameSite cookie for seven days (Secure on HTTPS). Login is limited to ten attempts per minute per IP in production. A random 50-bit, ten-character code identifies the world, in addition to the shared-password access check; there is no public room directory. Names are capped at 40 characters. Rooms accept at most five connections, command bursts of twenty and a sustained five commands per second per player, and bounded message/operation queues. Never commit `ROOM_PASSWORD` or share it in a public issue.

The application is multiplayer-only. First-time visitors enter the shared access password on a separate screen. Authenticated visitors choose **Start hosting** or **Join with a code**, then enter their player name. New rooms start in Tokyo in sandbox mode. Hosts receive a readable ten-character room code (displayed as `ABCDE-FG234`); friends enter that code or paste the invite link. An invite pre-selects the join screen and retains the code through password entry. The lobby reuses the original start-menu panel, buttons, colors and typography. Existing 40-character invite links remain supported. A persistent room bar shows the code, invite link, participants, backup download and exit; exiting returns to the lobby.

A checkpoint is stored every 100 confirmed operations. The original solo save is saved before entering a transient cooperative view. Cooperative results are tagged as shared copies so they never rank on the original leaderboard. Confirmed edits are automatically saved, including between checkpoints; download a backup to keep a copy beyond room retention. A checkpoint is limited to 2 MiB compressed, with the existing 32 MiB unpacked validator, plus a bounded identity sidecar. A new/returning participant loads the checkpoint and replays subsequent operations.

If the host disconnects, the first ready remaining participant automatically becomes host. The last confirmed clock state is applied before authority transfers; queued operations from connected players are retried. When everyone leaves, the simulation pauses. Joining the same code loads the saved world and automatically starts a new host. Confirmed operations and the checkpoint are retained by the Durable Object; an operation that the host had not confirmed can be lost. A diverging replica stops editing and asks the player to leave/rejoin. Currently, auxiliary global settings outside the edit protocol (such as switching the whole game to sandbox or changing running side) are blocked during a session. The dedicated host flow starts with unlimited construction funds and left-hand running in Tokyo. A room is scheduled for deletion seven days after its latest join; delete timing is not a backup guarantee.

## Competing companies

Hosting offers Cooperative or Competing companies on the same map. Competitive rooms start empty in normal mode; each company starts with US$10 billion. Track, nodes and lines belong to their builder. The Durable Object checks ownership before enqueueing and again before execution, including batches, stop edits and attempts to connect to another company's network. Construct all is scoped to the requesting company. Competitors see every company's infrastructure and share passenger demand, but operate independent networks.

The existing economy settles each line's actual fare income and running cost to its owner; native asset upkeep is charged to the infrastructure owner. Each company's wallet and five vehicle fleets are isolated. The Money tab shows cash and cumulative operating profit (fares minus running costs and maintenance), ranked by operating profit. This is an ongoing competition, with no time limit or forced winner. Global fare changes, loans, global undo/redo, group edits, ferry edits and station building footprints are unavailable in competitive rooms because the upstream model does not isolate those operations. Ordinary rail and bus construction and service editing remain available. Cooperative rooms keep the original behavior.

Company credentials are random per-room keys stored only on that browser; the server stores their SHA-256 hashes and never broadcasts the keys. Rejoining from that browser restores the same company, including after everyone leaves. Another browser creates another company; clearing local storage loses that company credential. There are at most five companies per room. Accounts and ownership persist in Durable Object storage alongside checkpoints and the journal, under the same seven-day retention. Downloaded ordinary world backups preserve railway geometry, not competitive account credentials or ownership; keep the room code and browser storage to resume competition.

Validation: `node trainworld/checks/competition.mjs` exercises two real WASM clients, ownership rejection, isolated wallets and vehicle purchases, maintenance, standings, host transfer and full-room recovery. Worker tests also send forged company identities and raw opponent-edit messages to verify enforcement outside the UI.

## Run locally

From the repository root, with Vite+, rustup and wasm-pack 0.15.0 installed:

```sh
vp install --frozen-lockfile
vp run dev
```

This root task builds WASM and starts both local servers. For frontend-only development after a build, use vp dev.

Open `http://127.0.0.1:5173/`. The development password defaults to `local-test-password`; override it with `ROOM_PASSWORD`. Miniflare runs the real Workers/Durable Objects implementation on port 8787 with local SQLite persistence under gitignored `artifacts/multiplayer-state`. Vite proxies `/api` and `/multiplayer` to it. The local origin exception is set only in the development runner, never in production bindings.

## Production

`cloudflare.config.ts` declares the Worker, SQLite Durable Object, secret, rate limiter and observability. This project uses the Cloudflare `cf` configuration model, not a hand-maintained Wrangler project. Static assets are the Vite output in `trainworld/app/dist/`.

Build the complete release with vp run build. The Worker uses the Cloudflare Vite plugin through vp build;
the root task prepares the frontend assets, builds the Worker and verifies the Build Output Specification.
The release retains these settings:

- `ROOMS`: a SQLite Durable Object namespace for the `RailwayRoom` export.
- `ROOM_PASSWORD`: a secret text binding with a strong shared password.
- `LOGIN_LIMIT`: a rate limit binding, namespace `901762011`, ten requests per sixty seconds.
- `ASSETS`: the uploaded static assets binding; route only `/api/*`, `/multiplayer` and `/health` through the Worker first.
- Static response headers from `headers.txt` keep HTML uncached and hashed assets immutable. Retain prior hashed asset paths during a deployment to protect clients already playing.
- Compatibility date `2026-11-17`; per-invocation CPU limit 50 ms; sampled logs and traces enabled.

Keep Workers CacheW disabled: ordinary Workers Static Assets requests are free and unlimited, while opted-in Workers caching has different billing. Do not add a paid TURN service, R2, D1, cron job, or another service to this deployment without reviewing its costs. No Oracle VM is required. Bind the custom domain to this Worker only after the authenticated endpoints and application are verified.

GitHub Actions deploys the verified artifact from main with vp run deploy. Pull requests run the build and dry run
without deployment credentials. See [automatic deployment](../docs/automatic-deployment.md). The cf CLI remains
the Cloudflare uploader; application and Worker bundling use Vite+.

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
vp test
vp check --quiet
NODE_USE_ENV_PROXY=1 node trainworld/multiplayer/check-deployment.mjs https://trains.aomona.me/
cargo test --manifest-path trainworld/sim/Cargo.toml --release
cargo test --manifest-path trainworld/sim/Cargo.toml --release --features demand --lib
node trainworld/checks/multiplayer.mjs
```

Run `node trainworld/checks/lobby.mjs` for the host/join onboarding flow, formatted code entry, return-to-lobby behavior and mobile layout. The normal UI no longer exposes solo save/new-game menus; the existing debug URL startup is retained for automated kernel checks.

The browser test needs Vite and Miniflare, Playwright and Chromium; `PLAYWRIGHT_MODULE` and `TW_CHROME` override their locations. `ROOM_PASSWORD` overrides the test login. An optional first argument selects another base URL (including the production build). It verifies real simultaneous WASM construction, overlapping edits, propagation latency, sparse identity preservation, late joining, shared time, original save protection, Japanese controls, host recovery, and leaving. It writes a screenshot to `artifacts/trainworld/multiplayer-realtime-ja.png`.

The upstream AGPL-3.0 and data/font notices still apply. The application links to this fork's source. Privacy/terms describe this deployment rather than upstream's account service.

Validation note: the demand-feature suite currently reports eight failures in `demand::intercity::tests`. The same eight failures were reproduced from untouched upstream commit `6b8ef91` in a separate checkout in this environment. The changes introduce no additional demand-test failures; the complete ordinary native suite (564 passed, 9 ignored), cooperative identity tests, Workers tests and browser checks pass.
