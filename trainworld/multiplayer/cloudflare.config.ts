import { bindings, defineConfig, exports } from 'cf/config';
export default defineConfig({
  worker: {
    name: 'multiplayer-trainsworld',
    entrypoint: './src/index.mjs',
    compatibilityDate: '2026-11-17',
    assets: { runWorkerFirst: ['/api/*', '/multiplayer', '/health'] },
    bindings: {
      ASSETS: bindings.assets(),
      ROOM_PASSWORD: bindings.secret(),
      ROOMS: bindings.durableObject({ worker: 'multiplayer-trainsworld', exportName: 'RailwayRoom' }),
      LOGIN_LIMIT: bindings.rateLimit({ namespace: '901762011', simple: { limit: 10, period: 60 } }),
    },
    exports: { RailwayRoom: exports.durableObject({ storage: 'sqlite' }) },
    observability: { enabled: true, headSamplingRate: 0.1, traces: { enabled: true, headSamplingRate: 0.1 } },
    limits: { cpuMs: 50 },
  },
});
