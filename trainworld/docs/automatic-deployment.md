# Automatic deployment

The deployment workflow validates pull requests and deploys pushes to `main` to the existing `multiplayer-trainsworld` Worker at https://trains.aomona.me/. Pull requests never receive deployment credentials. No preview URL or workers.dev endpoint is enabled.

Each run installs locked npm dependencies, builds both WASM modules with wasm-pack 0.15.0, checks TypeScript, bundles the frontend and Worker, and tests the packaged HTML, JavaScript, CSS and WASM MIME types. The Worker bundler includes imported modules, including the competition module when that feature is merged.

The configuration retains the `ASSETS`, `ROOMS`, `LOGIN_LIMIT` and `ROOM_PASSWORD` bindings, the SQLite `RailwayRoom` export, the 50 ms CPU limit and disabled Workers cache. The cf uploader preserves existing secret bindings. Deployment disables resource provisioning, so missing existing resources cause failure rather than creating a replacement namespace. It does not reset room data or change the shared password.

The deploy command uses `--force` to accept code and configuration from main when the existing Worker was last updated through the script API. Without it, cf aborts non-interactive uploads before changing the Worker. Main is the source of truth for code and configuration; external script-API edits will be overwritten by the next main deployment.

Only the API routes, WebSocket route and health route invoke the Worker before static assets. HTML uses no-store; hashed assets use immutable caching. After a successful deployment and smoke test, the workflow caches that release's assets. The next deployment also includes them, so already-open browsers can finish loading their existing chunks. Retention covers the current and immediately previous CI release; the initial CI run has no cache of the earlier manual deployment.

## Activate

Add the repository secret `CLOUDFLARE_API_TOKEN` at https://github.com/zunoser/multiplayer-trainsworld/settings/secrets/actions. Use a token restricted to deployment of this existing Worker in account `1ee487160d1c8983651d4fafc7be51c5`. The account ID is already configured in the workflow. Do not add `ROOM_PASSWORD` to GitHub or replace its existing Worker secret.

The token must allow the Worker upload and its existing bindings and custom domain to be read and maintained. Test the workflow with its dry run before the first production push. Secret values must never be committed or printed. The connected Pages and Cloudflare tools do not supply credentials to GitHub Actions, and the local 1Password MCP tools were unavailable during setup.

Merge this PR only after the token is configured and its checks are reviewed. Subsequent pushes to main deploy automatically. Roll back code through a reviewed revert on main; this does not roll back room data.

## Native Git integration alternative

Cloudflare's native repository integration can replace the Actions deploy step later. At setup time the Worker had no Git connection, and the GitHub Cloudflare app showed this transferred repository as a request. Resolve access at https://github.com/apps/cloudflare-workers-and-pages/installations/139420491 and then connect it in the Worker's Builds settings. Avoid enabling both production deploy paths simultaneously.

References: [cf in CI](https://developers.cloudflare.com/cf/ci/), [Cloudflare project builds](https://developers.cloudflare.com/cf/projects/), [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/).
