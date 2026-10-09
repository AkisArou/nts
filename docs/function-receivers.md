# Function values that carry `this`: the plan

**Status: A, refined (below). Step 1 built 2026-10-09; step 2 next.**

## The problem

In JavaScript, every call has a receiver, `this`. `obj.f()` passes `obj`,
`f.call(r)` passes `r`, and a plain `f()` passes `undefined`. A `function`
(not an arrow) can read it.

nts compiles a function value (a closure) with no receiver at all. That has
been sound only because three things are refused:
- a `function` expression or declaration whose body reads `this`;
- `this` outside a method;
- a method taken as a value.

`f.call(r, ...)` simply drops `r`, and `blockers/a-call-with-a-receiver-that-is-read`
pins why that is safe.

React needs the first of those, at two sites, and they are now the only thing
refusing its demos' `main`:
1. `ReactFiberThrow.ts:127`. The callback is written
   `update.callback = function callback(this: ErrorBoundaryInstance) {...}` and
   stored as `(() => unknown) | null`. React then calls it as
   `(callback as (this: unknown) => unknown).call(context)`. It reads members of
   `this`.
2. `ReactChildren.ts:254`. `Children.forEach` passes
   `function (this: unknown, child, index) { forEachFunc.call(this, child, index); }`
   to `mapChildren`, which calls it as `func.call(context, child, count++)`. Here
   `this` is only forwarded, never read.

Across the runtime corpora: 23 function expressions declare `this:` (in 19
files), with 83 `.call(`, 22 `.bind(` and 5 `.apply(this` uses.

The receiver has to travel with the function value itself: a callback stored
in a field typed `() => unknown` is later called with a receiver nobody can
see at the store.

## Option A: every function value takes a receiver (recommended)

The closure calling convention gains one hidden argument, the receiver, an
erased value. Every call through a function value passes one:
- `f()` passes `undefined`;
- `obj.f()` passes `obj`;
- `f.call(r, ...)` and `f.apply(r, args)` pass `r`;
- `f.bind(r, ...)` makes a function value that passes `r`.

Arrows and functions that never read `this` ignore it.

- **For:** it is JavaScript's own model, and engines work this way. One rule for
  every call, with no second dispatch path, and the dropped-receiver special case
  disappears. It also opens the way to methods taken as values
  (`const m = obj.m`), which are refused today.
- **Cost at run time:** one more argument per call through a function value, which
  is a register. To be confirmed on the benchmark table, not assumed.
- **Cost to build:** one large change in one place, the closure calling convention.
  It touches all three backends, the C callback bridges, the runtime's own
  closures, and the raising slot.

## Option B: a second entry, only where a receiver is read

Closures that read `this` get an extra entry that takes a receiver, as the
raising slot was added for exceptions. Call sites that have a receiver
(`.call`, `obj.f()` through a function-valued field) dispatch there. Every other
closure fills that entry with a small shim that drops the receiver.

- **For:** a smaller first change.
- **Against:**
  - Every `obj.f()` through a field, the common case, gains an extra hop through
    the shim.
  - "Does this call site have a receiver?" becomes a second rule, beside the one
    for ordinary calls, which this codebase has learned to distrust.
  - Method values stay out of reach.

## Plan, if A (refined 2026-10-09, after mapping the calling convention)

**Where a closure is called from.** A closure has two kinds of entry:
- its written `#call(env, params...)`, which is called directly once the closure
  is known, and called by the C runtime (timers, promise reactions, 33 sites in
  `runtime/node`), by the native callback bridges, and through the JVM's callback
  interfaces (`NtsCallback.call()` and friends);
- its uniform `#erased_call(env, erased...)` and raising entries, which are called
  only from HIR, through a dispatch slot, when a call goes through a function
  value whose closure is not known.

So the receiver can live where only HIR reaches, and every outside ABI stays as
it is:
1. **The uniform entries take a receiver.** `#erased_call(env, receiver,
   erased...)`, and its raising twin. Every call through a function value passes
   one: `undefined` for `f()`, `o` for `o.f()` through a field, `r` for
   `f.call(r, ...)` and `f.apply(r, args)`. A closure that does not read `this`
   ignores it. Devirtualization, which turns a uniform call into a direct
   `#call`, drops it for those. No behaviour changes in this step: the gate and
   the benchmark table must be unchanged.
