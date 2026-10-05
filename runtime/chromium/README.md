# Chromium experiments

This lane investigates native NTS application code in a Chromium content
renderer. It is an implementation experiment for the initial
[RFC](../../docs/electron-like.md), with no stable application ABI yet.

The pinned full source build and directly executable TypeScript tools live in
[`third_party/chromium`](../../third_party/chromium/README.md) and
[`tooling/chromium`](../../tooling/chromium). They are opt-in and independent
of the ordinary compiler build. The platform is initially Linux x86-64.
Chromium is the embedding host; a dedicated app/product configuration is
deferred until that integration executes.

The baseline fixture uses ordinary V8 JavaScript. Its smoke check verifies
HTML/CSS layout, input dispatch, rendering, separate browser/renderer
processes, renderer seccomp filtering, and a nested PID namespace. It runs
with Xvfb because the initial build host has no desktop display. Evidence
goes under `target/chromium/baseline-smoke`.

The native bootstrap fixture exports arithmetic, a managed string result,
an explicitly created counter record, direct DOM operations, and scalar async
code used by the scheduling experiment.
Its C shim keeps generated/runtime headers out of C++, enters an explicitly
owned NTS environment, and releases its managed values before disposal.
The fixture avoids mutable application module globals. Its standalone C
consumer checks twenty create/run/destroy cycles and independent
counters incrementing from 1 through 10 with each
backend; that is an embedding check, not evidence of renderer execution.

```sh
node runtime/chromium/experiments/native-bootstrap/check.ts
```

This builds with the available `target/release/nts` (override `NTS_BIN` to
select another binary), recompiles the generated C/runtime and LLVM artifact
with pinned Clang and LLD against Chromium's sysroot, and runs both consumers.
`target/chromium/native-bootstrap/check-result.json` records the binary hash,
its date, source/runtime hashes, toolchain, and actual observations. A repository
HEAD recorded alongside a prebuilt compiler does not imply that compiler was
built from that HEAD.

The generated artifacts are `probe/linux-gnu-x86_64` and
`probe-llvm/linux-gnu-x86_64`, with corresponding C headers and libraries.
The renderer integration compiles generated C, the runtime, and the C shim
into one archive with Chromium's pinned toolchain; LLVM output uses that
compatible toolchain too. The standalone consumer checks the same archive
linked by the renderer. Generated/runtime headers remain private to C, so
Chromium's C++ pointer checks do not become requirements on the C ABI layout.
The synchronous fixtures need no Chromium `NtsHost`. The mixed scheduling
fixture installs a bounded microtask host using the document's agent loop.
General task/timer posting, ordinary DOM source syntax and pending-await
cancellation remain later gates. React is outside the current scope.
The exact local file URL is an experiment opt-in, with attachment limited to
the main frame. It establishes no packaged-origin service authorization. At
this Chromium pin, file documents are ineligible for the back/forward cache;
reload/navigation checks do not establish freeze/restore behavior for a future
HTTP(S) application origin.

The optional `native-counter` fixture contains no application scripts. A public
Blink `input` listener invokes the compiled counter export; the observer writes
its result to a real DOM attribute, displayed by CSS. Listener removal and
Blink-root release precede native environment disposal. The smoke checks ten
actual input events, stable native live-object counts, and fresh state after
reload/navigation:

```sh
node tooling/chromium/smoke.ts \
  third_party/chromium/src/out/NtsBaseline/nts_shell \
  target/chromium/native-counter-c-smoke c counter
```

Run the same witness with `llvm` after staging/building that backend. This
bounded precursor uses `GetElementById`, `AddEventListener(kInput)`, and
`SetAttribute`. E0, C/LLVM renderer execution, and both native counter variants
passed; see the first [validation record](experiments/bringup.md).

The next `native-dom` and `native-microtasks` fixtures also pass through both
backends. A small target within Blink creates/queries/inserts/removes real
nodes, preserves their identities and UTF-16 strings, and reports real
tree/query errors across the C boundary. Oilpan traces its document-owned
roots. The microtask adapter shares the actual document-agent queue with V8
and drops owned host tasks on disposal. The native application never evaluates
JS strings to perform DOM operations. Comparison instrumentation uses V8 to
observe custom-element reactions, MutationObservers and mixed promise jobs.

```sh
node tooling/chromium/smoke.ts \
  third_party/chromium/src/out/NtsBaseline/nts_shell \
  target/chromium/native-dom-llvm-smoke llvm dom
node tooling/chromium/smoke.ts \
  third_party/chromium/src/out/NtsBaseline/nts_shell \
  target/chromium/native-microtasks-llvm-smoke llvm microtasks
node tooling/chromium/compare.ts
```

Use the backend currently staged/built. The [DOM/scheduling record](experiments/dom-and-microtasks.md)
has the full native/V8 reproduction commands, actual results, architecture,
limits and next experiments. The [contract reductions](experiments/contracts/README.md)
record available-compiler ownership/string/admission failures and the missing
host checkpoint-end maintenance contract. Those issues remain explicit rather
than being patched into compiler output. The supported E2 subset passes;
broader E3 acceptance remains open.

The owned shell uses `ShellMainDelegate` client factories and GN's
`root_extra_deps`; no tracked Chromium source changes are needed for this
experiment. Keep integration sources here and carry upstream patches only
where a later experiment demonstrates a need. Compiler, common runtime,
React, Node, and JVM changes remain with their
owning lanes; reduce any blocker to a fixture before requesting a change.
