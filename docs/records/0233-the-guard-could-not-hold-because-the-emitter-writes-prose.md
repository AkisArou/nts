# The guard could not hold because the emitter writes prose

`os` is the second whole module on the compiled axis: **9 passed, 0 failed, 4
n/a**, and all nine fail under `--sabotage`. The export that finished it is
`constants`, and the work is a representation change, a crossing, and a value
export. What is worth writing down is none of those. It is the fixture.

## What landed

`ManagedType::Table(K, V)` is now a sibling of `Map`, not a flag on it. An index
signature lowers to it, and the six backend sites the JVM lane enumerated
refuse or handle it by name. Their argument for the variant over the flag was
that the matches are exhaustive, so a new variant is a compile error at every
site rather than a silent fallthrough -- and that is what happened: the compiler
listed the six, and one of them was a length expression that would have been
wrong.

At the boundary, `Cross::Entries` crosses a table outward as a plain JavaScript
object, and `value_exports` no longer skips `Cross::Object`, so an exported
`const` whose type is an object can be published. `os.constants` is both at
once: an object value export with four table fields. Measured against node,
**0 differing names across all 5 groups** -- 33 signals, 79 errno, 6 priority,
5 dlopen, and `UV_UDP_REUSEADDR`.

`signals` arrives frozen and the other three do not, which is `shape.mjs`'s
`Object.freeze` and not the addon's. Testing the raw `.node` said `frozen:
false` and that reading was mine, not a defect -- the shim is how the module is
loaded and I had bypassed it.

## The fixture that could not fail, and its twin that could not pass

Two fixtures, because one is not a control:

    object-value-export                  publishes X
    object-value-export-unrepresentable  lacks-addon X

The second is the same object with one field the backend has no layout for. Its
job is to make the first non-vacuous: without it, `publishes X` holds equally
for a wrapper that builds the object it was asked for and for one that publishes
every object export and lets the C fail later.

Both were written with `X` = `shape`. Both were wrong, in opposite directions.

`lacks-addon shape` reported **REGRESSED -- the wrapper names it now**, with the
refusal message printed right beside it saying the wrapper had refused. Both
statements were true. The wrapper does not publish `shape`; the *addon* contains
the word "shape" four times, in its own boilerplate comments, describing the
shape of a conversion failure and the shape callers write. A guard reads emitted
text, and emitted text contains prose.

Which means `publishes shape` had the same defect with the sign reversed: it
would have held before the fixture compiled anything at all.

This is 0228 -- **an expectation naming something the emitter writes
unconditionally cannot fail** -- arriving through a door 0228 does not cover.
0228 was about a message the emitter always emits. This is about an *English
word* the emitter always emits, in a comment, about something else entirely. The
rule that covers both: a guard's name must be one the emitter cannot write for
any reason other than the one being tested. `constantTables` is that name here,
and the two-line check that settles it is `grep -c` for the candidate against an
addon built from an *unrelated* fixture, before writing the guard.

## The controls, stated so they are not assumed

`lacks-addon` was seen to fail on this fixture, today, under the name `shape`.
That is not an argument that the guard form works; it is an observation of it
failing where failing was correct, which is the only evidence that counts.

`os`'s nine passing files all fail under `--sabotage`, including the four behind
`constants`: `core-static.js` reports `os.tmpdir is not a function`,
`constants-table-static.js` reports `Cannot read properties of undefined
(reading 'signals')`. And `core-static.js` destructures `PRIORITY_BELOW_NORMAL`
and `PRIORITY_LOW`, which is why the table was checked by *calling* it rather
than by counting keys -- a table with five names and a table with six are the
same to a key count and not to that file. Both destructured values match node.

## What clippy found that review had not

Three of the six lints on this change were noise. Three were not.

`ManagedType::Table(_, _)` appeared **twice in the same or-pattern**, from a
`sed` that matched two anchors. The second was unreachable and the code was
correct anyway, so nothing would have caught it but the lint.

And `Cross::Entries(Box<Cross>)` carried a payload **no wrapper ever read**. The
variant was built to mirror `Cross::Elements`, which carries its element
crossing because an array's C representation differs per element type and the
wrapper has to spell one. A table's does not: entries are erased values, so
`nts_to_napi_entries` reads the tag at run time and one conversion serves every
value kind. The value's crossing still decides *whether* a table may cross --
`cross` computes it and refuses a table whose values cannot go -- but that is an
admission test, and storing its answer was the type claiming to carry data
nobody reads. It is `Cross::Entries` now. Symmetry with a neighbouring variant
is not a reason, and the lint asked the question review had not.
