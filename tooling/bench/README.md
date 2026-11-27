# Immutable run records and comparators

`nts-bench` publishes through `run-record.ts`, the same typed authority used by
comparator sittings. It validates the inventory and every cell, derives policy v1
from [The bar](../../docs/README.md#the-bar), and creates one immutable JSON file
under `results/benchmarks/runs/`. Each native backend faces every comparator
independently. The rendered `full.md` uses the newest complete run; partial runs
remain records of their own. Each backend/comparator pair compares its within-run
ratio with its best prior ratio on the same machine, source/input inventory and
timing contract. A regression exceeds max(1.05, the product of the current and
prior backend and comparator spreads). The report retains all four factors,
their product, the comparator, compiler and run. Invalid, unverified or missing
pairs remain unestablished. A backend regresses only when every established
comparator regresses, with at least one established pair. Individual comparator
flags remain visible as observations. Absolute times are information only.
`node tooling/records/summary.ts benchmarks` prints the same model as JSON, with
each backend's ratios to the C++ and Java references beside it; the benchmark
summary contract is version 4 and its definition is
that file's header.

The standing engine columns are node, Bun JIT, Bun AOT and ScriptC. `comparators.json`
declares their versions, commits and artifact checksums. Installed inputs are read
from `NTS_BENCH_COMPARATOR_CACHE` (default `~/.cache/nts-comparators`). Measurement
never downloads or builds an engine. A missing artifact is an absent cell with a
reason; an installed artifact with the wrong checksum is an instrument error.
Bun JIT and AOT use the same verified binary; AOT runs an executable made by
`bun build --compile --aot`. ScriptC always receives `--node-islands=off`, with no
explicit Node bridges. Refusals, aborts, build failures, CPU-budget exhaustion and
hangs retain their status and command receipts rather than a timing.

All four engines execute one typed projection of the canonical JS timer. The
projection changes types only; every call reloads the exact input bits through
atomic storage and consumes the accumulated result after timing. Each column
keeps five process attempts, its spread, checksum, exact commands and build cost.
Cold process launch through the first completed workload is measured separately
from warm throughput, by the launch timer below: one launch of the same body,
before any warm-up, recorded in the cell's details as `coldStartup` with its
`protocol`. Details written before the timer carry no protocol, and two
cold-startup observations compare only under one named protocol. Builds exclude
CPUs 4–5; timed launches use CPU 4 under the ordinary measurement lock, with
sibling counters and machine conditions retained.

# Launch rows

A case directory holding `launch.json` is a launch row: its `case.ts` is a
whole program with no exported workload, launched by the launch timer below.
The marker's one reader is `launch-marker.ts`. Exactly
`{"metric":"launch-to-exit"}` makes each cell the time from process launch to
exit; `{"metric":"executable-size"}` selects the size instrument, and the peak-RSS form is in "Peak-RSS rows" below. Any other content of the
marker is an error. The `startup` group's rows are launch-to-exit rows.

- **What is launched.** nts C and nts LLVM are the executables `nts build`
  makes, from a generated project whose config declares one `app.cli` product
  per backend, with the `nts` beside `nts-bench`. Both binaries embed a
  digest of the files under their source roots as they were built
  (`tooling/cli/source-roots.txt`, `tooling/cli/source_identity.rs`); a run
  requires `nts-bench`'s, and a launch row the `nts` one `nts version` names,
  to equal the measured commit's (`source-identity.ts`). A commit that
  changes none of a binary's roots changes neither its digest nor its build.
  Every repository file Cargo's dep-info for a binary names (what rustc and
  its build scripts read) must lie under its roots or a content-pinned path,
  or the run refuses that binary; the nightly copies each binary's `.d`
  beside it. A test also holds each list to its crate's `cargo metadata`
  path-dependency closure. Each launch row is measured at the session's own
  commit, and the record refuses one that was not. Node and Bun JIT run `case.ts` itself with no
  flags; Bun AOT and ScriptC are built from it as for throughput rows. nts JVM
  is `NOT_RUN` and C++ and Java `NOT_PROVIDED`, each with its reason. A cell's
  details name its recipe, command, artifact digest and argv.
