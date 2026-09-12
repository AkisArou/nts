# The load count could not tell ownership from redundancy

The JVM lane found a redundant load in `benches/common/awfy-som.ts`:

```text
  ours  15 units                    reference  13 units
    iput v0, Random.seed:I            iput v0, Random.seed:I
    iget v2, v2, Random.seed:I        return v0
    return v2
```

`this.seed = …; return this.seed;` goes back to memory for a value computed two
instructions earlier. A store-to-load forward within a block is the fix, and
they were explicit that it is **not a benchmark row**: they had counted the
pattern across the whole program and found two sites.

I built it, and then measured what it removed across the corpus:

```text
util      1066 -> 931    -135   (13%)
buffer     124 ->  68     -56   (45%)
timers     167 -> 142     -25   (15%)
```

Two hundred and sixteen loads. I had already written those percentages into the
fixture, and I had privately concluded the two-site estimate was low.

## What the gate said

`memory`, alone among sixteen steps:

```text
subclass-field   naive 17   actual 17   ideal 0   0%   17 ops above
```

That case had been at **0 allocations, 100% eliminated**. Its own comment,
written long before any of this, is about exactly the change I had made:

> the read of `b.left` *takes*: the slot is overwritten before anything else can
> reach it, so the reference moves out rather than being copied, and the store
> that overwrites owes nothing

Forwarding a load of a **reference** is *correct* and costs allocations. The
forwarded value is a second live reference at the moment of the overwrite, so
the store now owes a release and the object can no longer live in the frame.

**Nothing else moved.** 195 of 195 examples agreed, `rc` agreed, all three
backends agreed, 728 tests passed. The answer was right the entire time and only
an allocation count could see it.

## The number, restricted to what it may soundly do

```text
no pass          util 1066    buffer 124    timers 167
forwarding all   util  931    buffer  68    timers 142
scalars only     util 1064    buffer 124    timers 167
```

**Two loads in `util`, none in the other two.** Of the 216 removed, 214 were
references it must not touch — and the two that remain are exactly the count the
lane that reported it had given me. The JVM lane then measured its own side
independently and landed on two as well.

## The currency, a third time

[0310](0310-thirty-seven-refusals-cleared-and-the-answer-was-wrong.md) was a
refusal count that could not tell an unnecessary refusal from a protective one.
This is a **load count that cannot tell a redundant load from one carrying
ownership**, and it moved by sixty times more than the truth in the same
direction as the truth, which is what made it credible.

The pattern in all three cases: a cheap aggregate moved a lot, the movement
belonged to something other than the thing being measured, and the aggregate had
no field for the distinction. The check is not "is the number big" but **"what
would this number look like if I were wrong in the way that matters here"** —
and for a count of removed operations, being wrong looks exactly like being
right, only more so.

## What only one lane can see

The JVM lane cannot check this class of change and said so: under a tracing
collector there is no retain, no release and no frame placement, so a forwarded
reference is a free `getfield` removed and there is nothing to count. Had that
pass been written on that lane it would have been correct there, gated green
there, and wrong here with no instrument on that side able to say so.

So **anything touching ownership is gated on the reference-counting side**, and
the `memory` suite is not a nicety — it is the only instrument in the project
that can observe a class of defect the differential is structurally blind to.
