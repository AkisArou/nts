# Census phase CPU: #760

This change instruments the eight TypeScript/test262 backend steps. It changes
no lowering, frontend, compiler/core or runtime implementation. Check and emit
commands share the existing native phase-record owner. The worker suspends its
outer phase while host compilation or execution runs, and obtains each child's
CPU from wait4. A signed unattributed row reconciles known observations with the
retained scope's independently measured CPU. It includes startup, dispatch,
cleanup and missing work rather than inventing attribution for them.

The machine-readable evidence is
[the tool-written record](../../../results/gate/census-phases-760.json). Raw
streams, counters, manifests, scripts and the discarded or incomplete attempts
remain under `~/.cache/nts-scratch/760`, protected by keep.json until this task
closes. The evidence writer is `write-evidence.py` in that root and identifies
itself by digest in the record.

## Physical observations and missing data

Native commands use process self and waited-child getrusage counters through
one recorder. The record's case header carries the context once; each event is
serialized into a session-owned buffer and published with a checked immediate
write, so an abort does not wait for a destructor flush. The write trace before
and after that simplification is retained in profile-writes-v2/v3.

The worker gets own CPU and its clock through HostObservations. Pure fixtures
supply them, and a missing or backwards reading marks telemetry unmeasured
without changing the program's outcome. External tools run through the small
wait4 owner; their original stdout, stderr, exit and signal remain product
outputs. An unavailable report is missing evidence. Each self interval and
waited child contributes its own counter-resolution observation to the
quantization tolerance. Summed phase wall is worker time and overlaps between
workers; it must not be added up as step wall.

Only the eight named steps enable this instrumentation. Other step factories
return before touching CPU observations. Emit sessions additionally require the
explicit compiler-observation handoff; ordinary check instrumentation keeps its
existing scope. A case frame names each of its compiler observations, including
all six self-check control compiles. The summary checks frame multiplicity and
complete compiler records. Missing totals stay unknown while known partial CPU
remains visible.

## Output identity

