# Upstream React through NTS (retired route: stress corpus and oracle)

> **Status, 2026-09-24.** This is no longer how React reaches native code.
> Re-measured against HEAD on 2026-09-24, the strict linked reconciler still
> produced no usable runtime:
>
> - 1001 constructs refused in 483 functions (941 in 385 at the time of the
>   report);
> - the same nine FellThrough verifier failures;
> - 0 of 7 reconciler exports.
>
> Upstream's representation (Fiber fields shaped like `any`, extra fields added
> to thenables at runtime, prototype-based `Component`, `WeakMap`) conflicts
> with nts's static model. Even a successful compile would erase every hot
> field.
>
> The lane now builds its own React runtime, fully compatible with React's
> public behaviour; see `../README.md`. This directory is kept for two jobs:
>
> - **a compiler stress corpus.** `npm run runtime:native-probe` is a census of
>   refusals over 57k lines of real TypeScript, and `blockers/` holds the
>   reduced cases, for the language lanes;
> - **the upstream behaviour oracle.** `tools/upstream-oracle.mjs` runs the
>   exact pinned sources.
>
> It moved here from `runtime/react/` unchanged, apart from paths that point
> outside it. At the move, `runtime-typecheck --check` and
> `runtime-escape-audit --check` were already reporting stale before it and
> still do. The text below describes the experiment as it was designed.

## Original description

This directory asks one question with executable evidence: how much adaptation
is required to compile upstream React and React Compiler output with NTS while
keeping React semantics and native representations?

The current result and recommended implementation order are in
`reports/native-react-assessment.md`.

The upstream checkout is source-of-truth input. Its exact revision is recorded
in `upstream.lock.json`. Files under `generated/` are disposable and must never
be edited. Mechanical transforms, explicit semantic overrides, external
requirements and conformance evidence remain separate.

## Boundary

All writes made by this experiment stay below `runtime/react/upstream-compile`. The NTS compiler,
the C and JVM runtimes, and the React checkout may be read and executed. Missing
capabilities are reduced to cases under `blockers/` for their owning workstream.

## First profile

`client-mutation-production` selects the public React client, Scheduler, the
client reconciler, production constants and an NTS-owned mutation HostConfig.
It deliberately excludes DOM, server components, Flight and hydration from the
first dependency closure. Those are later profiles, not semantic substitutes.

The profile uses the upstream default React and Scheduler feature flags. The
HostConfig is virtual because its implementation belongs to the recording host
being built in this directory.

## Commands

Install the local toolchain and produce the dependency and syntax baseline:

```sh
npm install --prefix runtime/react/upstream-compile
npm run --prefix runtime/react/upstream-compile analyze
```

Verify that checked-in reports still match the pinned upstream commit:

```sh
npm run --prefix runtime/react/upstream-compile check
```

The analyzer verifies the checkout SHA before reading sources. Reports contain
the SHA-256 provenance of every source file in the resolved closure.

The strict runtime gate uses native TypeScript 7.0.2. The separate
`typescript` dependency aliases the final JavaScript TypeScript 6 API only for
tools that call `createProgram` and inspect checker/AST objects; TypeScript 7
does not yet expose a compatible in-process API.

Useful individual probes are:

```sh
npm run --prefix runtime/react/upstream-compile normalize:probe
npm run --prefix runtime/react/upstream-compile profile:specialize
npm run --prefix runtime/react/upstream-compile link:specialize
npm run --prefix runtime/react/upstream-compile runtime:typecheck
npm run --prefix runtime/react/upstream-compile runtime:escape-audit
npm run --prefix runtime/react/upstream-compile runtime:native-probe
npm run --prefix runtime/react/upstream-compile blockers:probe
npm run --prefix runtime/react/upstream-compile compiler:probe
npm run --prefix runtime/react/upstream-compile compiler:goldens
npm run --prefix runtime/react/upstream-compile compiler:nts
npm run --prefix runtime/react/upstream-compile conformance:upstream
npm run --prefix runtime/react/upstream-compile representation:probe
```

The exact-source upstream oracle executes eight scenarios, including keyed
reconciliation, hooks, effects, classes, Suspense and recovered React Compiler
output. The same recording host kernel executes through NTS C. All normalized,
specialized and linked runtime trees pass native TypeScript 7.0.2 with zero
diagnostics, and an AST audit finds no `any`, suppression directive or nested
assertion in 369 generated files.

The full reconciler is not yet a usable native runtime. The NTS probe reports
every refusal, HIR verifier failure and missing public reconciler export even
when the compiler command exits zero. Minimal strict fixtures under `blockers/`
separate compiler conformance defects, documented gaps, native host bindings
and explicit JavaScript object-model incompatibilities.

## Representation direction under test

Correctness starts with checked heterogeneous storage backed by NTS erased
values. Performance experiments then move erasure to genuine existential
boundaries: a Fiber points at an arbitrary component, while the invoked
component uses typed props, a component-specific hook frame, monomorphized
update queues and typed constant-index React Compiler cache slots.

No performance claim is accepted from source shape alone. The experiment must
inspect generated HIR and backend output and measure allocation, packing,
checks, indirect calls, hook access, reconciliation and code size.
