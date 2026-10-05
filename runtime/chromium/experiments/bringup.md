# Initial source bring-up

This records the first Chromium lane on 2026-10-05. It is experiment evidence,
not an implementation specification or a performance result.

The subsequent [direct DOM/shared microtask experiment](dom-and-microtasks.md)
now passes its supported subset through C and LLVM. This page retains the
first bring-up observations; broader E3 contracts remain open. React is
outside the current experiment scope.

| Input | Revision/profile |
| --- | --- |
| Chromium stable Linux | `154.0.8037.97`, `b510e9d7cd3a2fbd78d0ddc42234103206c5f78d` |
| depot_tools | `af7727bdabd4850569574e27bc1855ec19ab2773` |
| Clang | 24.0.0git, LLVM `9fca3cf47d011a0af295d4252d70f16f8693d6a2` |
| Target sysroot | Chromium's pinned Debian bullseye x86-64 sysroot |
| Host | Arch Linux x86-64, 32 GiB RAM; Xvfb for rendering |
| GN | Debug component build, symbols level 1, Blink/V8 symbols level 0, local execution |
| NTS compiler used | Available October 3 binary, SHA-256 `11ceacf8c8eeb73d38d31d5ae197b3fae0ece774dc6075a03a5c439b2940c816` |

The compiler binary was not freshly rebuilt from the October 5 working tree.
The generated runtime source hash and repository HEAD at each native check
are recorded in `target/chromium/native-bootstrap/check-result.json`.

Completed observations:

- Source checkout, `gclient sync`, and upstream hooks succeeded. The resolved
  manifest is `target/chromium/sync.json`.
- GN generated and built unmodified `content_shell` successfully. The final
  resumed run completed 14,310 steps in 50m08s. `target/chromium/build-result.json`
  records the latest build; `build.log` retains all attempts.
  The first run used eight jobs; following the user's resource request it
  resumed at 24 jobs, reusing completed objects. The interrupted eight-job run
  reported 13,413 completed steps and zero failed steps. A subsequent host OOM
  interrupted the 24-job run after 6,345 completed steps; the build resumed
  at 16 jobs. These are per-run counts, not total build completion percentages.
- The C and LLVM native fixtures both execute with pinned Clang/LLD and the
  Chromium sysroot: scalar `50`, managed string `native:probe`, and twenty
  environment create/run/destroy cycles without live-object growth. The
  expanded fixture also creates independent managed counters, increments each
  from 1 through 10 while retaining exactly one state object, and releases
  that state before environment destruction.
- The renderer observer and owned shell main compile and link with both
  native backends. The owned targets pass GN's header dependency check.
- The native shell uses existing `ShellMainDelegate` client factories and GN's
  `root_extra_deps`, replacing the initially prepared content-shell patch.
  Chromium's tracked source remains unmodified. Each native build reused the
  engine objects and completed three incremental steps in under nine seconds.
- All browser runs observe separate browser/renderer processes. Renderers
  have `Seccomp: 2`, `NoNewPrivs: 1`, and nested `NSpid` values. No
  `--no-sandbox` or renderer sandbox-disable flag was used.

E0 and E1 passed. The script-free input-counter witness also passed through
both backends. Each native browser check observes five attachments, four
disposals, three reloads, navigation away/back, and browser survival after
abruptly terminating the verified native-document renderer with `SIGKILL`.
The native counter receives ten real input events, retains exactly one managed
state object, and resets to zero after reload/navigation. Its HTML contains
zero application scripts; CDP evaluates inspection expressions only.

| Browser check | Launch to inspected ready (ms) | Summed process VmRSS (MiB) | Evidence under `target/chromium/` |
| --- | ---: | ---: | --- |
| Unmodified baseline | 4,239 | 3,038 | `baseline-smoke/result.json` |
| Native C bootstrap | 3,853 | 3,104 | `native-c-smoke/result.json` |
| Native C input counter | 3,872 | 3,103 | `native-counter-c-smoke/result.json` |
| Native LLVM bootstrap | 3,872 | 3,035 | `native-llvm-smoke/result.json` |
| Native LLVM input counter | 3,770 | 3,050 | `native-counter-llvm-smoke/result.json` |

