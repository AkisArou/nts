# Chromium kernels and task entry, corrected (2026-11-05)

Measured code: `2e6fe4967514ce5b445af33a8c179986d8e9df21`, clean.
Compiled TypeScript does **not** meet the Blink intrinsic bar: eight of
eleven rows have a resolved excess, two remain noise, and canvas loop is
slightly faster. V8 is a reference column.

## Conditions and evidence

Three rounds of four balanced native/V8 launch pairs give twelve launches
per side and 240 retained samples per cell. Every native launch contains
both native lanes and the atom-lookup control. Each case discards three
warm samples and retains twenty. Ordinary samples contain 20,000
iterations; task-call samples contain 2,000 MessageChannel tasks.

The sitting used an i9-14900K, CPU 4 with sibling 5 idle, under
`tooling/gate/with-lock.sh --wait`. The coordinator obtained quiet
confirmations from all other lanes. The wrapper admitted the first round
at 17:11:55 UTC; the last product-control launch finished at 17:17:36 UTC.
At sitting start/end, one-minute load was 0.86/0.69, available memory
18.77/18.89 GiB, and free disk 91.08/91.06 GiB. The CPU governor read
`powersave` at both ends. All timing, counting and profiling launches ran
inside this one sitting; their results are kept separate.

Each launch owns one transient systemd scope and a private session bus
with no service directories. Discovery reads only that scope's
`cgroup.procs`, refuses PID 1 and checks each member's current cgroup.
Renderer and zygote threads are born on CPU 4; other launch processes and
samplers are checked on `0-3,6-31`. Sandbox, seccomp, PID namespace,
affinity, checksum and sample-count checks passed.

Chromium revision: `b510e9d7cd3a2fbd78d0ddc42234103206c5f78d`.
The perf profile is optimized static Chromium without DCHECKs, without
official-distribution PGO. V8 uses its normal JIT. The compiler is the
official clean-main pin `4dc15835703d`, SHA-256
`1c4825476e64cde1aae194fab2949a8fac4e8aa5e1cc62ba02ffd5a4411a6d79`.

Intrinsic C++ and generated C use the **same pinned Clang**, 24.0.0git at
LLVM revision `9fca3cf47d011a0af295d4252d70f16f8693d6a2`, **`-O2`, no
LTO**. The C++ rule's `clang++` resolves to the C recipe's `clang` binary.
The flags receipt checks the actual Ninja C++ and link rules against the
generated-C archive recipe. C++ also has Chromium's frame pointers and
hardening; the generated-C recipe does not add frame pointers.

Evidence root: `~/.cache/nts-chromium-checkpoint1/`:

- `sitting-2e6fe4967/round{1,2,3}/result.json`: raw samples, launch logs,
  fixture identities, sandbox and affinity evidence;
- `sitting-2e6fe4967/analysis.json`, written by `analyze-sitting.ts`;
- `sitting-2e6fe4967/task-instructions/`: separate counted launches, raw
  perf stat output, per-launch results and `analysis.json`;
- `sitting-2e6fe4967/profiles/{blink-intrinsic,compiled}/`: `perf.data`,
  `stat.txt`, `flat.txt`, `profile.json`, `stacks-symbols.txt` and
  `profile-analysis.json`; intrinsic also has `helper-audit.json`;
- `sitting-2e6fe4967/product-control/`: four balanced product/control
  blocks and their `analysis.json`;
- `compile-flags-2e6fe4967.json`,
  `checkpoint1-preflight-2e6fe4967.json`, `normal-call-audit-2e6fe4967.json`,
  `run-batch-2e6fe4967.asm` and `step-2e6fe4967.asm`;
- `sealed-2e6fe4967/{product,control}/`: immutable executables, GN args,
  manifests, compiler checks, build records and sealing receipts;
- `sitting-start-2e6fe4967.json`, `sitting-end-2e6fe4967.json` and
  `sitting-2e6fe4967/launches.json`: conditions and launch boundaries.

