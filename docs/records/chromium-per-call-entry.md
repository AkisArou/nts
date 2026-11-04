# The per-call entry, measured (2026-11-04)

Ranked item 1 of the 2026-11-04 lane restart
(`~/.cache/nts-handover/chromium-resume-20261104.md`): what a native entry
costs when every operation is its own callback, and which parts of it the
compiled code provably does not need. Four candidates were built as stacked
commits on `chromium/per-call-entry`, each removing one cost, each verified
green alone; this record is their measurement and the keep/drop outcome.

## Instrument and conditions

Verdict metric: instructions per call. `perf stat` on
`cpu_core/instructions/` and `cpu_core/cycles/`, attached to the native
renderer's main thread (where every measured sample runs; benchmark pins it
to CPU 4), per launch of `tooling/chromium/benchmark.ts` kernels, C backend,
perf profile, pin `~/.cache/nts-pins/17fd5869f8fb/nts`. Ten launches per arm
(three interleaved sittings per pair), each sitting under
`tooling/gate/with-lock.sh --wait` on CPU 4, lock released between sittings.
Counting wrapper and analysis scripts:
`~/.cache/chromium-measure/scripts/{count.ts,sit.sh,analyze.py,summary.py}`;
raw counts and result files in `~/.cache/chromium-measure/out/`.

The machine was not quiet: nodejs #193 qualification and compiler work ran
on the other CPUs throughout (load average 3 to 14 across the sittings,
MemAvailable 13.3 to 20 GiB; sittings held below 14 GiB per the machine
rules). Instructions are the verdict for that reason; cycles and wall time
are reported beside them and are provisional until re-confirmed on a quiet
machine. Launch-median instruction IQRs ran 0.2 to 0.45 billion on a
44.6 billion base, so deltas below about 0.2% are at the noise floor of
this instrument: GC pacing makes even instruction counts drift with load.

Entry accounting per native kernels launch: 1,840,000 outermost compiled
per-call entries (4 kernels x 20,000 x 23 rounds), 920,000 nested entries
(event-round-trip's loop clicks and per-call clicks, one nested listener
dispatch each). Per binding launch: about 1.17 million entry-matrix entries
in kept rounds.

## Per-candidate deltas

Median per native launch, candidate minus parent (negative is better):

| candidate | instructions | cycles | reading |
| --- | --- | --- | --- |
| 1 nested re-enters nothing | -106M (-0.24%) | +0.03% | -115 instr/nested entry |
| 2 already-entered world | -90M (-0.20%) | -1.48% | does not fire here (below) |
| 3 nested host invoke | -271M (-0.61%) | -0.53% | -295 instr/nested invoke |
| 4 entry count, not refcount | +56M (+0.13%) | -0.67% | +31 instr, -51 cycles/entry |

Candidate 2 does not fire in these workloads, proven directly: a throwaway
counter build of 549d1978d printed `fires=0` against 1,800,000 misses per
kernels launch and 1,200,000 per binding launch
(`~/.cache/chromium-measure/out/c2probe-*/launch-*-native.log`). Posted-task
callbacks in both harnesses run with no V8 context entered, so the compare
is paid on every outermost entry and the Enter it would skip is always
taken. Its kernels instruction delta above is therefore drift, not its
effect; the bare-entry matrix below prices the compare itself. Where it
would fire — callbacks Blink makes from inside script or a checkpoint
(promise settles, queueMicrotask jobs, script-dispatched listeners) — no
current workload counts it. It returns when one does.

## Bare entry (binding entry matrix, 0 operations per entry)

Median ns per entry, wall (provisional), allocation-free entries:

| arm | 0 ops | 2 ops | 8 ops | 32 ops |
| --- | --- | --- | --- | --- |
| main 2ff6a9e69 | 33.96 | 334.9 | 1014.0 | 3662.9 |
| + candidate 1 | 32.32 | 337.5 | 1029.5 | 3759.5 |
| + candidate 2 | 36.48 | 348.7 | 1034.5 | 3727.9 |
| + candidate 3 | 36.23 | 346.6 | 1027.3 | 3691.1 |
| + candidate 4 | 34.74 | 335.8 | 1006.2 | 3660.0 |
| kept (1 + 3) | 32.46 | 337.8 | 1025.8 | 3743.7 |

Candidate 2's compare costs about 4 ns on every outermost entry it does
not skip; candidate 4's count is about 1.5 ns/entry cheaper in wall than
the refcount (its cycles win above), while executing slightly more
instructions (branches in place of two relaxed atomic RMWs).

## Kept, dropped

