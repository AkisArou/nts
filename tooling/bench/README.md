# nts-bench counting mode

Counting mode answers "how many user-mode instructions does this fixed
workload execute" instead of "how long did it take". Instruction counts at
fixed N are the primary signal on a loaded machine: load moves wall time, it
does not move how much work a loop does.

```
tooling/gate/with-lock.sh --no-quiet-wait \
  target/release/nts-bench --count --out <dir> [case...]

tooling/gate/with-lock.sh --no-quiet-wait \
  target/release/nts-bench --count --against <baseline-nts-bench> \
  --out <dir> [case...]
```

`--against` drives a B/F/B/F/B comparison (baseline, foreground alternating,
baseline last) so drift during the run shows in the bracket arms instead of in
the verdict. `--plan <file>` reuses a frozen calibration plan (warmups and
checksums included); `--fixed-n <n>` overrides the calibrated N for a row set
whose calibration would wander. Count runs are evidence only: they never
publish the README table.

v1 counts the node and nts Wasm columns. Other columns are named unsupported
selections until their own drivers speak the protocol below.

## The loop-control protocol (driver spec)

The protocol belongs to the counting mode, not to any one driver. A driver in
any language (the JS harness today; the native C and LLVM drivers next) speaks
it without the coordinator changing.

The coordinator starts `perf stat -D -1 --control fifo:<ctl>,<ack>` — counter
built and *disabled* — and passes the driver four environment variables:

| Name | Meaning |
|---|---|
| `NTS_BENCH_COUNT_MODE` | `calibrate` or `count` (unset: normal timing) |
| `NTS_BENCH_COUNT_N` | exact measured-loop iterations (`count`) |
| `NTS_BENCH_COUNT_WARMUP` | exact warmup iterations before enabling |
| `NTS_BENCH_COUNT_CONTROL` | path of the control FIFO (driver writes) |
| `NTS_BENCH_COUNT_ACK` | path of the ack FIFO (driver reads) |

A `count` driver must, in order:

1. Run the workload once and keep its f64-bit checksum (the same 16-hex
   spelling every bench column uses).
2. Run exactly `WARMUP` untimed iterations.
3. Write `enable\n` to the control FIFO, then read the ack FIFO until `\n`;
   the reply is `ack\n`, possibly with NUL bytes around it — perf appends a
   NUL after `ack\n`, which can prefix the next acknowledgement. Strip NULs
   and require exactly `ack\n`. Do not start the loop before the ack: the ack
   is what proves the counter is live.
4. Run exactly `N` iterations, accumulating results into a sink the optimiser
   cannot remove, timed as a secondary observation.
5. Write `disable\n` and consume its ack the same way. Exactly one
   enable/disable pair per process.
6. Print one JSON line: `{"checksum","warmup","n","elapsedNs","nsPerOp","sink"}`.

The count therefore includes the same small timer/control bookkeeping
between enable and disable in every arm, and nothing else: no process
startup, no compilation, no warmup.

A `calibrate` driver prints `{"checksum","warmup","nsPerOp","reps"}` after a
bounded warmup (20,000 calls or 300 ms, whichever ends first) and a doubling
probe. Calibration output chooses N; it never enters a result table.

The coordinator requires exactly one numeric `instructions` row in perf's
CSV at 100.00% counter time. `<not supported>`, `<not counted>`, a missing
ack, a nonzero child, a moved plan or a checksum that disagrees with node
each fail the cell loudly, with raw artifacts kept. Nothing retries a failed
cell invisibly.

Every cell runs in its own process group under a deadline (120 s; 600 s for
preparation) with its streams filed in the cell's directory. At the deadline
the group is killed and the cell fails: a perf that dies or hangs mid-cell
must never keep the coordinator — and with it the measurement lock —
waiting. A resumed run refuses cells counted under a different plan
rather than mixing two fixed works into one ratio.

## Preparation and the A/B overlay

Preparation (same compiler roots and generated call as timed mode) runs as a
child of the binary that owns the arm: the `--against` binary prepares B,
this binary prepares F, via the internal `--count-prepare <dir>` mode. A
same-binary diagnostic comparison (one compiler flag spelled two ways)
passes its baseline-only environment through the one documented name:

```
NTS_BENCH_COUNT_BASELINE_ENV='NTS_SOME_FLAG=1;NTS_OTHER=0'
```

`;`-separated `KEY=VALUE` pairs, applied only to the baseline preparation
child, never to the coordinator's own environment.

Both sides' binaries must speak counting mode: a baseline older than this
mode has no `--count-prepare` and the run says so rather than counting
something else. To A/B against an older compiler, build its tree with this
commit's bench tooling on top — preparation is bench-side, the artifacts
still come from that tree's compiler.

## Admission

Counting is a quality gate per cell, inside nts-bench, still under the
measurement mutex. Memory policy mirrors `tooling/gate/admission.ts` exactly:
hold below 12 GiB available, resume at 14 GiB, start held — that file is the
policy, the Rust constants are a copy. On top of it, a measurement-quality
window: 10 s swap-out mean at most 25 pages/s and no sampled second above
200, with no CPU-idle requirement. Each cell records its admission window
and CPU 4-5 activity; wall ratios from count runs are loaded observations,
never quiet-core claims. `with-lock.sh --no-quiet-wait` keeps the mutex and
skips the reserved-core quiet wait for these runs.

## Output

`<out>` holds `plan.json`, `REPORT.json` (every selected row, absences and
losers included), `ALL-ROWS.md` and `CELL-CONDITIONS.tsv` once every selected
row completes, plus per-arm artifacts with sha256 hashes, calibration runs,
and each counted cell's `perf.csv`, stdout, stderr and process conditions.
Re-running the same command resumes: completed cells whose hashes still
match are skipped, never re-prepared.

`NTS_BENCH_COUNT_PERF` names a different perf executable. It exists so the
protocol and its failure paths are testable with a controlled perf stand-in,
without any host perf configuration.
