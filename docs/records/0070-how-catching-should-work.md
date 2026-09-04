# 0070 — How catching should work

`try`/`catch` is the largest language gap. `throw` already lowers —
`nts_thrown` then `unreachable` — so what is missing is catching, and the goal
names the decision that comes before the code: **DWARF unwinding or explicit
cleanup**. This is that decision, argued from what this compiler already is
rather than from what compilers usually do.

The answer is **explicit cleanup**, and three things decide it.

## One: ownership is already local and precise

`rc.rs` opens with the convention: "Every managed value is owned by the function
that names it, and every consumption takes its own reference." That is the whole
difficulty of unwinding, already solved — at any point in any function, the pass
knows exactly which references that frame holds.

A handler needs precisely that set. DWARF exists to *recover* it from tables
because C++ cannot compute it; we do not need recovering, we need emitting, and
the pass that would emit it already runs.

## Two: DWARF would make the two backends different

The LLVM backend could use `invoke` and `landingpad`. The C backend cannot: C
has no unwinding, and the nearest thing —`-fexceptions` with
`__attribute__((cleanup))` — is a second mechanism, in a second language, doing
the same job a different way.

That is a dual path for one feature, which the standing rules forbid, and it
would put the C backend's correctness on a GNU extension. The C backend is the
oracle; it does not get to be the one with the exotic mechanism.

## Three: the throwing set is small and statically known

Only an explicit `throw` need be catchable. Runtime faults abort today —
`nts_bounds` calls `abort`, not `nts_thrown` — and keeping them that way means
"can this call throw" is a call-graph property, computed once.

Measured: **2 of 160** files across `examples` and `benches` contain a `throw`.
The motivation is not there, it is in `runtime/node` — `assert`, `http`,
`querystring` — which is exactly the code the profile exists to compile. So the
feature matters and the cost does not: a call that cannot throw pays nothing,
and the analysis says which those are.

## The shape

    - `can_throw`, a call-graph fixpoint: a function can throw if it contains a
      `throw` or calls something that can. Nothing else.
    - A `throw` sets the pending exception and returns, after releasing what the
      frame owns -- which `rc` already knows.
    - A call to something that can throw is followed by a test. In a function
      with no `try`, the test releases and returns; the caller sees the same
      pending exception.
    - A `try` makes its body's tests jump to the handler instead, with the
      catch parameter read from the pending slot.

Every one of those is an ordinary basic block. Both backends emit it identically
because it is not a mechanism, it is control flow.

## What this costs, and what it refuses

A test after each call that can throw, and nothing anywhere else. No unwind
tables, no `setjmp`, no `-fexceptions`, and no divergence between the backends.

**`finally` is not in this.** It needs the handler to run on the normal path too
and then resume, which is a second question, and the honest thing is to refuse
it until this half is measured rather than to design both at once.

## The premise below is false, and a stale comment is how it got here

What follows says `Error` is a prerequisite because the compiler cannot
construct one. It can. `hir::builtin` provides `Error`, `TypeError`,
`RangeError` and `URIError` as real classes with `message` and `name`, exactly
because `lib.d.ts`'s `stack?`/`cause?` are optional properties this compiler
refuses — and `class MyError extends Error {}` works through
`PropertyRecord::own`. `new Error("boom")` emits:

```c
struct NtsObj_Error { NtsHeader header; NtsString *message; NtsString *name; };
_Static_assert(sizeof(NtsObj_Error) == 40u, ...);
```

The comment in `lower_throw` that says otherwise — "the class is not one this
compiler can construct, it is `lib.d.ts`'s" — predates `builtin.rs` and was
never updated. It is the reason the section below reordered the whole feature
around a representation that already exists. *The record matches the code: a
stale comment is how a false premise reaches a goal*, and this is that, in a
record about the goal.

## What a thrown value should be

Not a message, and not an `Error *` either. `catch (e)` is `unknown` in
TypeScript, so the pending slot holds an **erased `NtsValue`**: `throw` erases
whatever it is given, `catch` binds `unknown`, and the erasure machinery that
already exists carries it. That admits `throw "text"` and `throw new Error(m)`
and anything else, at one representation, which is what the language actually
says.

What it costs is that a `catch` block wanting to discriminate needs
`instanceof`, which is its own gap. That is a real dependency and not a blocker:
`catch (e) { return String(e) }` and a typed rethrow both work without it.

## What building it found, kept because the reasoning below is still right



`throw` does not throw a value today. It throws a *message*:

```rust
// `new Error(m)` is the shape every one of these has. The class is not
// one this compiler can construct -- it is `lib.d.ts`'s -- so what is
// taken from it is the argument.
```

`throw new Error("x")` lowers to `nts_thrown("x")`. That is invisible while
throwing aborts, because nothing observes the value — the program is over. It
stops being invisible the moment `catch (e)` binds it: node binds an `Error`
whose `.message` is `"x"`, and we would bind the bare string. `String(e)` is
`"Error: x"` there and `"x"` here, and the differential fails on the first
example anyone writes.

So catching is not four pieces of control flow after all. It is those, **plus a
decision about what a thrown value is**, and there are only two honest answers:

- **Represent `Error`.** A class the compiler constructs, with `message` and the
  `toString` node agrees with. Then `catch (e)` binds an object and the control
  flow above is the whole of the rest.
- **Refuse `throw new Error(...)` where it can be caught**, and support
  `throw <string>` only. Smaller, and it makes the common shape — which is the
  one `runtime/node`'s `assert` and `http` use — the one that does not work.

The second is not worth building. The first is the real prerequisite, and it is
a *representation* question, which is the axis this goal declared closed.

Not built here, and now for a better reason than "it is large": the control flow
was the easy half, and the half nobody had looked at is what a thrown value is.

## Two more things building it found

**The lowering is single-pass, so the tests cannot go in it.** At the point it
lowers a call it does not know whether the callee throws — `can_throw` is a
call-graph property and the callee may not be lowered yet. So the checks have to
be a later HIR pass, which means the IR has to carry *which `try` region a call
is inside*. That is a new thing in the IR, not a new arrangement of what is
there.

**The handler needs N-edge merging.** `lower_if` snapshots the bindings, lowers
both arms, and builds block parameters for the names that differ. A handler is
entered from every throwing call in the body, each with different bindings —

```ts
let x = 1;
try { x = 2; f(); } catch { return x }   // 2, not 1
```

— so it needs that same algorithm over N edges rather than two, with every
edge's terminator patched after the body is lowered, the way `lower_if`
remembers `branch_block`.

## So the order is

1. `Error` as a representation, because `catch (e)` binds a value and today
   there is no value to bind.
2. A `try` region in the IR, because the single-pass lowering cannot decide the
   tests and something has to carry the question to a pass that can.
3. `can_throw`, the fixpoint, which is the easy part and was the part this
   record originally started with.
4. The handler merge, N edges, patched late.

The runtime slot for all this was written and then reverted: a pending-exception
slot nothing sets is scaffolding, and the rule against shipping it is the reason
this record is longer than the diff.
