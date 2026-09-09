# The empty object type is not a struct

`{}` in TypeScript is every value except `null` and `undefined`. It was being
given an object layout, so a number could not be assigned to it:

    const x: {} = n;
    NTS1001 a value of type Float { bits: 64 } where Managed(Object(TypeId(4))) is wanted

The checker was right and the representation disagreed with it. An anonymous
empty object type erases now.

## It is reached by inference, not by annotation

Nobody writes `{}`. `value ?? byDefault` with `value: unknown` **has** that type,
and that one expression is `internal/validators.ts:243`'s `parseFileMode` --
which the Node lane measured as one of four sites blocking 21 of 22 modules.

Their reduction is why this was findable at all. Four controls, each removing one
element and still compiling:

    value: number | null, byDefault: number     compiles   not `??`
    value: number | null, byDefault?: number    compiles   not the optional parameter
    value: unknown, never coalesced             compiles   not `unknown` in a parameter
    const given = value;                        compiles   not binding an erased value

Every element anyone could name was ruled out before anything was changed, and
what remained was a type **written nowhere in the source**. A reduction that
eliminates the visible candidates is what leaves the invisible one standing.

`parseFileMode` no longer refuses for this. It is now behind a regular
expression literal, which is the last wall in that file and a different piece of
work.

## Anonymous only, and why the line is there

`class Bare {}` is the same TypeScript type and a different intent: it is
instantiated with `new`, asked about with `instanceof`, and given an identity by
having an address. Erasing it would take all three.

`interface Empty {}` is left on the same side as the class rather than split from
it. Nothing in this tree needs the distinction, and guessing which side a
*declared* empty type belongs on is how a representation change becomes a
behaviour change.

Inherited members are flattened into `properties` before this sees them --
checked rather than assumed: `interface Derived extends Base {}` carries `Base`'s
field here and so is not empty.

## What it unblocked, and the defect it exposed

    published names across 22 modules   87 -> 97
    examples                            141 of 141 agree with node
    addons                              22 load, 0 crashed

And one module stopped building, which is the useful part:

    http/program.c:13472: expected member name or ';' after declaration specifiers
        struct NtsObj_Type11365 { NtsHeader header; NtsString * 100; …

`http`'s status table is `{ 100: "Continue", 101: "Switching Protocols", … }`. A
C identifier may not **begin** with a digit, and `unspellable_in_c` -- written
this morning for `"a b"` -- checked every character and not the first one.

So the predicate had been wrong for as long as it had existed and could not be
reached, and an unrelated change let the code that reaches it compile. That is
the third time today a defect surfaced not because it was introduced but because
something else stopped hiding it: `validateOneOf`'s needle, `os.constants`
publishing, and now this.

## And a fixture that stopped reproducing because the compiler improved

`wrapper-for-a-refused-body` reported REGRESSED. Its subject drew `NTS2006 an
object type with no layout` from the C backend -- because the join of a chain of
`typeof` narrowings is `{}`, which had a layout it could never have. That body
compiles now.

**The verdict for "this fixture's premise was fixed elsewhere" reads identically
to a real regression.** The only thing that told them apart was the fixture's own
header recording *why* the body had been refused, which is the entire reason
writing that down was worth the space. Rewritten around a heterogeneous tuple
return, which the lowering accepts and the backend refuses -- the shape the guard
needs, since a body the lowering rejects never reaches the wrapper pass at all.
