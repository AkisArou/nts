# 0041 — A table the instrument could not see

The queue's ninth and last primitive. It had correctness and neither of the
other two ratchets, and building them found a stale claim, a hole in the
measuring apparatus, and the worst row on the board.

## Representation

A real hash table, and the conformance table said otherwise.

    | ✗ | a hash table — what `Map`, `Set` and `Object`'s enumeration statics need

That row was stale. `nts_map_find` is open addressing with linear probing over a
power-of-two slot array, with tombstones for deletion and the keys and values
kept in insertion order beside the index — which is what makes iteration order
the specification's without a second structure. `Object`'s enumeration statics
turned out not to need one at all: `keys` and `hasOwn` are answered from the
layout.

Corrected to ✅, because a stale mark is how a false premise reaches a goal.

## The hole

`nts_map_rehash` takes its three blocks — keys, values, slot index — from
`malloc` rather than `nts_alloc`, deliberately: a table reallocates as it grows
and the bump provider cannot give a block back. What that cost was a **count**.

`nts_note_allocation` carries this comment:

> One place, so a fifth allocator cannot arrive and be counted by one of these
> and not the other. Objects, arrays, strings and maps all come through it.

A map's *header* came through it. The three blocks holding its actual contents
did not. So `tooling/memory`'s allocation column read **2** for two containers
of any size, and could not have read otherwise — a check that cannot fail, in
the column that exists to catch exactly this. The bytes were already tracked a
few lines below; only the count was missing.

Counted now, and paired with `nts_reclaimed` at **both** free sites — the rehash
and the destructor — because `nts_live_count` is `allocated - reclaimed` and an
unpaired increment reads as a leak on every grown table.

    map-and-set   2 allocations -> 17

Seventeen exactly, and derivable: growth doubles from a floor of eight, so
seventeen entries means capacities 8, 16 and 32 — three rehashes each, three
blocks for a `Map` and two for a `Set`, plus a header apiece.

## A process failure, recorded rather than hidden

The floor is supposed to be argued *before* measuring. The suite prints its
measurements when `expected` is absent, and `expected` was absent because the
case was new — so the numbers were on screen before the argument existed.

The seventeen is derived above independently and matches. The hundred and four
operations are *described* rather than derived, and the `expected` file says so.
That is the weaker half of that case and it is labelled as such.

## Speed, and we are behind

    map-and-set   10.77 us   C++ 9.45 us   node 6.95 us   1.14x C++   1.55x node

The worst row on the board. Unlike `bigint`, this is not a representation that
gave something up for a measured win: `std::unordered_map` and V8's `Map` are
both real hash tables, so ours is simply slower than one of them.

Profiled first this time, with the `gprof` that record 0035 found too late:

    20.51%  nts_hash_key    60,960,000 calls
    17.95%  nts_map_set     23,040,000
    15.38%  nts_map_find    46,440,000
     7.69%  nts_value_release 69,120,000
     7.69%  nts_map_get      7,680,000
     2.56%  nts_value_retain 61,440,000

Spread, with no single fix — the same shape `node-utf8` has. One targeted change
suggested itself: 130 million retain/release calls on a table whose keys are
numbers, where both do nothing but test a tag. Guarding them on the map's key
kind **moved the number not at all**, because clang inlines the tag test across
the translation unit already. Reverted, by the rule that deleted `0027`'s
inliner and `0039`'s caller redirect.

`nts_hash_key` at 20% over 61 million calls is where a real attempt would start:
it is called more often than `find`, because `set`, `get` and `has` each compute
a hash before probing and a rehash computes one per live entry.

## Operations

The refusals are element types rather than methods:

    a base `Map` of unrepresentable type                     77
    a property whose type is `Map<..., Set<...>>`            36
    a `new Set` with contents, which needs the iteration protocol  12
    a base `Set<string>` of unrepresentable type             10
    `WeakMap` with no recorded arguments                      6

`Map<K, V>` is representable exactly when `K` and `V` are, so most of these are
other primitives' gaps seen through a table — the same shape as the 273 array
sites in `0038`.
