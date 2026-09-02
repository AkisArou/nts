# 0029 — A string that grows

First step of the string audit, and the first under the rule that a feature is
not done until it answers the allocation question.

## What the representation said

`typedef NtsHeader NtsString` — a header and its code units inline, sized to
exactly `length`, one byte per unit where every unit fits and two otherwise. The
comment beside `NtsArray` explains why the array went out-of-line and the string
did not:

> A string never grows, so it keeps the inline shape and pays nothing for a
> field it would never use.

That is right about every string this compiler made until it met one being
built. `out += c` per code point is what a decoder writes -- it is what
`runtime/node/internal/utf8.ts` writes, and that file is the `node-utf8`
benchmark -- and each `+` allocated a whole new string and copied both sides. n
appends, n allocations, O(n²) code units copied.

## The instrument, and the floor argued before it was read

    string-append   18 operations, 17 allocations

The floor was argued first, and derived twice. Six allocations for seventeen
appends: `out` is unique, so growth may happen in place, and growth that doubles
reaches seventeen units in six steps -- capacities 1, 2, 4, 8, 16, 32, taken as
the length passes 1, 2, 3, 5, 9, 17. One operation: the accumulator is a single
owned value moved from one name to the next, released once where it dies.

Not one allocation, because nobody knows the final length: the trip count is
`16 + n`. `flow::string_span` bounds a slice by the string it came from, which
is a different question from bounding an accumulator by a loop it has not run.

## Capacity, without a field or a byte

The obvious answer is a capacity beside the length. The header is three words
exactly, so that costs eight bytes on every string in every program, to serve
the one shape that grows.

It is not needed. Grow only to a power of two and `capacity == next_pow2(length)`
is an *invariant*, so capacity is a function of the length and one flag bit --
`NTS_GROWN`, beside the `NTS_TWO_BYTE` that already says how wide the units are.
A literal, a slice, a substring sets nothing and is exact-sized as before. Only
a string something appended to pays, and what it pays is the slack every
growable buffer pays.

## Who is allowed to write into it

`nts_str_append` is **consuming**: the caller hands over its reference, the way
`nts_array_push_ref` already takes one. `rc` rewrites a `Concat` into it exactly
where the ownership answer says the left side is owned, unborrowed, dies here,
and is read by nothing after -- the same four guards the hand-over arm beside it
uses, and for the same reasons.

Whether it *writes in place* is decided at run time, by the count. Static
ownership is not uniqueness: this function may own a reference to a string it
also stored somewhere earlier. `reserved == 1` is one load against a word
already in cache, and it is the whole safety argument -- one reference exists,
this call is consuming it, so nobody can be reading the units being overwritten.

Two smaller things fell out of measuring rather than reasoning. Growth frees the
old storage through `nts_destroy` rather than `nts_release`: same reclamation,
without a counted operation the program never asked for -- and `nts_free` alone
was five leaks, because `nts_live_count` is `allocated - reclaimed` and the
bookkeeping lives in the death path. And an immortal left side is left alone:
`let out = ""` in front of a loop is a literal, which has no count to give back,
and releasing one was a call that decided nothing.

    string-append   18 -> 1 operations, 17 -> 6 allocations, both at the floor

## And the number it was for

    node-utf8   3.14x -> 2.36x node

Predicted under 2x. It is not, and the reason is in the same line of source:
`out += String.fromCharCode(c)` still allocates a one-character string on the
right of every `+`. The accumulator's allocations are gone; the temporary's are
not. `String.fromCharCode` has no `_into` form, so it cannot go in a frame the
way a slice can, and its length is bounded by one unit -- which is exactly the
shape `flow::string_span` exists to prove.

`substrings` 2.22x -> 2.14x and `strings` 0.64x -> 0.63x, both predicted not to
move, because slicing and scanning do not append.

## The temporary on the right

`String.fromCharCode` yields exactly one code unit, whatever it is given: the
argument is truncated to sixteen bits. That is the easiest bound in the
language, and a bound plus "does not outlive the frame" is exactly what frame
storage asks for -- the pair that already keeps a tokenizer's substrings out of
the heap. So it grew an `_into` form like the four helpers that had one, and
`frame_capacity` answers `1` for it directly rather than asking
`flow::string_span`, which reads a *string* argument and would have nothing to
say about a `double`.

The harder half was that it could not be placed anyway. `escape` escapes every
argument of every external call, because a body it cannot see could do anything
with what it is handed -- and `nts_str_append` is one it *can* see, in
`runtime/c`, where what it does with its right-hand argument is read it. So
`runtime::keeps` says which slots a helper may let outlive the call, `None`
meaning the honest default of all of them.

That blanket was measured once in `0028` and found to cost exactly nothing: a
probe removing it moved one case, wrongly. The measurement was right and its
scope was the suite it ran on, where nothing handed a string to a helper. This
is the case it did not contain, and the refusal was worth reopening the moment
there was one.

Then seventeen operations remained, one per iteration: a release for storage
that was never allocated. `own::counted` already answers "nothing to give back"
for a frame *object* with no reference fields, and a frame-placed string is the
same answer for the same reason -- `nts_str_place` marks it `NTS_IMMORTAL` and a
string holds no references.

    string-build   18 -> 1 operations, 6 allocations, both at the floor
    node-utf8      2.36x -> 1.48x node
    substrings     2.14x -> 1.88x C++

`substrings` moved because its slices are frame-placed too, and every one of
them was being counted on the way out.

## Where strings stand

    node-utf8   3.14x -> 1.48x node      over the whole audit
    substrings  2.22x -> 1.88x C++

Twenty-two memory cases at both floors, two of them strings. What is left is the
operations table: `padStart`, `padEnd`, `valueOf`, `isWellFormed` and
`toWellFormed` are pure code-unit work and absent for no reason, and three
decisions stand behind the rest -- Unicode tables for case and normalization, a
regex engine for `match`, `matchAll`, `search` and the pattern forms of
`replace` and `split`, and ICU for `localeCompare`. Each deserves a refusal with
a reason rather than a checkbox.