The complete TypeScript population contains 12,189 sources. Across C, LLVM and
JVM that produced 36,567 off/on pairs. All generated artifacts, stdout, exit
statuses and signals agree. Of the pairs, 36,472 also have identical stderr.
The remaining 95 pairs cover 33 sources and differ only in Rust's diagnostic
thread-ID digits. Raw off/off/on/on controls reproduce those differences in
both arms; no stream is normalized or rewritten. This is the pre-existing
[stable panic diagnostic defect, #766](https://github.com/AkisArou/nts/issues/766),
which remains held. The source list and exact changed byte ranges are retained
in the identity summary, and the record lists the sources.

The proof drives the same native binary in both arms. Its digest is in the
record. Final source-only changes after that proof affect telemetry validation,
not native emission; rebases must keep compiler content identical for the proof
to carry.

## Real phase wiring

The positive control drives actual step names and actual compiler/host tools,
with private observations, ledger/history, unit and scope meters. Its TypeScript
sample and all five test262 slices produce complete tables. The record contains
every phase, including the signed remainder, and the scope total from the same
run. Fixed observations separately exercise missing frames, partial compilers,
exclusive nesting, six compile controls, backwards channels and quantization.

| Step | Scope CPU-s | Known phases CPU-s | Signed remainder CPU-s |
| --- | ---: | ---: | ---: |
| typescript-c | 6.381024 | 4.265705 | 2.115319 |
| typescript-llvm | 5.432612 | 3.266851 | 2.165761 |
| typescript-jvm | 4.935463 | 2.791964 | 2.143499 |
| test262-cases | 7.959560 | 3.648537 | 4.311023 |
| test262-builtins-cases | 6.705753 | 3.537542 | 3.168211 |
| test262-rest-cases | 17.546590 | 9.072425 | 8.474165 |
| test262-jvm | 23.287237 | 7.742117 | 15.545120 |
| test262-llvm | 30.723260 | 15.490672 | 15.232588 |

## Measurement conditions

Overhead uses the same committed native compiler and the production TypeScript
selector. Each backend primes OFF and ON before balanced ABBA and BAAB arms.
The outcome projection (selected population, attempts, tallies and per-case
outcomes) must agree across every arm. The session runs through with-lock using
its stable perf-count key on CPU 4, with CPU 5 quiet; no outer admission promise
sits above it. The table retains wall, cgroup CPU, peak memory, load and raw user
instruction counts. Collection CPU is observed separately and charged to ON.

The common waited-child helper is compiled once at run preparation, outside
the individual step scopes. That setup is not charged as a per-case or
per-step helper build in these steady workload cohorts; no cold-build cost
claim is made here.

Ordinary cgroup CPU and perf-inherited cgroup CPU are separate cohorts. The
latter includes the perf fork/PMU attachment cost of the observation wrapper,
so its CPU ratio is not described as ordinary execution. User instruction
counts use cputime.mjs's existing hybrid-event parser and PERF_ARGS.

Earlier small and cold cohorts remain evidence: the first real cohort had a
cold first C arm; the second stopped before measured arms to correct ON
priming. The 100-case warm repeats straddled the CPU criterion, and the
subsequent 500-case repeat is retained rather than replacing those results.
The final-measure counted attempt that exited 75 before admission is NOT
MEASURED, not a counted result. Its parent unit had already been collected
before the attempted stop.

| Backend | Ordinary CPU incl. collection | Counted user instructions | CPU under perf incl. collection |
| --- | ---: | ---: | ---: |
| c | 1.008149x | 1.000968x | 1.047647x |
| llvm | 1.005414x | 1.001290x | 0.993980x |
| jvm | 1.009260x | 1.001451x | 0.999421x |

The ordinary including-collection means meet the one-percent production-cost
criterion. The production runner wraps these steps with GNU time and retained
cgroup accounting, without perf; their all.sh routes invoke the census directly.
The separate counted cohort verifies user instructions at the same measured
source. The card's counted comparison is therefore reported beside the actual
production CPU comparison, with each observer configuration named.

Counted C CPU **does not** meet one percent. A matched launch-component control
measures an additional observer interaction under perf, but it does not explain
the full C excess. That remainder is unexplained; the record never calls it a
fully attributed PMU cost or an ordinary production-overhead measurement.
Counted LLVM and JVM CPU also remain visible, with every arm's load and spread.
No CPU ratio divides across observer configurations or old/new CPU bases.

The overhead population is a fixed 500-project TypeScript sample on each
backend. The five test262 routes have separate positive wiring proof; this is
not a full-corpus timing or a separate overhead cohort for each test262 slice.


## Canonical checks

The supported check at the measured source ran the full owed set. It passed
3044 Rust tests, with 0 failures and 8 ignored,
across 55 binaries and 18 doctest crates.
Tooling passed 2174, with 0 failures and 2
existing TODOs (2176 total). The final focused/timing batch passed
58 controls. Host ownership and strict TypeScript checks passed.

The gate summary's wall was 610.349 s, while the CLI including
build preparation reported 691 s. Ledger waits totalled
400.220 s and can overlap active steps; they are not
subtracted as an exclusive execution interval. The cold scheduling history
explains the long admission waits.

That full run was red only on Clippy and the dependency notice check.
Clippy requested a must-use diagnostic on the public session guard. The
attribution generator added the new locked dependency notices. At
3e752b875ba5843a6c09e31f6238c71b8282ba8e the exact canonical rustfmt,
workspace/all-target Clippy and license owners all pass. The follow-up's only
Rust change is the diagnostic attribute; no executable logic changed. The
record keeps the measured/native-identity pin at 96efb519b774 and does not
claim an unbuilt follow-up release binary is byte-identical.

One private rerun initially used cargo fmt --all, which checks unowned vendored
tsrs sources, and another used the internal function name instead of the public
step name. Both are retained as command errors. The successful formatting check
uses all.sh --call rustfmt; no vendor file was changed.


## Observer launch profile and report boundary

The component profile separates a direct launch, the waited-child launcher
without a report, the complete report path, native phase emission and collector
parsing. The original fork/error-pipe launch was the dominant added cost.
The final helper uses posix_spawnp and retains wait4 for entered children,
the caller's signal mask and the original signal/exit distinction. An explicit
launch error owns child=0; it never depends on the spawn API's output parameter
on failure. Component rows retain their controls and observer configurations;
their absolute CPU times are not compared as a cross-run performance ratio.

A captured report pipe was rejected before implementation: Node charges captured
fd3 bytes to maxBuffer too, so telemetry could turn exact-bound stdout into
ENOBUFS. The separate CLOEXEC report file preserves the product's output budget.
A real exact-buffer control compares the observed and original launch.

Executable text without a shebang exposes execvp's shell fallback, which
posix_spawnp does not supply. Only a proven no-entry ENOEXEC delegates once to
the original spawnSync with its unchanged stdin/options/buffer. Its waited CPU
is explicitly unmeasured. The script/control appends one marker per invocation
and produces identical output, so no successful program can run twice.
A real exit 127 remains distinct from a missing executable.

## Provenance publication

The final ordinary cohort completed all target arms and all product comparisons,
then its private script's metadata write failed because its Git-call import was
missing. The executed script is unchanged. Recovery checks compare all 24 saved
rows and all eight per-backend selected/population/attempt/tally/outcome
projections, the unchanged measured commit and binary digest. No target was
rerun. The executed source and recovery verifier are embedded in the record.

The counted cohort completed successfully. Its metadata's source-description
field shadowed the Git source field; the unchanged launch commit is retained
separately with the original manifest digest and executed-script digest. Both
bookkeeping corrections are disclosed independently from the target results.
Earlier failed, cold, stopped and unmeasured cohorts are retained separately
and are never pooled with the final acceptance cohort.
