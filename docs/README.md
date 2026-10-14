# Documentation

What each document is for. If a document is not listed here, it is either a
lane's own (under `runtime/<lane>/docs/`) or it should be added.

## How we work

- [`../AGENTS.md`](../AGENTS.md): the rules every contributor follows: landing, the gate, fixtures, the shared tree.
- [`agents/lessons/`](agents/lessons): what working on nts has taught, one rule and its reason per line, by topic.
- [`records/`](records): one file per decision, with the evidence. Claim a number with `tooling/gate/claim-record.sh`.
- [`workflow.md`](workflow.md): how lanes work side by side, landing with `land`, and `lane status`.

## Where things are

- [`../tests/`](../tests): what nts must pass, one kind per directory: programs compared with node, refusals, outcomes, memory cases, interop projects, GJS ports, the workspace. Its README says which gate steps run each kind and how to add one.
- [`../benchmarks/`](../benchmarks): what is measured: the cases nts-bench times against C++, Java and node, and the Wasm and GTK benchmarks.
- Before 2026-10-14 these were `examples` and `benches` at the root and four directories under `tooling`; [`../tooling/migrate/table.ts`](../tooling/migrate/table.ts) maps each old place to its new one. Records keep the paths they were written with.

## Status ledgers (where the numbers are)

- [`conformance/typescript.md`](conformance/typescript.md): the TypeScript language status. Its §13 is the authority for the census's non-goals.
- [`conformance/test262.md`](conformance/test262.md): how test262 is run and counted.
- [`census/test262.md`](census/test262.md): the earlier per-slice test262 census.
- [`conformance/nodejs.md`](conformance/nodejs.md) and [`conformance/nodejs-plan.md`](conformance/nodejs-plan.md): Node.js API status, and the plan for the rest.
- [`primitives.md`](primitives.md): each primitive and what it costs. Read by the `primitives` gate step.

## Current designs

- [`compiler-delivery-plan.md`](compiler-delivery-plan.md): the compiler's current plan and what is landed.
- [`any-unknown.md`](any-unknown.md): `any` and `unknown`, erased values and how they are recovered.
- [`async.md`](async.md): promises, async functions and the host seam.
- [`interfaces-by-shape.md`](interfaces-by-shape.md): interfaces satisfied by shape, and field families.
- [`function-receivers.md`](function-receivers.md): function values that carry `this`.
- [`scalar-numbers.md`](scalar-numbers.md): `Int32`, `c_int` and the other scalar types (`@nts/scalars`).
- [`native-operations.md`](native-operations.md) and [`native-interop.md`](native-interop.md): calling C, and C calling TypeScript.
- [`jvm-interop.md`](jvm-interop.md) and [`jvm-android-provider.md`](jvm-android-provider.md): the JVM and Android lane.
- [`wasm.md`](wasm.md): the WebAssembly backend.
- [`nts-config.md`](nts-config.md): products, targets and `nts.config.ts`.
- [`web-platform-integration-plan.md`](web-platform-integration-plan.md): the contract `runtime/web-platform` implements.
- [`temporal.md`](temporal.md): Date, Temporal and Intl.
- [`eval.md`](eval.md): a possible engine-free `eval`. Not built; test262 cites it for why eval tests stay in scope.
- [`npm-deps.md`](npm-deps.md) and [`npm-deps-plan.md`](npm-deps-plan.md): what npm dependencies need from the compiler.

## Lane notebooks

Living status, written by each lane as it goes:

- [`apple-lane-goal.md`](apple-lane-goal.md): macOS and iOS.
- [`gtk-lane-goal.md`](gtk-lane-goal.md): GTK.
- [`windows-lane-goal.md`](windows-lane-goal.md): Win32, WinRT and WinUI 3.
- [`electron-like.md`](electron-like.md): native code calling Blink in Chromium. The lane's own docs are in `runtime/chromium/docs/`.

## Guides

- [`macos.md`](macos.md): writing a Mac app in TypeScript.

## Ideas

- [`ideas/`](ideas): directions worth keeping that nobody has committed to.