The measured product executable's SHA-256 is
`d83f26aa86eba61b09f7ba72e7796e36643fe46946aa8fd3cc472a012c5fef81`;
the unmodified V8 executable's is
`4c6ac01dda8a74f593d77ec98131d4d443ee1be6e2db52cb76e10ef24807292d`.
Executables are copied before measurement so a subsequent in-place relink
cannot alter the measured artifact or its perf build-ID cache.

## Every kernel and shape

Times are pooled sample medians in ns per iteration; intrinsic is 1.000.
Verdicts use 10,000 bootstrap resamples of the median of twelve paired
launch-median differences, with a 95% percentile interval. The independent
unit is a launch, rather than its twenty samples. These are comparisons
within this sitting, not absolute comparisons across earlier sittings.

| kernel | shape | intrinsic ns | compiled ns | compiled/intrinsic | V8 ns | V8/intrinsic | verdict |
|---|---|---:|---:|---:|---:|---:|---|
| create-element | loop | 49.80 | 54.30 | 1.090 | 100.00 | 2.008 | regression |
| create-element | per-call | 45.55 | 70.63 | 1.550 | 102.50 | 2.250 | regression |
| detached-counter-tree | loop | 122.88 | 210.43 | 1.713 | 290.00 | 2.360 | regression |
| detached-counter-tree | per-call | 179.63 | 209.05 | 1.164 | 295.00 | 1.642 | noise |
| event-round-trip | loop | 719.63 | 852.83 | 1.185 | 930.00 | 1.292 | regression |
| event-round-trip | per-call | 1078.58 | 1333.25 | 1.236 | 1335.00 | 1.238 | regression |
| canvas-rects | loop | 60.13 | 59.63 | 0.992 | 70.00 | 1.164 | improvement |
| canvas-rects | per-call | 114.78 | 160.45 | 1.398 | 195.00 | 1.699 | regression |
| canvas-rects | batch16 | 63.60 | 67.60 | 1.063 | 80.00 | 1.258 | regression |
| canvas-rects | batch256 | 60.03 | 61.20 | 1.020 | 70.00 | 1.166 | noise |
| canvas-rects | task-call | 4490.50 | 4648.25 | 1.035 | 5350.00 | 1.191 | regression |

Intrinsic is below V8 on every pooled row. Counter-tree per-call has
different GC bands across native launches: its paired-median difference
is -46.54 ns with interval -56.04 to +176.31 ns despite the positive
pooled difference. Canvas batch256 has interval -0.29 to +2.29 ns. Neither
noise row establishes equality. The next attribution targets are
counter-tree loop, create-element per-call and canvas per-call, in that
order; this table does not assign their unexplained excess to the compiler.

## Matched entry and counting conditions

Both native lanes use the same outer batch loop, checksum consumption and
task epilogue. Per-call and batch shapes emulate task ends with the same
Blink microtask checkpoint. Blink ends a real task the same way whoever
ran its body. Task-call therefore leaves that checkpoint to the scheduler
on both native lanes, with the same MessageChannel and native listener.
V8's ordinary per-call/batch shapes are calls inside page script; its
task-call shape uses the corresponding MessageChannel handler.

Allocation reset and read occur before and after each sample's clock on
both native lanes, never at a compiled kernel entry. The timed kernel
entry has no counting call. Reset/read wrappers abort if called while the
sample clock is active; standalone C and LLVM negative controls exercise
both violations, and a source assertion checks the entry body and raw API
uses. Every retained native kernel sample reports zero nts allocations.
Counting and call-audit launches do not supply wall times for the bar.

## Requests 17 and 18

**Request 17, combined host entry/leave ground:** four separate counted
launches per native lane, in balanced order, attach perf stat to the
sandboxed renderer's main thread. Each executes exactly 46,000 tasks:
three warm plus twenty retained samples of 2,000. User instructions and
cycles start disabled; perf acknowledges enable before input and disable
after the native completion log. There is no Runtime.evaluate polling
while counters run. Counts include common input/start/completion work
inside those boundaries, amortized over the tasks.

