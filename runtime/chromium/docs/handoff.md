# Chromium experiment handoff

> **Superseded for the current design by [architecture.md](architecture.md)**
> (2026-10-06): nodes are Blink's own pointers rooted only where the program
> keeps them, text crosses as views both ways, and the legacy bridge is gone.
> Paths below predate the 2026-10-06 layout (see the [README](../README.md)).
> What follows is the record of how the lane got there.

Prepared 2026-10-05 at the user's request to stop after completing the current
benchmarks. Continue only when assigned by the user. This is an investigation
of the initial [electron-like RFC](../../../docs/electron-like.md), not a final
implementation specification. Read [architecture and costs](costs.md),
[DOM and scheduling](dom-and-microtasks.md), and [bring-up](bringup.md) for the
evidence behind the current design. Older `docs/RFC` material is not authoritative.

## User constraints and coordination

- Optimize the whole architecture for performance, low overhead, clean code
  and maintainability. String allocation is only one part of that objective.
- Keep V8 and Chromium's normal Web platform. React is outside scope. A new
  product/build target is deferred until the integration is understood.
- Use `.ts` for owned Node tooling; Node 24 runs it directly. No owned `.mjs`
  or Python tooling. Upstream Chromium's own tooling remains upstream.
- Many independent compiler agents and a MainCodex session share this tree.
  Stay in `runtime/chromium`, `tooling/chromium`, `third_party/chromium`, and
  `docs/electron-like.md`; coordinate shared compiler/runtime fixes with their
  owners. Do not reset their work or assume a prebuilt compiler includes it.
- Eight build jobs are the current conservative limit after a real OOM.
  Report actions remaining and approximate build progress during long builds;
  keep the user informed of benchmark numbers without ending work to ask.
- All profiles share staged sources and one build writer guard. Finish a
  build or benchmark before changing that staging or its output binaries.

## Completed work and exact stopping point

The debug component engine is built (100%). Owned `nts_shell` and unmodified
`content_shell` are both available in `third_party/chromium/src/out/NtsBaseline`.
The selected native backend at handoff is **C**. Both C and LLVM archives exist.
The optimized component profile in `out/NtsPerf` is generated/header-checked,
but its engine has **not been built** and no optimized-engine timing exists.
Do not mistake generated Ninja files for a completed optimized build.

The final benchmark uses six launch pairs for **each** backend, with both
launch orders and all three payload-order rotations. Each pair contains an
independent native launch and an unmodified `content_shell` launch. The V8
application is loaded as an ordinary HTML script and triggered by real input;
measured application execution does not go through debugger evaluation.
The runner checks actual final Blink UTF-16 units, renderer PID/executable,
CPU affinity and sandbox, and native allocation/live-object invariants.

The earlier debugger-evaluated/three-pair timing artifacts are superseded by
these six-pair results. Raw data lives in ignored local `target/chromium`:

- `binding-benchmark-c-debug/result.json`
- `binding-benchmark-llvm-debug/result.json`
- `build-result.json` (latest baseline C build)
- `native-bootstrap/check-result.json` (compiler/archive identities and
  standalone witnesses)
- `native-dom-{c,llvm,oracle}-smoke/result.json`
- `native-microtasks-{c,llvm,oracle}-smoke/result.json`
- `comparison-result.json` and `contracts/`

Both semantic backends passed exact node identity/error/UTF-16 checks,
detached-node forced GC, ten input events, five attachments/four disposals,
reload/navigation and browser survival after killing the selected renderer.
Full custom-element/MutationObserver/mixed native–V8 job traces match the
independently executed V8 oracles. Standalone checks passed 20 environment
create/run/destroy cycles and independent managed counters without growth.
Owned GN header/layering checks and strict TypeScript checks passed.
Chromium's tracked source remains unmodified.

Both six-pair runs finished successfully: LLVM at `2026-10-05T14:13:27.458Z`,
C at `2026-10-05T14:22:41.494Z`. There is no active owned build or benchmark.
The current experiment is complete; the deliberately deferred optimized
build and unresolved design questions are the next assignment.

Prepared/scoped native medians are **4.249 / 4.456 µs** for C and
**4.146 / 4.425 µs** for LLVM at 16 / 4096 UTF-16 units. Fresh/scoped native
medians are 4.627 / 13.177 µs (C) and 4.585 / 16.237 µs (LLVM). Fresh conversion
allocates three NTS objects per mutation; prepared input allocates zero, with
one retain in both cases. The intrinsic prebuilt Blink control is about 2.0 µs.

Ordinary V8 medians are **3.237 / 6.277 µs** in the C cohort and
**2.673 / 2.665 µs** in the LLVM cohort. These cohorts use the same V8 executable.
At 4096 units, whole launches settle around either 2.6 µs or 6.1–6.7 µs;
the cause is unproven and no outliers were discarded. The comparison reverses
between cohorts, so it does not establish a reliable native speedup. Ordinary
V8 is faster in the short-string rows. The architecture record contains the
full table, quartile evidence, short-entry tradeoffs and measurement limits.

