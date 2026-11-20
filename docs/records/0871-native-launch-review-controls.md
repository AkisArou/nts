# Native launch review controls

Review of f915443775d72804c7c7fb56e8c10df87af351fb found two correctness defects
in the implementation measured in [0870](0870-native-launch.md). The startup
counts did not exercise either path. The fixes retain the same lazy-host design.

## Activation inherits queued work

The owner detaches a foreign batch under its mutex, then executes it without
the mutex. A task A in that batch can first activate the host. If another thread
posts B after detachment but before activation, B used the no-op wakeup and was
left in the queue. The old claim that the owner drains that batch before it
blocks was false: it drained an earlier batch, not B's batch.

Activation now publishes uv_async_send and, under the same lock, signals when
the inherited queue is nonempty. Later posts use the immutable foreign entry
and the published wakeup target. The extra check is cold; the task, timer,
pending and foreign-post steady-state paths are unchanged.

A committed control repeats 100 times per arm: a foreign thread posts A; A
starts and joins a thread posting B, then schedules a zero-delay timer t. The
reviewed lazy host produced A -> t and dropped B 100 times. The explicit-loop
control produced A -> t -> B with no drops. The fix delivers B exactly once
and drops nothing in both arms; B/t ordering is allowed either way. The full
host harness now has 46 checks, including the original 200 forced
publication/post interleavings and frozen-field checks.

## Libm follows every library input

The original scoped libm preceded needs.libs, binding and loop flags, and
bundled archives. GNU ld can omit an as-needed DSO before a later archive
introduces its first reference. The application owner now emits one scoped
libm after all library inputs. The bundled-dependency owner omits its own
math flag only on that supported dynamic ELF route. Static, Zig, Mach-O and
COFF paths retain their existing flags.

The GCC C project captures the actual non-LTO link argv and loads the resulting
library. It verifies exactly one scoped libm after every library. A reduced
link retains those same flags and native caller/constant export, removing dead
runtime math references which could otherwise mask the ordering defect.
Reviewed argv: math index 9, archive index 11; its reduced GNU ld link fails
with undefined sin and cbrt. Fixed argv: archive index 8, math index 10; its
reduced link succeeds. The permanent fixture also moves the scoped block
back before the archive and checks that GNU ld rejects it. Normal C/LLVM
empty and Math.sin readelf/oracle controls remain in the full inner proof.

## Older supported GCC defects

CC is supported by docs/reference/cli.md and toolchain_for; ThinLTO is enabled
only for a clang-named driver. Two independent failures reproduce with CC=gcc
on clean main pin 9b264d589c79710b849ca6731125ba39e00b50c1:

- #917: library.native C fails in nts_array_push's always_inline call because
  the function body can be overwritten at link time. The ordering fixture uses
  -fno-semantic-interposition on both arms to isolate this older failure.
- #918: an LLVM executable reaches GNU ld without producing program.ll.o.

Neither defect is changed by #870. Exact commands, configs and errors are in
~/.cache/nts-scratch/870/main-gcc-check/{shared,llvm-object}/result.json;
~/.cache/nts-scratch/870/main-gcc-check.py reproduces both.

## Qualification of the original paired sitting

The original paired /bin/true floor inverted: empty 252.823 us (spread 1.2323)
and hello 228.117 us (1.1257), above the variant native and ScriptC cells.
That sitting cannot separate TIE from noise. Its formal policy classifications
remain historical observations; the instruction/fault/syscall counts carry
the cause claim. New sittings below retain their own ratios, spreads,
conditions and floor without subtracting a universal floor constant.

## Measured revision and conditions

The review fixes are in cb1a5d54db; final measured source is
9d5681c70e6607d6ed407b7d67759dc64d2e734c. The retained base is
723a9ce9f90144ee5047790c35a88912394f7e49. A fresh plain release build supplies
both nts and nts-bench. Hardware, comparator pins and protocol are unchanged
from the original record: i9-14900K, Linux 7.2.11-arch1-1, clang 23.1.5,
node 26.13.0, ScriptC 0.4.5 at 8971d694b18a81a9a52b8f8208be22b182cb092b,
Bun 1.4.4-canary.1 at 89452d2ac13773aee8a6d632c4c30074bd1bb4fa.