2. **A closure that reads `this` gets the receiver.** Its body is lowered as
   `#call_this(env, receiver, params...)`. Its `#call` is a thin wrapper
   passing `undefined`, so the runtime, the bridges and Java call it unchanged,
   and receive JavaScript's strict-mode `this` for a plain call. Its uniform
   entries forward the receiver. Devirtualizing a call to it names
   `#call_this` with the receiver. The refusals go:
   - "a `function` expression that uses its own `this`";
   - "`this` outside a method", for a `function` declaration used as a value;
   - `RECEIVER_IS_NOT_BOUND`.

   `blockers/a-call-with-a-receiver-that-is-read` becomes an example.

   **What `this` is inside the body.** It arrives erased. An `Unerase` is
   unchecked: it trusts that the lowering typed the value. For a written
   parameter the checker typed the call, but a `this:` annotation is not checked
   at a call through a cast: React's site is
   `(callback as (this: unknown) => unknown).call(context)`. So the annotation
   is proven like any narrowing, never trusted:
   - `this: unknown`, `this: any`, or no annotation: `this` stays erased. React's
     `ReactChildren.ts:254` only passes it on.
   - `this: C` for a class `C`: an `instanceof C` test at entry, and a
     `TypeError` where it fails. React's `ReactFiberThrow.ts:127` is
     `this: ErrorBoundaryInstance`, which is the class `ClassComponentInstance`,
     and it passes `this` on at that type.
   - Any other annotation (an interface, a union) has no test yet and is refused
     by name.
3. **`.bind(r, ...)`** makes a closure that holds `r` and the bound arguments and
   calls through the uniform entry with them. It is unsupported today.

**What it touches.** About 14 HIR call sites, all funnelled into
`call_a_closure_entry`, plus `erased_call`, `uniform_params` and the
`declare_*_entries` functions. Then about 13 passes that assume argument 0 is
the environment and the parameters follow it (`fields::devirtualize`,
`monomorphize`, `call_directly`, flow, escape, ownership...). No runtime, bridge
or Java-interface change.

**Methods as values already work**, bound to their receiver (`bound_method`). So
the blocker's third load-bearing refusal is gone already, and its comment says
otherwise; it is corrected in step 2.

**Step 1, as built (2026-10-09).** `hir::UNIFORM_THIS` and
`hir::UNIFORM_ARGUMENTS` say where an entry takes its `this` and its arguments.
`uniform_params` builds every uniform entry from them, and
`call_a_closure_entry` is the one place a call fills them:
- `f(x)`, `f?.(x)`, a sort comparator and a promise reaction pass `undefined`;
- `o.f(x)` through a field or a getter passes `o`;
- `f.call(r, ...)` and `f.apply(r, list)` pass `r`. `r` used to be lowered for
  its effects and dropped; it is now lowered expecting an erased value, as an
  argument to an `unknown` parameter is.

`o.f?.(x)` and an ObjC field call do not hold `o` at the call yet; they pass
`undefined` until step 2 gives them the object. `call_directly`, the one
place a uniform call becomes a direct one, drops the `this` with the padding.
On the JVM, the typed face passes `undefined` and the lambda adapter skips it.
`core/tests/function_value_this.rs` asserts what each kind of call passes,
with a control that drops every receiver.

Measured on eight rows that call through function values (`closures`,
`closure-merge`, `module-closures`, `optional-chain`, `event-state`,
`pipeline`, `array-methods`, `dispatch`), baseline, step 1, baseline again:
every nts column (C, LLVM, JVM, f64) is within the two baselines' own spread.
`optional-chain` on C is 33.42 us in all three, and `closures` 1.12, 1.12 and
1.13 us.

Verified by:
- React's two sites, and its demos' `main`;
- the blocker turned into an example, on C, LLVM and JVM;
- test262's `this`-in-function cases;
- the benchmark rows before and after step 1.
