# Native Chromium architecture and cost experiments

Initial investigation, 2026-10-05. V8 remains enabled and React remains outside
scope. This complements the [RFC](../../../docs/electron-like.md) and the
[DOM/scheduling record](dom-and-microtasks.md); it is not a final API or ABI.
The objective covers execution, scheduling, ownership, binding generation,
interoperability, and deployment as well as individual DOM calls.

## Working architecture

```mermaid
flowchart TD
  B[Browser: content embedder, origins, privileged services]
  B <-->|Mojo across processes| R[Sandboxed renderer main thread]
  R --> E[Native callback entry: document lifetime and NTS environment]
  E --> A[Compiled TypeScript application: C or LLVM]
  A --> C[Private C adapter: managed values and native ABI]
  C --> D[Pinned Blink adapter: typed direct calls]
  D --> DOM[Real Blink nodes and Web platform]
  A --> H[NtsHost adapter]
  H --> Q[Document agent EventLoop and microtask queue]
  V[V8 platform state and explicit JavaScript interop] --> Q
  Q --> E
```

Application DOM calls run on the renderer's owner thread. They call Blink in
the same process; neither JS evaluation, serialization, nor browser-process
IPC is required for an ordinary DOM mutation. Browser services still use
Chromium's process boundary. The C adapter owns managed NTS details; Blink
implementation types stay in its version-specific target. Static linking is
the current bring-up mechanism, not a commitment to a stable binary ABI.

Chromium supplies task scheduling and the message pump. V8 is not the event
loop host replacing libuv. Blink uses a V8 microtask queue for platform job
ordering, and native jobs join the document agent's actual queue. A second
renderer libuv loop would introduce another scheduler and lifecycle to
coordinate; the working renderer design uses the Chromium host.
Task/timer and cross-thread completion adapters are still unimplemented.
Web timer semantics would need Blink's scheduling rules, not just an arbitrary
delayed task. Native main-process/Node services remain a separate later scope.

