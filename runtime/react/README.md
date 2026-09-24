# React for NTS

This lane has one goal. An application written against React's public API
should compile to native code with NTS. The same hooks and components should
also run unchanged on the web against real React.

## Route

**We are writing our own React runtime. It must be 100% compatible with
React's observable behaviour.**

**Same public API and behaviour as React:**
- elements and keys;
- every hook;
- class components, `memo`, `forwardRef`, context, `lazy`, `Suspense`,
  transitions and `startTransition`;
- error boundaries and `StrictMode`.

It must also match the order of render, commit and effects, bailouts, batching,
priorities, Suspense retry, and error recovery.

**Different internals.** A Fiber is a typed record. Hook state lives in typed
storage. React Compiler's memo cache becomes a typed class per component. Props
of known host elements are fixed records. NTS lowers all of these to fixed
native layouts; none of them passes through a 16-byte erased value on the hot
path.

**Upstream React is the reference, never shipped code.** Compatibility is
measured with upstream's own reconciler tests: about 1000 tests over
`react-noop-renderer` and `scheduler/unstable_mock`, pinned at the commit in
`upstream-compile/upstream.lock.json`. They run against this runtime, and a
ledger records pass or fail for each test. When React releases a new version,
we move the pin and review which tests changed.

**Application code** goes through three steps:
1. **tsgo** checks the original TS/TSX. Types come from this checked program.
2. **React Compiler** runs, using upstream's Rust port.
3. **Typed JSX lowering** runs, as the lane's own pass.

Then NTS compiles the result. A component whose output cannot be fully typed
stays uncompiled by React Compiler. It is still correct, only not memoised.

**Hosts are per platform.** The first real host is GTK. A GTK app imports
`{ Button } from "react-gtk"`, and props and signals are typed from the bind-gir
bindings. There is no cross-platform `<View>` layer. Hooks and logic are what
is shared with the web.

## Status

**Compatibility (JavaScript build).** Upstream React's own tests, run
unmodified against this runtime, count only in-scope tests
(conformance/upstream-tests/README.md). Every result equals upstream's own
build:

| Suite | Production | Development |
| --- | --- | --- |
| reconciler | 557 / 557 | 580 / 580 |
| scheduler | 63 / 63 | 63 / 63 |
| react | 51 / 53 | 51 / 53 |

In the `react` suite, upstream's own build fails the same 2 tests.

**Native build.** native/probe compiles the runtime whole with nts. The
census went from 1286 to 643 refusal lines. Creating a root compiles, and
the render path runs from `updateContainer` to the commit, where it stops at
exceptions thrown across calls. The remaining work on our side is in the census. The compiler
capabilities React needs have been reported to the language lane:
- exceptions across closures and methods, which Suspense and error
  boundaries rely on;
- a base-class `instanceof` downcast;
- weak collections.

The rules nts imposes on this code are the ones ported code must follow;
they are listed in PORTING.md and in the native config's comments.

## Layout

| Path | What it is |
| --- | --- |
| `packages/` | the runtime: `react`, `react-reconciler`, `scheduler`, `react-noop-renderer` and `shared`, plus `react-gtk` (a design draft so far). Native twins sit beside the files they replace (`*.native.ts`) |
| `tsconfig.native.json` | the base of every native program: binds the twins, and maps packages to their sources |
| `native/probe/` | a native program: the runtime, a typed test host and a deterministic scheduler host |
| `conformance/` | the harness that runs upstream's tests, and the per-test ledgers |
| `compiler/AUDIT.md` | the upstream Rust React Compiler, audited as our memoizer |
| `spikes/` | representation experiments the design rests on |
| `upstream-compile/` | the retired route: the Flow→TS conversion of upstream React compiled through NTS. It is kept as a compiler stress corpus (a census of refusals over 57k lines) and as the exact-source JS behaviour oracle |

## Rules for the runtime source

- NTS must compile it with zero refusals:
  - no `any`, prototype manipulation, extra fields added at runtime, or weak collections;
  - classes, closures, discriminated unions, and `unknown` only behind a checked narrowing.
- A missing NTS feature becomes a reduced fixture handed to the lane that owns
  it. This lane does not edit `compiler/` or `runtime/c`.
