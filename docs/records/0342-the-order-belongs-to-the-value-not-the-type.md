# The order belongs to the value, not the type

`Object.keys` answers own string keys in **insertion** order. A compiled object
has no insertion order, so `own_names` read the layout's field list — and a
layout is one order per *type*, where insertion order is a fact about each
*object*.

Records 0258 and 0259 are the two attempts to close that gap by choosing a
better order for the layout. This one stops choosing.

## What the two previous attempts settled

**0258** laid inherited fields first, so `interface Extended extends Base` would
be a genuine prefix of `Base` and the structural cast between them free. Four
cast sites cleared and `examples/key-order-through-an-extended-interface` went
from 29 of 29 agreeing with node to 0 of 29. Reverted. Its conclusion: key order
has to be recorded **per allocation site**, which read as a representation
change.

**0259** found the order was already in the IR — `{ a: 7, b: 1, c: 2 }` emits
`field.set` at the layout's indices *in source order* — and took it before the
layout was decided rather than after. `Naming::written_order` maps a sorted
field-name set to the order the program's literals write it in, and
`as_the_program_writes_them` lays the type out that way.

That fixed every shape the program writes **consistently**, and 0259 wrote down
what it did not fix:

> A file writing one type `{ a, b, c }` in one function and `{ c, a, b }` in
> another has no single layout that satisfies both. Those shapes keep the
> checker's order and `agreements/key-order-of-an-extended-interface` runs and
> disagrees on purpose.

It disagrees on purpose because a layout was still being asked the question. It
is the same sentence as 0258's — one order cannot serve two objects — one level
further in.

## Ask the value

`Object.keys(e)` has the literal in hand at the use, and the literal is the
allocation site 0258 asked for:

```ts
const e: Extended = { a: n, b: 1, c: 2 };
Object.keys(e)            // a, b, c -- this literal's order
```

`FuncBuilder::as_that_literal_writes_them` orders the enumerable names by the
literal `written_as_a_literal` finds behind the argument — the expression itself
when it is one, or the initialiser of a `const` that binds it. Where there is no
literal to find, the layout's order stands, which is exactly what this did
before. **No layout changed and no backend needed a line**: the keys array is a
compile-time constant and it now holds a different constant.

`const` only, and that is the whole soundness argument: a `let` can be assigned
a second object of the same type written the other way round, and then there is
no single literal to answer for. One hop, not a chain, because nothing measured
wants one.

Applied **before** `property_order`, so an integer-like key is still hoisted and
sorted ascending. JavaScript's rule is that indices come first however they were
written; this is about the string keys after them.

## What it bought

    agreements                     5 disagreeing -> 4
    cases compared                 162, unchanged
    refused                        18, unchanged
    key-order-of-an-extended-interface    DISAGREES -> agrees

`examples/key-order-through-an-extended-interface` stays at 116 of 116 and
`agreements/integer-like-key-order` and `examples/object-key-order` are
untouched. The `runtime/node` corpus is unchanged — this decides what a constant
array holds, not what compiles.

Bracketed against the binary at `99beede0`, which disagrees on
`baseFieldsWrittenFirst` and compares the same three cases. A fixture that
passes on both binaries measures nothing; this one does not.

## What it does not buy, and this is the half worth writing down

**Not one structural-cast site.** 0259's header had to be corrected once for
claiming otherwise, and the temptation is identical here: this looks like it
decouples key order from layout order, and therefore like it frees the layout to
be inherited-first and clear 0258's four sites.

It does not, because the decoupling is partial by construction. Where no literal
is in hand the layout's order is still the answer, so flipping the layout would
move those cases from right to wrong — which is 0258's measurement again over a
smaller population. The four sites 0258 cleared are, in its own words, "types
the program builds through constructors and parameters rather than literals",
and those are exactly the cases with no literal for this to find.

Key order is what this buys. The census taken the same day says what the cast
sites are actually waiting on, and it is not an ordering rule: of 77 distinct
sites, 18 have a target declaring more fields than the source holds and 37 name
a field the source has no slot for at all. **55 of 77 are an absence**, which no
order reaches.