V8 retains its realms, platform JavaScript callbacks, exception machinery,
and Blink GC integration. The app does not need a V8 object for every native
record or every native DOM handle. NTS records use RC and cycle collection;
Blink nodes use Oilpan, integrated with V8's C++ heap; JavaScript objects use
V8's collector. These facts do not supply a collector for NTS↔DOM↔JS cycles.
See the pinned [EventLoop](https://chromium.googlesource.com/chromium/src/+/b510e9d7cd3a2fbd78d0ddc42234103206c5f78d/third_party/blink/renderer/platform/scheduler/public/event_loop.h)
and [ThreadState](https://chromium.googlesource.com/chromium/src/+/b510e9d7cd3a2fbd78d0ddc42234103206c5f78d/third_party/blink/renderer/platform/heap/thread_state.cc).

## Architecture decisions to test

| Area | Current experiment | Candidate direction and acceptance gate |
| --- | --- | --- |
| Callback entry | Explicit per-document environment and C exception barrier | Keep ownership explicit. Compare per-operation realm setup with a lexical DOM entry; measure short callbacks and computation-only entries. |
| Synchronous semantics | Immediate Blink operations, individual CE reaction scopes, actual exception handling | Amortize entry setup without batching DOM effects or delaying reactions. Prove nested dispatch, foreign-realm reentry, and navigation during reactions. |
| Native object identity | Indexed handles with canonical lookup; every bound node remains rooted until disposal | Compare document-scoped root leases and typed foreign wrappers. Reclaim roots when the last native owner releases them; test stale identities and reuse before choosing a representation. |
| Cross-heap lifetime | Explicit listener removal and document disposal | Reduce cycles containing a DOM listener, an NTS closure, and a DOM reference. A weak cache alone cannot break arbitrary cycles. |
| Module state | Explicit state objects; no mutable application module globals | Compare explicit instance state, hidden instance parameters, and thread-local instance selection. A fresh environment does not instantiate generated module globals. Do not force extra renderers solely to hide this problem. |
| Jobs and tasks | Shared microtasks, owned run/drop envelopes, checkpoint-end collection witness | Agree generated cancellation and public checkpoint maintenance with the owning lanes. Then add owner-thread tasks/timers and cross-thread completions, with ordering and teardown tests. |
| Strings and primitives | Authored C ABI, typed-array loans, copied length-bearing UTF-16 | Investigate borrowed 8/16-bit string views and compact results without temporary managed buffers. Preserve NUL, lone surrogates, nullability and conversion semantics. |
| Binding generation | Handwritten implementation for a small IDL-derived subset | Generate typed direct operations and semantic annotations from pinned Chromium IDL/binding facts. Keep exceptional APIs behind reviewed adapters; reject unsupported operations explicitly. |
| V8 interop | V8 comparison instrumentation; no ordinary DOM call routed through JS | Make genuine JS-object/callback interop explicit. Measure wrapper creation, conversions and cross-heap retention separately. |
| Origin and packaging | Exact local-file opt-in | Move to browser-owned packaged origins and document-scoped services. Then test normal multi-document navigation, freeze/restore, startup and complete resources. |
| Optimization and upgrades | Debug component engine; native archive compiled with pinned Clang at `-O2` | Repeat with optimized Chromium, then investigate final static/LTO packaging. Preserve upstream layers and acceptance fixtures across a source-pin upgrade. |

The root lease and module-instance rows are proposals, not implemented
contracts. Raw Blink pointers cannot simply become reference-counted NTS
objects: Oilpan lifetime needs an explicit root bridge. A lease wrapper also
needs a disposal protocol and a cycle policy for callbacks that capture it.

Result/error representation is part of the architecture too. The prototype's
context-wide scratch status and subsequent `status()` read are convenient for
reductions; they are not a final reentrant exception ABI. Results should carry
their own success/error state, with full exception semantics defined before
general synchronous callbacks are admitted. Neither an arbitrary numeric
token nor a manual `Opaque` pointer establishes safe managed DOM ownership.

Generated bindings must account for conversions, overload resolution,
nullable results, `[CEReactions]`, execution/script context requirements,
`[ImplementedAs]`, exceptions and API-specific policies. Calling the same
method name is insufficient. Ordinary typed application syntax and the
generator follow a proven native representation; they do not require a new
Web HIR. The existing managed/opaque ABI refusal is recorded in the
[contract reductions](contracts/README.md).

## Implemented experiment

`nts_blink_dom_native_scope` establishes the main-world script context and
do-not-run microtask scope once around a compiled DOM entry. Individual calls
retain document/realm validity checks, exception guards, node resolution,
strong context guards and their required CE reaction scopes. They skip repeat
realm/microtask setup only while the lexical entry's realm is actually current.
A reentrant call from another realm takes the ordinary setup path. No DOM
operation is deferred. General reentrant behavior is still an acceptance gate.

The existing DOM program, counter update and async completion DOM update now
exercise this scope. Their exact UTF-16, detached-node GC, error codes,
identity, input/lifecycle and complete mixed-job/CE/MO comparisons are checked
against independently executed V8 fixtures for both native backends.

The character copy now creates owned Blink UTF-16 storage directly and copies
the bytes once, avoiding the temporary vector and second copy. The former
vector path remains only as a benchmark control. This change preserves
embedded NUL and both paired and lone surrogates; it does not borrow native
storage after return or claim zero-copy DOM strings.

The initial benchmark setup exposed missing retention of borrowed string
parameters assigned to fields in the available compiler's generated code.
It now keeps source strings explicitly owned in C and passes them as borrowed
arguments. The returned setup record owns only freshly created typed arrays.
No generated output is rewritten and no missing retain is compensated for.
The compiler is the available October 3 binary recorded by `check.ts`, not a
new build of today's compiler sources.

## Entered DOM ABI (second iteration, 2026-10-05)

The debug results below were measured on a debug Blink *and* a debug V8, so
they cannot rank native against V8. They did show where the first bridge
spent its time: every operation looked up the main-world `ScriptState`,
entered the V8 context, opened a `MicrotasksScope` and a `v8::TryCatch`,
materialized a V8 `DOMException` to read back its code, and copied each
string after the compiled code had already converted it with a
`charCodeAt` loop. The second iteration removes each of those by design
rather than by tuning:

| Concern | First bridge | Entered ABI ([`dom_abi.h`](native-bootstrap/native/ffi/dom_abi.h)) |
| --- | --- | --- |
| Entry | V8 context, microtask scope and `TryCatch` per operation | One `nts_blink_dom_entry` per native callback, holding the agent's microtask scope as `V8ScriptRunner::CallFunction` does for script; the outermost one checkpoints on return |
| Exceptions | Thrown into V8, caught, unwrapped to a code; non-DOM errors became 1000 | `DummyExceptionStateForTesting` records code and message with no isolate; each result carries its own status |
| Per-operation scopes | All of them | Only what the IDL member requires, e.g. `[CEReactions]` |
| Names, literal text | Copied and re-atomized on every call | Interned once per document; operations pass an atom id: no copy, no hash. A text write from the table is a shared `StringImpl` reference, which V8's externalization gives repeated page strings |
| Dynamic text | Copied twice and widened to UTF-16 | One copy at the string's own width (Latin-1 or UTF-16), the floor for text Blink keeps |
| Node handles | Index; every node rooted until disposal | Leased slot + generation; a released handle never aliases a later node, and the last lease unroots the node |
| Wrapper hop | `dom_host.c` per call | None: the Blink adapter implements the C ABI directly |

Two fixtures exercise it against ordinary page JavaScript in unmodified
`content_shell`. `binding-benchmark` keeps the Text-node microbenchmark and
adds Latin-1, fresh-string (`prefix + suffix` per mutation) and interned-text
rows. `rows-benchmark` is a js-framework-benchmark-shaped table
(create/replace/update/select/swap/remove/append/clear over 1k and 10k
rows, plus `+layout` cases that force style and layout after each
operation). Both fixtures run one case table; the runner requires the
native and V8 documents to end identical and the native registry to hold
exactly the leases the app still owns.

## Standalone evidence: the application's own cost

`rows-standalone/check.ts` runs the same compiled rows app over a C
mini-DOM implementing `dom_abi.h`, and the V8 fixture's page script over a
JS mini-DOM in Node. C, LLVM and the page script build identical rows, and
the app leaks no lease. It found the largest cost outside Blink:

| One `remove` of 1,000 rows | C backend |
| --- | ---: |
| Runtime default: collect cycles at every checkpoint | 16.7 µs |
| Host-owned checkpoints, collection between interactions | 0.16 µs |
| That deferred collection, per removal | 0.23 µs |

The compiler retains and releases `app.rows` around the runtime `splice`
helper; the release leaves the array a cycle candidate, and the runtime's
checkpoint pass walks all of it on every event. The renderer host therefore
owns checkpoints and collects in Blink idle time
(`nts_chromium_probe_install_host`, `ThreadScheduler::PostIdleTask`), with
the runtime's candidate threshold as the backstop; the rows harness performs
and reports that collection between batches rather than hiding it. The
compiler-side cause and the runtime policy are recorded in
[compiler-requests.md](contracts/compiler-requests.md), items 3 and 5, and
are being fixed in the compiler and runtime themselves. With collection out
of the way, the profile's hottest symbol is `fmod`: every `%` calls libm.

## Measurement method and interpretation

The script-free `binding-benchmark` fixture compares eight paths on the same
attached Text node, alternating distinct strings of 16, 256 and 4096 UTF-16
units. U+0100 forces wide representation in every path.

| Path | Purpose |
| --- | --- |
| `blink-prepared` | Intrinsic control using prebuilt Blink strings; omits adapter/conversion/binding work. |
| `native-vector-per-call` | Previous two-copy adapter control. |
| `native-copy-per-call` | Single-copy adapter with ordinary per-operation entry setup. |
| `native-copy-scoped` | Same operation inside a lexical DOM entry. |
| `compiled-copies-per-call`, `compiled-copies-scoped` | Actual compiled TS loop, freshly converting strings to typed arrays on every mutation. |
| `compiled-prepared-per-call`, `compiled-prepared-scoped` | Actual compiled TS loop reusing prepared native inputs. Blink still copies on every mutation. |

An additional entry matrix uses 0, 2, 8 or 32 mutations per compiled callback,
with and without a DOM entry scope. Every callback enters/leaves its native
environment normally; runtime checkpointing is not hidden inside a synthetic
outer callback. Zero mutations expose unnecessary realm setup. Nonempty
entries alternate A/B and finish on B, avoiding identical-value updates.

Each native launch collects 168 operation and 168 entry samples. Its separate
ordinary page-JavaScript reference collects 21 samples in unmodified
`content_shell`, with normal V8 JIT. Six launch pairs per backend balance both
launch orders and all three payload-length rotations, giving 42 samples per
case. Warm-up uses 16,384 operations and calibration targets 16 ms samples,
followed by seven rounds. Timing happens in the renderer;
CDP, setup and logging stay outside the repeated timed work. Samples include
allocation/retain counters and entry validation; they are diagnostic cost
comparisons, not uninstrumented API latency. Setup allocations are reclaimed
and checked against the pre-setup native live count. Prepared loops must
allocate no NTS heap objects and all loops must preserve native live counts.

The runner pins only the measured renderer main thread when `--cpu` is given,
verifies its PID/executable and sandbox, and records CPU information, affinity,
host load, raw samples, quartiles, source/archive/compiler identities and GN
arguments. It rejects an active build or changed executable/staging/arguments.
The V8 control uses the same Text-node mutation and payloads in its own
document, with matching Chromium configuration, display, main-thread CPU
affinity and sandbox. Application code is loaded by the HTML parser and
invoked through real input; debugger evaluation only inspects state. Spare
renderer prewarming is suppressed equally to make the measured tab's PID
unambiguous. Native TimeTicks and page performance.now differ in precision;
long samples reduce page-clock quantization. No forced GC occurs inside
measured loops. The current NTS runtime's allocation counters remain part of
native execution; no extra per-call counters are added to the V8 path.
This is not an end-to-end layout, rendering, memory or cold-start workload.
The short native entry matrix is not a V8 callback-latency comparison.
Full Chrome's product services, PGO and final distribution settings are also
outside this component-engine comparison.

The debug diagnostic establishes three NTS heap allocations per fresh input
conversion and zero for prepared input through both backends. Prepared input
still incurs one managed retain per mutation and a Blink string allocation;
zero NTS allocations does not mean zero total allocations or zero overhead.
The short-callback axis shows why a realm scope should not be applied blindly
to all native code: it adds work to a computation-only entry. The optimized
engine must establish the production break-even point and cost ranking.

## Optimized engine results (2026-10-05)

Static release Chromium with DCHECKs off (`perf-args.gn`), C backend, the
entered DOM ABI. The archive was compiled by the candidate compiler pin
`chromium-rc/pins/dev-665bfe681be4` (SHA `7ef4e76c...`, main 7a453f3ad plus
the three RC packets below): the shipped `target/release/nts` leaks the rows
app's table when it is destroyed (an export's parameter fields were assumed
zero), so the rows workload cannot pass its own leak checks with it. Each
result records the compiler it used. V8 is unmodified `content_shell` with
normal JIT. Semantic smoke and V8-oracle checks pass on this engine.

Text-node mutation, median ns per mutation, six balanced launch pairs:

| Payload | Interned (atom) | Prepared | Fresh `string` | V8 fresh | V8 repeated | Blink intrinsic |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Latin-1, 16 | 56 | 112 | 133 | 129 | 75 | 47 |
| Latin-1, 256 | 56 | 112 | 158 | 259 | 92 | 46 |
| Latin-1, 4096 | 56 | 138 | 1834 | 1393 | 1307 | 47 |
| UTF-16, 256 | 57 | 121 | 743 | 320 | 87 | 47 |
| UTF-16, 4096 | 57 | 168 | 9188 | 2453 | 2468 | 47 |

The boundary itself is about 9 ns: an interned write costs 56 ns against 47 ns
for Blink's own call with a prebuilt string. Everything above that is strings.
Fresh text crosses today's `string` ABI as UTF-8 -- copied by NTS, scanned,
then scanned and copied again by Blink -- and non-ASCII text is three to four
times slower than V8 because of it ([request 1](contracts/compiler-requests.md)).
A native entry costs 32 ns; inside one, an operation is about 117 ns against
about 152 ns with per-operation setup.

The rows workload (js-framework-benchmark-shaped, four balanced pairs) is at
parity: create1k 2.82 vs 2.90 ms, replace1k 3.30 vs 3.30 ms, update10th 20.2 vs
20.0 us, create10k 27.8 vs 28.4 ms. Blink's cloning, insertion and text work
dominate; the compiled application's own cost (about 0.9 ms per thousand rows
standalone) is a small slice. `create1k+layout` is the exception: 38.2 ms
native against 30.2 ms V8, while `create1k` alone is at parity. Unexplained;
the leading hypothesis is Oilpan collection pressure from leases churned
through the traced handle registry (four temporaries per row), to be tested
with `benchmark.ts --trace-gc` before anything is changed for it.

