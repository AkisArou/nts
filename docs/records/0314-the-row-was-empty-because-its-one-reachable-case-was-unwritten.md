# The row was empty because its one reachable case was unwritten

`conversion side effects (valueOf, toString) in operand position` was a `✗` row
with **nothing in its explanation cell**. Every other row in that table carries
an argument; this one carried a title.

Probing it found a wrong answer that runs.

## Most of the family cannot be written

TypeScript rejects it before the compiler sees anything:

```text
o + 1        TS2365  Operator '+' cannot be applied to these types
"1" == 1     TS2367  This comparison appears to be unintentional
```

And the two shapes that *do* typecheck were already refused by name:

```text
`${o}`       a conversion to string from `Celsius`
Number(o)    a conversion to number from this type
```

So four of the five things anyone would try are unreachable or handled, which is
exactly why the cell stayed empty: **the family reads as unreachable until you
write the one member that is reachable.**

## The fifth

`a > b` between two class instances is not a type error. It is `ToPrimitive` on
each — `valueOf` first for a relational comparison, then `toString` — and this
compiler has neither. What it emitted:

```text
%1 = object.new frame : managed<obj#1>
%7 = object.new frame : managed<obj#1>
%10 = gt %1, %7 : bool
```

Two pointers. `class Celsius { valueOf() { return this.degrees } }` answered
`a > b` **true for every input**, against node answering from the degrees: 29 of
29 cases disagreed, in all four relational operators at once.

Refused by name now, with three controls beside it — numbers, strings, and the
same comparison written through the member it would have called — because the
refusal has to be narrow enough not to take the comparisons that were always
right.

## The shape

A row with an empty cell is not a row nobody has thought about; it is a row
whose *argument* nobody could write. And the reason an argument could not be
written here is that the four obvious instances all fail early — three in the
checker, one in the lowering — so anyone reasoning about the family from its
name concludes there is nothing to reach.

That is a different failure from the ones this session has been collecting. Not
a count measuring the wrong thing, not a message asserting an untested cause:
**a row that looked closed from every direction except the one nobody looked
from.**

The tell, in hindsight, is available without any of the probing: the row says
*in operand position*, and nobody had listed the operand positions. Four of them
are arithmetic and string contexts that TypeScript types away. The fifth is
relational comparison, where TypeScript is content because both sides are
objects and the *result* is a boolean regardless.

**The check that would have found it: enumerate the positions, not the
feature.** "Where can a conversion happen" has a finite answer, and every entry
in it is either refused, type-errored, or a defect — and the third case is only
visible once the list exists.

## What closing it needs

`OrdinaryToPrimitive` with hint `number`: call `valueOf`, take the result if it
is a primitive, otherwise call `toString`, and throw `TypeError` if neither is.
Those are members this compiler already puts on the descriptor, so this is
reachable machinery wanting an *ordering* and a fallback rather than missing
machinery.

Zero corpus demand — `runtime/node` writes no relational comparison between
objects — which is why this is filed rather than built, and why the filing now
carries a program instead of a blank.
