import { defineConfig } from "vite-plus";

export default defineConfig({
  defaultPackage: { dev: "trainworld/app", build: "trainworld/app", preview: "trainworld/app" },
  // Keep the established source layout; CI formats the toolchain files explicitly.
  check: { fmt: false },
  fmt: {},
  lint: {
    ignorePatterns: ["trainworld/tools/**", "trainworld/data/**", "**/dist/**", "**/src/wasm/**"],
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: [
      "trainworld/multiplayer/*.test.mjs",
      "trainworld/checks/{base64,competition-wire}.test.mjs",
    ],
    environment: "node",
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
  run: {
    tasks: {
      "wasm:track": {
        command:
          "wasm-pack build ../sim --target web --profile wasm --out-dir ../app/src/wasm/track --out-name sim",
        cwd: "trainworld/app",
        cache: false,
      },
      "wasm:demand": {
        command:
          "wasm-pack build ../sim --target web --profile wasm --out-dir ../app/src/wasm/demand --out-name sim -- --no-default-features --features demand",
        cwd: "trainworld/app",
        dependsOn: ["wasm:track"],
        cache: false,
      },
      "build:app": {
        command: "vp build",
        cwd: "trainworld/app",
        dependsOn: ["wasm:demand"],
        cache: false,
      },
      build: {
        command: [
          "node prepare-assets.mjs",
          "vp build",
          "node check-build.mjs",
          "vp exec cf deploy --prebuilt --mode production --dry-run",
        ],
        cwd: "trainworld/multiplayer",
        dependsOn: ["build:app"],
        cache: false,
      },
      check: { command: "vp check --quiet", cache: false },
      "format:check": {
        command:
          "vp fmt --check package.json bun.lock vite.config.ts tsconfig.json .github/workflows/deploy.yml trainworld/app/package.json trainworld/app/vite.config.ts trainworld/multiplayer/package.json trainworld/multiplayer/vite.config.ts trainworld/multiplayer/*.test.mjs trainworld/checks/base64.test.mjs trainworld/checks/competition-wire.test.mjs",
        cache: false,
      },
      "test:native": {
        command: "cargo test --release --quiet",
        cwd: "trainworld/sim",
        cache: false,
      },
      verify: {
        command: "vp test",
        dependsOn: ["check", "format:check", "test:native"],
        cache: false,
      },
      dev: {
        command: "vp run --filter trainworld --filter trainsworld-multiplayer --parallel dev",
        dependsOn: ["wasm:demand"],
        cache: false,
      },
      deploy: {
        command: [
          "vp exec cf deploy --prebuilt --mode production --provision=false --force",
          "node check-deployment.mjs",
        ],
        cwd: "trainworld/multiplayer",
        cache: false,
      },
      "assets:retain": {
        command: "node retain-current-assets.mjs",
        cwd: "trainworld/multiplayer",
        cache: false,
      },
      "test:competition": { command: "node trainworld/checks/competition.mjs", cache: false },
      "test:multiplayer": { command: "node trainworld/checks/multiplayer.mjs", cache: false },
      "test:lobby": { command: "node trainworld/checks/lobby.mjs", cache: false },
    },
  },
});
