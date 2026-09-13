# The guard was below the path that needed it

```ts
const C = (n & 1) === 0 ? TypeError : RangeError;
new C("x").name.length          // node 9 for a TypeError. This answered 10.
```

A `RangeError` built where the program chose `TypeError`, on C **and** LLVM, 13
of 87 cases. The class comes from `type_of(id)` — the type of the `new`
*expression* — which the checker gives as a union and `widened` collapses to one
arm.

`constructed_from_a_value` has guarded exactly this since
`a-new-through-a-class-value` landed a day earlier. It sat **below**
`lower_new_provided`. A class this compiler provides has no constructor to call
and is built inline, so it took a different route to the same gap and arrived
under the guard.

The fix is moving one line up. It costs one refusal site per module.

## The row said the opposite, and was right about what it measured

> Comparison **agrees on C and LLVM** — 116 cases across four exports, bound,
> returned and tested against both arms — so checking those two reads as the
> feature working. The JVM declines it.

Every word true. `examples/a-class-stored-and-compared` binds a class value,
returns one, and compares one against both arms — and **now agrees on all three
backends**, so the JVM half of the row is closed too.

What it never does is call `new` on one.

**One row, two features, one of them measured.** The row's title is "a union of
two class values", and a union of two class values can be compared or it can be
constructed. The example covers the first exhaustively — four exports, 116 cases
— and its thoroughness about comparison is exactly what made the row read as
settled.

That is [[0323]]'s "a ✗ is not proof of absence" from the other end: a ✅-shaped
argument inside a ✗ row, correct about its own half, and load-bearing for a
conclusion about the whole.

## How it was found

Not by reading the row. By probing it — the goal's standing instruction is to
confirm each row against the live corpus before building it, and the row said
the JVM declined, so the probe was written to check whether *that* was still
true.

It was not: all three backends agree on the example. The probe then asked the
row's own title — a union of two class values — in a shape the example does not
contain, because writing `new C(...)` is the obvious thing to do with two class
values and the example never does it.

**A stale claim and a live defect in one row, and the same probe found both.**

## The shape, which is the third of its kind this session

- `arguments.len() > 1` encoded "the message is the only argument before
  options" as a number, and a second signature arrived ([[0322]]).
- A floor encoded "this equals the corpus" as a constant, and the corpus grew.
- A guard was placed in a dispatch chain above one path and below another, and
  the second path reached the same gap.

Each is a rule that was complete over the cases in front of it. None of them is
findable by reading the rule, because the rule is correct — what is missing is a
case that did not exist when it was written. The only instrument that finds them
is a program that exercises the new case, and the only reason to write one is
suspecting the row.
