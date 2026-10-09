# Function values that carry `this`: the plan

**Status: A, refined (below). Steps 1 and 2 built 2026-10-09, `.bind`
2026-10-10; function declarations and method values reading `this` next.**

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
   - `this: C` for an object type with a layout (a class, an interface, an
     object literal's type): an `instanceof` test at entry, against its layout
     and the classes under it. React's `ReactFiberThrow.ts:127` is
     `this: ErrorBoundaryInstance`, which is the class `ClassComponentInstance`,
     and it passes `this` on at that type.
   - Any other annotation (a union, a primitive) has no test yet and is refused
     by name.
3. **`.bind(r, ...)`** makes a closure that holds `r` and the bound arguments and
   calls through the uniform entry with them. Built 2026-10-10: see below.

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

As built in step 1, `o.f?.(x)` and an ObjC field call passed `undefined`;
`o.f?.(x)` passes its object since (below). `call_directly`, the one
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

**Step 2, as built (2026-10-09).** A `function` expression whose body reads
`this` (`ClosureInfo::reads_this`) is a closure like an arrow. Its body is
`ClosureN#call_this(closure, this, params…)`. Its `#call` is a wrapper passing
`undefined` (`passing_undefined`), which the runtime, the bridges and Java call
unchanged; reachability removes it where nothing needs it. Its uniform entries
pass their `this` on (`erased_call(…, takes_this)`). A call where the closure is
known names the body with the `this` (`ClosureEntry::Receiving`).
`Program::receiving` maps a wrapper to its body, and both devirtualizers resolve
the entry from the closure class through it, not from the table slot the
wrapper's removal empties.

A failed `this` test **stops by name** (`nts_refused`), not with a `TypeError`.
TypeScript's object types are structural: `bump.call({ count: 0 }, 1)`
type-checks and runs in node, so a `TypeError` would be a JavaScript error
JavaScript does not raise. What the compiler cannot do is read an object at a
layout it is not.

Found and fixed on the way:
- `captures_of` would have recorded such a function's own `this` as a capture
  of the enclosing one. It was unreachable while the function was refused.
- `map.forEach(function () { this… })`, a `NodeList` `forEach` and an
  `Array.from` mapper inlined a `function` callback's body, so its `this` read
  the enclosing one where JavaScript passes `undefined`. That was wrong before
  this work, silently. `inlines_as_a_callback` keeps such a callback out of
  inlining.
- A named `function` expression could not call itself by its name
  (`bind_own_name` bound only declarations).

`o.f?.()` passes `o` too (2026-10-09): `member_of` records the object each
member read was made on (`read_from`), and the optional call reads it back for
the member it called. The object is lowered before the call branches, so it
dominates the call.

Not yet, and refused rather than wrong:
- an `o.f?.()` whose read of `o.f` recorded no object (a static, a namespace
  member), and an ObjC field call. In a program where some `function` reads its
  own `this`, they are refused (`check_this_is_passed`). Before step 2 such a
  program did not compile at all.
- A generator `function` that reads `this`: its body runs at the first
  `next()`, and a frame has no place for the `this` yet.
- `function` declarations and method values reading `this`:
  `blockers/a-call-with-a-receiver-that-is-read`.

`examples/a-function-that-reads-its-own-this` agrees with node on C, LLVM, the
JVM and C under reference counting, 290 cases. Each control fails:
- dropping every `this` stops at the test, by name;
- `call_directly` dropping the `this` is invalid HIR;
- on main the example compiles nothing.

Over all 471 examples, step 1 against step 2: 470 unchanged, 1 fixed.

**`.bind`, as built (2026-10-10).** Each `f.bind(r, ...bound)` on a function
value is a closure of its own (`ClosureSource::Bound`, collected beside the
reactions). It holds `f`, `r` and the bound arguments, at the types `f`
declares for them, and its `#call` takes what remains, from the signature the
checker gives the call. `bind`'s declaration types that as one rest parameter
of a tuple, which is expanded to one parameter per element. The body calls `f`
through `closure_callee`, the path every call of a function value takes, so `f`
may be a declared function, a closure or a `function` that reads `this`.
`bound_shape` derives the fields for both the site and the body. Refused for
now: a rest on either side, and a `bind` inside a generic.
`examples/a-bound-function` agrees on C, LLVM, the JVM and rc, 116 cases. The
control that drops the bound `this` stops at the `this` test by name.

Verified by:
- React's two sites, and its demos' `main`;
- the blocker turned into an example, on C, LLVM and JVM;
- test262's `this`-in-function cases;
- the benchmark rows before and after step 1.
