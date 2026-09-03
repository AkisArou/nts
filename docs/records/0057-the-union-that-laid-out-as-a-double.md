# 0057 — The union that laid out as a double

`absences` was the last primitive row losing to node: 4.45x C++ and 1.06x node.
0053 measured the cause, named the fix, and did not build it. This builds it.

## What the row was paying

The shape is one line:

```ts
const held: number | undefined = i % 5 === 0 ? undefined : i;
total = (total + (held ?? -1)) | 0;
```

The raw lowering makes this look like an arithmetic problem — twelve `toint32`
against three erasures, which is what `| 0` costs. It is not. In the
*specialized* function, where `i` is already an `i32`, the prepared HIR says:

    %131 = convert %11 : f64        cvtsi2sd  -- only because an erased
    %45  = erase %131 : erased                --  value's payload *is* a double
    %54  = unerase %44 : f64
    %121 = convert %36 : f64        cvtsi2sd
    %56  = add %121, %55 : f64
    %58  = toint32 %56 : i32        cvttsd2si

Four conversions and a floating-point add per iteration. An erased value is a
tag and a payload, and the payload is a `double`, so an integer that goes into
one comes back out through two conversions — every iteration, for a value that
was an `i32` on both sides.

## The measurement that came before the pass

The fix is a *split*: one parameter carrying a union becomes two, a tag and a
payload at its own representation. Rather than build that and find out, the
split was written by hand in TypeScript first — the same arithmetic with the
union spelled as a presence test and a value — and measured:

    union   188.3 ns C++   793.4 ns nts C   837.8 ns LLVM   793.0 ns node
    split   187.2 ns C++   188.5 ns nts C   399.8 ns LLVM   760.1 ns node

The C backend at parity with C++ said the entire 4.45x was the round trip, and
that a pass producing this shape was worth writing. It cost one file and ten
minutes, and it is the difference between building a pass and betting on one.

## The pass

`hir::split` takes a block parameter of erased type where every argument carries
a statically known tag and every use asks only for the tag or the payload, and
makes it two parameters. The erasures before the jumps go, tag reads become the
tag parameter, unerasures become the payload parameter.

**It runs before specialization**, and that is the whole of why it is its own
step. It narrows nothing itself — it leaves ordinary dataflow where a tagged
value was, and the specializer then narrows the payload exactly as it narrows
everything else. Run afterwards it would find every payload already committed to
a double, which is the conversion it exists to remove.

**The unit is a web, not a parameter.** `T | null | undefined` lowers to two
parameters chained: one merges `undefined` with the value, the next merges
`null` with that. Neither can be judged alone — the first's only use is the
second, and the second's only source is the first — so the conditions are asked
of the group's outside edges. Two of this benchmark's three absences are that
shape, and a version handling single parameters would have measured almost
nothing.

**What it refuses.** A payload that is not a scalar, because an erased reference
already carries its payload as the pointer and splitting one would put a
reference into a block parameter, which is the reference counter's question. Any
use that is not a tag read or an unerase. And an unerase at a type the payload
does not have, where the pass could insert a conversion and stay correct — and a
conversion is what it exists to remove.

## The result

    before   188.3 ns C++   837.8 ns   4.45x C++   1.06x node   1.28x bun
    after    187.0 ns C++   399.7 ns   2.14x C++   0.50x node   0.61x bun

The C backend lands at 188.7ns against C++'s 187.0, which is parity, and matches
the hand-written diagnostic to within noise — the pass produces the shape the
experiment promised. **No primitive row loses to node now.**

## The hole a test found

The first version asked its conditions of every *operation* that reads a member
and never of the terminators. A parameter that is `return`ed is handed to a
caller expecting the general representation, and the pass split it anyway —
because `operands_of` covers operations and a terminator is not one.

`a_member_that_is_returned_is_left_alone` caught it before the gate did. It is
worth naming because the hole is exactly the shape of the mistake: a condition
written against one way of reading the IR, and a second way that did not exist
in the author's head at the time.

## What this leaves open

**LLVM is 399.7ns where the C backend is 188.7, on the same HIR.** Both are fed
identical operations by the same fifteen passes, and one of them is twice as
slow. That is not this record's question and it is now the sharpest one on the
board: a backend gap with the frontend held fixed, which is the easiest kind to
chase.
