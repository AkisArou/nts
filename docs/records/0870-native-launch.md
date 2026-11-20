# Native executable launch to exit

The review follow-up and corrected implementation are recorded in
[Native launch review controls](0870-native-launch-review.md). This record
retains the original measurements; its implementation had two defects in
foreign-post activation and library ordering, fixed in that follow-up.

Issue #870 removes unused loop acquisition and unused libm loading from the
ordinary standalone host. Empty and hello win against ScriptC in the standard
final sitting and tie in the paired base/variant/replay sitting; all native
cells win against node. The paired floor inverted above the native and
ScriptC cells, so its formal ties cannot be separated from noise. Builtins remains unavailable, refused before timing
with `NTS1100 JSON.parse` (the outstanding builtins work is #886).

The baseline is `723a9ce9f90144ee5047790c35a88912394f7e49`; the final measured
implementation is `9f7c5a43a1b83b533bddf6e035dc7a061d7a5af7`. The baseline
compiler was built in `nts-dev`, the final compiler and bench with plain
`cargo build --release`. The measured native executables are products of
`nts build`, not the Rust compiler's own process. Their build commands and
source identities are retained. Hardware: i9-14900K, Linux 7.2.11-arch1-1,
clang 23.1.5. Comparator pins: node 26.13.0, ScriptC 0.4.5 at
8971d694b18a81a9a52b8f8208be22b182cb092b with Node islands off, Bun
1.4.4-canary.1 at 89452d2ac13773aee8a6d632c4c30074bd1bb4fa.

## Cost at its cause

Libuv was already static. Dynamic libuv loading was ruled out. The original
main acquired `uv_default_loop`, installed idle/async handles, ran the loop
and shut it down even when evaluation scheduled nothing. It also retained
unused libm through both the application and bundled-dependency link owners.

51-repeat `perf stat` observations of startup-empty and one syscall trace per
column show the removed work. Instruction counts are user-mode counts.

| Column | before instructions / minor faults / syscalls | after instructions / minor faults / syscalls | dependencies besides interpreter |
|---|---:|---:|---|
| nts C | 192000 / 77 / 62 | 128926 / 56 / 35 | libc + libm → libc |
| nts LLVM | 191999 / 77 / 62 | 128926 / 56 / 35 | libc + libm → libc |
| ScriptC | 120685 / 68 / 31 | 120744 / 68 / 31 | libc |
| /bin/true | 140228 / 53 / 31 | 140228 / 53 / 31 | libc |

| nts-only syscall cause before | count removed |
|---|---:|
| loading/protecting unused libm | 10 |
| loop initialization: epoll, kernel-version query, 256-entry io_uring and two populated mappings, two pipes, wakeup write/futex, eventfd | 11 |
| run/shutdown: io_uring_enter and epoll_pwait | 2 |
| libuv exit destructor closing its signal pipe | 2 |
| first heap growth for the unused loop | 2 |
| total | 27 |

Four additional process-start diagnostics remain: querying the stack limit,
installing an alternate stack and installing SIGSEGV/SIGBUS handlers. The final
trace has exactly the common 31 syscalls plus these four. Unused run/shutdown
creates no loop or handles and performs no backend or destructor close work.

`LD_DEBUG` reports initial/relative/final relocation statistics separately;
they are not added together. Before nts: 132 / 17 / 163; after nts:
99 / 27 / 111; ScriptC: 101 / 20 / 108. Thus the anticipated 132-versus-101
initial-relocation residue is gone too. The final C and LLVM empty executables
are byte-identical, SHA-256
`2afcf968d48a8e95e40509f559bb422cce2451f530d3ad5b8c373045f3311a13`;
their baseline products were also byte-identical
(`363d9200a280721ce000f382927384508fa2dcc9675e1593412714597c7eb2e1`).
The C/LLVM timing gap is not a difference in their empty executables.

Both nts products retain three init-array entries: `__cpu_indicator_init`,
`nts_require_the_cpu_it_was_built_for` and `frame_dummy`; two fini entries are
`__do_global_dtors_aux` and `uv_library_shutdown`. ScriptC has one preinit,
four init and one fini entries (text huge-page setup, uptime anchor, small-int
initialization and CRT entries). The change does not remove ISA validation.
Libuv's destructor remains installed but has no initialized signal pipe to
close in an unused host.

Before and after `perf record` use user-only `cpu_core/cycles/u`, period 10000,
user callchains and DWARF stacks over 300 execs per column. Raw records retain
Python launch-driver samples and unidentified transition addresses; they do
not provide a kernel-time decomposition. The baseline identifies the loader
and CPU-feature constructor. No wall-time share is inferred from the samples.
The first recording attempt requested disallowed kernel callchains; the
user-only rerun succeeded without changing host policy.

## Locked launch sittings

CPU 4, sibling 5 idle at admission, canonical empty HOME/TMPDIR environment,
three page-cache warmups and 21 rotating timed rounds per column, including
`/bin/true`. Every timed sibling user/nice sample is zero. Times are medians;
spread is upper/lower quartile. ScriptC is WON below 0.95x, TIE through the
larger cell spread or 1.05, otherwise LOSS; node/Bun JIT require 0.8x.
The floor is shown as measured, not subtracted as a universal constant.
Only ratios inside a sitting decide its verdict.

| Sitting | load start → end (1/5/15 min) | MemAvailable GiB start → end |
|---|---|---:|
| before, all its rows | 24.44/29.86/39.28 → 28.93/30.50/39.29 | 17.82 → 17.45 |
| after, all its rows | 13.64/47.91/48.20 → 19.51/46.46/47.70 | 15.04 → 15.25 |
| paired startup-empty | 19.51/46.46/47.70 → 19.51/46.46/47.70 | 15.40 → 15.94 |
| paired startup-hello | 19.51/46.46/47.70 → 19.51/46.46/47.70 | 15.57 → 15.87 |
| paired startup-builtins | 19.23/45.95/47.53 → 19.23/45.95/47.53 | 16.12 → 15.08 |

### Before

| Row | Column | µs | spread | / ScriptC | / node | ScriptC verdict |
|---|---|---:|---:|---:|---:|---|
| startup-empty | nts C | 332.832 | 1.0329 | 1.1614 | 0.00823 | LOSS |
| startup-empty | nts LLVM | 301.228 | 1.0538 | 1.0511 | 0.00745 | TIE |
| startup-empty | node | 40428.418 | 1.0377 | 141.0730 | 1.00000 | — |
| startup-empty | Bun JIT | 2771.935 | 1.0777 | 9.6725 | 0.06856 | — |
| startup-empty | Bun AOT | 2411.595 | 1.0907 | 8.4151 | 0.05965 | — |
| startup-empty | ScriptC | 286.578 | 1.1359 | 1.0000 | 0.00709 | — |
| startup-empty | floor | 181.592 | 1.0952 | 0.6337 | 0.00449 | — |
| startup-hello | nts C | 316.025 | 1.1762 | 1.2275 | 0.00759 | LOSS |
| startup-hello | nts LLVM | 301.623 | 1.0978 | 1.1715 | 0.00725 | TIE |
| startup-hello | node | 41619.616 | 1.1108 | 161.6522 | 1.00000 | — |
| startup-hello | Bun JIT | 2571.661 | 1.0932 | 9.9884 | 0.06179 | — |
| startup-hello | Bun AOT | 2260.719 | 1.1362 | 8.7807 | 0.05432 | — |
| startup-hello | ScriptC | 257.464 | 1.1901 | 1.0000 | 0.00619 | — |
| startup-hello | floor | 179.849 | 1.1073 | 0.6985 | 0.00432 | — |

### Final standard sitting

| Row | Column | µs | spread | / ScriptC | / node | ScriptC verdict |
|---|---|---:|---:|---:|---:|---|
| startup-empty | nts C | 189.590 | 1.1073 | 0.6808 | 0.00487 | WON |
| startup-empty | nts LLVM | 181.472 | 1.0662 | 0.6516 | 0.00467 | WON |
| startup-empty | node | 38894.923 | 1.0445 | 139.6611 | 1.00000 | — |
| startup-empty | Bun JIT | 2902.045 | 1.0465 | 10.4205 | 0.07461 | — |
| startup-empty | Bun AOT | 2453.136 | 1.1018 | 8.8085 | 0.06307 | — |
| startup-empty | ScriptC | 278.495 | 1.1543 | 1.0000 | 0.00716 | — |
| startup-empty | floor | 181.807 | 1.0679 | 0.6528 | 0.00467 | — |
| startup-hello | nts C | 208.648 | 1.0678 | 0.7504 | 0.00474 | WON |
| startup-hello | nts LLVM | 207.322 | 1.1308 | 0.7457 | 0.00471 | WON |
| startup-hello | node | 44047.156 | 1.0263 | 158.4202 | 1.00000 | — |
| startup-hello | Bun JIT | 3105.211 | 1.0512 | 11.1682 | 0.07050 | — |
| startup-hello | Bun AOT | 2662.830 | 1.0385 | 9.5771 | 0.06045 | — |
| startup-hello | ScriptC | 278.040 | 1.1887 | 1.0000 | 0.00631 | — |
| startup-hello | floor | 195.133 | 1.0782 | 0.7018 | 0.00443 | — |
| startup-builtins | nts C | REFUSED | — | — | — | unavailable |
| startup-builtins | nts LLVM | REFUSED | — | — | — | unavailable |
| startup-builtins | node | 45741.914 | 1.0383 | 126.8906 | 1.00000 | — |
| startup-builtins | Bun JIT | 3499.655 | 1.0918 | 9.7082 | 0.07651 | — |
| startup-builtins | Bun AOT | 2741.693 | 1.0600 | 7.6056 | 0.05994 | — |
| startup-builtins | ScriptC | 360.483 | 1.1411 | 1.0000 | 0.00788 | — |
| startup-builtins | floor | 199.123 | 1.1717 | 0.5524 | 0.00435 | — |

### Paired base/variant/replay sitting

The baseline is replayed in the same rotating sitting as the variant. All
baseline and replay native cells still lose to ScriptC; all four variant
cells are formally classified TIE. However, /bin/true is slower than every
variant native and ScriptC cell (252.823 µs empty, 228.117 µs hello). This
sitting cannot separate TIE from noise; the instruction, fault and syscall
counts carry the cause claim. Builtins has no baseline product and the variant is refused, so
its native ratio is unavailable rather than a win.

| Row | Column | µs | spread | / ScriptC | / node | ScriptC verdict |
|---|---|---:|---:|---:|---:|---|
| startup-empty | base nts C | 329.275 | 1.1126 | 1.6600 | 0.00809 | LOSS |
| startup-empty | variant nts C | 204.620 | 1.0916 | 1.0316 | 0.00503 | TIE |
| startup-empty | replay nts C | 312.992 | 1.1559 | 1.5779 | 0.00769 | LOSS |
| startup-empty | base nts LLVM | 302.388 | 1.1059 | 1.5245 | 0.00743 | LOSS |
| startup-empty | variant nts LLVM | 196.728 | 1.0687 | 0.9918 | 0.00484 | TIE |
| startup-empty | replay nts LLVM | 288.494 | 1.0931 | 1.4544 | 0.00709 | LOSS |
| startup-empty | ScriptC | 198.358 | 1.0445 | 1.0000 | 0.00488 | — |
| startup-empty | node | 40681.879 | 1.0406 | 205.0932 | 1.00000 | — |
| startup-empty | Bun JIT | 3031.690 | 1.0492 | 15.2839 | 0.07452 | — |
| startup-empty | Bun AOT | 2537.614 | 1.0857 | 12.7931 | 0.06238 | — |
| startup-empty | floor | 252.823 | 1.2323 | 1.2746 | 0.00621 | — |
| startup-hello | base nts C | 326.898 | 1.1031 | 1.6089 | 0.00795 | LOSS |
| startup-hello | variant nts C | 210.154 | 1.1033 | 1.0343 | 0.00511 | TIE |
| startup-hello | replay nts C | 293.399 | 1.1421 | 1.4440 | 0.00714 | LOSS |
| startup-hello | base nts LLVM | 298.791 | 1.0665 | 1.4706 | 0.00727 | LOSS |
| startup-hello | variant nts LLVM | 211.465 | 1.0744 | 1.0408 | 0.00514 | TIE |
| startup-hello | replay nts LLVM | 281.273 | 1.0915 | 1.3844 | 0.00684 | LOSS |
| startup-hello | ScriptC | 203.180 | 1.0775 | 1.0000 | 0.00494 | — |
| startup-hello | node | 41107.659 | 1.0904 | 202.3214 | 1.00000 | — |
| startup-hello | Bun JIT | 2877.491 | 1.0973 | 14.1623 | 0.07000 | — |
| startup-hello | Bun AOT | 2399.132 | 1.1327 | 11.8079 | 0.05836 | — |
| startup-hello | floor | 228.117 | 1.1257 | 1.1227 | 0.00555 | — |
| startup-builtins | ScriptC | 289.777 | 1.0741 | 1.0000 | 0.00664 | — |
| startup-builtins | node | 43647.935 | 1.0697 | 150.6259 | 1.00000 | — |
| startup-builtins | Bun JIT | 3188.773 | 1.0648 | 11.0042 | 0.07306 | — |
| startup-builtins | Bun AOT | 2521.788 | 1.0557 | 8.7025 | 0.05778 | — |
| startup-builtins | floor | 227.533 | 1.1902 | 0.7852 | 0.00521 | — |

## Per-column launch counters

These are a separate locked 51-repeat perf sitting over the retained baseline
and final products, including both startup rows and every comparator. They
are instrumented counts, not the launch wall-time verdicts. Software-fault
counts and hardware user-instruction means are printed by perf; repeats may
differ by one or two instructions. Node/Bun observations describe those
processes, not changes caused by nts. Bun AOT's baseline major faults remain
visible. Profile load was 16.59/36.40/43.85 → 16.90/35.49/43.44.

### startup-empty

| Column | before instructions / minor / major faults | after instructions / minor / major faults |
|---|---:|---:|
| nts-C | 192000 / 77 / 0 | 128926 / 56 / 0 |
| nts-LLVM | 191998 / 77 / 0 | 128926 / 56 / 0 |
| ScriptC | 120685 / 68 / 0 | 120744 / 68 / 0 |
| node | 305526306 / 9208 / 0 | 305222264 / 9211 / 0 |
| Bun-JIT | 3877853 / 747 / 0 | 3878101 / 748 / 0 |
| Bun-AOT | 2868919 / 727 / 3 | 2868689 / 720 / 0 |
| floor | 140228 / 53 / 0 | 140228 / 53 / 0 |

### startup-hello

| Column | before instructions / minor / major faults | after instructions / minor / major faults |
|---|---:|---:|
| nts-C | 194692 / 79 / 0 | 132851 / 59 / 0 |
| nts-LLVM | 194692 / 79 / 0 | 132851 / 59 / 0 |
| ScriptC | 123173 / 68 / 0 | 123231 / 68 / 0 |
| node | 332150359 / 9431 / 0 | 333207831 / 9429 / 0 |
| Bun-JIT | 3912930 / 757 / 0 | 3913401 / 758 / 0 |
| Bun-AOT | 2878709 / 738 / 3 | 2878708 / 734 / 0 |
| floor | 140229 / 53 / 0 | 140228 / 53 / 0 |

## Host correctness and cost controls

Only the standalone libuv main passes NULL. GLib, CoreFoundation and Win32
adapters continue passing an explicit default loop and remain eager. The JVM
uses Java `NtsEnv`, not this C host. Node-API addons install their explicit
hosted loop through `nts_node_set_loop`; that fast path precedes the new core
accessor. Its addon/worker control aborts if the core accessor is consulted.
The cleanup control verifies replacement and thread isolation, then one
no-host fallback query after cleanup.

The owner-only cold task, delayed-task and pending callbacks activate once,
then the runtime replaces `post_task`, `post_delayed`, `cancel_delayed`,
`pump_one` and `pending` with the original callbacks. Cancellation already
works without activating an unused host. The cold pump drains foreign work
without acquiring a loop. Outer run/pump/shutdown, backend fd/timeout and
native-loop access retain their activity checks; the task, timer and pending
steady-state callbacks contain none. The foreign entry is fixed and its
mutex publishes one wakeup function pointer, from a no-op to `uv_async_send`.
Promise and microtask processing paths are untouched.

The host harness forces 200 interleavings: the owner pauses in default-loop
acquisition while holding the activation lock, and the foreign thread signals
that it is attempting that same lock. Every completion runs exactly once.
The suite also covers posts before activation, tasks and checkpoints, timers,
pending work, settled-promise joining without a loop, owner identity and all
frozen fields. It passes 40 checks. The deterministic host zero-initializes its
optional native-loop entry.

`nts_host_activate` and `nts_host_loop` are host APIs; no HIR operation renders
a call to either. The public-header inventories nevertheless require NoRaise
catalog entries and signatures for all five LLVM ABIs. Those checks pass.
Neither API takes an `NtsHeader *`, carries `NTS_READS_ONLY`, or introduces a
JVM scalar helper declaration, so no erasure, read-only or JVM mapping row is
owed. The callback's no-raise protocol permits loop acquisition and host
assertions, never inline language execution.

The measured implementation scoped `--as-needed` around each existing `-lm`.
Review found that their original positions could precede a static archive
which first references math. The corrected link emits one scoped libm after
all library inputs; the follow-up records the GNU ld regression control. Emitted-argument controls
cover ELF, Mach-O and COFF. Fully static links keep their original flags.
Zig's driver rejected `--push-state`; Zig dynamic still links libm, a known
residue. The original static-musl/cross-link control remains and passes.
The live-math control builds both C and LLVM products: empty/hello does not
need libm, while a loop calling `Math.sin` retains it in `DT_NEEDED` and prints
the same result as Node.


The direct-native-I/O fixture was committed before the loop hook. It replaces
only the module body in each backend's real emitted standalone runner and
uses the actual Node timers, fs and crypto primitives through `loop.c`.
On the baseline all four cases agree with Node on both backends. On the lazy
host before the hook, the no-I/O control agrees but timer/fs/crypto each exit
without completion output on both backends. After the hook all 16
base/final × C/LLVM × four-case comparisons agree. The permanent C host
harness checks the same shared runner and the Node oracle.

The matched host count probe uses the harness's bundled static libuv, -O1,
reference counting, and 1000 mixed iterations in one outer loop run. Each
iteration posts a task, schedules/fires a timer, begins pending work and
posts its completion through the foreign entry. The count seam uses owner
posting for deterministic work; actual cross-thread ordering is forced by
the separate interleaving controls. Empty brackets remove process setup and
teardown. Seven interleaved repeats give:

| Probe arm | median net instructions | min–max | max/min spread |
|---|---:|---:|---:|
| base | 2297763.5 | 2297761–2297765 | 1.000001741 |
| variant | 2297764.5 | 2297763–2297766 | 1.000001306 |
| replay | 2297764.0 | 2297761.5–2297766.5 | 1.000002176 |

The variant's 1.000000435x base ratio is flat within the repeat spread.
First work including activation, one mixed iteration (a task, timer and
pending foreign completion) and teardown adds a
median 25093 instructions (25091–25163), once. Probe load was
23.66/25.44/28.92 → 25.37/25.76/29.00. Earlier exploratory probes are retained;
the accepted steady-state probe matches static UV and uses one outer run.

There are no async/event-loop benchmark groups; that instrumentation gap is
#909. The approved replacement is the host probe and the complete memory
foundation group. All 18 native rows are flat within their declared 1-bp
(0.01%) bands, including event-state and module-loop-retained. Both group
attempts failed json-build-append's Node oracle; their single-row retries
completed. All attempts remain in the raw evidence.

| Memory row | C before | C after | LLVM before | LLVM after | largest absolute move (bp) |
|---|---:|---:|---:|---:|---:|
| array-copying-methods | 482833 | 482832 | 538832 | 538832 | 0.0207 |
| awfy-towers | 941646 | 941646 | 908821 | 908821 | 0.0000 |
| cyclic-churn | 2375872 | 2375872 | 2377856 | 2377856 | 0.0000 |
| event-state | 1700 | 1700 | 1698 | 1698 | 0.0000 |
| immutable-update | 2031902 | 2031902 | 2033945 | 2033945 | 0.0000 |
| json-build-append | 222777 | 222777 | 222777 | 222777 | 0.0000 |
| json-stringify-doc | 27212312 | 27212310 | 27037196 | 27037192 | 0.0015 |
| map-entries-top-k | 387301 | 387301 | 398771 | 398771 | 0.0000 |
| module-loop-retained | 262196 | 262197 | 262197 | 262197 | 0.0381 |
| objects | 27684 | 27684 | 27684 | 27684 | 0.0000 |
| pipeline | 239558 | 239558 | 239558 | 239558 | 0.0000 |
| record-word-counts | 152641 | 152641 | 154112 | 154112 | 0.0000 |
| release-acyclic | 1832669 | 1832669 | 1832669 | 1832669 | 0.0000 |
| sort-objects | 468806 | 468806 | 480865 | 480865 | 0.0000 |
| sort-objects-runs | 669658 | 669658 | 674744 | 674744 | 0.0000 |
| sort-objects-shuffled | 1425253 | 1425253 | 1531948 | 1531948 | 0.0000 |
| string-sort-control | 2401 | 2401 | 2465 | 2465 | 0.0000 |
| tree-teardown | 597515 | 597515 | 597516 | 597516 | 0.0000 |


## Proof and retained evidence

`node tooling/gate/inner.ts --no-agree` passed formatting, runtime clang-format,
Clippy, a fresh compiler and all selected tests (tests: 682s). It includes the
native I/O regression, 40 host checks, Node-API loop/worker/cleanup controls,
C/LLVM live-libm checks, unchanged static/cross-link fixture and all header
inventories. Earlier red runs exposed the Zig driver rejection, an owner-query
effect edge and the isolated no-core fixture import; those were fixed without
weakening their controls. The local landing check is reported with the final
commit through Signalbox; this record does not queue a landing.

Raw output, source snapshots, exact argv, build identities, stats, profiles,
constructor inventories, launch observations and reproduction scripts are in
`~/.cache/nts-scratch/870/`. The immutable evidence manifest is
`~/.cache/nts-scratch/870/evidence.sha256` (708 files), SHA-256
`a97d747509fb1ba6a4b9f462e0fa4d1af7a39ec6ec0bf232029844662c244990`.
Decision-bearing files are `before/`, `after/`, `paired/`, `before-profile/`,
`after-profile/`, `startup-stats/`, `host-counts-final/counts.json`,
`native-loop-before/results.json`, `native-loop-after/results.json`,
`memory-comparison.json` and `inner-final.log`; the manifest also authenticates
exploratory and failed attempts. Raw machine output is not copied into Git.
