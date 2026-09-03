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

## What building it immediately found, and why that stops it

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
The next sitting starts there, not with `can_throw`.
