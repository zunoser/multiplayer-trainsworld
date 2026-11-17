# Snapshot and picture byte conversion

Room creation and each checkpoint encode the compressed save as Base64 on the main thread.
A joining browser decodes it before validation and loading. The limit is 2 MiB compressed;
checkpoints happen every 100 confirmed edits. Save thumbnails also use Base64 in the clock
worker and when downloading an account game's picture.

`app/src/base64.ts` uses a typed array's native `toBase64` when available. Older browsers keep
the previous chunked `btoa` encoder. Decoding still calls `atob`, preserving its whitespace,
padding and malformed-input behavior, then copies into one preallocated byte array. The old
`Uint8Array.from(string, callback)` iterated characters through a temporary list. Neither
the wire representation, image data URL, room protocol nor save validation/limits change.

## Measurement

Measured on Windows, Chrome 157, Vite 8.3.4. The benchmark loads only the codec module, with
no game, map or demand workers running. Chrome is pinned to one logical core (15, mask
`0x8000`). Three warm-ups precede 21 samples per implementation, alternating old/new order
each repetition on identical bytes. Both implementations run in the same browser process.
No other heavy job was launched by this chat during this timed interval; the desktop was
shared, background applications were not stopped, and these are not exclusive-machine results.

The small fixture is the tracked `T-007-real-nyc.save` (75,151 bytes). The limit fixture is
2,097,152 deterministic bytes, `byte[i] = (i * 31 + 17) & 255`, exercising the entire byte range.
The baseline is the exact previous room encoder/decoder, included in the benchmark.

| Fixture | Operation | Before p50 / p95 (ms) | After p50 / p95 (ms) |
| --- | --- | ---: | ---: |
| NYC save | Encode | 1.6 / 1.8 | <0.1 / 0.1 |
| NYC save | Decode | 4.3 / 5.1 | 0.2 / 0.8 |
| 2 MiB limit | Encode | 45.5 / 51.9 | 0.4 / 0.6 |
| 2 MiB limit | Decode | 160.7 / 197.9 | 8.2 / 10.4 |

These are synchronous conversion times, not end-to-end join times or FPS gains. Compression,
save validation, network transport, journal replay, demand solving and the simulation still
take their existing time. Browsers without native `toBase64` receive the decoder improvement
and retain their encoder's previous performance. No dependency or browser minimum was added.

Reproduce with a local Vite server, Playwright and Chrome as described in `multiplayer/README.md`:

```sh
node trainworld/checks/base64.mjs
node trainworld/checks/base64-perf.mjs http://127.0.0.1:6183/
```

The first check covers every byte value, empty data, padding, whitespace, malformed strings,
offset subarrays, chunk boundaries, the limit-sized payload, native dispatch and forced fallback.
The browser check exercises the real native API, fallback, and a module worker's transferred
round-trip result. Timings are reported rather than enforced with machine-dependent thresholds.

## Other paths investigated

Initial triage used the existing release-mode benchmarks, before changing application code:

- `track_bench 2000 500 60 5`: 2,068 route-km, 480 stations, 60 running lines; representative
  service/track edits 50–58 ms, unrelated new track 0.06 ms.
- `edit_bench` on the NYC save's extracted network at game time 111600, four repetitions:
  109 lines, mean/median edit 4.0 ms, maximum 4.5 ms.
- `boarding_bench` on that same network/time, two rider updates: three day kinds 254 ms;
  subsequent weekday updates 69/68 ms, with a maximum three-line step below 7 ms.
- `demand_bench --no-edit --no-periods`: fixed synthetic city, 152,683 cells, 434 stations,
  10.3 million subzone pairs. First mode-choice pass 566 ms of a 605 ms first estimate;
  complete free-flow/crowding recompute 1,204 ms.
- An Aside browser loaded the actual NYC save through the clock worker: 109 lines and
  1,627 hourly trips. Its initial paused-view draw average was approximately 3 ms. This
  startup observation is not a steady-state rendering benchmark.
- A separate six-second running sample in isolated Chrome, pinned to two logical cores
  with one demand worker, at Midtown zoom 14 drew 180 frames with a mean overlay draw
  of 0.69 ms (1,627 trips). The final sampled guard call was 0.4 ms. Five name edits during
  startup also exposed renderer-buffer rebuilding (24–347 ms) and state posting (6–140 ms)
  in the clock worker's existing timings. Downloads and startup work overlapped those
  edits; these exploratory timings are not suitable for an improvement claim. The empty
  initial demand solve was excluded from the demand measurement above.

An experimental early skip of empty rail-choice blocks covered only 20,841 of 1,293,926
blocks in the synthetic network and did not improve its mode-choice time. It was removed.
No demand approximation, schedule, passenger model, renderer, worker scheduling, UI or game
rule change is included. The retained change targets the measured snapshot conversion stall.

## Regression validation

Both WASM modules and the Vite production application build successfully. The sparse local
checkout reports missing optional map/data packs during bundling; runtime tests obtain the
needed packs through the existing Vite data fallback. The shared encoder also runs successfully
in a real module worker. TypeScript checking, `checks/base64.mjs` and all eight local
Workers/Durable Objects tests pass.

`checks/multiplayer.mjs` passes with real WASM: simultaneous construction and property edits,
named cursors/chat, late-join checkpoint decoding and journal replay, shared clock, local-save
protection, host handover and leaving. No Rust source changed; the existing demand-feature
failures are outside this change.

The lobby host/invite/join/resume/exit flow and 390 px mobile layout also pass. Its first run
timed out waiting for the host's participant label after joining; a retry with failure-only
diagnostics passed without application changes. The desktop was shared; the cause of that
single timeout was not established.