- **The timer** (`launch.c`, built with clang and driven by `launcher.ts`;
  C because the per-child `wait4` rusage it needs has no safe Rust binding
  here, and the workspace forbids unsafe code) pins itself to CPU 4 and sets
  its CPU and core limits once; children inherit them, so no wrapper process
  is inside the window. Each launch is `clock_gettime(MONOTONIC)`,
  `posix_spawn`, `wait4` on that pid, `clock_gettime`. While a child runs the
  timer only waits. A child's stdout and stderr go to files opened before the
  clock starts and read after the sitting, so a child never blocks on output.
  Each launch keeps its wall time, exit status or signal, whether it passed a
  bound (the wall bound killed it, or its own CPU time reached the CPU bound),
  wait4's user and system time and peak RSS (an observation only; size and
  RSS rows are their own instruments), and the user and nice ticks of the
  timed CPU's sibling 5 around it. Those ticks are 10 ms, so for a launch of
  a few hundred microseconds a non-zero count shows the sibling ran a program
  and a zero shows little; the row's spoil check over the whole case is the
  disturbance control.
- **One sitting per row.** Every column, and `/bin/true` as the timer's own
  floor, launch in rotating rounds (round r starts at column r): three warm-up
  rounds, which only warm the page cache, then 21 timed rounds. All columns
  share one cwd (the repository) and one environment: `HOME` and `TMPDIR`
  empty directories of the sitting, `PATH=/usr/bin:/bin`, `LANG=C.UTF-8`,
  `TZ=UTC`, and nothing inherited, so no comparator cache is switched on by
  ours. The environment's digest is in every cell.