What this says about where native wins: per-call binding work (interned and
prepared text, 2-40x), and compute in the application itself -- not DOM
construction, where both engines wait on Blink.

## RC defects found by this lane and fixed in the compiler

Measured with `tooling/memory`'s harness on the unmodified compiler (main
7a453f3ad), each fixed on branch `chromium/rc-runtime-helper-borrows`
(worktree `~/.cache/nts-chromium-rc`) and delivered to Main for review:

| Defect | Effect on main | Commit |
| --- | --- | --- |
| A field of a parameter retained around runtime array helpers (`app.rows.splice`) | every event re-walked the whole table at the checkpoint: remove 30.2 -> 0.10 us | a26a73f62 |
| Cycle classification ignored structural casts, erased fields, Map/Set/Promise | cycles leaked (15, 5 and 15 objects in three reductions) | edbded1db |
| An export's parameter fields assumed zero ("no caller to be wrong about") | `app.rows = []` in an export leaked the old array and its rows | 665bfe681 |

The second also made the first safe: eliding the container's retain unmasked
a misclassified cycle (0 -> 15 leaked) until classification was honest.

## Completed debug measurements

Both six-pair runs passed on 2026-10-05. The following values are medians in
microseconds per mutation, with 42 samples per cell. The two V8 rows are
separate cohorts of the same unmodified executable, not different V8 backends.
These replace the earlier debugger-evaluated, unbalanced comparisons.

