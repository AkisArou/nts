# The library boundary cost more than the type it was keeping out

Found by walking a yield measurement down to its head instead of stopping at the
first ranked table, and the head was one type.

## The walk

`prize.mjs --all` measures the compiled axis against node's own suite: **1980
files pass interpreted, 48 pass compiled, 1934 to gain**. Of the 1718 failures it
prints — 89% of the gap — **1307, or 76%, name an absent export**. `createServer`
alone appears in 369 of them.

So the question is why exports decline, not why lines refuse. Walking `net`'s
declines gave NTS1003 cascades; walking those to their roots gave, in all three
highest-yield modules, the same number one:

    a property `X` of unrepresentable type (a union of …)

And resolving the placeholder in that message gave one type. In `fs`:

    194  PromiseWithResolvers | null
     44  PromiseWithResolvers | undefined

238 sites, one name. `blockers/promise-with-resolvers` had already recorded it —
*"292 of `fs`'s 2,078 refusals are this one type … the largest single blocker in
the module by a wide margin"* — which is corroboration arrived at from the other
end rather than a rediscovery I can claim.

## The cause was the boundary, and the proof was one file

`decompose.rs:323` stops at the library boundary: a type declared outside the
compiled files stays a placeholder, because decomposing pulls the standard
library's whole graph in — measured at 5,773 types from a 180-node file. That is
a good reason and this record is not an argument against it.

What it costs is that a placeholder has no representation, so **every property
holding one refuses**. Exactly the failure `ReadonlyMap` had before it was
carried, where `#uniqueHeaders` alone was 89 of `http`'s 154.

The proof that it is the boundary and not the shape is two arms in one file:

```ts
interface Mine<T> { promise: Promise<T>; resolve: (v: T | PromiseLike<T>) => void }
class A { f: Mine<number> | null = null }                    // compiles
class B { f: PromiseWithResolvers<number> | null = null }    // refuses
```

Structurally identical, one variable between them — where the interface is
declared. Nothing about function-valued members, generics, or unions is
involved, and each of those was my hypothesis in turn.

## What carrying it does

Baseline against the change, three highest-yield modules:

```text
           NTS1001 root      union-typed      NTS1003 cascade
  fs       2033 -> 1858      444 -> 216       839 -> 936
  stream   1617 -> 1468      329 -> 143       490 -> 557
  net      1450 -> 1334      287 -> 134       542 -> 603
```

Corpus-wide, both arms against **one corpus frozen at `dfa53fcc`** in a detached
worktree:

```text
             roots (NTS1001)    cascades (NTS1003)
  baseline        20000               6820
  carried         18291               7673
                 -1709 (-8.5%)       +853 (+12.5%)
```

The cascades **rise**, and that is the shape to expect: a function that used to
stop at an unrepresentable property now gets further and stops at the next
thing, moving from the root column into the cascade one. A reading that took the
rise as a regression would have thrown the change away.

**The first version of this paragraph was wrong and is worth keeping as the
error.** I published "21,493 refusals to 19,670" from two *gate runs about two
hours apart* — and `runtime/node` took **16 commits in those three hours** from
another lane. So it was my change plus someone else's corpus growth in unknown
proportion, a before and an after never measured against the same corpus. What
caught it was an accidental control: a later gate on **identical compiler
logic** printed 18,291/20,175 where the earlier printed 19,670/21,594, with only
prose between them. Two numbers that had to agree and did not.

The frozen-corpus redo also cross-checks: its patched root count, 18291, is the
same figure the gate's own profile step printed for that corpus.

Matched by name, not by shape. "Carry any library interface whose members are
representable" is the version that sounds principled and pulls the graph in
through the first type whose members happen to qualify. A name is a decision
someone can read and argue with.

## Three errors on the way, all the same one

- I probed with a **local** twice where the refusal says **property** — the same
  position mistake as row 2024's probe earlier the same day. A local keeps its
  initialiser; the declared type is decoration there.
- I printed a baseline of "1290" I had **never measured**, inside the same
  command that produced the real after-number.
- A `cp` hit the interactive-overwrite alias, so a whole round compared the
  baseline against itself. It read as "the change does nothing", and the only
  reason it was caught is that patched and baseline came out **byte-identical**,
  which a real null result would not be.

Each one produced a number that looked like a number.

## Where it stops now, which is better stated

The fixture moved one link down its own chain: `this.cap.resolve()` now refuses
with *a call of a function value in a program with no closures*. Measured rather
than predicted — adding one unrelated arrow function to the file does not change
that refusal, it **removes** it, and the file compiles. So nothing is wrong with
the call, the field, or the type; the closure call path simply is not built for a
program whose only function values arrive from a library type.

## What this change is NOT, and the control that does not exist

**A refusal count is not a correctness count, and for this change no correctness
count is currently obtainable.** The JVM lane caught it before I committed:
`PromiseWithResolvers` appears in **zero** files under `examples/` and
`benches/`, so the gate's `examples` step reads 205 of 205 agreeing whatever this
emits. Nothing executes the type.

I wrote `examples/a-promise-with-resolvers` to close that, with four arms and a
plain-`Promise` control, and ran it against a compiler built from the frozen
worktree — a named commit rather than `target/release/nts`, which is whoever
built last and would have given stability without provenance. The arms:

```text
  dfa53fcc      line 32: a property `cap` of unrepresentable type   <- the target
                line 22: `Promise.withResolvers`, a global member with no definition here
  + carried     line 32: gone
                line 22: unchanged
```

So the change does exactly what it claims, and the example **still does not
compile**: `Promise.withResolvers` is itself unimplemented. There is no way to
construct a value of the type, so it cannot be exercised end to end, so the
example was deleted rather than left carrying refusals.

That leaves the honest statement of what landed: **1709 fewer root refusals on a
named corpus, a green gate across all three backends, and no evidence that a
single working export publishes that did not before.** It is a prerequisite that
has been measured, not a gain that has been demonstrated. The next link is
`Promise.withResolvers` itself, and until that exists the value of this is
theoretical.

The first arm of that control also failed silently in the exact way this record
is about. It printed nothing and I read it as "compiles" — it had exited 1 with
`No version is set for command tsgo`, and my `awk` filter for `NTS1[0-9]{3}`
turned a dead run into a clean bill. One `NTS_TSGO` later it produced the table
above. **A filter applied to a stream that was never produced looks exactly like
a filter applied to a stream with nothing in it.**
