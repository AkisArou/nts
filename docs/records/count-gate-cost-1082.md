# What a full instruction count costs, and whether nts-dev counts equal release counts (#1082)

The question: what shape the planned per-row instruction-count gate should
take (`docs/workflow.md`, "The full check's later additions"). Either a
landing-check step inside the ten-minute bound, or a post-landing full-check
step with a culprit search on a rise. The owner decided on 2026-11-26 that
per-landing performance proof is native instruction counts, not timed runs.

Measured on 2026-11-27 at `7d755be182`, which adds the phase record this
measurement reads. Count mode used to build each row's build recorder and
then drop it, and it timed neither the count driver nor the host columns.
Each counted row now writes `target/bench/phases/<row>.phases.json` (under
`count/` at the measured commit, where count runs were also named by their
driver label, such as `nts`, rather than by their table column) with:

- the row's wall time;
- the process's own CPU (capture, preparation and emission, checker threads
  included);
- its waited children's CPU;
- every build stage;
- each counted and host run's wall time and children's CPU.

The header names the file in one added `phase records:` line, and the table's rows are unchanged.

## Conditions

- The machine was shared with a landing gate run, a culprit search and other
  agents' work throughout. Every run used nice 19 and CPUWeight 20 under
  `admit.ts`, taskset `0-3,6-31`, so CPUs 4–5 were untouched. Counts ran on
  CPU 0.
- Wall times are inflated by that load: row wall was 1.57× row CPU for C and
  1.68× for LLVM. CPU seconds are the load-independent figures. The
  projections below use CPU.
- Raw evidence is in kept scratch `~/.cache/nts-scratch/1082/`:

  | Evidence | Files | SHA-256 |
  |---|---|---|
  | Per-row phase records, C | `full-c-phases/*.json`, concatenated in glob order | `814ffdcf7024f396fe811d32e732694b050a15c4cb4c0dbf606a7adb7959134e` |
  | Per-row phase records, LLVM | `full-llvm-phases/*.json`, concatenated in glob order | `eb55375717db5ed4630d495ecce17fc0a949f6fb11de7441c5ca90c5873b8354` |
  | Printed tables, C | `full-c.out` | `d8c7216cadff4431af0ee124948810a22e31810af10b2beea85b596645118042` |
  | Printed tables, LLVM | `full-llvm.out` | `4df0e3519ff342681f4a258fa75b802ae9bd3a171bd03c171ddcd547e1af4cf8` |
  | Dev-vs-release table | `equality.tsv` | `b45ff330e6014206cd3795c478dcc2716846597c5a8f8b13b9e22a14af311e72` |
  | Artifact hashes, first dev pass | `eq-dev-with-1.sha256` | `f4cfacc0d4eb79f9feb706a9fda2df76e985bfd2072df754781594a2bf44fc58` |

  The summarizers are `summarize.ts`, `rows.ts` and `project.ts` in the same
  folder.

## Building nts-bench

Both builds were `cargo build -p nts-bench --timings` through `admit.ts`.

| Profile | Wall | nts-bench binary unit | Ledger peak |
|---|---:|---:|---:|
| `nts-dev` (cold tree) | 61 s | 2.9 s | 3.70 GB |
| `release` | 276 s | 105 s (thin LTO, one codegen unit) | 3.76 GB |

The landing check already builds the compiler crates in `nts-dev`, so
nts-bench there adds seconds. A release build per landing would add minutes.

## Cost of a full count (as measured)

Each backend ran as one `NTS_BENCH_LANES=<lane> nts-bench --count` over all
benchmark rows. That is 172 workload rows; launch rows are never counted.

| | nts C (`lanes=c`) | nts LLVM (`lanes=llvm`) |
|---|---:|---:|
| Wall, serial | 69.4 min | 58.6 min |
| CPU, rows total | 2648 s | 2099 s |
| Admit ledger peak | 1.95 GB | 1.83 GB |
| Rows counted / failed | 140 / 32 | 148 / 24 |

### CPU by phase (CPU s)