The latest baseline build passed with eight jobs and finished at
`2026-10-05T14:16:07.477Z`; executable SHA-256
`1bd9c16b1991e155caccc0706cd78ecd23225614e0d0c01e245be8dd497b219b`.
The common V8 control SHA-256 is
`842ee9342fd06a79e56322f449d0e21e74ce4c1aed4d44acbdc4b07d7d33ea44`.
Owned GN checks, strict TS checks, whitespace checks and the four semantic
oracle comparisons were checked again at handoff. Status reports no build
process, and an owned-benchmark process scan is empty. The optimized executable
does not exist. About 135.9 GiB disk space remains; no cleanup was performed.

## Source/toolchain identity

- Chromium `154.0.8037.97`, source pin
  `b510e9d7cd3a2fbd78d0ddc42234103206c5f78d`.
- depot_tools `af7727bdabd4850569574e27bc1855ec19ab2773`.
- Chromium Clang 24, LLVM
  `9fca3cf47d011a0af295d4252d70f16f8693d6a2`, Debian bullseye sysroot.
- The measured NTS compiler is `target/release/nts`, SHA-256
  `11ceacf8c8eeb73d38d31d5ae197b3fae0ece774dc6075a03a5c439b2940c816`,
  mtime `2026-10-03T15:45:26.494Z`. This is the available October 3 binary,
  **not** a fresh build of current compiler sources.
- Repository HEAD when the latest C archive check ran:
  `343e4971f27ecf4c8307b547a48fd71507ad211c`. Other sessions can advance it.
  This session has made no commit; some earlier work is already tracked in
  shared history. Inspect the current working tree rather than resetting it.
- Baseline engine: debug/component, symbols 1, Blink/V8 symbols 0, local build.
  Native generated code and private C runtime/shim use pinned Clang `-O2`.
  Debug Blink versus optimized native code cannot establish production speed.
- Host: Arch Linux x86-64, i9-14900K, 32 logical CPUs, about 31 GiB RAM and
  19 GiB swap. Both measured renderer main threads are pinned to CPU 4;
  competing sessions and P/E-core topology matter. Raw load/affinity is saved.

## Files to inspect and how they fit together

All native paths below are relative to
`runtime/chromium/program/`:

| File | Role |
| --- | --- |
| `native/dom_bridge.cc` | Main Blink adapter and current DOM optimizations: canonical traced node registry, exception/CE scopes, lexical `nts_blink_dom_native_scope`, direct UTF-16 allocation/copy, actual agent queue and disposal. |
| `native/dom_bridge.h`, `dom/abi/dom_testing.h`, `dom/abi/dom_testing.c` | Opaque C boundary, UTF-16 spans and authored native host functions; no managed NTS layouts in Blink C++. |
| `native/probe.c`, `native/probe.h` | Private C ownership/environment barrier, compiled callback entry, benchmark setup/teardown and allocation counters. |
| `src/dom.ts`, `src/main.ts` | Actual C/LLVM-compiled TS DOM program, counter, scalar awaits and benchmark loops; prepared state owns fresh arrays only. |
| `native/binding_benchmark.cc/.h` | Renderer-local timers, eight DOM paths, calibration, rotating samples and short-entry matrix. |
| `native/probe_observer.cc` | Document/input integration, lifecycle and benchmark trigger. |
| `native/probe_main.cc` | Owned shell delegate/browser/renderer factories and opt-in switch forwarding. |
| `native/BUILD.gn`, `native/blink.BUILD.gn`, `native/probe.gni` | Layer-preserving owned GN targets; `probe_abi` owns the shared C header to avoid a renderer/Blink dependency cycle. |
| `check.ts` | Real compiler output, pinned native archives and standalone checks for both backends. |

Other entry points:

- `tooling/chromium/probe.ts`: runs standalone checks, stages owned files and
  archives with a manifest, generates the selected GN profile. **Both profiles
  share this staging.** Never manually edit generated/staged copies.
- `tooling/chromium/chromium.ts`: setup/build/status/provenance; building
  `nts_shell` also builds its unmodified V8 `content_shell` control.
- `tooling/chromium/profiles.ts`: baseline/perf selection and active-build
  detection, including relative command-line invocations.
- `tooling/chromium/{args,perf-args}.gn`: separate debug and optimized component
  profiles with ordinary V8/platform features and pointer/GC checks retained.
- `tooling/chromium/benchmark.ts`: paired process launches, real input, renderer
  discovery/pinning, validation, raw samples, quartiles and hashes.
