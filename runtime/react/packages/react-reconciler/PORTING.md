# Porting the reconciler

This package is a typed port of upstream's `packages/react-reconciler/src`
at the pinned commit (`runtime/react/upstream-compile/upstream.lock.json`,
checkout at `~/.cache/nts-react/upstream`). It is not a transliteration and
not a redesign: it has upstream's algorithms, names and file layout, in
typed TypeScript that NTS can compile. When React moves the pin, the upstream
diff maps file by file onto this port.

## Rules

1. **One file per upstream file, same name.** `ReactFiberHooks.js` becomes
   `src/ReactFiberHooks.ts`. The exported names and parameter order stay
   upstream's, because the files import each other by those names. A private
   helper may be renamed or restructured when that makes the code clearer.
2. **Imports.** Siblings are relative with the `.ts` extension
   (`./ReactFiberLane.ts`). Shared code comes from `shared/<File>.ts`
   (`shared/ReactSymbols.ts`, `shared/ReactTypes.ts`,
   `shared/ReactFeatureFlags.ts`, `shared/Build.ts`,
   `shared/getComponentNameFromType.ts`, `shared/reportGlobalError.ts`,
   `shared/noop.ts`, `shared/CheckStringCoercion.ts`, `shared/enqueueTask.ts`).
   React's internals come from `./ReactSharedInternals.ts`. The scheduler is
   imported by its package name, through `./Scheduler.ts`: Jest mocks the
   bare `scheduler` specifier, so a relative path would miss the mock. Host
   operations come from `react-reconciler/ReactFiberConfig.ts`; that module
   is only a contract, and each renderer's build replaces it.

   **A module that a build replaces (a fork point) is always imported by its
   package path, never relatively.** Examples are the host config, the
   scheduler's host (`scheduler/src/Host.ts`) and `shared/Build.ts`. The
   JavaScript build replaces them through the forks table in
   `tools/build-js.ts`. A native build replaces them through `paths` in its
   tsconfig, and `paths` only applies to package paths.
3. **Feature flags.** Import them from `shared/ReactFeatureFlags.ts` and keep
   upstream's `if (enableX)` branches, so the file stays diffable.
   `__DEV__` becomes `isDevelopment` from `shared/Build.ts`. `__PROFILE__`
   becomes `isProfiling`, and `__EXPERIMENTAL__` is `false`. Code behind a flag
   that is off in the stable channel can be reduced to the branch that runs,
   with a one-line comment naming the flag. Do this only where the dead branch
   would need types or modules that do not exist (gestures, transition
   tracing, the scope API, legacy mode, legacy context).
4. **Types.** Never `any`, `@ts-ignore` or `@ts-expect-error`. Where upstream
   stores a value whose type depends on the fiber's tag (`memoizedState`,
   `stateNode`, `updateQueue`, props, `type`), the field is `unknown` (see
   `ReactInternalTypes.ts`). The code for that tag projects it with `as`, as
   upstream's Flow `any` does implicitly. Keep those projections at the site
   that knows the tag, or in a small accessor. A value that really is
   heterogeneous (a thrown value, a child, an action) is `unknown`, and is
   narrowed with a check before it is used. Types defined upstream in a file
   (`Hook`, `Update`, `UpdateQueue`, `Effect`, `Cache`...) are defined in the
   same file here, and imported from there.
5. **Development behaviour is part of the contract.** The tests assert the
   exact text of `console.error`/`console.warn` calls and component stacks in
   development. Port `if (__DEV__)` blocks that produce observable output
   verbatim, including message text and argument order. Behaviour that only
   feeds DevTools, the performance timeline (`ReactFiberPerformanceTrack`,
   `console.timeStamp`) or the scheduling profiler may be a no-op with the same
   signature. Say so in a comment and in your report.
6. **Comments.** Keep upstream's comments that explain why. Drop Flow noise
   (`$FlowFixMe`, `// eslint-disable`). Match the style of this package:
   double quotes, `.ts` imports, two-space indent.
7. **Language subset.** Only what NTS will compile: classes, closures,
   discriminated unions and checked narrowing. Upstream's `FiberNode` is a
   constructor function; here it is a class. Do not add fields to objects
   after construction, and do not patch prototypes (the thenable `status`
   fields are declared on `Thenable`). Where upstream relies on the JavaScript
   object model and there is no typed equivalent, keep upstream's behaviour
   and mark the line `// JS object model:` with the reason.

## Checking your files

```sh
cd runtime/react
npx tsc -p packages/react-reconciler/tsconfig.json --noEmit
```

Until every file exists, errors about a sibling module that is missing are
expected. Every other error in a file you wrote is yours to fix. Do not run
the conformance harness, cargo or git: the integrating session does that.