Each directory also contains a screenshot, launch log, and the GN-declared
runtime dependency list. Results record executable/fixture/source/staging
hashes, GN arguments, process status, and the exact termination method.
These single debug-component observations include Xvfb and CDP readiness
overhead. VmRSS sums double-count shared pages and include inspection processes;
GN runtime dependencies include test fixtures. They establish no speedup,
optimized distribution size, or production memory budget. Sandbox acceptance
here covers renderers: the observed GPU process had `Seccomp: 0`, and the
network service ran with `--service-sandbox-type=none` in this shell profile.

The separate CDP `Page.crash` diagnostic did not exit its renderer within
twelve seconds. The same behavior reproduced on the unmodified baseline
executable, without NTS linked: the renderer reported `CoreDumping: 1`, and
the log contained a fatal assertion and a seccomp signal-handling failure.
The browser continued serving its version endpoint. Evidence is in
`target/chromium/baseline-crash-witness/diagnostic-result.json` and `launch.log`.
This leaves the debug crash/core-dump path unresolved; the passing containment
checks above use verified renderer `SIGKILL` termination instead.

Bring-up exposed one tooling issue: freezing `depot_tools` source updates lets
`gclient` operate through vpython without initializing GN's Python launcher.
The wrapper now invokes upstream `ensure_bootstrap` explicitly when required,
preserving the tool source pin. Chromium compilation uses its own Clang/LLD
and sysroot; host GNU ld was unsuitable for the standalone sysroot link.

The first native GN build exposed another boundary issue: compiling the C
shim directly in a Chromium target applied its unsafe-buffer/raw-pointer
checks to generated C runtime structs. Generated C, runtime C, and the C shim
now compile into one pinned-toolchain archive, tested by the standalone
consumer and imported with an explicit GN file dependency. C++ consumes only
the small opaque probe header and retains Chromium's normal checks. No shared
runtime layout or global Chromium warning policy was changed.

The scalar fixture is stateless and main-frame-only, selected by an exact file
URL. An optional script-free input-counter fixture adds an explicit
document-owned managed record and a small public Blink API witness. Both
backend variants execute in the renderer. These first-stage fixtures supply
no general DOM bridge, asynchronous host, privileged desktop service, or React
integration. The subsequent DOM/scheduling experiment expands that subset.
File documents are
ineligible for the back/forward cache at this pin, so the first navigation
check covers disposal rather than frozen-document restoration.

Inspection at the source pin found a public native listener entry point,
`WebNode::AddEventListener`, with RAII removal and an Oilpan-traced listener.
Its event enum covers input/keyboard events but not `click`; its public event
wrapper also does not expose the usual DOM event properties. `WebElement`
offers attribute mutation but no general text-node creation/insertion API.
These are useful bounded seams, not a complete DOM binding surface. E2/E3
should compare their supported semantics with a small Blink-owned bridge
before choosing an application-facing API. The prepared input witness uses
only fixed IDs, a checkbox's `input` event, and attribute mutation; it does not
establish the broader E2/E3 gates.

Scheduling inspection at the same pin found that both `LocalWindowProxy`'s
normal context creation and `V8ContextSnapshotImpl`'s snapshot path pass the
document execution context's microtask queue. `ExecutionContext` resolves that
queue through its agent's `EventLoop`. Follow these call sites rather than an
older comment in the event-loop header about V8's default isolate queue.
The loop can be shared by scriptable documents, so closing one native document
must revoke/drop its queued state explicitly rather than assuming the loop
dies with it. `NtsTask.run` and `drop` each consume the owned state reference;
the host must choose exactly one, in the owning environment. Collector and
rejection maintenance at checkpoint end remain an integration question because
the NTS checkpoint functions opt out when the host supplies `enqueue_microtask`.
No scheduling adapter or ordering result was claimed by this first bring-up.
The subsequent experiment records an adapter and comparison for the bounded
fulfilled-promise profile, including checkpoint collection and explicit
document-owned host task drops; rejection maintenance remains open.
