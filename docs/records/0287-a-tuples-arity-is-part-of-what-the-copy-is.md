# A tuple's arity is part of what the copy is

`(...args: [number]) => number` is the same TypeScript type as
`(a: number) => number`. TypeScript will assign either to the other, and a
fixed-length tuple rest is not variadic at all: the arity is written down.

This compiler had **three** places that decided a signature's arity, and they
did not agree.

    the call site           expanded the tuple  (effective_parameters)
    a closure's `call`      expanded the tuple  (since it was written)
    the declaration         built one array     (lower_param)

A parameter-list mismatch is not a diagnostic. It is invalid HIR, reported
against the *callee*, which is why this read for a long time as a defect in
closures:

    CallArgumentType { callee: "Closure0#call", at: 1,
                       expected: Float { bits: 64 },
                       found: Managed(Array(Int { bits: 32, signed: true })) }

## The A/B that chose the direction

Two of three agreeing is not an argument; either side could have been made to
match the other, and one of them costs an allocation per call. What settled it
was disabling the call-side expansion and rebuilding. In **both** arms of that
A/B the surviving error was `Closure#call` wanting a scalar and being handed an
array — so the closure half had never been in dispute, and the declaration was
the one site out of step. Positional is also the representation worth having: a
fixed-arity rest should cost what the same parameters written out would, which
is nothing.

## What the change cannot do without

**A copy is named after the representation of what its type parameter bound
to**, and `[number]` and `[number, number]` both represent as an array of `f64`.
Both spelled `[f64]`. One copy served every arity:

    func pack<[f64]>(args: managed<[f64]>) -> i32     <- three call sites, arities 1, 2, 3

That was **harmless** while the parameter was an array, because the array
carried its own length, and it becomes a miscompile the instant the declaration
is positional. So the copy's identity had to gain the arity before the
declaration could lose the array:

    func pack<[f64]x1>(args_0: f64) -> i32
    func pack<[f64]x2>(args_0: f64, args_1: f64) -> i32
    func pack<[f64]x3>(args_0: f64, args_1: f64, args_2: f64) -> i32

The arity is not in the representation and cannot be recovered from it, so
`Sources` — the source `TypeId` behind each substitution — is kept *beside*
`Substitution` rather than replacing it. Representation still decides sharing
for every type that has no arity; only a type parameter bound to a tuple reads
the new map, and nothing that was sharing before stopped.

This is the third time this month that the answer was to keep the shared thing
and add the distinguishing one beside it. See `0286`, where a layout is a shape
and a class is an identity.

## Two mistakes worth keeping

**A second derivation of a fact that already had one.** `lower_positional_rest`
builds the array the binder is bound to, and I gave it a rule for the element
type: take the positions' common type, erase where they disagree. Reasonable,
and wrong at the first shape with no positions to read — `A = []` inferred
`Erased` while every other site, the closure capture field among them, had the
declared `Array(f64)`. The verifier caught it as a `StoreType`. The fix was to
delete the rule and read the declared representation, which is what everything
else already did.

**A green that was over the survivors.** Expanding the declaration turned the
old invalid HIR into a *named refusal* at `cb(...args)` — a spread into a call
whose callee is positional. `nts check` then printed `agreed on every case`,
because it compares the functions that survived and two had not. The count that
caught it is the refusal count, not the agreement:

    agreed on every case            <- over 2 of 4 functions
    2 construct(s) refused          <- the one that mattered

The rule from the goal text is that both forms of regression are reachable for
one rule and both have to be covered. Here the same *change* produced both, five
minutes apart.

## What it closed

`blockers/a-fixed-arity-rest-is-not-positional` is deleted and
`examples/a-fixed-arity-rest-is-positional` replaces it — six functions under
test and two controls, because a change that made *every* rest positional would
answer wrong for a genuinely variadic one rather than merely being slower.
`countsByArity` answers 123 and a copy collision makes it answer 111, 222 or
333.

`blockers/a-spread-into-a-call` is narrowed rather than deleted: a spread of
known arity is expanded, a spread of a `number[]` still refuses, and the
condition was never the argument position.

`blockers/a-generic-rest-forwarded-to-its-callback` moved one link. The
forwarding works; what stops it now is capturing the binder in a closure, whose
type is the type parameter.
