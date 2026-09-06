# 0156 — A key built to be compared and thrown away

*Built, measured, and **reverted**. The prediction below was written before
the measurement and the measurement is at the bottom; it is worse than the
prediction's worst case, and the reason is the interesting part.*

`map-and-set` is 1.85x hand-written Java. Its standing entry in this session's
goal says the cause is that *"`NtsMap` keys through `Double.valueOf`, which has
no cache, into a `HashMap<Object,Integer>` boxing the slot"* — and that has been
false for some time. `NtsMap` is open-addressed over `NtsValue[]` with the hash
cached in the bucket word and no `HashMap` in it anywhere.

What is true is one word of the old sentence. It boxes.

## Eight an operation, and four of them for nothing

`javap` on the emitted class, before:

    8  NtsValue.ofNumber(D)     per specialization

The case does `seen.set(i*7, i)`, `marks.add(i*3)`, `seen.get(i*7)`,
`marks.has(i*3)`, `seen.has(i*7+1)` and `seen.set(i*7, total)`. Every numeric
key crossing the boundary is built into an `NtsValue`, handed to a helper that
reads its `num` field, and dropped.

`NTS_BENCH_ALLOC=1` says 65,952 bytes an operation against the reference's
52,864. An `NtsValue` is 32 bytes and the case does 253 rounds: 2,024
constructions is 64,768, which is the whole of what the row allocates.

**Four of the eight are lookups.** `get`, two `has`, and the overwriting `set`
need no object at all — the slot they are looking for either exists, in which
case the key is already in the table, or it does not.

## What was built

`NtsMap` gains `getNumber`, `hasNumber`, `setNumber` and `addNumber`, taking the
`double`. `setNumber` and `addNumber` build a key **only to insert one**; the
overwriting case, which is a whole loop of this benchmark and the common shape
in a table that is filled and then updated, builds nothing.

Two things are shared rather than copied, because the failure mode of not doing
so is silent:

- `hash(NtsValue)` **returns** `hashNumber(value.num)` for a `NUMBER` key. A key
  looked up by its `double` has to land in the bucket the boxed one was stored
  in, and two spellings of the same arithmetic would show up as a lookup missing
  a key that is there — only for the values where they disagree.
- `find(NtsValue)` routes a `NUMBER` key into `findNumber`, so there is one
  probe loop for numbers rather than two drifting ones.

The backend part is a set computed once in `body.rs`: an `Erase` of an `f64`
whose **only** reader is one of those four helpers, in the key position. Such a
value gets no slot and `operation` does not emit it; the call site pushes what
it was erasing. The single-use test is the whole of the safety — an `Erase` read
anywhere else is built exactly as before, because then the boxed value is wanted
rather than immediately unwrapped.

The analysis and the call site read **one** table, `numeric_key_helper`. A
disagreement between them is an erasure skipped and then wanted, which is an
empty slot, or one built and then ignored, which is the allocation this exists
to remove.

## After, statically

    8  NtsValue.ofNumber(D)  ->  2

The two that remain are the *values* in `seen.set(i*7, i)` and
`seen.set(i*7, total)`. Those are stored in the table and have to exist.

Every example that builds a `Map` or a `Set` — `absent`, `array-from`,
`iteration`, `map-and-set`, `tuples`, `unsupported` — agrees with node on every
case through this backend.

## The prediction

Allocation should fall from 65,952 bytes an operation to about 16,500. At
young-generation rates that 50 KB is roughly half a microsecond against a gap of
four, so **the allocation alone does not explain the row and removing it will
not close it**: 1.85x to about 1.6x is what the arithmetic supports.

If it comes in much better than that, the construction was costing more than its
bytes — a boxed key is also a pointer chase in the probe, and removing it lets
the comparison read a `double` the caller already had in a register. If it comes
in at 1.85x, the allocation was free and this change measured nothing, which
would be worth as much and is the reason the number goes in this record either
way.

---

## Measured: 1.85x became **2.08x**, and the allocation barely moved

    jvm/Java        1.85x  ->  2.08x
    bytes/op       65,952  ->  57,760      (predicted ~16,500)

Both wrong, and in the same direction, from one cause.

**The allocation I was removing was already being removed.** Expected saving was
1,012 constructions of 32 bytes — 32,384 — and the measured saving is 8,192,
which is 256 objects: about one site's worth out of six. The substitution did
fire; `javap` shows eight `ofNumber` becoming two.

So most of those keys were never allocated in the first place. `NtsMap.get` is
small, C2 inlines it into the caller along with `find`, `hash` and `sameKey`,
and a key that goes no further than those is scalar-replaced — exactly what
record 0149 measured on five other rows and what I did not think to check on
this one. **The bytes counter said 65,952 and I read that as "the keys", when
it was the keys *the table keeps*.**

**And the change bought a second probe.** `setNumber` finds the slot, and on a
miss calls `set`, which finds it again. `addNumber` the same. The first loop of
this case is 253 inserts and every one of them now probes twice. That is the
0.74 us.

## What it is evidence of

The prediction said: *"If it comes in at 1.85x, the allocation was free and this
change measured nothing, which would be worth as much."* It came in at 2.08x,
which is that finding plus a bill.

The rule this repository keeps is that a reverted change with a written reason
beats a kept one that measured nothing. This one measured *worse*, so there was
never a question — but the reason is worth more than the revert. **The
allocation counter tells you how many bytes survived, not how many objects the
program wrote down.** Six of eight `ofNumber` calls in this row are free, and
the only way to know which is to remove one and see whether the number moves.

The goal's standing note on this row is still wrong in the way it was wrong
before: there is no `HashMap` in `NtsMap` and it does not key through
`Double.valueOf`. What is left of `map-and-set`'s 1.85x is unattributed, and it
is not the boxing.