| Path / cohort | 16 UTF-16 units | 4096 UTF-16 units |
| --- | ---: | ---: |
| C compiled, fresh conversion, scoped | 4.627 | 13.177 |
| LLVM compiled, fresh conversion, scoped | 4.585 | 16.237 |
| C compiled, prepared, per-call setup | 4.764 | 5.072 |
| LLVM compiled, prepared, per-call setup | 4.744 | 5.007 |
| C compiled, prepared, scoped | 4.249 | 4.456 |
| LLVM compiled, prepared, scoped | 4.146 | 4.425 |
| Intrinsic prebuilt Blink, C cohort | 2.016 | 2.036 |
| Intrinsic prebuilt Blink, LLVM cohort | 2.033 | 2.023 |
| Ordinary page V8, C cohort | 3.237 | 6.277 |
| Ordinary page V8, LLVM cohort | 2.673 | 2.665 |

Prepared compiled loops perform zero NTS heap allocations and one retain per
mutation in both backends; fresh conversions perform three allocations and
one retain. Single-copy plus lexical setup removes costs from the old vector
control, which measured 74.130 µs (C cohort) and 72.396 µs (LLVM cohort) at
4096 units. These are debug implementation costs, not expected production
ratios. Individual checks and the Blink allocation still remain in the new
prepared path; its approximately 4.2–4.5 µs cost exceeds the intrinsic control.

