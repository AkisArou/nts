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

## Two measurements that were wrong, and the loop I had written

The row was still 1.48x node, so the next question was where the time went. The
guess on offer was the representation again -- V8 answers `a + b` with a *cons
string*, a tree node over both halves, and never copies until something reads
the result. That guess was wrong, and two measurements had to be thrown away
before it was.

**The first was invalid.** A microbenchmark timing `build(20000)` in a loop
reported 54us against node's 106, which would have meant we were already twice
as fast. `build` is pure and its argument was a compile-time constant, so clang
hoisted the call out of the timing loop: it measured one build amortized over
two hundred. Taking the length as a parameter put it back to 150us, and the
honest number was 1.36x behind, not 0.51x ahead.

**The second found something real, in my own code.** `nts_round_up_pow2` was
written as `while (at < n) at <<= 1`, which runs on *every append*, to ask
whether the string still has room. O(log n) per append is O(n log n) to build a
string -- most of it shifting a one upwards to rediscover a capacity that had
not changed. Branchless, it is five instructions:

    20000 appends   150us -> 120us     (node 112)

**And the third was a floor I had argued too weakly.** Doubling from one spends
an allocation on each of the first few units, and those are the units every
short string has: a ninety-unit line of decoded text cost eight allocations to
hold what one could. A grown string now starts at sixteen units -- sixteen bytes
of slack on a narrow string, less than the header it hangs off:

    20000 appends   120us -> 75us      (node 96) -- 0.79x, ahead
    string-append   6 -> 2 allocations, below the floor `expected` argued

That last line is the column doing its job. The floor said six with an argument
from doubling out of one, the implementation reached two, and the suite refused
it until the argument was rewritten. An argument weaker than the code is exactly
what "below the floor" is for.

## What `sds` has that we do not

Asked whether to use antirez's `sds`, and the answer is no as a dependency and
yes to two of its ideas.

Not as a dependency: an `sds` is a `char *` with its header immediately before
the data, and ours has to carry a descriptor pointer and a reference count that
`sds` has no place for. A JavaScript string is UTF-16 code units with an O(1)
length, and the narrow/wide pair we already have is V8's answer, not `sds`'s. On
its headline feature -- an explicit `alloc` field -- we are ahead: capacity here
is derived from an invariant and costs no bytes at all where `sds` spends four
or eight.

Its growth policy is better than what I wrote, though. Doubling without limit
asks for two megabytes to hold a million and one units, and `sds` stops doubling
at a threshold and grows in fixed chunks after it. Same threshold here, and the
capacity stays a function of the length -- `cap(cap(n)) == cap(n)` at every
probe -- so nothing else changes:

    100M units   128M allocated -> 100.7M

The other idea is worth keeping in view rather than taking: `sds` picks a header
size from the length, three bytes where ours is twenty-four. Twenty-four bytes
on a one-unit string is most of what a short string costs, and the short-string
shape is where we are still behind.

## Where strings stand

    node-utf8   3.14x -> 1.28x node      over the whole audit
    substrings  2.22x -> 1.87x C++

Still behind node on `node-utf8`, and the remaining gap is most likely the one
thing this representation cannot answer: that benchmark builds a string and
reads only its `length`, which a cons string gives in O(1) having copied
nothing. A flat string copies each unit once. Which is right depends on whether
the string is *used* -- indexed, compared, handed to C -- and for anything that
touches the characters, flat wins and the rope has to flatten first. Measuring
that trade is the next question, not assuming it.

Twenty-two memory cases at both floors, two of them strings.

## The operations, and three of them were already there

The audit asks of every method: present, refused, or slow. Taking the inventory
found the ledger describing a compiler from some months ago -- `at`, `split`,
`replace` and `trim` were listed absent and all four were present. What was
genuinely missing and had no reason to be: `padStart`, `padEnd`, `valueOf`.

`padStart` and `padEnd` are the runtime's, and the only thing needing thought
was the omitted argument. Every other two-argument member here defaults to "to
the end", which is a number, and this one defaults to a single space, which is
not -- so the lowering supplies it rather than the runtime carrying a second
signature. `valueOf` is not a call at all: the specification says the result
*is* the receiver, and a helper returning it would hand back a reference the
caller does not own, so it lowers to the receiver.

`isWellFormed` and `toWellFormed` were written, and then taken out. They are
ES2024 and this compiler's programs are ES2022, so no program it compiles can
name them -- the typechecker says so before the lowering is reached. Helpers
nothing can call are the dead code this project refuses to ship, and raising the
target is a decision about every example rather than about strings.

## ES2022 was a decision nobody made

The fixtures targeted ES2022 -- all one hundred and forty-eight of them, each
repeating the same six options -- and that quietly decided which language this
compiler is for. `isWellFormed` was written, could not be named by any program
the compiler accepts, and was removed as dead code. A fixture that cannot ask
for a construct is a construct nobody discovers is missing.

They now inherit one `tsconfig.fixtures.json` at ESNext. The two TypeScript
packages that actually ship keep extending `tsconfig.base.json` and are built by
`tsc`; this is only for the programs *nts* compiles.

It moved the corpus by itself:

    lowered completely   49 -> 50
    refused a construct  48 -> 43
    rejected by typecheck 86 -> 90

Five fewer refusals and four more programs the checker declines, which is what
raising a target does: constructs stop being unknown and become either compiled
or rejected. And the ES2024 pair went back in, reachable now.

## A lone surrogate in a literal is silently wrong

Found by writing the test for `isWellFormed`, which is the point of writing it.

    "a\ud800b".length     node 3, nts 5

A lone surrogate has no UTF-8 encoding, and the literal's text reaches this
compiler as UTF-8 through the frontend protocol -- so what arrives is U+FFFD,
whose three bytes become three code units. The program compiles, runs, and
answers differently from node with no diagnostic, which is the worst shape a
defect can have.

Not fixed here, and the reason is where it lives: the literal would have to
cross as UTF-16 code units rather than as text, which is the transport rather
than the lowering. Refusing it needs the same thing, or a re-scan of the source
span for a surrogate escape that has no pair. Until one of those, this is
written down rather than hidden, and the example builds its lone surrogates with
`fromCharCode`, which goes through no such transport and is what a program
producing them actually does.

What remains absent is absent for a reason, and each is a decision rather than a
task: Unicode case-mapping and normalization tables for `toLowerCase`,
`toUpperCase`, the `toLocale` pair and `normalize` -- data rather than code; ICU
for `localeCompare`; a regular expression engine for `match`, `matchAll`,
`search` and the pattern forms of `replace` and `split`; tagged templates for
`String.raw`; and indexing, `s[0]`, which is refused as "indexing a
representable type, which is not an array".
