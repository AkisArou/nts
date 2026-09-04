# A signature is the whole of an abstract method

`abstract area(): number;` was refused. The ledger's line was accurate and
slightly misleading: *"the class works, the declaration is refused"* — which
reads as a gap in the declaration and is really a gap in what the **caller**
could be emitted from.

68 sites in the profile. 40 ✗ rows left, down from 41.

## Why it could not be skipped

An abstract method has no body, so the first instinct is that there is nothing
to lower and the declaration can be dropped. Dropping it produces this, from the
C backend, on the function that *calls* it:

    NTS2006 no declaration for `Shape#area` to take a signature from

A call through `Shape#area` on a `Shape` receiver is an indirect call:

    v1 = ((double (*)(NtsObj_Shape *))v0->header.descriptor->methods[0])(v0);

and that cast is a function-pointer *type*. `virtual_signature` builds it by
looking the target up in `program.funcs` and reading its parameters and return
type. With the method refused there is no entry to read, and the caller is
declined for a reason that names the callee.

So the declaration is lowered: a function with the declared parameters and
return type, and no body. The block is left open, which `finish` terminates as
`Unreachable`:

    static double Shape__area(NtsObj_Shape * v0) { __builtin_unreachable(); }

That is the truth rather than a placeholder. An abstract class is never
instantiated, so its slot is never the one dispatch lands on — every reachable
receiver is a subclass whose override filled it. `finish`'s comment says an open
block "is only possible if a lowering forgot, and `Unreachable` states that";
here it is what the language means.

## The distinction that had to be kept

`a method without a body` was the refusal one line further down, and it still
is. An overload signature has no body either:

    pick(a: number): number;
    pick(a: number, b: number): number;
    pick(a: number, b?: number): number { return b === undefined ? a : a + b; }

The first two are declarations whose code the lowering cannot see, and the call
goes to the implementation. Emitting an unreachable function for one would be a
function that *can* be reached and does nothing. Only `abstract` means "there is
deliberately no body here", so the body is optional exactly when the modifier
says so, and `examples/unsupported` carries the overload case.

The mutation that removes that distinction — treating any bodyless method as
abstract — fails one test and only one, which is the check being narrow rather
than lucky.

## And writing the fixture for that found a refusal that leaked

The overload case went into `examples/unsupported` to give the test something to
check. It compiled. It should not have:

    Error: invalid HIR: [
      CallArgumentCount { func: "one", callee: "Overloaded#pick", expected: 3, found: 2 },
      CallArgumentType { func: "two", callee: "Overloaded#pick", at: 2,
                         expected: Erased, found: Float { bits: 64 } } ]

Refusing the signatures refused the *declarations*. The implementation has a
body, so it lowered — and the call sites resolve against whichever signature
TypeScript picked, whose parameter list is not the implementation's.
`pick(a: number)` and `pick(a: number, b?: number) { .. }` are two different
shapes, and the emitted function had the second while the caller was built for
the first.

**A refusal that leaves a broken artifact is worse than no refusal**, because
every diagnostic says the compiler noticed. This one reported three refusals and
produced invalid HIR anyway.

So the implementation is refused too, detected from its *siblings*: an overload
implementation looks exactly like an ordinary method, and what makes it one is
that another member of the same class shares its name and has no body. `abstract`
is excluded, which is why this is a separate question rather than the same one —
an abstract method and its implementation are never siblings.

It was worth checking that the cause was overloads at all. A probe with the same
implementation and *no* overload signatures — `pick(a: number, b?: number)`
called both ways — agrees with node on 58 cases. Optional parameters were never
the problem; the resolved signature was.

Three refusals now, one per declaration, and the caller is refused by
`drop_callers_of_refused` in the ordinary way. This is the second instance today
of the shape recorded in 0085: **a refusal that exists on one path and leaks on
another.** That one was `nts check` declining a program the specialized emission
compiled; this one is a declaration declined while its implementation went
through.

## No benchmark row, and the reason is a diff

The four deliverables want a benchmark row or a written reason there is none.
The reason here is measured rather than argued. Two programs, identical but for
the base class being `abstract area(): number` in one and `area(): number
{ return 0; }` in the other, emitted to C and diffed:

    41a42,44
    >     double v1;
    >     v1 = 0.0;
    >     return v1;

That is the whole difference. The vtables are identical, the descriptors are
identical, and the dispatch site is byte-identical in both. An abstract base
costs at the call site exactly what a concrete base costs, and
`benches/cases/dispatch` already measures that at 0.99x C++ and 0.67x node. A
new row would time the same instruction sequence under a different name.

## What it does not close

`const shape: Shape = n > 0 ? new Circle(n) : new Square(-n)` still refuses,
with "an erased value where a concrete representation is wanted" — and it
refuses with a *concrete* base too, so it is not this feature's. TypeScript types
the ternary as `Circle | Square` and the declaration says `Shape`; nts erases the
union rather than upcasting both arms to their common base. Base-first layout is
what would make that upcast free, and `Layout.base` now records the relation the
upcast would need, so this is reachable work rather than a representation
question. It is the next thing on this file.

The example works around it by calling through a function that takes the base,
one subclass at a time, which is also how most code is written.

## Ratchets

- `examples/abstract-methods` — 145 cases against node on C, LLVM and under
  counting: the template-method shape, a direct call on the concrete type, an
  abstract method with two parameters, a three-level hierarchy where the middle
  class implements one of two, and one returning a string so the signature has
  to be right about more than a count.
- `compiler/core/tests/abstract_methods.rs` — four tests, three mutations, each
  failing a different one: refusing abstract again, treating every bodyless
  method as abstract, and dropping the declaration's parameters.
- `tooling/memory/cases/abstract-dispatch` — 0 / 0, argued before measuring.
- No benchmark row, for the reason above.