- **The cell** (`launch-cell.ts`, `launch-to-exit-v1`): every launch exited 0
  within its bound and printed the same stdout. The value is the median of the
  21 timed launches, the spread the ratio of their upper to lower quartile, the
  checksum the stdout's SHA-256 prefix. Node's output is the oracle, as for
  throughput rows. That checksum holds the executable `nts build` ships; the
  case's `case.ts` is also a whole program to the differential, recorded as a
  `program` row and compared whole with node by `nts check`
  ([cli](../../docs/reference/cli.md#nts-check)), on C, LLVM and the JVM, by
  the gate's `launch-agree` step at every landing that touches a case. A row
  refused by name stays listed in `LAUNCH_DECLINES`
  (`tooling/gate/verdict-policy.ts`), with the refusal it must still decline
  with, until its task lands. A non-zero exit or signal is `ABORTED`, a launch past its
  bound `TIMED_OUT`, launches of one column that print different output
  `INVALID`. A record reader derives the value, spread and checksum again from
  the launches; a missing, short or inconsistent launch list is refused.
- **The row** carries `kind: "launch"`; throughput rows carry no kind, and a
  row's own best comes only from rows of its kind. The floor and the sitting's
  provenance are in the row's conditions. `--count` does not count launch rows.

# Executable-size rows

A launch case with `{"metric":"executable-size"}` in `launch.json` records
whole-file bytes from the same product that the launch timer runs. The
`executable-size` group names hello world, the JSON/builtins program, and
FlightPlanner, the largest benchmark by case-local TypeScript source bytes.
FlightPlanner calls its original workload once; a refusal stays visible rather
than substituting a smaller program. New cases and cells land pending; build
records and the nightly immutable run writer measure them after landing.

The headline is **as-shipped executable bytes**: exactly the file `nts build`
makes, with whatever runtime it links into that file. The same rule holds for
Bun AOT and ScriptC. Shared libraries, including libc and any shared runtime,
are listed separately with their resolved paths, whole-file bytes and SHA256;
those bytes are never silently added to any column. The product's ELF
interpreter and DT_NEEDED names disclose its linkage. Static dependencies are
already part of its file bytes. Bun AOT embeds Bun's runtime. Node and Bun JIT
produce no standalone product for this source, so their size cells are absent
with that reason; node still verifies each product's output. JVM, references
and missing or failed comparators retain their own absent reasons.

`executable-size.ts` consumes the timed executable once, before cleanup. It
copies it privately, applies `llvm-strip --strip-all` to the copy, and measures
that file too. It never rebuilds or changes the shipped product. The same
clang driver selected by the nts build recipe resolves its own installed
`llvm-strip`; strip must be beside clang and match its LLVM major.minor.
No host-strip fallback is allowed. Both tools' paths, versions and SHA256 and
the strip arguments are retained. The stripped product must execute and match
the original and node output. A missing, empty, non-ELF or malformed artifact,
a failed strip or an inconsistent receipt is an instrument error, never a size.

`kind: "executable-size"` cells retain the launch observations and a strictly
checked `executableSize` receipt (`executable-file-bytes-v1`). Both shipped and
stripped views have separate within-run ratios, bar verdicts and own-best
histories; `full.md` shows both, including losses. Bytes have spread 1; timing
noise supplies no size allowance. Stripped histories additionally require the
same strip version and SHA256 in both columns. Both histories require the
same effective build recipe (flags, product and backend; paths and untimed CPU
masks are normalized). Shipped histories do not depend on strip identity. Dynamic closure size is disclosed separately in either view.
The record readers derive and check both sets of verdicts. A review sitting's
run JSON stays in kept scratch, cited by path and SHA256; only the nightly
writer publishes the official run after landing.

# Peak-RSS rows

A launch row whose `launch.json` is
`{"metric":"peak-rss","case":<case>,"function":<name>,"input":<number>}` is a
peak-RSS row: it calls that case's workload once at that input, and its cells
rank by peak resident set. A peak-RSS row is named `rss-<case>-<input>`, and a
case is measured at two or three sizes.

- **The program.** Its `case.ts` is exactly the text `peakRssProgram` derives
  from the marker (`launch-marker.ts`): an import of the case's workload and
  `console.log(<function>(<input>))`. The input is a literal, so each size is
  a program of its own, built per row: nts does not provide `process.argv`
  (#871), so one binary cannot be launched at three inputs. The input must lie
  inside the case's declared domain for that function's one parameter
  (`case.domains.json`: its minimum, maximum and integer flag). A marker
  with another field, a case without that domain, an input outside it, or a
  `case.ts` that differs from the derived text refuses the row as an
  instrument error.
- **What is launched** is what a launch row launches (above), with the same
  recipes. Every column's measured process is the program itself, and wait4
  reports that pid: nts C and nts LLVM are the executables `nts build`
  makes; Bun AOT and ScriptC are the executables their builds make, executed
  directly; node and Bun JIT run `case.ts` in their own process and start no
  child process (their workers are threads, whose memory is the process's).
  wait4's ru_maxrss covers a child and the descendants it reaped, so a
  wrapper could only add to a value, never hide one. nts JVM and nts f64 are
  `NOT_RUN`, C++ and Java `NOT_PROVIDED`, each with its reason.
- **The cell** (`peak-rss-cell.ts`) is a launch cell (`launch-to-exit-v1`)
  with `peakRss`: the median of its 21 timed launches' ru_maxrss in bytes
  and their interquartile ratio, from the same wait4 that ends each launch's
  time. So a cell shows memory beside time from one run, not from a second
  sampler. A launch with no resident set, or a recorded `peakRss` its
  launches do not derive, is refused by every record reader. An absent cell's
  `peakRss` is null.
- **Growth proves the work ran.** A literal input could let a compiler fold
  the work away. A run derives each column's growth over a case's rows
  (`growth` on each row, checked like the verdicts): `GROWS` when the column
  ran at two or more sizes and its time rises strictly at every larger input,
  `FLAT` when it did not, `UNESTABLISHED` below two sizes. Time is the
  counterfactual to folding: folded work takes no longer at a larger input.
  Memory is the ranked value and takes no part in growth, since doing the work
  in constant memory is the best outcome a peak-RSS row can show. A
  comparison involving a column that does not grow is `SUSPECT`, with its
  ratio, and is never ranked, nor a source of own best. Every OK cell's output
  must match node's at its size, as in every row.
- **Verdicts** hold the bar's ratios to peak bytes: at 0.8× node's or Bun
  JIT's bytes or less a row is won, short up to 1×, and lost above; against
  Bun AOT and ScriptC it is won below 0.95×, tied within max(1.05, the two
  cells' RSS spreads), and lost above. Own best compares the same row kind's
  bytes ratios. The row carries `kind: "peak-rss"` and `sized`, the case,
  function and input.
- **Baselines.** `full.md`'s peak-RSS section names startup-empty's peak RSS
  in the same run per column (each runtime's footprint doing nothing), and
  each row's `/bin/true` floor from its own sitting, so a runtime's baseline
  and its work can be read apart.

The workload inventory comes from the snapshot already captured by `case()`:
normalized URI, the native producer's `xxh3-128-le-checked-utf8-v1` content digest
and transform identity, sorted and framed with exact input bits. This is checked
UTF-8 source text after native decoding and overlays, not a digest of disk encoding
or a later reread. Declarations remain in that graph; their inventory, build recipes and toolchains
have separately retained provenance. The compiler artifact is hashed and its build commit is recorded.

For an agent's review evidence, use
`nts-bench --sitting ~/.cache/nts-scratch/<N>/sittings/<id>/ [case ...]`
(or combine `--sitting` with `--group`). The named directory must be fresh and
outside the repository, including after resolving symlinks. The same measurement,
sealing, validation, verdicts and `renderFull` produce `<run-id>-sitting.json`
and `full.md` there. A partial sitting's page shows its selected rows against
published history. Both outputs identify themselves as a sitting; its JSON has
`purpose: "sitting"` and an id ending in `-sitting`. Publication and the published
store reader refuse it. Cite the scratch path and SHA-256 in the task's record.
The command leaves `results/`, Git HEAD and the index untouched; it creates no
results commit to drop. Count, render and journal modes cannot combine with
`--sitting`.

The nightly command omits `--sitting` and keeps the published path:
Each completed run is published atomically and followed by a results-only commit.
The index must be clean; only the new record and generated page are staged.
`--render` regenerates the page without restamping an old observation. Historical
imports use explicit one-way adapters in `legacy-record.ts`; unknown facts remain
null and pre-correction invalid timings stay invalid.

# Counting mode

`nts-bench --count [case ...]` (or `--count --group <name>`) counts instead
of timing: one count-driver owner serves native, Java and JS columns. It
chooses repetitions from an instruction-count probe, uses that fixed work
for warmup, and subtracts a matching empty bracket from the work bracket.
Wall time never chooses the repetitions. Each counter is pinned to one CPU
outside the measurement pair 4–5. The printed cell is net instructions per
operation, beside each column's empirical repeat range from the
tool-written `results/benchmarks/count-bands.json` cohort. Native repeatability
is checked tightly; JIT tiering spread is reported without refusing a landing.
The range describes that cohort, not a guarantee about a future JIT draw.
`node tooling/bench/count-bands.ts --cohort <runs.json> --provenance <origin.json>
--record` writes a complete measured cohort; it retains samples and provenance,
and the reader recomputes the ranges before using them. No measurement lock
is taken and no run record is published, so counted runs proceed in
parallel; a timed row still comes from a locked session on CPU 4. The
checksum agreement a timed row keeps is kept here too: calibration and
the counted run must print the same checksum, and every column must agree
with node, before any count prints.

Each counted row also writes its cost by phase to the file the header's
`phase records:` line names (`target/bench/phases/<row>.phases.json`): the
row's wall time, this process's CPU (capture, preparation and emission,
checker threads included), its waited children's CPU, every build stage
with its waited usage, and the wall time and children's CPU of each counted
column and of the host columns. Timing reads only the clock and `getrusage`
around those runs; the counted bracket is unchanged. Each counting run
starts that folder afresh, so it holds exactly the rows the run attempted.

# Optional C++ reference libraries

A case may put library names in `ref.link` beside `ref.cpp`, in link order:

```text
gmpxx gmp # GMP's C++ wrapper before its C library
```

Names are separated by whitespace; `#` starts a comment. Write `re2` for RE2.
The runner passes these as `-l` arguments only when linking that case's C++
reference. A case without `ref.link` keeps the usual flags. Arbitrary compiler
or linker flags are not accepted.

The runner first checks that a tiny C++ program links against the declared
libraries. A linker diagnostic explicitly naming a missing declared library
leaves the C++ column `--`, with the reason in the console, saved run and
results. Other toolchain, compilation, checksum and workload errors still fail
the row. Library availability does not affect any nts or host-engine column.
The runner never installs packages; references remain optional system tools.

# Layout intervals

Use `layouts-interval-run.ts` for a new placement-sensitive comparison. It
reuses the link and body checks below, samples at least 20 independent joint
code/heap layouts per arm, and reports an empirical interval and verdict. The
native adapter and whole-command cost adapter share `layouts-sitting.ts`;
their counter scopes remain explicit in every raw cell.

For each draw, both arms receive independent seeded function orders and heap
padding. The linker must produce distinct actual geometries, and hot function
bodies must match their own arm's reference. Each process starts fresh. The
heap helper holds bounded allocations before main and each thread body, with
their seed, requested bytes and address recorded. It wraps thread entry, with
no malloc/free interposition. A thread receives at most 2 MiB of requested
padding, and the helper refuses beyond 128 thread entries.

This samples malloc-backed startup placement. It does not replace an allocator,
shuffle every object or move shared-library code. Allocators outside that malloc
domain require another placement adapter. The motivation follows
[Curtsinger and Berger's STABILIZER](https://people.cs.umass.edu/~emery/pubs/stabilizer-asplos13.pdf);
this sampler does not claim its runtime re-randomization or Gaussian argument.

Inside a named bounded unit with the controller off CPUs 4–5, compile the helper:

```sh
clang -std=c11 -O2 -Wall -Wextra -Werror -fPIC -shared \
  tooling/bench/layouts-heap.c -ldl -pthread -o /fresh/run/heap.so
```

Use the native link plan described below with at least 20 unique seeds and
these additional fields:

```json
{
  "heapLibrary": "/fresh/run/heap.so",
  "interval": {
    "primary": "cycles",
    "rounds": 3,
    "confidence": 0.99,
    "resamples": 20000,
    "seed": 324508639
  }
}
```

The primary metric is declared before sampling. Native choices are `cycles`,
`instructions` and `nanoseconds`; all three receive intervals. Preparation
executes no workload:

```sh
node tooling/bench/layouts-interval-run.ts check experiment.json /unused
node tooling/bench/layouts-interval-run.ts build experiment.json /fresh/build
node tooling/bench/layouts-interval-run.ts measure /fresh/build /fresh/sitting
node tooling/bench/layouts-interval-run.ts record /fresh/sitting results/layout-intervals/name
```

Measurement takes the ordinary reserved-core lock. It retains rejected
admissions and a subsequent three-second read-only task/interrupt sample.
PID, thread name and tick deltas identify candidate offenders; last-CPU
endpoints do not attribute every tick to that CPU. The instrument never changes
affinity or the guard. A measurement unit must allow its children to use CPU 4
while its controller stays off both siblings.

Every layout first passes fixed-count output checks. Three or more A/B/A
brackets then run in shuffled layout order. Each bracket uses the geometric
mean of its A anchors, and each layout contributes one equally weighted arm
mean. The percentile bootstrap resamples those paired layout means. Hot
repetitions do not increase the independent sample count. No draw or outlier
is dropped. The default uses 20,000 deterministic resamples and a nominal 99%
interval for the ratio of arm means. An interval wholly below zero means
`improvement`, wholly above zero `regression`, and one containing zero `noise`.
The full arm ranges, per-layout deltas and A-repeat drift remain beside it.
The interval describes the chosen sampler and observed sitting; it is not a
universal bound over all placements or future machine conditions.

The native adapter checks exact count, warmup, checksum and repeated-addition
sink, and requires one numeric event at least 99% running on the pinned PMU.
It uses the counted driver's existing FIFO control protocol. Historical
validation drivers accept a positive ACK read; full ACK-frame validation is
not claimed. Native heap padding occurs outside the hot window, and this
adapter currently requires a single-thread native row. Peak RSS includes the
live padding, so these RSS values are not unperturbed memory baselines.

For command-cost experiments, import `sampleLayouts` from `layouts-sitting.ts`
and `costAdapter` from `layouts-cost.ts`. Supply verified executable geometries,
per-layout commands and heap seeds, and a decoder returning one canonical
work/population signature or throwing on failure. The adapter uses
`spawnCounted`'s optional pinned user-only events: all target threads and waited
descendants from exec, with CPU from perf's waited user+system footer. Its
metrics are whole-command cycles, instructions and CPU seconds. Startup and
thread padding are included in that scope and are recorded explicitly; measure
their overhead for the command. Unperturbed startup/P-2 rows use their ordinary
protocol. A failed decode, missing event, bad exit, changed work signature or
incomplete bracket retains raw data and cannot produce a verdict.
The record command re-derives every interval from complete raw brackets and
rejects altered summaries, signatures or populations before publishing.

# Native layout range replay

Use this mode when an A/B effect is smaller than the row's recorded layout
range, or when an unexplained wall/cycle change survives flat instructions.
It implements record 0358's layout-sampling decision: build at least five
seeded function orders **per arm**, keep every layout, and compare arm means.
One favorable link is not an optimization result.

The mode currently supports Linux x86-64 ELF native C and LLVM outputs. It
relinks immutable object inputs with lld's `--symbol-ordering-file`. It does
not change optimization flags, recompile with different optimization options,
or pick a winning seed. When shipping uses a different linker, compare the
unshuffled lld reference's hot instructions and resolved constants/switch
targets against the shipping binary before measuring. Retain that comparison
with the experiment; matching output alone does not prove matching code.

## Input and build

An experiment JSON names matched native counted-driver inputs. Use the same
seed list for both arms and every row, chosen before seeing times:

```json
{
  "seeds": [101, 307, 509, 701, 907],
  "pairs": [{
    "name": "example",
    "backend": "llvm",
    "n": 2000,
    "checksum": "3ff0000000000000",
    "arms": [
      {"name":"base", "command":"/usr/bin/clang++", "cwd":"/build",
       "args":["-O2","-flto=thin","-fuse-ld=lld","base.o","driver.o","-lm"],
       "hot":["work"]},
      {"name":"contents", "command":"/usr/bin/clang++", "cwd":"/build",
       "args":["-O2","-flto=thin","-fuse-ld=lld","candidate.o","driver.o","-lm"],
       "hot":["work"]}
    ]
  }]
}
```

`contents` is the candidate arm's protocol name, independent of what it changes.
Supply the actual shipping link flags and all immutable object inputs; `args`
excludes `-o` and any existing ordering file. Both arms must use the suite's
native counted driver (`benchmarks/common/main.cpp`), with the same opaque seed,
checksum and hot call count. Backends of one case must use identical work.
Keep compiler pins, original compile/link argv, driver, objects and emitted
sources with the experiment. The mode accepts extra provenance fields in its
input and preserves the whole input in `experiment.json`.

```sh
node tooling/bench/layouts-run.ts check experiment.json /unused
node tooling/bench/layouts-run.ts build experiment.json /fresh/layout-build
node tooling/bench/layouts-run.ts measure /fresh/layout-build /fresh/layout-run
node tooling/bench/layouts-record.ts /fresh/layout-run results/layout-ranges/name
```

Run builds and measurements in a named bounded user scope, with swap disabled,
core dumps disabled, nice 19, and orchestration pinned off CPUs 4–5, as required
by AGENTS.md. The build checks 14 GiB available memory and 40 GiB free disk
before every link. The measure command acquires `with-lock.sh --wait --key bench-layouts`,
which reserves the sitting's memory before it takes the lock; only
workload children are pinned to CPU 4. Do not wrap it in another measurement
lock. Build and measurement output directories must be fresh. The recorder
rewrites only its two generated range files in the chosen results directory.

`layouts-link.ts` and `layouts-measure.ts` are the lower-level commands for
pre-existing preparation pipelines. The latter takes validated `artifacts.json`,
a case-keyed `{n, checksum}` plan, and a fresh output directory. Its `--check`
path parses and validates the actual sampler before taking the lock.

## Validation and decision

Every seed must produce a distinct actual function-address layout, and every
named hot function must move. Instruction offsets, opcodes, registers and
literal constants must match the unshuffled reference within each arm. Only
resolved addresses are normalized; anonymous read-only numeric constants are
compared by bytes. Accepted lld ordering warnings about internalized/shared
symbols are retained. Other diagnostics and changed code fail the build.

The sitting first checks exact output on both arms of every layout. It then
runs five A/B/A brackets per layout, rotating and reversing layout order across
rounds. Each process checks checksum, exact count, repeated-addition sink and
exit/stderr. Native warmup is one untimed call. PMU cycles, instructions,
branches and branch misses cover only the acknowledged hot window, with at
least 99% counter running time. Raw streams, argv, RSS, load,
counter files and in-flight checkpoints survive failures. Failed or incomplete
sittings cannot publish range tables.

For each bracket A is the geometric mean of its two anchors. A layout's value
is its five-bracket arithmetic mean; an arm's value is the arithmetic mean of
all its layouts, with equal weight. The effect is the ratio of those arm means.
The decision floor is the larger full layout range `(max - min) / mean` or the
largest A-repeat drift. The table reports means, min/max, standard deviations,
both arms' layout ranges, each seed's B/A delta and its full min/max span, all
seeds and the decision. Ranges are observations
at the recorded layout count and pins, not a universal bound. Unmeasured rows
have no calibrated range.

A future-reference range table must come from a dedicated sitting with no
capture experiment and low load, taken under `tooling/gate/with-lock.sh --wait --key bench-layouts`.
Keep a loaded sitting as the change's evidence; its ranges are upper bounds.
Pass a provenance JSON with `"calibration": true, "captureExperiments": false`
to `layouts-record.ts` only for the dedicated quiet sitting. Publication
rejects a one-minute load above 2.
The optional third argument is preserved beside the recorded conditions and
compiler/link inputs in `ranges.json`.

Node/Bun ratios require their own matched work and at least five independent
launches in the same sitting. This native layout mode makes no new host-ratio
claim and does not reuse a host time from a previous run.
