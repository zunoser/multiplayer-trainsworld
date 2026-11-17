# Automatic deployment

The deployment workflow validates pull requests and deploys pushes to `main` to the existing `multiplayer-trainsworld` Worker at https://trains.aomona.me/. Pull requests never receive deployment credentials. No preview URL or workers.dev endpoint is enabled.

Vite+ 1.7.0 manages the JavaScript toolchain. The root packageManager selects Bun 1.3.12, .node-version pins Node 24.22.0, and rust-toolchain.toml pins Rust 1.96.0 plus the WASM target. The app and Worker share bun.lock; npm lockfiles are not used.

The workflow has three stages:

1. Linux runs vp install --frozen-lockfile, the default Rust suite with vp run test:native, then vp run build. That task builds both WASM modules with wasm-pack 0.15.0, the frontend, and the Worker through the Cloudflare Vite plugin. It checks the packaged HTML/JS/CSS/WASM and runs the cf upload dry run. The app/dist, generated WASM and TypeScript bindings, and .cloudflare/output are uploaded as a commit-named artifact.
2. Windows and Linux install the same lockfile and download the generated artifact before running vp check --quiet, vp run format:check and vp test. The type checker therefore sees bindings produced by the actual Rust build. All tests import vite-plus/test; the Worker fixture cleanup uses onTestFinished.
3. On main only, after both platforms pass, a separate job downloads that same artifact and runs vp run deploy. This job receives the deployment token and does not rebuild the release. It checks production, then saves the current release assets for the next deployment.

setup-vp caches Bun downloads and the pinned Vite+/Node/package-manager toolchain. A separate OS/toolchain/Cargo.lock cache covers Cargo dependencies, Rust targets and the pinned wasm-pack binary. Actions are pinned to commit SHAs. Pull requests cannot start the production job; workflow_dispatch on main can re-run the same pipeline.

vp check covers the app and toolchain configuration with lint and type checks. The legacy source has existing lint warnings, so CI gates errors and uses --quiet. Formatting is checked on the toolchain files and migrated tests; this migration does not reformat the entire game.

The production smoke check retries the complete HTML, asset and health check every two seconds, up to 31 attempts, so a transient asset 404 immediately after upload can settle. Persistent missing assets and incorrect MIME types still fail the run.

The configuration retains the `ASSETS`, `ROOMS`, `LOGIN_LIMIT` and `ROOM_PASSWORD` bindings, the SQLite `RailwayRoom` export, the 50 ms CPU limit and disabled Workers cache. The cf uploader preserves existing secret bindings. Deployment disables resource provisioning, so missing existing resources cause failure rather than creating a replacement namespace. It does not reset room data or change the shared password.

The deploy command uses `--force` to accept code and configuration from main when the existing Worker was last updated through the script API. Without it, cf aborts non-interactive uploads before changing the Worker. Main is the source of truth for code and configuration; external script-API edits will be overwritten by the next main deployment.

Only the API routes, WebSocket route and health route invoke the Worker before static assets. HTML uses no-store; hashed assets use immutable caching. After a successful deployment and smoke test, the workflow caches that release's assets. The next deployment also includes them, so already-open browsers can finish loading their existing chunks. Retention covers the current and immediately previous CI release; the initial CI run has no cache of the earlier manual deployment.

## Activate

Add the repository secret `CLOUDFLARE_API_TOKEN` at https://github.com/zunoser/multiplayer-trainsworld/settings/secrets/actions. Use a token restricted to deployment of this existing Worker in account `1ee487160d1c8983651d4fafc7be51c5`. The account ID is already configured in the workflow. Do not add `ROOM_PASSWORD` to GitHub or replace its existing Worker secret.

The token must allow the Worker upload and its existing bindings and custom domain to be read and maintained. Test the workflow with its dry run before the first production push. Secret values must never be committed or printed. The connected Pages and Cloudflare tools do not supply credentials to GitHub Actions, and the local 1Password MCP tools were unavailable during setup.

Merge this PR only after the token is configured and its checks are reviewed. Subsequent pushes to main deploy automatically. Roll back code through a reviewed revert on main; this does not roll back room data.

## Native Git integration alternative

Cloudflare's native repository integration can replace the Actions deploy step later. At setup time the Worker had no Git connection, and the GitHub Cloudflare app showed this transferred repository as a request. Resolve access at https://github.com/apps/cloudflare-workers-and-pages/installations/139420491 and then connect it in the Worker's Builds settings. Avoid enabling both production deploy paths simultaneously.

References: [Vite+ migration](https://viteplus.dev/guide/migrate), [Vite+ tasks](https://viteplus.dev/guide/run), [Vite+ tests](https://viteplus.dev/guide/test), [setup-vp](https://github.com/voidzero-dev/setup-vp), [cf in CI](https://developers.cloudflare.com/cf/ci/), [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/).
