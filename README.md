# trainsworld

A railway building game on a map of the whole world. You lay track and stations, set up lines, and
the game works out who rides your trains and who takes the car. It runs in the browser.

The game is at https://anita.garden/trainsworld/. This repository is its source.

Most of the code was written by Claude (Anthropic's AI model), working with Anita, who designs the game, plays it
and reviews the changes. The docs and this README were written by Claude too.

The page is TypeScript with MapLibre and Preact. The simulation and the demand model are Rust compiled to
WebAssembly. The city data is built by Python scripts, and the game fetches the built data when it runs.

Everything is in the `trainworld/` folder (the game was called trainworld while it was built), and the docs write
paths from this repo's root, so `node trainworld/checks/smoke.mjs` means what it says.

## Run it

Install [Vite+](https://viteplus.dev/guide/) and Rust through rustup. The repository pins Vite+ 1.7.0,
Node 24.22.0, Bun 1.3.12 and Rust 1.96.0. Vite+ selects Bun from the root packageManager field;
there is one workspace and one bun.lock for the app and Worker. bunfig.toml selects Bun's hoisted layout
for compatibility with the Vite dependency scanner on Windows.

```
vp env use 24.22.0 bun@1.3.12
vp install --frozen-lockfile
rustup show
cargo install wasm-pack --version 0.15.0 --locked
vp run dev
```

Open http://127.0.0.1:5173/. The development password is local-test-password. The dev task builds both WASM
modules, then starts Vite+ and the local Worker together. The first Rust build takes a few minutes.
If another runtime manager keeps Node in system-first mode, enable Vite+ Node management with
vp env on node, or prefix a command with vp env exec --node 24.22.0 --package-manager bun@1.3.12.

Run commands from the repository root:

| Command | Purpose |
| --- | --- |
| vp check --quiet | Lint and type-check the app and configuration |
| vp test | Run all JavaScript unit and Worker integration tests |
| vp run verify | Check toolchain formatting, lint/types, Rust and JavaScript tests |
| vp run build | Build both WASM modules, the app and Worker; check the packaged release |
| vp build | Build just the frontend, using the existing WASM output |
| vp run test:competition | Run the real-browser competition regression against the dev servers |
| vp run test:multiplayer | Run the real-browser cooperative regression |

Tests import vite-plus/test and run through vp test. Existing source formatting is preserved; CI checks formatting
of the toolchain files and migrated tests. The existing lint warnings are visible with vp lint; CI fails on errors.
See [the CI and deployment guide](trainworld/docs/automatic-deployment.md) for caches and release artifacts.

## Cooperative multiplayer

This fork adds password-protected rooms for up to five players to build one world together in real time,
using Cloudflare Workers and SQLite Durable Objects. See [multiplayer setup and limitations](trainworld/multiplayer/README.md).

## Data

The game needs city packs, terrain, outlines and real rail networks, about 6 GB in all. They are not in this repo.
With no `trainworld/data/packs` folder, the dev server fetches the files the page asks for from
https://data.anita.garden/trainworld/. A first session downloads tens of MB. The published version it reads is
named in `trainworld/data-version.txt`. To pin another one, set TW_DATA_VERSION before vp run dev. To stay
offline, set TW_DATA=off and fill trainworld/data/ yourself.

The basemap tiles come from OpenFreeMap and need no key.

A fork you host on your own site can read the same published data straight from
https://data.anita.garden/trainworld/<version>/ (the data host allows any site to read it). A build names its data
address in `index.html` (`tw-data`). Please keep to the published versions, and if your fork gets a lot of players,
host your own copy of the data.

You can build packs yourself with the scripts in `trainworld/pipeline/`, but a world run needs 30 GB of raw
downloads (OpenStreetMap extracts, GHSL, national censuses) and hours of compute. Treat the pipeline as a
reference for how the numbers are made unless you are adding a place. `trainworld/docs/adding-a-country.md` and
`trainworld/docs/world-run.md` explain the process. Parts of it name private tooling (an AWS account, a cores
ledger) that is not in this repo.

The game's account, leaderboard, community and feedback features talk to a server that is not part of this repo.
They stay off on localhost unless you run your own server and add `?acct=local`. The game plays fully without them.

The four building sounds are not included (see `NOTICE.md`). The game plays without them.

## Where things are

- `trainworld/SPEC.md` says what the game is and how it works.
- `trainworld/docs/` has the rules in detail, one file per area. `docs/code-map.md` says where each module lives.
- `trainworld/app/` is the page, `trainworld/sim/` the Rust crate, `trainworld/pipeline/` the data scripts.
- `trainworld/checks/` has the browser and Node checks. `checks/smoke.mjs` runs the main ones against a dev server
  that has data. Set `TW_CORES=3` to limit the cores a check's Chrome uses. Some older checks use paths from the
  author's machine.
- `trainworld/wiki/` has pages that explain the mechanics to players.

## Licence

The code is under the GNU Affero General Public License 3.0 (`LICENSE`). If you run a modified copy as a website,
you have to offer its source to the people using it.

The data is under the ODbL, and the fonts, flags and libraries keep their own licences. `NOTICE.md` lists each, with
the credits the data needs. The name "trainsworld" is not covered by the code licence.

Settings has links to the author's Ko-fi page and Discord, and the page has privacy and terms files that name
anita.garden. If you host a fork, replace them.

## Contributing

See `CONTRIBUTING.md`. Issues and pull requests are welcome.
