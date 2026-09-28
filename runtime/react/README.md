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

**Speed (JavaScript build).** Against upstream React built from the same
source without Closure (upstream's rollup build, Closure off), measured by
running the two alternately in each round on one core: mount 1.04×,
updateEvery10th 1.00×, reverse 1.01×, swap 1.06×, removeOne 0.99×, clear
1.01×, stateUpdates 1.03×. Upstream's published build, with Closure, is
1–14% faster than ours. Most of the remaining gap is `swap`: our child
reconciler is a class where upstream's is a closure per mode, so V8 shares
one compiled `reconcileChildrenArray` between mounting and updating and
deoptimises it every render. Upstream's shape waits on nts compiling a
nested function that calls a sibling with a capture.

**Native build.** The runtime compiles whole with nts. The GTK counter (a
`main` that renders a Box holding a Label and a Button, with no hooks) runs
natively on C under reference counting. It mounts, updates its label, and
a click reaches the app's handler, as the JavaScript scenario does. It needs
scratch stand-ins for the compiler items still open, so it is not yet a
checked-in program. What stands between a native program and running is
read from its build log with `node tools/census.ts <log>`: the entry's chain
of refused calls, the construct that ends it, and every root refusal by
kind. Walking that chain and then running the program, with each blocker
neutralised in a scratch copy to reach the next, found about 30. The lane's
own were fixed, and so was one compiler item (`Array.isArray` after a
`typeof` narrowing). The rest were reported with reductions, and these
stand:
- raising: a `try` whose callee throws through a function value, a method,
  or a callee that cannot carry the throw itself;
- a value read through a view of another layout: a props record read
  through an interface, an element read through `{ $$typeof }`, a typed
  array read as `unknown[]`, and a function called through another
  signature, whose result is misread (every function component);
- generics: a union type argument built from a type parameter, and a
  generic function passed as a value (`useState`'s chain, which stops the
  `useState` counter);
- arrays of references written at their length;
- the LLVM backend's call to a `never`-returning function;
- smaller ones: spread in call arguments, closures returning `null`,
  `String(unknown)`, a field named `__…`, an interface method no class
  implements, a literal written in another order than its interface, and
  `Object.keys` over `object`.

**react-gtk** (packages/react-gtk, DESIGN.md) generates 72 GTK and 54
libadwaita widgets from GIR, with typed props, signals, slots, child and
object elements, and controlled inputs. Its host config is driven on real
widgets under reference counting with GTK warnings fatal, through the C and
the LLVM backends (native/gtk, native/adw).

Class components are designed for the native build and verified through
the JavaScript run (CLASS-COMPONENTS.md). Contexts are classes held by a
non-generic base.

The rules nts imposes on this code are the ones ported code must follow;
they are listed in packages/react-reconciler/PORTING.md and in the native
config's comments.

## Layout

| Path | What it is |
| --- | --- |
| `packages/` | the runtime: `react`, `react-reconciler`, `scheduler`, `react-noop-renderer` and `shared`, plus `react-gtk`, GTK 4's host (its widgets, props and signals generated from GIR). Native twins sit beside the files they replace (`*.native.ts`) |
| `tsconfig.native.json` | the base of every native program: binds the twins, and maps packages to their sources |
| `native/probe/` | a native program: the runtime, a typed test host and a deterministic scheduler host |
| `native/compiled/` | the probe's scenarios in TSX, which `tools/probe-agree.ts` runs plain, as written, and as the React stage rewrote them |
| `native/gtk/` | react-gtk's host config and GLib scheduler host driven on real GTK widgets, as the reconciler will drive them (`build.sh`) |
| `native/adw/` | the same for react-gtk/adw, libadwaita's widgets (`build.sh`) |
| `native/journal/` | DESIGN.md's Journal app and its libadwaita twin, with the React stage: the programs the native render must run (it builds today with `main` refused) |
| `conformance/` | the harness that runs upstream's tests, and the per-test ledgers |
| `compiler/` | the upstream Rust React Compiler as our memoizer: the audit (`AUDIT.md`), and how its output stays typed TypeScript (`TYPED-OUTPUT.md`, with its fixtures and study) |
| `spikes/` | representation experiments the design rests on |
| `upstream-compile/` | the retired route: the Flow→TS conversion of upstream React compiled through NTS. It is kept as a compiler stress corpus (a census of refusals over 57k lines) and as the exact-source JS behaviour oracle |

## Rules for the runtime source

- NTS must compile it with zero refusals:
  - no `any`, prototype manipulation, extra fields added at runtime, or weak collections;
  - classes, closures, discriminated unions, and `unknown` only behind a checked narrowing.
- A missing NTS feature becomes a reduced fixture handed to the lane that owns
  it. This lane does not edit `compiler/` or `runtime/c`.
