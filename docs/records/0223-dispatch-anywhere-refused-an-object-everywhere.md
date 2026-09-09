# Dispatch anywhere refused an object everywhere

`path.parse` returns five strings. It was declined at the wrapper as
`returns an object`, and the reason had nothing to do with `ParsedPath`:

    ParsedPath  class=false  base=false  methods=[None, None, None, None, None, None]
                fields=[root: String, dir: String, base: String, ext: String, name: String]

`Layout::methods` is **one entry per dispatch slot in the whole program**, with
`None` where a layout does not implement that slot. Its own documentation says
so -- "this class's implementation for each dispatch slot, where it has one".
The wrapper's test for "this is a class, and copying it as data would lose
behaviour" was `!layouts[at].methods.is_empty()`, which a row of six nulls
satisfies.

So an object return was refused by **dispatch existing anywhere in the
program**. Not in the type, not in its cone, not in anything it can reach.

## Shown on five lines

    export interface Five { root: string; dir: string; ... }   // five strings
    export function five(path: string): Five { ... }

    abstract class Shape { abstract area(): number; }           // never crossed
    class Square extends Shape { ... }                          // never returned
    class Circle extends Shape { ... }                          // never mentioned

With the three classes: `no wrapper for five: returns an object`. Without them:
`five` crosses. The classes are unreachable from the boundary and unrelated to
the record; what they add is a dispatch slot, which gives every layout in the
program a table to have nulls in.

`path` has six slots somewhere in it. That is the whole of why `parse` was
declined, and `parse` is 26 of the 54 remaining divergences in that module's
edge table.

## The fix, and how far it was from being local

    layouts[at].methods.iter().any(Option::is_some)

Eleven places in this compiler read `Layout::methods`. Ten of them --
reachability twice, `signatures`, `unerase` twice, the JVM emitter, the
devirtualization test -- iterate with `.flatten()` or `filter_map(Option::as_deref)`,
because a `None` is not a method and every one of them knows it. The wrapper was
the only reader that asked how long the table was.

## Measured by running it

`path` publishes 13 rather than 12, and declines 4 rather than 5. Built
`path.node`, loaded it, and compared `parse` against `node:path`'s over 347
generated paths -- `""`, `"/"`, `"///"`, `"/a//b"`, `".."`, `"x.y.z"`, spaces,
tildes, every pairing of twelve fragments. **347 agree, 0 differ.**

Swept across all 22 modules, published and declined counts before and after on
the same pair of binaries: **`path` is the only one that moves**, 12/5 to 13/4.
`assert` 0/24, `buffer` 3/12, `os` 17/6, `zlib` 0/53 and the rest are identical
to the export.

That is the expected shape and worth stating rather than assuming. The gate
freed was one specific decline, so a module with no scalar-record return has
nothing to gain from it, and a module that gained something else would have
meant the change did more than it was argued to.

## The fixture that could not have caught it

`object-return-carries-scalar-fields-only` is a good fixture. Nine functions
differing in one field's type, six declines, three controls that say the object
machinery works, and a comment explaining that the rule is flat-scalar rather
than scalars-all-the-way-down. It passed identically before and after this fix.

It has no class in it. It had no reason to: it is a fixture about object
returns, and a class is not part of the shape it isolates. So its program had
**zero dispatch slots**, every layout's method table was genuinely empty, and
the condition under test was one the fixture could not express.

It now carries a `Shape`/`Square`/`Circle` hierarchy that nothing crosses,
declared for no reason except that the program should not be slot-free.
Controlled: `fNumber` appears in the addon 0 times under the previous binary and
1 time under this one.

## Three of these in two days, and they are one shape

- `0221`: a fixture put `doubles()` beside `wide()`, and the fraction array cost
  every `number[]` in the program its narrowing, so the eight-byte case was
  tested zero times while six checks passed.
- The Node lane's `in`-with-a-computed-key fixture took its object as a
  *parameter*, and object parameters draw their own decline, so the control was
  refused for a reason unrelated to `in`.
- This one: a boundary fixture with no class in it.

Each time the control was written to isolate the subject, and isolating it
removed a precondition the subject needed. The lesson is not "add a class to
every fixture". It is that a fixture states the conditions it *varies* and is
silent about the ones it holds fixed, and the ones it holds fixed are where a
whole-program property hides. A fixture that is simpler than any real program is
testing a case that does not occur in one.
