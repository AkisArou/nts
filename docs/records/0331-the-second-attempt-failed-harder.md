# The second attempt failed harder than the first

Intersections are the refusal census's number two cause — 45 distinct things
across 15 modules. [[0310]] records the first attempt: take whichever member has
a concrete representation. It cleared 37 of 39 refusals and answered **wrongly**,
29 of 29 cases, because `"href" in v` makes a synthetic record whose layout puts
`href` at index zero while the value's own class put it elsewhere.

The second attempt looked like it had learned that, and was worse.

## The reasoning, which is the part worth reading

The hazard in the first attempt is a **field offset**. So take only a member
whose representation is *not an object* — `Uint8Array`, `DataView`, `Array` —
where there is no field to be at the wrong offset, because the read goes through
that representation's native accessor. Sound by construction.

And the corpus is full of them. Instrumented rather than assumed:

```text
36  Iterable & <anon>              20  InspectableObject & Error
16  <anon> & <anon>                12  InspectableObject & BigInt64Array
12  InspectableObject & Boolean    10  DataView & InspectableObject
```

**Signal 11, seventeen times.**

## Why

An **index-signature** type — `{ readonly [key: string]: unknown }`, which is
exactly what the corpus narrows through — is also not an object representation.
It is a *table*. The rule picked it, and the read went through a table accessor
on a value that is an ordinary class instance.

`Indexable & Tagged` has **no** object-represented member at all, so a test
phrased as "exactly one native member" selected the structural one while
appearing to exclude structural members.

## The two sentences, which are not the same sentence

The first attempt bought: *`in` answers whether a property exists, not where it
is.*

This one bought: **"not an object representation" is not a proxy for
"nominal".**

Both are the same wrong instinct — reaching for a property of the
*representation* to stand in for a fact about the *type* — and knowing the first
did not prevent the second. The counterexample was simply further away: the
first failed on a class with two fields ahead of the read one, the second needs
an intersection where *neither* member is object-represented.

**A cleverer rule has a more distant counterexample, and the distance is what
makes it feel safer.** The refusal count moved the same way both times.

## What the measurement did settle

The original conclusion stands: the narrowing has to establish a **layout**.
`v instanceof C` does, and a predicate returning `v is C` for a declared class
does.

New: that subset is **empty here**. Instrumented across `events`'s cone, no
intersection member carries `SymbolFlags::CLASS` — every named member is a
`lib.d.ts` interface, which is structural under a name and carries the same
hazard as `<anon>`. So the available subset is not small, it is nothing, and the
45 things behind this cause are all waiting on the same thing the census's
number *one* cause waits on: an interface's representation when both an object
literal and a class instance can be one.

Two causes, 93 distinct things, one missing mechanism.