| lane | median user instructions/task | minimum | maximum |
|---|---:|---:|---:|
| intrinsic | 50969.93 | 50962.04 | 50975.92 |
| compiled | 51861.21 | 51851.31 | 51877.62 |

The paired median excess is **894.15 instructions/task**, range
883.54–901.70. It bounds the combined entry, generated body and binding
excess; it is not a measurement of compiler entry alone. Unprofiled wall
time remains the bar: its paired median excess is **140.25 ns/task**, 95%
interval 96.00–173.25 ns. No V8 subtraction sizes this request.

**Request 18, per-literal converted atom slot:** the same create-element
loop has a control that changes only passing the once-built `div` atom
to constructing `AtomicString("div")` per call. It preserves the Blink
binding entry point and exception handling. Intrinsic is 49.80 ns/call;
the lookup control is 53.55 ns/call, a pooled excess of **3.75 ns**. The
paired median excess is **3.725 ns/call**, interval 3.063–4.313 ns. This
sizes atom lookup, not an implemented compiler slot or every adapter cost.
It accounts for most of this sitting's 4.50 ns pooled create-loop gap.
No adapter-side literal-address stand-in was added.

## Product atom and default attributes

The product commit reuses the `2d` atom and immutable default canvas
attributes in the no-options typed adapter entry. Calls supplying their
own attributes still construct those attributes per call. These two
product changes are measured together.

Control `be5209c70` is a child of the measured code with only
`runtime/chromium/adapter/dom_canvas.cc` restored to `df0002e93262`.
It retains the corrected intrinsic, matrix and launch instrument. Its
executable SHA-256 is
`bde20eb20c189cc28eb701ed92fb399d537727be2939f06638273d7c77f2d0fa`.
Product/control/control/product blocks each contain two balanced
native/V8 pairs: four native and four V8 launches per arm, eighty retained
samples per cell. This samples one linked layout per arm, not a layout sweep.

| canvas shape | original adapter ns | product ns | pooled saving ns | paired launch savings ns | verdict |
|---|---:|---:|---:|---|---|
| loop | 61.13 | 60.08 | 1.05 | -3.95 to +3.83 | noise |
| per-call | 210.85 | 159.75 | 51.10 | +45.53 to +55.03 | improvement in all four pairs |
| batch16 | 69.93 | 66.45 | 3.48 | +2.33 to +4.80 | improvement in all four pairs |
| batch256 | 62.00 | 61.38 | 0.63 | -1.88 to +6.08 | noise |
| task-call | 4660.00 | 4613.25 | 46.75 | -74.00 to +217.75 | noise |

Within these control passes intrinsic canvas per-call is 115.00/117.18 ns
and V8 197.50/195.00 ns for control/product. Batch16 intrinsic is
63.00/62.20 ns and V8 80.00/80.00 ns. The full reference columns for every
control row are in `product-control/analysis.json`; the bar table uses
only the separate three-round product measurement above.

## Profiles and reference audit

Separate sandboxed launches profile only intrinsic or only compiled,
each with all eleven kernel/shape cells. Perf record samples main-thread
user cycles at 2999 Hz with frame-pointer callchains; perf stat counts
user instructions and cycles concurrently. Their instrumented times are
excluded from the bar. Counts include warmups and surrounding renderer
work; they are not per-entry counts.

| selected lane | samples | lost | user instructions | user cycles |
|---|---:|---:|---:|---:|
| intrinsic | 3113 | 0 | 26382755307 | 8540474693 |
| compiled | 3468 | 0 | 29234806708 | 9658491580 |

Both profiles spend their largest individual shares in Blink's event
path, cppgc allocation/barriers, string operations and canvas/Skia. The
compiled profile also exposes `NtsDomContext::Name` (0.46% of sampled
period), `ProgramScope` construction/destruction (0.34% each) and the
compiled kernel entry (0.26%). These are whole selected-lane profile
shares, not time estimates for a compiler request. Lost samples are zero;
generated C without frame pointers still limits stack attribution.