Both launch sittings run under the measurement lock on CPU 4 with sibling 5
idle, an empty canonical HOME/TMPDIR, three warmups and 21 rotating measured
rounds per column. Every timed sibling user/nice tick sample is zero. Spreads
are upper/lower quartiles. The ScriptC verdict is WON below 0.95x, TIE through
the larger cell spread or 1.05, otherwise LOSS. Ratios are within each sitting;
no universal floor is subtracted. The standard sitting wins all four native
empty/hello comparisons; the paired sitting formally ties all four. The paired
floor again inverted above variant native and ScriptC: those ties cannot be
separated from noise. All available native cells win against node. Builtins
remains refused with NTS1100 JSON.parse (#886); it has no native timing verdict.

| Sitting | load start → end (1/5/15 min) | MemAvailable GiB start → end |
|---|---|---:|
| standard, all rows | 42.91/36.31/32.64 → 33.15/34.51/32.12 | 19.55 → 18.83 |
| paired startup-empty | 33.15/34.51/32.12 → 33.15/34.51/32.12 | 18.81 → 18.75 |
| paired startup-hello | 33.15/34.51/32.12 → 31.86/34.22/32.04 | 18.66 → 18.88 |
| paired startup-builtins | 31.86/34.22/32.04 → 31.86/34.22/32.04 | 18.77 → 18.70 |

### Standard launch sitting

| Row | Column | µs | spread | / ScriptC | / node | ScriptC verdict |
|---|---|---:|---:|---:|---:|---|
| startup-empty | nts C | 165.106 | 1.0457 | 0.7921 | 0.00493 | WON |
| startup-empty | nts LLVM | 161.627 | 1.0631 | 0.7754 | 0.00482 | WON |
| startup-empty | node | 33523.396 | 1.0630 | 160.8230 | 1.00000 | — |
| startup-empty | Bun JIT | 2500.095 | 1.2186 | 11.9938 | 0.07458 | — |
| startup-empty | Bun AOT | 1938.372 | 1.1541 | 9.2990 | 0.05782 | — |
| startup-empty | ScriptC | 208.449 | 1.0827 | 1.0000 | 0.00622 | — |
| startup-empty | floor | 160.719 | 1.1010 | 0.7710 | 0.00479 | — |
| startup-hello | nts C | 177.943 | 1.0617 | 0.8347 | 0.00485 | WON |
| startup-hello | nts LLVM | 173.768 | 1.0362 | 0.8151 | 0.00474 | WON |
| startup-hello | node | 36679.042 | 1.0629 | 172.0470 | 1.00000 | — |
| startup-hello | Bun JIT | 2585.058 | 1.2144 | 12.1255 | 0.07048 | — |
| startup-hello | Bun AOT | 1927.489 | 1.0644 | 9.0411 | 0.05255 | — |
| startup-hello | ScriptC | 213.192 | 1.0544 | 1.0000 | 0.00581 | — |
| startup-hello | floor | 167.347 | 1.0703 | 0.7850 | 0.00456 | — |
| startup-builtins | nts C | REFUSED | — | — | — | unavailable |
| startup-builtins | nts LLVM | REFUSED | — | — | — | unavailable |
| startup-builtins | node | 40338.305 | 1.0215 | 124.9719 | 1.00000 | — |
| startup-builtins | Bun JIT | 3013.204 | 1.0315 | 9.3352 | 0.07470 | — |
| startup-builtins | Bun AOT | 2326.681 | 1.0489 | 7.2083 | 0.05768 | — |
| startup-builtins | ScriptC | 322.779 | 1.0932 | 1.0000 | 0.00800 | — |
| startup-builtins | floor | 181.072 | 1.0501 | 0.5610 | 0.00449 | — |

### Paired base/fixed/replay sitting

| Row | Column | µs | spread | / ScriptC | / node | ScriptC verdict |
|---|---|---:|---:|---:|---:|---|
| startup-empty | base nts C | 292.920 | 1.0579 | 1.6294 | 0.00817 | LOSS |
| startup-empty | fixed nts C | 184.315 | 1.0354 | 1.0253 | 0.00514 | TIE |
| startup-empty | replay nts C | 260.807 | 1.0815 | 1.4508 | 0.00728 | LOSS |
| startup-empty | base nts LLVM | 263.946 | 1.0290 | 1.4682 | 0.00737 | LOSS |
| startup-empty | fixed nts LLVM | 178.158 | 1.0586 | 0.9910 | 0.00497 | TIE |
| startup-empty | replay nts LLVM | 249.520 | 1.0487 | 1.3880 | 0.00696 | LOSS |
| startup-empty | ScriptC | 179.771 | 1.0415 | 1.0000 | 0.00502 | — |
| startup-empty | node | 35834.208 | 1.0392 | 199.3325 | 1.00000 | — |
| startup-empty | Bun JIT | 2689.708 | 1.0509 | 14.9619 | 0.07506 | — |
| startup-empty | Bun AOT | 2071.780 | 1.0405 | 11.5246 | 0.05782 | — |
| startup-empty | floor | 224.849 | 1.0962 | 1.2508 | 0.00627 | — |
| startup-hello | base nts C | 315.390 | 1.0827 | 1.5916 | 0.00780 | LOSS |
| startup-hello | fixed nts C | 207.863 | 1.0558 | 1.0489 | 0.00514 | TIE |
| startup-hello | replay nts C | 282.918 | 1.0439 | 1.4277 | 0.00700 | LOSS |
| startup-hello | base nts LLVM | 284.892 | 1.0542 | 1.4377 | 0.00705 | LOSS |
| startup-hello | fixed nts LLVM | 204.861 | 1.0617 | 1.0338 | 0.00507 | TIE |
| startup-hello | replay nts LLVM | 276.029 | 1.0576 | 1.3929 | 0.00683 | LOSS |
| startup-hello | ScriptC | 198.165 | 1.0648 | 1.0000 | 0.00490 | — |
| startup-hello | node | 40409.995 | 1.0327 | 203.9209 | 1.00000 | — |
| startup-hello | Bun JIT | 2900.220 | 1.0527 | 14.6354 | 0.07177 | — |
| startup-hello | Bun AOT | 2293.530 | 1.0485 | 11.5738 | 0.05676 | — |
| startup-hello | floor | 233.937 | 1.1324 | 1.1805 | 0.00579 | — |
| startup-builtins | ScriptC | 271.945 | 1.0566 | 1.0000 | 0.00667 | — |
| startup-builtins | node | 40749.523 | 1.0497 | 149.8447 | 1.00000 | — |
| startup-builtins | Bun JIT | 2999.845 | 1.0381 | 11.0311 | 0.07362 | — |
| startup-builtins | Bun AOT | 2273.551 | 1.0489 | 8.3603 | 0.05579 | — |
| startup-builtins | floor | 228.625 | 1.0981 | 0.8407 | 0.00561 | — |
| startup-builtins | fixed nts C / LLVM | REFUSED | — | — | — | unavailable |

## Hot-path counts

The same matched static-libuv host harness uses -O1, reference counting and
1000 mixed iterations in one outer run. Each iteration posts a task, schedules
and fires a timer, begins pending work and posts its completion through the
foreign entry. Empty brackets remove process setup/teardown. Seven interleaved
perf repeats under the lock give:

| Probe arm | median net instructions | min–max | max/min spread |
|---|---:|---:|---:|
| base | 2297763.0 | 2297761.5–2297765 | 1.000001523222 |
| fixed | 2297765.5 | 2297763.5–2297835 | 1.000031117215 |
| replay | 2297764.0 | 2297763–2297768.5 | 1.000002393632 |

The fixed median differs from base by 2.5 instructions per 1000 iterations,
inside the repeated ranges. First work including activation, one mixed
iteration (task, timer, pending foreign completion) and teardown is a one-time
median 25095 instructions, range 25093–25165. This is not activation alone.
Load was 31.63/28.64/30.44 → 32.61/28.95/30.53.

Only owner cold task, delayed-task and pending callbacks activate and replace
the five owner callbacks. Cancellation and cold pumping can operate without
activation. Outer run/pump/shutdown, backend fd/timeout and native-loop access
retain checks. The foreign entry is immutable; its mutex publishes the wakeup
pointer. Hot task/timer/pending operations retain their original bodies.
Promise and microtask processing paths are untouched. Only the standalone
libuv main passes NULL. Explicit-loop GLib/CoreFoundation/Win32 hosts remain
eager. Node-API retains its explicit-loop fast path, guarded against calling
the core accessor. JVM uses Java NtsEnv, not this C host.

There are no async/event-loop benchmark groups (#909). The agreed replacement
is the host probe plus --count on all 18 memory rows. Every native movement
is below its 1-bp (0.01%) band. The first group attempt failed event-state's
Node oracle; its single-row retry passed. All attempts are retained.

| Row | C before / fixed | LLVM before / fixed | largest absolute movement (bp) |
|---|---:|---:|---:|
| array-copying-methods | 482833 / 482832 | 538832 / 538832 | 0.0207 |
| awfy-towers | 941646 / 941646 | 908821 / 908821 | 0.0000 |
| cyclic-churn | 2375872 / 2375872 | 2377856 / 2377856 | 0.0000 |
| event-state | 1700 / 1700 | 1698 / 1698 | 0.0000 |
| immutable-update | 2031902 / 2031902 | 2033945 / 2033945 | 0.0000 |
| json-build-append | 222777 / 222777 | 222777 / 222777 | 0.0000 |
| json-stringify-doc | 27212312 / 27212310 | 27037196 / 27037191 | 0.0018 |
| map-entries-top-k | 387301 / 387301 | 398771 / 398771 | 0.0000 |
| module-loop-retained | 262196 / 262197 | 262197 / 262197 | 0.0381 |
| objects | 27684 / 27684 | 27684 / 27684 | 0.0000 |
| pipeline | 239558 / 239558 | 239558 / 239558 | 0.0000 |
| record-word-counts | 152641 / 152641 | 154112 / 154112 | 0.0000 |
| release-acyclic | 1832669 / 1832669 | 1832669 / 1832669 | 0.0000 |
| sort-objects | 468806 / 468806 | 480865 / 480865 | 0.0000 |
| sort-objects-runs | 669658 / 669658 | 674744 / 674744 | 0.0000 |
| sort-objects-shuffled | 1425253 / 1425253 | 1531948 / 1531948 | 0.0000 |
| string-sort-control | 2401 / 2401 | 2465 / 2465 | 0.0000 |
| tree-teardown | 597515 / 597515 | 597516 / 597516 | 0.0000 |

## Repeated launch profile and counts

A separate locked perf sitting repeats 51 execs per column, before and fixed,
for instruction and minor/major-fault counts. These are instrumented counts,
not the timed verdict. Comparator counts describe those processes. Each perf
command exited zero. Bun AOT retains three baseline major faults; all fixed
major-fault means are zero in this repeat. The byte-identical C/LLVM products
can differ by a few instructions in the repeat means.

### startup-empty

| Column | before instructions / minor / major faults | fixed instructions / minor / major faults |
|---|---:|---:|
| nts-C | 191998 / 77 / 0 | 128925 / 56 / 0 |
| nts-LLVM | 191999 / 77 / 0 | 128929 / 56 / 0 |
| ScriptC | 120721 / 68 / 0 | 120721 / 68 / 0 |
| node | 305983109 / 9210 / 0 | 305463992 / 9208 / 0 |
| Bun-JIT | 3880609 / 743 / 0 | 3879593 / 744 / 0 |
| Bun-AOT | 2869461 / 729 / 3 | 2869570 / 702 / 0 |
| floor | 140228 / 53 / 0 | 140228 / 53 / 0 |

### startup-hello

| Column | before instructions / minor / major faults | fixed instructions / minor / major faults |
|---|---:|---:|
| nts-C | 194695 / 79 / 0 | 132851 / 59 / 0 |
| nts-LLVM | 194692 / 79 / 0 | 132855 / 59 / 0 |
| ScriptC | 123208 / 68 / 0 | 123208 / 68 / 0 |
| node | 332181560 / 9431 / 0 | 332222782 / 9432 / 0 |
| Bun-JIT | 3912331 / 753 / 0 | 3912524 / 754 / 0 |
| Bun-AOT | 2879442 / 738 / 3 | 2879484 / 711 / 0 |
| floor | 140228 / 53 / 0 | 140228 / 53 / 0 |

### Loader and syscall control

| Column | instructions | minor faults | syscalls | initial / relative / final relocations |
|---|---:|---:|---:|---:|
| true | 140228 | 53 | 31 | 145 / 0 / 145 |
| nts-C | 128925 | 56 | 35 | 99 / 27 / 111 |
| nts-LLVM | 128929 | 56 | 35 | 99 / 27 / 111 |
| ScriptC | 120721 | 68 | 31 | 101 / 20 / 108 |

The fixed empty C/LLVM artifacts are byte-identical, SHA-256
`db35407428f2ae2bf61f9f521ebfad7dbe4cd0f7dc2d61e7cfb234287c61b647`.
Readelf/ldd show libc only for both, with static libuv. The repeated profile
retains the 27-syscall reduction detailed in the original record, with the
four remaining nts stack/signal diagnostics above the 31-syscall common trace.
Relocation categories are reported separately, never summed. The original
132-versus-101 initial-relocation residue is gone (fixed nts 99, ScriptC 101).

Perf record repeats 300 execs per column using user-only cpu_core/cycles/u,
period 10000, DWARF user callchains and no kernel callchains. Python launch
samples and unidentified transition addresses remain; no wall-time share or
kernel-time decomposition is inferred from them. Profile load was
17.99/28.70/30.28 → 18.03/28.18/30.08.

## Proof

The focused host witness and captured/reduced GCC controls pass. Full
`node tooling/gate/inner.ts --no-agree` passes formatting, runtime clang-format,
Clippy, fresh compiler build and all selected tests (tests: 692s). This includes
46 host checks, native timers/fs/crypto and no-I/O controls, Node-API
worker/cleanup controls, ELF/Mach-O/COFF emitted arguments, static/Zig guards,
normal C/LLVM empty and live-Math.sin readelf/oracle controls, and all runtime
header inventories. Earlier red fixture attempts and their corrections are
retained. The final commit's `check.ts --here` result is sent through Signalbox;
no landing is queued by the worker.

## Retained evidence

Raw argv, errors, counters, profiles, launch observations, source snapshots and
reproduction scripts are kept under `~/.cache/nts-scratch/870/`. The new
`review-evidence.sha256` manifest (2936 files) has SHA-256
`19b3cdb09af3b6f5a14950fc3a09df552d9c75ff9352fa6698d85382a45acd30`.
It authenticates `review-before/`, `review-host-after/`, `review-link-controls/`,
`main-gcc-check/`, `host-counts-review/`, `review-after/`, `review-paired/`,
`review-after-profile/`, `review-startup-stats/`, the memory comparison,
`review-inner5.log`, all earlier review attempts, and `scripts-review/`.
The original `evidence.sha256` and all original sitting outputs remain intact.
The final local landing log is `review-landing.log`; its exact commit and
verdict travel through Signalbox after the run.