V8 has substantial unexplained between-launch variation. At 4096 units, some
launches stay around 2.6 µs and others around 6.1–6.7 µs through the timed
rounds. The LLVM-cohort V8 interquartile interval is 2.632–6.177 µs, versus
4.314–4.478 µs for its prepared scoped native path. The C-cohort V8 interval
is 6.056–6.516 µs, versus 4.410–4.653 µs for native. Slow launches are retained
in the raw samples. Warm-up/tiering and string externalization are possible
investigation leads, not established explanations. Fixed operation-count
warm-up does not prove that V8 has reached steady state. The reversal between
cohorts prevents a robust native-versus-V8 performance conclusion. In the
stable short-string rows, ordinary V8 is faster than this native prototype.

The separate entry matrix also exposes an architectural tradeoff. The table
below is microseconds **per callback**, with 16-unit prepared inputs and normal
NTS entry/leave maintenance in every callback:

| DOM mutations / callback | C per-call setup | C lexical scope | LLVM per-call setup | LLVM lexical scope |
| --- | ---: | ---: | ---: | ---: |
| 0 | 0.385 | 1.522 | 0.386 | 1.535 |
| 2 | 10.004 | 10.325 | 10.001 | 10.305 |
| 8 | 38.646 | 35.677 | 38.317 | 35.122 |
| 32 | 156.000 | 138.148 | 151.600 | 134.504 |

