# The append was out of bounds, and the length was not

    const xs: number[] = [1];
    xs[1] = 2;
    xs.length

    nts: refused: index 1 is outside [0, 1)   -- SIGABRT
    node: 2

**Not landed.** The fix works, agrees with node on 174 cases, and costs
`cyclic-array` one reference-counting operation and one collector candidate — a
memory floor, and this session's rule is that floors go up. What follows is the
mechanism, the two halves, and the two measurements, so that whoever builds it
does not rediscover them.

`xs[xs.length] = v` is the ordinary append and it is not out of bounds. The
store used `nts_index`, which compares against the length, so the append aborted
the process. `xs.push(v)` — the other spelling of the same operation — was
correct all along, which is what says this was about the store rather than about
growth.

Found by the Node lane's `agreement.mjs`, which is the only instrument in the
tree that can see a program that compiles, runs, and answers wrongly.

## Two halves, and the second is the one that was nearly shipped wrong

**The store.** A *checked* element store takes its slot through
`nts_array_slot`, which extends the array by one when the index is exactly the
length. A store the bounds analysis proved keeps its inlined subscript, so a
proven store cannot be the append and the hot path is untouched.

A **sparse** write is still refused. `xs[3] = 4` on a one-element array gives
node a length of 4 with `undefined` at 1 and 2, and a dense `double[]` cannot say
`undefined`. Zero-filling would answer 0 where node answers `undefined`, which is
a wrong value where this is a named refusal.

**The length.** With only the store fixed, `xs[1] = 2` stored correctly and
`xs.length` still answered **1** — folded from the allocation. A right value and
a wrong length out of one array, which is worse than either alone.

## The circularity, and the observation that breaks it

`allocated_length_is_exact` was the obvious place to invalidate: an array with a
growable store no longer has a knowable length. Doing that cost **1.70x on
`benches/cases/growth-fixed`** — 157 µs to 265 µs, stable over three runs each.

The reasoning was circular. A store is *checked* because the length is not
exact; the length is not exact because a store is checked. Nothing was ever
proven, so every store in a pre-sized loop became a call and the array pointer
could no longer be hoisted.

**Growth only ever makes an array longer.** So `index < allocated` still implies
`index < actual` after an append — a bounds check may be eliminated against the
allocated length even when the array can grow. Only the *value* of `Length` must
be pessimistic.

Two predicates, and the split settles in one pass because only one of them is
about growth:

    allocated_length_is_a_floor    bounds elimination     unaffected by stores
    allocated_length_is_exact      folding `Length`       a checked store kills it

`growth-fixed`'s emitted `program.c` is now **byte-identical** to the one before
any of this.

## The benchmark that said 2.3x and was not measuring the program

`nts-bench` reported `growth-grown` at 626 µs before and 265 µs after — a 2.3x
improvement from a change that replaces one unsigned comparison with three
double comparisons. That is the wrong direction for the mechanism, and the only
difference in the emitted C is two lines.

Compiled with one driver, one set of flags, both `program.c` files:

    before   302.50 us/op
    after    286.35 us/op      same answer, 3.16e+09, from both

**Five percent, not 230.** The bench's figure was not a property of the emitted
program, and I would have reported a 2.3x win from a change that cannot produce
one.

`nts-bench does not follow the CLI` was already in my notes, in those words,
about a different failure of the same instrument. The rule that would have caught
it here is narrower and worth having: **when a measurement disagrees with the
mechanism, the measurement is the thing to check first.** A 2.3x win from a
costlier comparison was the tell, and it was visible before the driver was
written.

## Why it was not landed, which is the same circularity one level up

`cyclic-array` went one reference-counting operation and one collector candidate
above its `expected`. Its source has no indexed store at all — zero
`nts_array_slot` in its emitted C — so the cost is not the store. It is the
`Length` fold.

`flow` asks `allocated_length_is_exact` **during** the optimisation fixpoint,
before `eliminate_checks` has run. At that moment every store is still marked
checked, including the ones about to be proven, so the array literal `[first]`
looked growable and `listA.length` stopped folding.

The floor/exact split fixed the *bounds* half of the circularity because a floor
is monotone under growth. The *fold* half is not: whether a store can grow
depends on facts the fold is part of computing.

The rule that closes it is not "which stores are checked" but "which stores have
an index the facts allow to reach the length", asked where the facts are — at
the fold site in `flow.rs`, not in a predicate that only sees the function. That
is a contained change and it is not a five-minute one, which is why this record
exists instead of a commit.

## What the whole exercise cost, stated

Three A/B crossings, six benchmark runs, two rebuilds, and a hand-written driver
— for a change whose correctness took twenty minutes. The performance question
was the expensive half and it produced three results: the split, which the naive
version would have shipped without; the retraction of a 2.3x number I had already
believed; and a memory floor that said no to the whole thing after both.