| Phase | nts C | nts LLVM |
|---|---:|---:|
| Capture and checker (in process, three captures per row, #1110) | 829 | 806 |
| Emission threads: C | 120 | 162 |
| Emission threads: f64 | 56 | 66 |
| Emission threads: LLVM | 118 | 115 |
| clang compile + ThinLTO link, this backend | 662 | 473 |
| clang compile + link, C++ reference (`lanes=c` includes it) | 296 | — |
| Count driver, this backend | 33 | 35 |
| Count driver, C++ reference | 26 | — |
| Host columns: node, Bun JIT, Bun AOT, ScriptC (always run, #1110) | 284 | 295 |
| Build supervision (case-bound observer, unattributed waited children) | 223 | 147 |

Counting itself is about 1–2% of the cost. The cost is capture, clang, and
work the selected lane does not need. The `lanes=c` run's C++ reference
compile, link and count (322 CPU s) is work a nts-C-only count would not do.

### Rows that dominate the critical path (CPU s per row, as measured)

| Row | nts C | nts LLVM | Where it goes |
|---|---:|---:|---|
| jetstream-json-stringify-inspector | 358 | 337 | in-process checker over three captures; nts columns refused |
| jetstream-json-parse-inspector | 301 | 253 | the same |
| jetstream-stanford-crypto-aes | 285 | 59 | clang compile of the emitted C, 247 CPU s; link times out (standing BUILD_FAILED) |
| ares6-babylon | 173 | 201 | in-process checker |
| jetstream-flight-planner | 132 | 157 | in-process checker |

### Failed rows, kept apart

**Node oracle flakes (#1109).** host-columns counts node through the count
driver. Its probe calibration (n=1 minus n=0) goes negative when node's JIT
and GC threads vary. The node cell is then absent, and the row loses its
native counts with it.

- 26 rows failed this way in the C run: accumulate, awfy-queens, awfy-sieve,
  case-convert, case-convert-unchanged-greek, cyclic-churn, generic-classes,
  growth-fixed, in-narrowing, json-build-join, json-scan, map-literal-keys,
  module-closures, module-loop-plain, parse-int-decimal, parse-int-default,
  release-acyclic, sort-objects, str-append-length, str-compare,
  str-map-keys, str-search-defaults, strings, substrings, symbol-keys,
  upcast.
- 20 rows failed in the LLVM run: absences, array-copying-methods,
  awfy-list, awfy-permute, case-convert, closures, cyclic-churn,
  event-loop-promises, loop, module-loop-plain, module-loop-retained,
  node-buffer-alloc-small, objects, parse-int-default, parse-int-runtime,
  release-acyclic, str-index-read, str-map-keys, string-sort-control,
  symbol-keys.
- The two sets differ, and accumulate passed when counted alone straight
  afterwards. So these are load-dependent flakes, not row defects.

**Standing build failures** (BUILD_FAILED in the 2026-11-27 nightly as well):

| Row | Failure |
|---|---|
| awfy-json | C: `-Wunneeded-internal-declaration` on a dispatch function |
| octane-navier-stokes | C: incompatible pointer types |
| jetstream-offline-assembler | invalid HIR, BrokenBase |
| jetstream-lebab-wtb | does not typecheck |
| jetstream-stanford-crypto-aes | link timed out |
| jetstream-ai-astar | clang or link timed out |

The first two fail only on C; the other four fail on both backends.

## Projection with #1109 and #1110 fixed

The C-only shape models one capture, one emission, this backend's builds and
count, no reference or host columns, and an oracle checksum that is recorded
or comes from an uncounted node run (not modelled):

- per row, the in-process CPU keeps one third of the checker share and drops
  the other emissions;
- the backend's own clang and link and its count are kept;
- the supervision share is scaled by the builds kept.

Makespans schedule rows longest first over N slots, CPU-bound.

| Shape | Rows | CPU total | 1 slot | 8 slots | 24 slots |
|---|---:|---:|---:|---:|---:|
| nts C, as measured | 172 | 2648 s | 2648 s | 358 s | 358 s |
| nts LLVM, as measured | 172 | 2099 s | 2099 s | 337 s | 337 s |
| nts C, #1109 + #1110 fixed | 172 | 1234 s | 1234 s | 268 s | 268 s |
| nts LLVM, #1109 + #1110 fixed | 172 | 1086 s | 1086 s | 136 s | 111 s |
| nts C, fixed, standing BUILD_FAILED rows left out | 166 | 924 s | 924 s | 118 s | 118 s |
| nts LLVM, fixed, standing BUILD_FAILED rows left out | 166 | 980 s | 980 s | 123 s | 111 s |

At 24 slots the critical path is one row, so more slots stop helping:
jetstream-json-stringify-inspector's single capture takes about 110–120 CPU s.
On a machine as loaded as this one, the observed 1.6× wall factor turns
118 s into about 3 minutes.

## Dev-vs-release counts

nts-bench was built in `nts-dev` and in `release` at the same commit. Nine
rows were counted with no lane filter, in alternating passes: dev, release,
dev, release. The rows were fib, map-and-set, json-parse, str-concat-pair,
awfy-nbody, event-loop-promises (libuv host), clbg-binary-trees,
jetstream-gaussian-blur and generator.

After each pass, 129 artifacts were hashed: every row's `.specialized.c`,
`.plain.c` and `.specialized.ll`, its driver, its linked `nts`, `ntsllvm`,
`ntsf64` and `C++` binaries, and its JVM classes. **All four passes are
byte-identical.** The two profiles emit the same programs and link the same
binaries, so they count the same work.

The `nts-dev` profile's debug assertions and overflow checks change nothing
emitted.

| Row | Column | nts-dev counts | release counts | spread of all four (bp) |
|---|---|---|---|---:|
| awfy-nbody | nts C | 134750687 134750926 | 134750923 134750922 | 0.02 |
| awfy-nbody | nts LLVM | 142000928 142000928 | 142000927 142000927 | 0.01 |
| awfy-nbody | C++ | 129000453 129000456 | 129000455 129000453 | 0.01 |
| awfy-nbody | ScriptC | 165251598 165251598 | 165251594 165251595 | 0.01 |
| clbg-binary-trees | nts C | 53447178 53447178 | 53447190 53447177 | 0.01 |
| clbg-binary-trees | nts LLVM | 53447172 53447173 | 53447173 53447146 | 0.01 |
| clbg-binary-trees | C++ | 232722244 232722244 | 232722244 232722243 | 0.01 |
| clbg-binary-trees | ScriptC | 48074434 48074718 | 48074717 48074717 | 0.06 |
| event-loop-promises | nts C | 281969 | 281968 281968 | 0.04 |
| event-loop-promises | nts LLVM | 280347 | 280347 280347 | 0.00 |
| event-loop-promises | ScriptC | 335054 | 335054 335054 | 0.00 |
| fib | nts C | 6356233 6356233 | 6356233 6356233 | 0.00 |
| fib | nts LLVM | 6356231 6356231 | 6356231 6356231 | 0.00 |
| fib | C++ | 6431171 6431248 | 6431248 6431248 | 0.12 |
| fib | ScriptC | 11845095 11845095 | 11845095 11845095 | 0.00 |
| generator | nts C | 2060433 2060433 | 2060433 2060433 | 0.00 |
| generator | nts LLVM | 2060436 2060436 | 2060436 2060436 | 0.00 |
| generator | C++ | 2065508 2065508 | 2065508 2065508 | 0.00 |
| generator | ScriptC | 37987737 37988133 | 37988133 37988134 | 0.11 |
| jetstream-gaussian-blur | nts C | 273467759 273467977 | 273467987 273467983 | 0.01 |
| jetstream-gaussian-blur | nts LLVM | 331445682 331445677 | 331445679 331445675 | 0.01 |
| jetstream-gaussian-blur | ScriptC | 187437477 187437483 | 187437486 187437482 | 0.01 |
| json-parse | nts C | 21219209 21219210 | 21219210 21219209 | 0.01 |
| json-parse | nts LLVM | 21538351 21538352 | 21538351 21538352 | 0.01 |
| json-parse | ScriptC | 22400991 22400990 | 22400992 22400991 | 0.01 |
| map-and-set | nts C | 135209 | 135209 | 0.00 |
| map-and-set | nts LLVM | 135465 | 135465 | 0.00 |
| map-and-set | C++ | 425393 | 425393 | 0.00 |
| map-and-set | ScriptC | 105852 | 105852 | 0.00 |
| str-concat-pair | nts C | 71497 | 71497 | 0.00 |
| str-concat-pair | nts LLVM | 70219 | 70219 | 0.00 |
| str-concat-pair | C++ | 63897 | 63897 | 0.00 |
| str-concat-pair | ScriptC | 261046 | 261046 | 0.00 |

Every difference is inside the 1 bp native band. The same spread appears
between two passes of one profile: fib C++ gave 6431171 and 6431248 from the
dev build, with identical binaries. Native counts of one binary are not
bit-identical from run to run, so a gate compares counts against the band.
Comparing the linked binary's hash is exact.

Five row-passes lost their row to the #1109 flake: map-and-set twice,
str-concat-pair twice, and event-loop-promises once. That is why some cells
hold one count instead of two.

## The phase writer leaves the instrument unchanged

fib, awfy-towers and awfy-nbody were counted with the binary built at the
parent commit (no writer), then with the writer's binary. Both ran from the
same tree and the same `nts-dev` profile, in the order without, with,
without. In the third pass awfy-towers lost its row to the #1109 flake.

| Row | Column | without (pass 1) | without (pass 2) | with |
|---|---|---:|---:|---:|
| fib | nts C | 6356234 | 6356233 | 6356233 |
| fib | nts LLVM | 6356231 | 6356231 | 6356231 |
| fib | C++ | 6431248 | 6431248 | 6431233 |
| fib | ScriptC | 11845095 | 11845095 | 11845095 |
| awfy-nbody | nts C | 134750923 | 134750690 | 134750930 |
| awfy-nbody | nts LLVM | 142000932 | 142000930 | 142000935 |
| awfy-nbody | C++ | 129000454 | 129000453 | 129000453 |
| awfy-nbody | ScriptC | 165251597 | 165251596 | 165252950 |
| awfy-towers | nts C | 677920 | — | 677920 |
| awfy-towers | nts LLVM | 645095 | — | 645095 |
| awfy-towers | C++ | 347328 | — | 347328 |
| awfy-towers | ScriptC | 2592185 | — | 2592185 |

Every "with" count is within the no-writer repeat spread or the 1 bp band.
The largest gap is ScriptC awfy-nbody at 0.08 bp. The count path itself is
untouched: the writer only reads the clock and `getrusage` around it. The
count-bands and count-driver tests pass with the writer present.

## Recommendation

The landing bound of ten minutes decides it.

- **As measured, a per-landing count does not fit.** Both backends together
  are 4747 CPU s, 79 CPU-minutes. Even at the gate's 24 slots the critical
  path is a 358 s row, and at the observed load factor that is about
  10 minutes before the landing's own build and tests. Serially it is more
  than two hours. About half of that CPU is work the gate does not want
  (#1110), and about 15% of rows fail at random (#1109), which would make the
  step red without a change. Neither can go into a landing.
- **Once #1109 and #1110 are fixed, a landing step fits.** C and LLVM
  C-only work comes to about 1900–2300 CPU s, roughly 32–38 CPU-minutes per
  landing, and the 24-slot makespan is set by one row, at 118–268 s. The
  268 s is jetstream-stanford-crypto-aes's clang compile, a standing
  BUILD_FAILED row that a gate would refuse or skip rather than count.
  Without the standing failures the critical path is about 2 minutes of CPU,
  about 3 minutes at this machine's load factor. That is under the bound, if
  the step runs its rows as pooled cases across the landing's slots.
  - Build it in `nts-dev`: the counted programs are byte-identical to
    release, and nts-bench costs about 3 s there against minutes for a
    release build.
  - Compare per-row native counts against the band.
  - Skip clang and the count for any row whose linked binary hash equals
    main's recorded one. The count is a function of the binary, so an
    unchanged binary needs no count. Capture and emission (about 400 CPU s
    per backend, one third of the checker share included) still run for
    every row, because they produce the binary to hash.
  - Leave the reference and engine columns to the nightly. They do not
    depend on the change.
- **Until then: a post-landing full-check core step with a culprit search.**
  It counts nts C and nts LLVM on each new main and compares each row with
  `verified`'s counts against the band. On a rise past the band, it bisects
  to the first commit whose count for that row rose and reverts it as for any
  red. It runs off the landing's clock, so the as-measured cost (about 80
  CPU-minutes, about 6 minutes at 24 slots) is acceptable there. It moves
  into the landing check when #1109 and #1110 land and a measured run of the
  fixed shape confirms the projection above.

The heaviest remaining row is a single capture of
jetstream-json-stringify-inspector, about 110–120 CPU s, nearly all checker
time. It sets the landing step's floor. Under the compile-speed policy it is
a candidate only if it proves super-linear.
