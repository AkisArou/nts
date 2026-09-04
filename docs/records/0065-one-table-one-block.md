# 0065 — One table, one block

`map-and-set` read **17 allocations** for two containers, and its `expected`
argued the number carefully and correctly from the code as it stood:

```text
Map   1 header + 3 rehashes x 3 blocks = 10
Set   1 header + 3 rehashes x 2 blocks =  7
```

and then said "fewer is possible only by being told the size in advance, and
nothing tells it". The first half was right and the second half was not looking
at the right thing.

## The three blocks were always one table

`nts_map_rehash` allocated the keys, the values and the slot index with three
separate `malloc`s. They are the same table: allocated together, freed together
in both free sites, and never one without the others. Nothing was buying the
separation except the code having been written that way.

One block sliced three ways:

```c
size_t key_bytes = (size_t)wanted * sizeof(NtsValue);
size_t value_bytes = map->holds_values ? key_bytes : 0u;
size_t index_bytes = (size_t)slots * sizeof(int32_t);
unsigned char *block = malloc(key_bytes + value_bytes + index_bytes);
```

`keys` first, so the block's base is what `free` is given. `NtsValue` is sixteen
bytes and `wanted` is a whole number of them, so `values` and then `index` are
aligned by construction rather than by padding.

    allocations   17 -> 8
    map-and-set   5.30us -> 5.16us,  0.76x node -> 0.74x

Eight is `1 + 3` twice, and it is the floor for the same reason seventeen was:
growth doubles from eight, so seventeen entries means three rehashes. A `Set`
now costs what a `Map` does in *count*; what it still saves is the block's
*size*, which `nts_bytes_held` sees and the allocation column does not.

## What the case did, and what it did not

The case is why this was findable at all. Before it, `nts_note_allocation` was
called for a map's header and not for the blocks holding its contents, so the
column read `1` for a table of any size — 0041 fixed that and wrote the
seventeen down.

But a floor argued from the code is a floor that inherits the code's
assumptions. This one said "three blocks a rehash" because there were three, and
the sentence that followed — fewer needs the size in advance — is true only of
the *capacity*, not of the block count. The suite caught the change the moment
it landed: `BELOW allocation floor -- the argument in expected is wrong`, which
is exactly what a ratchet should say when the thing it measures gets better.

The lesson is narrow and worth keeping: an argued floor proves the number is not
an accident, not that it is the best available. Those are different claims and
this case's `expected` made the first and read like the second.
