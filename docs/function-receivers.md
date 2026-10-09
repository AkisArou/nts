# Function values that carry `this`: the plan

**Status: proposed (2026-10-09); parked by the user until scalar step 2 is finished. A is recommended.**

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

## Plan, if A

1. **The calling convention.** Every closure entry takes a receiver, and every
   call passes `undefined`. No behaviour changes: the gate and the benchmark table
   must be unchanged.
2. **Receivers at call sites.** `obj.f()` for function-valued properties,
   `.call`, `.apply` and `.bind`. `function` expressions and declarations that read
   `this` compile. The blocker above becomes an example, since its three refusals
   stop being load-bearing.
3. **Later:** methods as values.

Verified by:
- React's two sites, and its demos' `main`;
- the blocker turned into an example, on C, LLVM and JVM;
- test262's `this`-in-function cases;
- the benchmark rows before and after step 1.
