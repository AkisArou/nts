# JetStream 3: FlightPlanner

This row transcribes JetStream 3.0's complete non-Unicode FlightPlanner workload.
Each original operation resolves all **100 flight plans five times**, retaining
all **1,010 airways**, **84,010 FAA waypoints**, and the original user waypoints.
It is real code compared with Node and Bun, without a C++ reference.

## Source and licence

Source revision: `WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b`.

- [airways.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/RexBench/FlightPlanner/airways.js)
- [waypoints.js.z](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/RexBench/FlightPlanner/waypoints.js.z)
- [flight_planner.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/RexBench/FlightPlanner/flight_planner.js)
- [expectations.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/RexBench/FlightPlanner/expectations.js)
- [benchmark.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/RexBench/FlightPlanner/benchmark.js)

The complete Apple 2017/2018 and Michael Saboff 2016–2017 BSD-2-Clause
notices remain in the transcribed files and are reproduced in
`../LICENSE-jetstream`. The complete 12,210,905-byte expanded waypoint source
and all recorded routes retain their original literals. Exact source hashes,
input counts, original observations and timing results are in
`source-audit.json`.

## Transcription and measured work

`Benchmark.runIteration` retains its original nested loops: clear and populate
the user waypoints, reset each flight plan, and resolve its route, for five
passes. `work(n)` repeats that complete operation `n` times and mixes the final
leg count of every plan into an unsigned checksum. It reads the original
constructed lists' stored counts, without calculating routes during timing.

The source driver runs `validate` after timing. The port preserves that
boundary: `render` invokes the unchanged `validate`, including every original
route equality check and five-second time tolerance, then returns all original
formatted route strings. `details` additionally observes every unrounded
computed double, time and leg field for independent correctness tests.
Neither observer is called by `work`.

The adaptations required by typed module code are:

- Script bindings become explicit imports and exports. Class fields and
  parameter/return types are declared; the source's singleton constructors,
  initial values, reset behavior and linked lists remain unchanged.
- The release selects the non-Unicode registration. Its identity keyword
  lookup and empty RegExp Unicode flag are bound explicitly; no Unicode
  workload is substituted.
- The fixed `Number.prototype.toRadians` and `toDegrees` extensions and their
  calls become typed helper calls with the identical multiplication/division
  expressions. The inventory expressly approves this syntax adaptation.
- Two comparisons of `toFixed` strings against `10` spell their existing
  numeric coercion as `Number(...)`. Erased non-null annotations express the
  same source invariants. Checked `Time` guards express calculation phases;
  they run only during validation.
- The dormant Date-only `Math.Round` misspelling is preserved with checked
  callable narrowing and the original TypeError behavior; it is not repaired
  to `Math.round`. A declaration-only overload admits the original ignored
  argument to `clearTrueAirspeedOverride` without changing its runtime body.
- Diagnostic messages are collected locally for tests instead of calling a
  host console. The unchanged original and the port both emit zero messages
  for the complete workload. The unused `createTestRoutes` source-fixture
  printer, whose original invocation is commented out, is not linked.

No compiler, harness, input-domain or oracle-count changes are included.

## Validation

Untouched pinned source files were loaded in their original order and run
under **Node 24.20.0**. All 100 original validation plans pass with no
diagnostics. The port and original agree byte for byte on both observations:

| Observation | Result |
| --- | ---: |
| Complete formatted route characters | 103,018 |
| Complete numeric/leg observation characters | 735,677 |
| `seed` | 1 |
| `work(0)` | 0 |
| `work(1)` | 4,156,792,939 |
| `work(2)` | 4,168,355,168 |
| Float64 checksum bits at `seed` | `41eef8740d600000` |

Formatted route SHA-256:
`19c05cce1a65de02b526b0ff2f25c1e211886b83ce2ab9361dc3c4c55e4d9179`.

Complete numeric/leg observation SHA-256:
`64b56ceaa99c3b9cafce632dfe91593ad91eb44b5bc2a2661760ac34b66c3c11`.

```sh
pnpm install
pnpm exec tsc --noEmit --strict --target ESNext --module NodeNext \
  --moduleResolution NodeNext --allowImportingTsExtensions --skipLibCheck \
  benchmarks/cases/jetstream-flight-planner/case.ts
node --test benchmarks/jetstream.test.ts
```

The exact PR layout passes **8 tests, 8 passed, 0 failed, 0 skipped**. The
original driver methods also match their upstream ASTs after type erasure and
static module binding removal.

Tests check original input-source hashes, all full outputs, original validation,
zero diagnostics, repeated-call stability, and opaque iteration counts. Tests
have no timers or speed-dependent assertions.

## Local timing

The unchanged `benchmarks/common/bench.mjs` measured five sequential fresh
Node 24.20.0 processes, each with its original warmup, calibration and best of
five trials. Process minima at `seed = 1` were **3.8663240, 4.0626607,
4.0381054, 4.7545816, and 3.8668160 ms**. The best local result is
**3.8663240 ms**, within the 1–10 ms policy without changing the original input
or number of passes. These are local scale measurements; maintainers perform
nts compilation, gate execution, oracle recording and final measurement.
