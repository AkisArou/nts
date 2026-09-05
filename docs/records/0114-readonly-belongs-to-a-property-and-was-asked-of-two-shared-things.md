# `readonly` belongs to a property, and was asked of two shared things

Twenty-four legal assignments in `runtime/node` were refused as *"assigning to a
readonly property"*. None of the properties was readonly. Two defects, one
shape: **a fact about a single declaration read off a structure that many
declarations share.**

Thirteen lines reproduce the first:

    class Frozen  { readonly count: number; constructor(n: number) { this.count = n; } }
    class Counter { count = 0; }

    const c = new Counter();
    c.count = n;      // refused

## The whole program, by name

    fn declared_readonly(snapshot: &SemanticSnapshot, name: &str) -> bool {
        snapshot.nodes.iter().any(|node| {
            node.modifiers.contains(DeclarationModifiers::READONLY)
                && node.children.iter().any(|c| nodes[c].text == Some(name))
        })
    }

No type parameter. It asks whether *anything anywhere* carries the modifier and
has a child with that text. So one `readonly count` in one file makes every
`count` in every unrelated type readonly.

Its own doc comment says **"Whether a member is declared `readonly` on the
type's own declaration"** and **"Walks the declaring node's members"**. That is
what it should do and never did. Sixth stale-or-wrong comment this stretch, and
the second where the comment states the correct algorithm beside code that does
something else — 0102's was `specialize.rs` naming an optimisation and
attributing it to a compiler that was not performing it.

The names it caught in the profile are exactly the ones you would predict:
`length`, `destroyed`, `closed`, `chunks`, `port`, `resolve`, `finished`,
`root`, `name`, `path`. Every name common enough that *somewhere* declares it
readonly.

A property symbol carries the declarations it came from, so the question has an
exact answer and needs no search at all. Inheritance keeps working for the same
reason: an inherited property's symbol is the base's, and the base's declaration
is where the modifier is written.

## And then the layout, which several types share

Fixing that left one refusal, in this feature's own example — and it named
`Frozen.count` for an assignment to a `Counter`.

`Frozen { count, label }` and `Counter { count, label }` have identical fields
and merge into **one layout**, which is correct and deliberate:

> Not `readonly`: a value is laid out the same whether or not anyone may write
> to it, and refusing to share a layout over that would split `Point` from
> `Readonly<Point>`.

That argument is about *storage* and it is right. The bug is that the lowering
then used `layout.fields[field].readonly` as a **permission** check — and
permission is not a property of a shape. The merged layout carries whichever
type was laid out first.

Asked of the type's own property list now. The two defects are the same mistake
at two levels: **a per-declaration fact answered by a shared structure**, once
the whole program and once a merged layout.

## The check is now unreachable, and stays

TypeScript rejects assigning a `readonly` property outside its constructor
itself — `TS2540` — so no well-typed program can reach this refusal any more.
The only reason it ever fired was the two defects.

It stays, for the reason 0091 gives about `every_arm_descends_from`: the
lowering should not depend on the checker having run. Its unreachability is
written beside it rather than papered over with a fixture that cannot exist, and
the mutation that restores either defect makes it reachable again — which is how
the tests fail.

## Measured

    profile refusals, distinct sites   2194  ->  2176
    of which readonly                    24  ->     0

The net is eighteen rather than twenty-four: removing a refusal lets a function
lower, and a function that lowers can then meet a *different* refusal further
in. That is the count working. Six sites moved from "refused for a reason that
was false" to "refused for a reason that is true", which is progress that a
falling number would have hidden.

    readonly (memory)   ideal 0   allocated 0   actual 0   alloc 0

Argued before measuring. The case holds both classes on purpose: a fix that had
split them to carry writability in the layout would show up as two descriptors
for one arrangement of bytes, and this is where that would be visible.

**No benchmark row, and the reason is the shape of the fix.** Nothing about a
*write* changed — a non-readonly field's `FieldSet` is the store it always was.
What changed is which programs reach it, and a program that used to be refused
has no previous number to compare against.

## The ledger said ✅

`optional and readonly properties, index signatures` has been ✅ throughout. It
was true of the half that reads and lays out, and false of the half that
decides who may write — and the row had no way to say so, because a row that
covers a feature covers its defects too.

The row now carries what was wrong. That is the third time a ✅ has turned out
to overstate: `forEach` supported one-parameter callbacks only, `Object.keys`
answered from the layout for optional properties, and this.

## Ratchets

- `examples/readonly-names` — 203 cases against node on C, LLVM and under counting,
  across seven functions. Every writable property in it shares its name with a
  readonly one declared beside it, an inherited `readonly` sits over an
  unrelated writable of the same name, and one class is named `length` because
  that is the name `lib.d.ts` declares readonly in several places.
- `compiler/core/tests/readonly.rs` — three tests, two mutations. Restoring the
  name search fails two; reading the flag off the layout fails one **and refuses
  an assignment in the example**. The middle test asserts the two classes really
  do share a layout, without which the first would pass for the wrong reason.
- `tooling/memory/cases/readonly-names` — 0 / 0, argued before measuring.
- No benchmark row, for the reason above.
