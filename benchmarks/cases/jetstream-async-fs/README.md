# JetStream 3: asynchronous filesystem

Source: [generators/async-file-system.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/generators/async-file-system.js), release revision `3967678fa8ab98d847ab33cf3728dba726fa854b`. The original Apple BSD-2-Clause notice and credits remain in `case.ts`.

## Full workload and checksum

The complete in-memory filesystem, original byte generator, async generators, visitors, awaits, byte-order work and deletion pass are retained. The original `MAX_DIR_COUNT = 2500` with its inclusive bound actually creates **2,501 directories**. It generates **800 files** and retains **739 files** after each original deletion pass. Every original count/hash validation remains.

`work(n): Promise<number>` resets only its scalar observation totals, performs n full preparations and iterations, and returns a checksum of the validated file count, directory count and actual final file hash. `seed = 1`; `work(1) = 437733167`, `work(2) = 438520877`. Zero iterations reject with the original missing-file-hash validation error. One `Benchmark` remains alive across work calls, including its previous filesystem until the next awaited preparation replaces it.

The standalone call includes the original `prepareForNextIteration()` before each original `runIteration()` to restore the complete input. **Timing is therefore setup-inclusive**; JetStream's driver prepares outside its measured iteration. No cached copy or shortened input substitutes for the original generator. `render(n)` is an untimed observer that returns every final path and byte.

## TypeScript adaptations and retained source behavior

Declared fields and discriminated listing records describe the original objects. Explicit branches narrow the original `instanceof` result while retaining property order. A checked filesystem access preserves the original unprepared-instance `TypeError`.

The original deletion-accounting expression lacks an `await`: it subtracts a Promise from a number and produces `NaN`. The port spells this coercion as `Number(dir.totalFileSize())`, preserving both the `NaN` result and the original pending asynchronous call. Adding an await here would repair the source instead of transcribing it, so the source behavior stays intact.

No file is read or written on the host. No Node module, external dependency, global patch or C++ reference is added.

## Correctness

Strict TypeScript passes. Untouched-source comparisons on Node **24.20.0** match every final path and byte for n = 1 and n = 2, all aggregate counts, and the actual final file hash **436945457**. The complete n = 1 snapshot serializes to 2,868,860 bytes with SHA-256 `1e59cf6f7cd3000017c5f73b0fb814545a4641f593b230a4831cd1e9243c08da`; n = 2 yields 2,868,861 bytes and `728e99652ed0d3d09a87cb11763f037d7cbcb5f73a53f84ed38eb46ff7de961f`. A structural comparison covers all 26 original functions and methods, with only the documented type-related normalizations. The shared test checks the complete snapshot hash, counts, repeated checksums and zero-iteration failure.

## Timing

Timing exception (approved): **20.513300500 ms at seed = 1 under Node 24.20.0**; one full iteration exceeds 10 ms and retains its complete original input.

A scratch awaited adapter uses the harness's original warmup, calibration and best-of-five loops, awaiting each complete call. This is provisional async timing; the repository harness is unchanged. Five sequential fresh processes were measured; the reported time is the lowest process result, for local scale only. Float64 checksum bits: `41ba17472f000000`. Maintainers compile with nts, record oracle counts and measure on their own machines.

## Draft status

This authorized async port stays a draft until the maintainers' awaited benchmark harness lands. Local timing uses a scratch adapter with the original warmup, calibration and best-of-five loops, awaiting every full call; the repository harness is unchanged. Maintainers compile with nts, record oracle counts and measure on their machines. A compiler refusal remains a finding.
