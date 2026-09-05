# 0119 — Two refutations on map-and-set, and the second was my own transcription

`map-and-set` is **2.19x** hand-written Java and the goal has listed it as known
and unacted-on for weeks, with a diagnosis attached: *"`NtsMap` keys through
`Double.valueOf`, which has no cache, into a `HashMap<Object,Integer>` boxing
the slot."*

That diagnosis is stale -- `NtsMap` is an open-addressed table with a `long[]`
index caching the hash, not a `HashMap` -- but the boxing half looked live:
`bytes/op` said **65,952**, and `javap` showed `NtsValue.ofNumber` at every call
site, twice per `set`.

## The first refutation cost five seconds

The reference is `HashMap<Integer,Integer>`, which boxes too. So:

    java reference   52,864 bytes/op
    ours             65,952 bytes/op

**1.25x.** Java allocates an `Integer` per key and per value, allocates almost
as much as we do, and is still 2.19x faster. Allocation is not the gap.

I was one command away from rewriting a 327-line data structure -- with
deletion holes, insertion-order cursors and SameValueZero -- to remove boxing
that the thing beating me also pays.

## The second refutation was a bug in my own instrument

Next hypothesis: the hash clusters. I transcribed `NtsMap.hash` into a probe
harness and measured **72.64 probes per insert** against an int hash's 1.00, and
79 distinct low-9-bits out of 253 keys. Damning, and I wrote a replacement and
measured it at 1.56.

The transcription stopped one statement early. The real function continues:

    h *= 0x7feb352d;
    h ^= h >>> 15;
    h *= 0x846ca68b;
    return h ^ (h >>> 16);

With the whole function: **1.43 probes**, 194 distinct low-9-bits. The hash was
already fine, my "fix" was marginally *worse* than what it replaced, and the
finding was an artefact of modelling the subject instead of reading it.

This is the third time in two days that a model of the thing was wrong where the
thing was right, and the second time today: the `int, check` cell of a 2x2 that
widened its index through an implicit conversion, and now this. **When the
subject is available, measuring a copy of it is a choice, and it is the wrong
one.** The probe harness could have called `NtsMap.hash` by reflection.

## What the profile actually says

`async-profiler`, `event=cpu`, which is the tool the goal lists and which I had
not used all day:

    20.15%  NtsMap.hash
    19.72%  NtsMap.set
     9.49%  NtsMap.rehash
     6.93%  Program.table$whole
     5.86%  NtsMap.find
     5.33%  NtsMap.sameKey
     4.26%  NtsMap.append
     4.16%  NtsValue.ofNumber

The hash is 20% not because it collides but because **it costs** --
`doubleToLongBits`, a switch on the tag, two 32-bit multiplies -- where
`Integer.hashCode` is `return value`. And `rehash` reuses the cached hash from
the bucket cell already, so its 9.5% is allocation and reinsertion.

**No single item is the row.** The map is about 2x Java's `HashMap` per
operation, spread evenly across hashing, probing and storing. There is no
mistake here to correct; there is a data structure to beat, which is a different
kind of work and should be budgeted as one rather than started on a hunch.

So this row stays open with a number and a profile attached, and without a
change I cannot attribute.
