# The ledger dropped its own notes, and nothing could report it

Two findings, the second one found while checking the first.

## One: dispatch is a property of the layout, not of the value

Row 333 — methods and getters on object literals — has been the blocker behind
the idiomatic iterator, `return { next() { … } }`, and behind `for await` over a
hand-written `AsyncIterable`. Its stated obstacle is a **name**: an anonymous
object type has no canonical one, so two `TypeId`s of one shape emit two method
names and the call site misses the definition.

Yesterday I added a second derivation to that row: `layout_of` merges shapes as
it builds, so the naming authority the row asks for already exists in embryo,
and an **unannotated** literal has one `TypeId` and cannot collide at all — so a
narrower version looked reachable without any program-wide work.

That note was wrong, and the way it was wrong is the point. `Layout::methods` is
a `Vec<Option<String>>` — one *named implementation per dispatch slot* — and
`Layout::types` is a `Vec<TypeId>` precisely because every structurally-equal
type shares that one layout. Dispatch therefore belongs to the **layout**. Two
literals at one interface type are two values of one layout, so

```ts
const a: Stepper = { step() { return 1 } };
const b: Stepper = { step() { return 2 } };
```

have one table with one entry for `step`. A class escapes this because each
class *is* its own layout; an object literal is many values of one.

So the narrower version is not incomplete, it is **silently wrong at the second
literal** — sound only while exactly one literal in the program has the shape,
which nothing checks and no diagnostic would report. My earlier note would have
shipped a rule complete over the case in front of it with the exception arriving
later, which is this session's recurring shape ([[0315]], [[0329]]) — except
here the later case answers wrongly instead of refusing.

The candidate that survives is a different representation: lower the method to a
**field holding a closure**, per value, guarded on the body not mentioning
`this`. It costs a pointer per method per object and changes how every class
implementing the interface is laid out. Priced, not built. Note the guard is
what makes it *sound*, not merely what makes it narrow.

Three derivations of one fact now, and the third outranks the two above it. The
ledger holds all three, because the losing two are what a reader will otherwise
re-derive.

## Two: the ledger was dropping 56 rows' notes, and said nothing

While escaping a cell I counted `|` per line and found rows at widths the table
did not declare. Per table — declared columns against the rows beneath — thirteen
tables disagreed with their own headers.

Ten of them declare two columns (`|---|---|`) while carrying rows shaped
`| status | feature | notes |`. GitHub-flavored markdown specifies that a row
with more cells than the header has **the excess ignored**. So the notes column
of 56 rows — the entire argument of each row, including six coercion rows
written this week — was not rendered at all. Nothing errors. The file is valid
markdown; it is just quietly narrower than it reads in a text editor.

Two further rows had unescaped pipes inside prose that split them again: a
`string | undefined` written without `\|`, and a literal `||` operator in a
`SameValue` definition.

The fix is the document's own precedent: tables 52, 2366 and 2459 already
declare three columns and carry two-cell rows happily, so an empty notes cell is
the correct rendering of "no notes". Ten headers widened, two rows escaped, and
the check that found it now reads zero:

```
rows still wider than their header: 0
```

with the status counts unmoved at 33 ✗ / 20 ◐ / 160 ✅, which is the control
that says row structure was not disturbed.

## Why this one is worth a record

The disciplines say every instrument must be able to fail. The ledger is the
instrument this whole effort reports through, and its failure mode was to render
*less* than it contained, with no error, in the direction that makes the work
look thinner rather than the direction that would have been noticed. A count of
✗ rows was never affected, which is exactly why it survived: every check pointed
at the ledger counted **rows**, and the loss was inside them.

The habit that found it was counting a delimiter per line before trusting a
table edit — the same habit that caught two split rows earlier this session.
It found a defect nobody was looking for on the third use, which is [[0324]]'s
finding about sweeps, arriving through a one-line `awk`.