Kept on `chromium/per-call-entry-kept` (tip ce0285fcc, verified green):
candidate 1 (fbb1f1666) and candidate 3 (ce0285fcc). Dropped: candidate 2
(549d1978d, pays where it does not fire, unproven where it would) and
candidate 4 (d1de81179, fails the designated instructions metric; its
cycle win is a quiet-machine re-test, not a keep). The full four-commit
stack stays on `chromium/per-call-entry` for those re-tests.

Kept tip against main, counted: kernels -369M instructions per launch
(-0.83%), binding -183M (-0.40%), about -156 to -200 instructions per
outermost per-call entry depending on the entry population counted.

## Summary: main against kept tip (wall medians, provisional)

ns per operation, pooled across each arm's sittings (10 native launches
per arm). The bar: under 1.0 against V8 is required; parity with
hand-written Blink C++ is the target.

| kernels row | main nts/C++ | main nts/V8 | kept nts/C++ | kept nts/V8 | verdict |
| --- | --- | --- | --- | --- | --- |
| create-element loop | 0.987 | 0.545 | 0.980 | 0.547 | beats both |
| create-element per-call | 1.499 | 0.715 | 1.513 | 0.741 | beats V8; behind C++ |
| counter-tree loop | 0.876 | 0.711 | 0.871 | 0.719 | beats both |
| counter-tree per-call | 0.917 | 0.859 | 0.935 | 0.861 | beats both |
| event loop | 0.832 | 0.648 | 0.955 | 0.642 | beats both |
| event per-call | 1.322 | 0.746 | 1.257 | 0.718 | beats V8; behind C++ |
| canvas loop | 1.003 | 0.849 | 0.998 | 0.816 | beats both |
| canvas per-call | 1.332 | 1.084 | 1.372 | 1.116 | **loses to V8** |

Canvas per-call loses to V8 on both arms: a pre-existing losing row, not
an entry-cost row — its compiled side re-queries the element and context
per call and the named compile is a gated compiler item (the canvas5
fixture); ranked item 2's hand-written closure in a retained raster
context is its fix at the cause. The two other behind-C++ per-call rows
(create-element, event) are what remains of the entry cost below.

Binding entered op rows (one entry per loop) did not move within noise,
as designed: e.g. compiled-entered-prepared-utf16 at length 16, main
110.8 ns against kept 112.1 ns; the entry there is amortised over the
sample's iterations. The binding per-entry shapes are the matrix above;
V8 has no bare-entry counterpart to ratio against.

## What still stands after the kept stack

One HandleScope, one Context::Enter/Exit, one MicrotasksScope, the
entry's refcount (candidate 4 dropped), and the host's environment,
callback and depth enters, per outermost entry. Measured shares from
perf record on the renderer main thread (cpu_core cycles, flat per
symbol, two launches per arm, about 4K samples each — 0.1% is about 4
samples, so shares are ±0.1% at best;
`~/.cache/chromium-measure/out/{main,kept}-records/`):

- main: Context::Enter 0.53% + Exit 0.18%; ProgramScope ctor+dtor
  0.51% (HandleScope and GetContext inlined there); MicrotasksScope
  plus ShouldPerformCheckpoint about 0.39%; HandleScope
  DeleteExtensions+Extend 0.21%; host and runtime enters
  (nts_callback_enter, nts_leave, nts_enter, environment and host
  enter/leave) about 0.52% in sum; nts_blink_dom_entry 0.07%. Entry
  path in total about 2.7% of main-thread cycles on kernels.
- kept: Context::Enter 0.15% + Exit 0.13% (nested entries no longer
  enter); ProgramScope 0.40%; MicrotasksScope plus checkpoint about
  0.36%; host and runtime enters about 0.33% (nested invokes no
  longer re-enter). Entry path in total about 1.9%.

The host's enters in runtime/c (nts_environment_enter,
nts_callback_enter, nts_enter and their leaves) are already TLS reads
and depth counters; at about 0.3 to 0.5% of launch cycles — roughly
15% of the 34 ns bare entry — they are the largest single remaining
slice the lane cannot touch. Request for the compiler lane, with
these numbers: is there a combined host entry (one call that enters
environment, callback and depth together, and one that leaves) the
chromium host can call instead of three pairs across translation
units? No defect is claimed; the current shape is the documented
contract, and any change is the compiler lane's design to make.

## Next

- Re-confirm wall time and candidate 4 on a quiet machine before any
  wall-time claim; re-test candidate 2 there too, on a workload whose
  callbacks arrive with the world entered (script-dispatched events,
  promise settles), since neither current workload exercises it.
- The remaining per-call rows behind C++ are now dominated by the one
  Enter/Exit, the checkpoint fast path and the host enters above, plus
  each kernel's own per-call work (canvas context re-query); the
  ranked list's later items address those at their causes.

