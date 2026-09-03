# 0047 — Three methods, chosen by counting

`some`, `every`, `findIndex` and `filter` landed in 0043 and left an obvious
list behind: `find`, `concat`, `sort`, `shift`, `unshift`, `splice`, `flat`,
`flatMap`, `findLast`, `findLastIndex`, `reduceRight`, `toSorted`,
`toReversed`. All of them are real methods and all of them are missing, so the
question is which to build, and "obvious list" is not an answer to it.

`runtime/node` is 24 modules of ordinary TypeScript written by people who were
not thinking about this compiler, which makes it the closest thing to a
population sample the repository has. Counting the calls:

    shift            17
    unshift          16
    splice           12
    sort              2
    concat            2
    toSorted          1
    toReversed        0
    reduceRight       0
    flatMap           0
    flat              0
    findLastIndex     0
    findLast          0

So `shift` and `unshift`, and not the six with nothing behind them. `splice` is
next by this measure and is a different shape — it removes a range and inserts
another, and its result is a new array — so it is a separate piece of work
rather than a third helper here.

`find` is here for a different reason: it is the fifth of a family whose other
four exist, and it costs almost nothing given them.

## `find`, which is `findIndex` reading one element

The loop is the same. What differs is the seed: `findIndex` carries `-1` for
"nothing matched", and `find` carries the **length**.

Both say the same thing, and the length says it in a number that `at` already
answers `undefined` for. So the result is one helper call — `nts_array_at_value`
for a tagged result, `nts_array_at_ref` for a reference one — rather than a
conditional this lowering would have to build and both backends would have to
agree about. `-1` would not do: `at(-1)` is the *last* element, which is the
opposite of nothing.

## `shift` and `unshift`, which are `pop` and `push` at the other end

The other end costs a `memmove`. An array's elements are contiguous and its
length is where they stop, so taking one off the front means moving the rest
down: O(n) where `pop` is O(1). That is what the operation *is* rather than a
shortcoming of this representation — V8 pays the same move for an array that
has not been made into a dictionary.

`unshift` goes through `lower_pushes`, the same emitter `push` uses, because it
has the same shape: as many elements as it is given, and for a reference array
the **consuming** convention where the caller owes a reference and the slot
takes it. `own::consumes` names it beside `nts_array_push_ref`; the two ends of
one convention are one line apart now, which is the point of putting it there.

## A fixture that is a measurement

The examples went into `examples/arrays` first, and
`the_report_counts_what_was_removed_and_what_remains` failed: 15 checks kept
against an expected 4.

The test is right and the placement was wrong. That fixture is a controlled
measurement of the bounds analysis — its comment enumerates each of the four
checks that survive and why no proof is available for it — and eleven
unprovable `xs[0]!`s dropped into the middle of it do not weaken the analysis,
they weaken the *statement*. The examples moved to `examples/growable`, where
an array that grows is already the subject, and the ratchet still says four.

Worth writing down because the temptation was to update the number.
