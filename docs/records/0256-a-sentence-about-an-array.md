# A sentence about an array

    const xs: number[] = [1, 2, 3];
    "length" in xs

    an `in` on something that is not an object, which JavaScript throws for

An array is an object in every sense the language has. What it is not is
`TypeKind::Object`, and the path that answers `in` asks which of a type's
*declared members* have the name. An array declares none, so it fell through to
the arm written for primitives and borrowed their message — a refusal that told
the reader their program was wrong. The same for a typed array, a `Map`, a
`Set`, a `Promise` and an `ArrayBuffer`.

The answer is a constant, and the table written two commits ago already held it:
an array has a `length`, a `Map` and a `Set` have a `size`, a `Promise` has a
`then`, a typed array and a `DataView` sit on a `buffer` at a `byteOffset`. The
same table that says which natives answer for a name now also asks which one the
receiver already is, and where the two meet nothing has to be tested.

**Only the `true` direction.** A name the table does not list is not therefore
absent: `push`, `slice` and `forEach` are all `true` in JavaScript, and they live
on a prototype a compiled program does not have. So the other direction stays a
refusal, and now says which of the two it is instead of claiming the value is not
an object.

`String` is deliberately not in the receiver table. `"length" in "abc"` **throws**
in JavaScript — `in` requires an object and a string primitive is not one — so
the answer there is a refusal rather than `true`.

## `{ ...base, k: v }`

Refused by name since object literals were written. 25 distinct sites across
`runtime/node` and `runtime/web-platform` and 158 refused functions across the
module builds: `util/inspect.ts`, `stream/from.ts`, `util/format.ts`,
`fs/src/options.ts`. It is how a TypeScript program spells "these options, with
this one changed".

It is a field-by-field copy, and the whole of the semantics falls out of emitting
it **where it is written**: what comes later overwrites what came before. A
lowering that appended the spread's stores at the end would pass
`{ ...base, count: 7 }` and fail `{ ...first, ...second }`.

The third order cannot be written at all: TypeScript rejects
`{ count: 7, ...base(n) }` as TS2783. So the ordering a fixture can check is
spread-against-spread, and it checks it.

A field the target does not declare is skipped rather than refused — the result's
type is what the checker gave the literal, so a field outside it cannot be read
back and copying it would need a slot that does not exist. A spread of an erased
value or of a table refuses: there is no field list to walk, and guessing one
would be a struct built from nothing.

## The instrument that could not fail, and the step that now catches it

**`nts check` exits 0 when an exported function refuses.** It compiles what it
can, runs that, compares it with node, and reports agreement over the functions
that survived.

So while `examples/in-on-a-native-receiver` was being written, disabling the
change under test refused **seven of its nine functions** and `nts check`
answered:

    checked 58 cases across 2 function(s)
    agreed on every case

exit 0. `backend_examples` counts that as `ok`, and the floor reads 147 either
way. The fixture could not fail at the thing it was written for, and neither
could the gate.

That is the fourth vacuous instrument in two days, and the first one whose cause
was in the *gate* rather than in the fixture. The other three were a case table
indexed by a number the differential's pool never generates, an expectation that
ran the wrong subcommand, and a fixture whose types were never candidates. All
four were found the same way: by forcing the answer and watching what did not
change.

`tooling/gate/example-refusals` lists every example that refuses anything, with
its count and the reason, and a new gate step fails on an example that is not
listed or that refuses more than it says. Twelve examples are on it. Six are
named `*-unsupported` and exist to hold refused constructs; six are ordinary
examples that happen to contain one — a regular expression literal, a JSX
element, an intersection parameter, an accessor assignment, a void expression, an
erased value where a concrete one is wanted. Each of those is somebody's next
item and each is now visible instead of being invisible inside a green 147.

It counts `nts hir`'s refusals rather than `nts check`'s: `check` prints the
cascades below a refusal too, so it says three for `calls` where the lowering
refuses one thing and two functions fall over behind it. Counting the root keeps
the number stable when a cascade lengthens.

Controlled four ways, all of them run: a count raised by one fails; a name
removed from the table fails; disabling the native-receiver change reports
`in-on-a-native-receiver refuses 7 and is not in tooling/gate/example-refusals`;
and disabling the spread reports the same for its example. It also caught its
first real thing immediately — `library refuses 1, down from 4`, because the
spread work had cleared three of its four while the table still said four.

## Measured

`examples` 147 to 149 on the LLVM lanes and 146 to 148 on the JVM, with both new
examples agreeing with node on all three. `blockers/spread-assignment-in-an-object-literal`
is kept as a guard.