Scope setup loses on empty/two-operation entries and wins in the sampled
eight/32-operation entries. That is evidence for selective entry architecture,
not a production break-even threshold. Optimized Blink and stable V8 cohorts
are still required before selecting a final binding design.

Raw results, including provenance and all samples, are in
`target/chromium/binding-benchmark-{c,llvm}-debug/result.json`. The selected
baseline executable at handoff uses C. No optimized engine build is running;
see the [handoff](HANDOFF.md) for the exact stop state and continuation steps.

## Reproduce and next gates

After the accepted baseline, run each backend sequentially:

```sh
node tooling/chromium/probe.ts c
node tooling/chromium/chromium.ts build --jobs 8
node tooling/chromium/benchmark.ts third_party/chromium/src/out/NtsBaseline/nts_shell target/chromium/binding-benchmark-c-debug c --allow-debug --cpu 4 --runs 6
node tooling/chromium/probe.ts llvm
node tooling/chromium/chromium.ts build --jobs 8
node tooling/chromium/benchmark.ts third_party/chromium/src/out/NtsBaseline/nts_shell target/chromium/binding-benchmark-llvm-debug llvm --allow-debug --cpu 4 --runs 6
```

Use an available CPU on the measurement host. Debug engine timings require
explicit `--allow-debug` and cannot establish production performance.

The optimized profile is a static release build with DCHECKs off
(`perf-args.gn`): non-official Linux builds otherwise default
`dcheck_always_on` and expensive DCHECKs on, and a component build puts
every adapter->Blink->V8 call behind a PLT. It is still not an official
ThinLTO/PGO build. Its first build started 2026-10-05:

```sh
node tooling/chromium/probe.ts c --profile perf
node tooling/chromium/chromium.ts build --profile perf --jobs 8 --background
node tooling/chromium/chromium.ts status --profile perf
# After the build passes, run semantic checks before performance comparison.
node tooling/chromium/smoke.ts third_party/chromium/src/out/NtsPerf/nts_shell target/chromium/perf/native-dom-c-smoke c dom
node tooling/chromium/smoke.ts third_party/chromium/src/out/NtsPerf/nts_shell target/chromium/perf/native-microtasks-c-smoke c microtasks
node tooling/chromium/benchmark.ts third_party/chromium/src/out/NtsPerf/nts_shell target/chromium/perf/binding-benchmark-c c --cpu 4 --runs 6
node tooling/chromium/benchmark.ts third_party/chromium/src/out/NtsPerf/nts_shell target/chromium/perf/rows-c c --cpu 4 --runs 4 --workload rows
```

Repeat with LLVM after the C run. All profiles share a writer guard because
their staged source is shared; never stage or build another profile while a
build runs. Eight jobs remain the conservative limit after the earlier OOM.
Add `--collection checkpoint` to the rows run for the runtime-default arm.

Next measure the entry break-even point and native/Blink boundary with the
optimized engine, then investigate borrowed string views and root leases.
In parallel with those architecture choices, reduce reentry/disposal,
module-instance and cancellation semantics before widening the binding surface.
Finally use equivalent complete UI workloads for cold/warm startup, event-to-
paint latency, CPU, allocation, PSS and distribution resources. Promote choices
only when both semantics and the relevant measurements support them.
