# One order cannot serve two questions

`interface Extended extends Base` is laid out **derived-first**: `{ c, a, b }`
where `class Derived extends Base` gives `{ a, b, c }`. That asymmetry is why a
structural cast from an extended interface to its base is unsound, and the
obvious fix is to make interfaces agree with classes.

It was implemented, measured, and **reverted**.

## What it bought

    structural-cast refusals    458 -> 410
    distinct sites               75 -> 71

Four sites. The rest are a class reaching an unrelated interface, where no
ordering helps: `Readable`'s layout begins with `EventEmitter`'s fields —
`_events`, `_eventsCount`, `_maxListeners` — because it extends one, correctly,
base-first. `ErrorOrDestroyStream { destroyed, … }` cannot be a prefix of that
whatever order interfaces use.

    746  disagreements by field name       different fields at that position
     54  disagreements by representation   Stats vs BigIntStats, StatFs<number>
                                           vs StatFs<bigint>
      0  the artifact that was worried about

So the structural-cast problem is two problems, and only the smaller one has a
cheap answer.

## What it cost

`Object.keys` walks the layout's field order, because a compiled object has no
insertion order. JavaScript orders own string keys **by insertion**.

    { c: n, a: 1, b: 2 } as Extended    node: c, a, b

With the layout derived-first, that agrees. With inherited fields first, it
answers `a, b, c`: **29 of 29 cases in the fixture written for it went from
agreeing with node to disagreeing.**

Four refusals for a wrong answer in every object of an extended interface type.
Reverted.

## Which is not the same as key order being right

It is not. One layout is one order and a literal can be written in any of them:
with the layout as it stands, `{ c, a, b }` agrees and `{ a, b, c }` of the same
type does not. Both orders are wrong for some literal, and the reordering would
have moved which ones — trading a correct 29 for an incorrect 29 while looking
like progress on the refusal count.

`agreements/key-order-of-an-extended-interface` is the case that runs and
disagrees, with the two that agree beside it so the divergence reads as an
ordering rather than an absence.
`examples/key-order-through-an-extended-interface` is the half that passes, and
its header says plainly what it is: not a claim that the order is right, a claim
that **moving it moves these too**.

The answer is to stop the two questions sharing one order — key order recorded
per allocation site rather than read off the layout. That is a representation
change and it is what both fixtures are waiting for.

## Nothing in the gate saw it

With the reordering in: all 150 examples agreed with node on all three backends,
`example-refusals` was clean, clippy was silent and the whole test suite passed.
The corpus survey said 75 sites had become 71, which is the number a person
looking for progress would have quoted.

It was found by asking what else field order decides. That is not a check and
cannot be made into one; what can be, and now is, is a fixture that fails when
the order moves. The gate could not see this because **no example asked
`Object.keys` of an object whose type extends another** — an absence that looks
identical to coverage until someone writes the case.

Fourth negative result of the night that a green gate would have shipped: after
a fixture indexed by a number the differential's pool never generates, an
expectation that ran the wrong subcommand, a fixture whose types were never
candidates, and a predicate that changed the program it was checking.