The earlier reference's **all fifteen and thirteen helper samples** are
accounted individually by instruction offset in
`profiles-61e0020e9/helper-audit.json`, with three additional dispatcher
samples. Nine helper frame/save samples disappeared with normal inlining;
one static-atom guard moved outside timing. Sixteen are Blink argument,
exception/type-check, coordinate or checksum work retained by the kernel;
two are the native listener's entry frame, with the same C++ callback ABI
on the compiled side. The three dispatcher samples were removed with the
reference-only dispatcher. The old disassembly and old measured executable
are preserved; the old table is superseded.

The new intrinsic profile has **25 own-symbol leaf samples**, 0.775% of
sampled period, all mapped in its `helper-audit.json`:

- nineteen in `RunBatch`: eight Blink argument/exception/reaction-scope
  preparations, two successful counter checksums, four kernel-selection
  operations and five common batch argument/frame instructions;
- five in `Step`: two common batch-size selections and three instructions
  in the common Blink task epilogue;
- one at the native counting listener's entry frame.

The compiled side has the same batch frame, kernel selection
(`run_kernel`), checksum algorithm, outer loop, callback ABI and task
epilogue. There is no reference-only forced wrapper or volatile dispatch.
No own-symbol sample is left unclassified.

The untimed audit launch counts the same templated Blink operations for
all eleven shapes and checks each result's checksum. The optimized
**non-audit** `RunBatch` disassembly independently retains one external
Blink call per kernel operation: create and counter operations in their
count loops, click in its decrement loop, and fillRect in its indexed loop.
Body/listener and canvas/context lookups remain once per batch, matching
the compiled kernels. Returns, exceptions, types and listener counts feed
the checked checksum; void Blink operations retain their opaque effects.
No LTO can fold those external Blink calls away. Audit counter accesses
are absent from the normal template instantiation.

## Correction and verification

The earlier entry comparison was invalid: its intrinsic constructed
`String("2d")` per call and ordinary V8 calls were compared with native
task roots. A subsequent table also timed compiled per-entry counting
and reference-only wrappers. Neither table supplies this record's ratios
or request sizes. This record uses hoisted constants, matching Blink
binding implementations/checks, normal inlining, common task epilogues
and counting outside both clocks. No compiler or C runtime was changed.

The four-commit landing series separates product constants, launch
ownership, kernel matrix and this record/catalogue. Product binaries were
checked on both backends and profiles through the separately pinned safe
scoped harness `61e0020e9`, as approved; the old process-group cleanup was
never run. Receipts are `product-check-22637ae8b/receipt.json` and its log.
The launch commit has full perf verification and the whole Node 24 tooling
step (`verify-instrument-perf-d24d8748a.log`,
`tooling-instrument-node24-d24d8748a.log`).

Both full verify profiles pass on the measured clean code with the
official compiler pin: `verify-perf-2e6fe4967.log` and
`verify-baseline-2e6fe4967.log`. The gate's whole tooling command passes
on pinned Node 24.20.0: 873 tests, 871 pass, zero fail, two existing TODOs
(`tooling-node24-2e6fe4967.log` and its summary). Node 26 is not owed;
its tooling failures belong to the Node 26 migration.

The final record/catalogue tip gets its own dry run and whole tooling
receipt in the review packet, with every owed step paired with evidence
or its outstanding canonical landing check. The three retained archive
refs are catalogued in the same commit. Uncited check executables and
build artifacts were removed after their checks; measured executables
and cited evidence remain. At preflight, the actual gate test cache needed
90.37 GiB free including the 40 GiB floor, and 92.01 GiB was available.

The series was rebased onto main's authority-reference correction
`493b09b6479c` before final review. The measured and per-commit receipts
retain their original identities above; `runtime/chromium` and
`tooling/chromium` are byte-identical after that rebase. The original
measured series remains on lane-only branch
`chromium/checkpoint1-measured-b3ffb1f9e`. The final dry run includes audit
against the corrected authorities, and tooling runs on the rebased tip.

Landing remains subject to the coordinator's LAND OK.