- `benchmarks/pages/binding/index.html`: script-free native fixture.
- `benchmarks/pages/binding-v8/index.html`: ordinary page-JS reference.
- `tooling/chromium/smoke.ts`, `compare.ts`: lifecycle/semantic acceptance and
  complete oracle comparison.
- `contracts/check.ts` and its README: compiler/runtime reductions
  kept separate from browser acceptance; no generated-code patching.

The benchmark driver/harness invokes the benchmark once in each fresh
document. Repeated benchmark clicks in the same document are not an accepted
interactive workflow; add explicit repeat/setup handling before using it that
way. Raw timing files are local ignored artifacts, so copy them separately if
the next agent works on a different machine.

## Architectural conclusions and open contracts

Renderer application code runs on Chromium's owner thread and uses Chromium's
host scheduling. Native jobs join the actual document agent's V8 microtask
queue. V8 is not the event-loop host replacing libuv; the renderer does not
need a second libuv loop. Browser services still cross Chromium's normal
process boundary. NTS RC/cycle collection, Blink Oilpan and V8 GC remain
distinct; inter-heap cycles need an explicit policy.

The lexical DOM scope preserves immediate operations and per-operation CE
reaction/exception/lifetime checks. It skips duplicate realm setup only while
the expected realm is actually current; foreign-realm reentry falls back to
ordinary setup. It must not be blindly added to computation-only callbacks.
General nested dispatch/navigation during reactions is still unproven.

Prepared input eliminates NTS conversion allocations, but Blink still copies
the UTF-16 span into owned storage. It is not zero-copy. A persistent root
registry currently keeps every bound node alive until document disposal;
per-wrapper root reclamation, typed lease representation and mixed cycles are
not solved. Context-wide scratch status is not a final reentrant error ABI.
Explicit state objects avoid mutable globals in these fixtures, but a fresh
NTS environment does not instantiate compiled module globals per document.

The **available compiler** still exhibits the reduced managed-argument
retention, null generated-resume-drop, lone-surrogate literal and managed/opaque
ABI-admission problems described in `contracts/README.md`. Benchmark source
strings are explicitly owned in C and borrowed by the compiled loop; no extra
retain compensates for incorrect generated storage. Browser async fixtures
suspend scalar state. Host-owned task cancellation is proven; generated-await
cancellation is not. Shared checkpoint-end rejection maintenance still needs
a public runtime contract. Do not guess what arbitrary null-drop state owns.

The handwritten bridge is a semantic/ownership experiment for future
IDL-derived generation. Conversions, overloads, nullability, `[CEReactions]`,
execution context and exceptions must follow pinned upstream binding facts.
No Web HIR or generalized JS object emulation is planned. Packaged origins,
full events/timers, V8 object interop, BFCache/freeze/restore, resource packaging
and final static/LTO distribution remain later gates. The shell's GPU/network
sandbox and debug crash-path limitations are recorded in bring-up; the
measured renderers keep seccomp, `NoNewPrivs` and nested PID namespaces.

## Recommended next work, after resuming

1. Inspect the final raw samples and resolve V8's between-launch timing
   variation without silently discarding slow launches. Warm-up/tiering and
   Blink/V8 string externalization are investigation leads, not proven causes.
   The pinned `platform/bindings/string_resource.h` is a useful source lead.
2. Build the optimized component engine with eight jobs, then run semantic
   acceptance before repeating the same balanced benchmarks. Measure native
   entry break-even and remaining boundary costs before further optimization.
3. Reduce nested dispatch, foreign realms and navigation during CE reactions;
   choose an explicit per-result exception representation and root-lease
   ownership. Prove module-instance and cancellation contracts with their
   owning compiler/runtime lanes before widening the facade.
4. Investigate a borrowed NTS string view ABI and generated typed bindings,
   guided by production-profile allocation/CPU evidence. Keep explicit V8
   interop separate and measured. Then add equivalent complete UI workloads
   for startup, event-to-paint, memory and packaging decisions.

Start the optimized build only after the user resumes this work:

```sh
node tooling/chromium/probe.ts c --profile perf
node tooling/chromium/chromium.ts build --profile perf --jobs 8 --background
node tooling/chromium/chromium.ts status --profile perf
```

After a successful build:

```sh
node tooling/chromium/smoke.ts third_party/chromium/src/out/NtsPerf/nts_shell target/chromium/perf/native-dom-c-smoke c dom
node tooling/chromium/smoke.ts third_party/chromium/src/out/NtsPerf/nts_shell target/chromium/perf/native-microtasks-c-smoke c microtasks
node tooling/chromium/benchmark.ts third_party/chromium/src/out/NtsPerf/nts_shell target/chromium/perf/binding-benchmark-c c --cpu 4 --runs 6
```

Then stage/build LLVM in the same profile and repeat its semantic/benchmark
checks sequentially. The architecture record also contains complete debug
reproduction commands. Retain the debug output; no disk reclamation or new
engine build was requested for this handoff.
