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

Not built here. This is the decision the goal asks for before the code, and the
next sitting starts with `can_throw` and a `throws` example the differential can
check against node.
