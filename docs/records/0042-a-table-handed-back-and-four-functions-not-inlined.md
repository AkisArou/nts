# 0042 — A table handed back, and four functions not inlined

Two rows lost to node: `map-and-set` at 1.54x and `node-utf8` at 1.22x. Both
win now, and neither needed a new algorithm. What they needed was a calling
convention that stopped paying for a reference nobody wanted, and four
functions the compiler had decided not to inline.

## The convention

`m.set(k, v)` evaluates to `m`, which is what makes `m.set(a, 1).set(b, 2)`
chain. A call's result was owned whatever it was, so `nts_map_same` retained on
the way out and the caller released what it had thrown away.

Almost every call site throws it away. A `set` in a loop is a statement, and
its value goes nowhere:

    v20 = nts_map_set(v2, v18, v19);
    ...
    nts_release((NtsHeader *)v20);

436,590 calls into `nts_release` on `benches/cases/map-and-set` — an eighth of
the program's instructions — to give back a table the caller had been holding
the whole time and went on holding afterwards.

`own::Summaries` already had the idea. `hands_back` names functions whose result
is one of their own parameters, and `classify` gives such a result
`Ownership::Borrowed` where the borrow is provably safe and `Ownership::Copied`
where it is not. It only ever contained the *program's* functions:
`hands_back_a_parameter` reads `program.funcs`, and the runtime is C.

So `RUNTIME_HANDS_BACK` names the seven that do it — `nts_map_set`,
`nts_set_add`, three `nts_array_fill` forms and two `nts_array_reverse` — and
the match arm that consults it grew `Callee::External` beside `Callee::Direct`,
because that is what a runtime call lowers to.

Adding a name there is half a change. The other half is that the callee has to
stop retaining, and the first attempt shipped only the first half: the count
went the other way and the table was freed under its own `set`. `nts_map_same`
and `nts_array_same` are one line each now, and the comments that used to argue
for the retain argue for its absence instead.

The retain was not wrong when it was written. It was covering a real crash —
`stringKeys` released the same `NtsMap` four times — and it is only removable
because the caller changed at the same moment.

## What the checkpoint was for

`runtime/c/tests/hashmap.c` failed immediately, which is the whole reason it
exists. It is hand-written C standing in for what the compiler emits, and it
had `nts_release(&nts_map_set(m, key, value)->header)` written out as the
convention it was mirroring, plus a check asserting `m->header.reserved == 2`
after a `set`. Both say the old convention in so many words. Both were updated,
and the check now asserts `1` — so the next person to change one end of this
learns it from a test rather than from a segfault.

## Four functions not inlined

`nts_hash_key`, `nts_key_eq` and `nts_map_find` are `static` and were not being
inlined; `nts_str_append` is external and was not being inlined across the LTO
boundary. Marking all four `always_inline`:

    map-and-set   8.06 -> 7.83   (hash and compare)
    map-and-set   7.83 -> 6.85   (find)
    node-utf8    35.70 -> 30.19  (append)

`nts_map_find` is the interesting one. It takes an `insert_at` out-parameter
and tracks a tombstone to reuse, and `get` and `has` pass null — so inlining it
folds that bookkeeping out of the two operations that run most often. A 12.5%
row from one attribute.

## Two smaller ones

`out += c` appends a string of length one, and the append called `memcpy` to
move it. That is a call into the C library's vector dispatch, which reads a
length, picks a strategy, and moves a byte: 494,776 calls to
`__memcpy_avx_unaligned_erms` on `node-utf8`, seven per cent of the program,
for 494,776 bytes of work. Spelled out as a store when the length is one.

`nts_round_up_pow2` ran the textbook five-shift smear on *every* append to
re-derive a capacity. `__builtin_clz` does it in two instructions, and the
machine has had the instruction since 2003.

## Three that measured nothing, and are not here

Recorded because the rate is the point: half of what was tried did not work.

**The hash in the index slot.** Each probe step is two dependent loads — the
slot, then `keys[at]` at a random offset — and putting a copy of the hash beside
the entry number rejects a mismatch without the second. It measured neutral to
worse. Cachegrind said why: the D1 miss rate is 0.6%. The table is L1-resident
at this size, so the load being avoided was already a hit, and the eight-byte
slot made `nts_map_set` write more. Reverted.

**A cheaper mix.** `nts_hash_mix` is murmur3's finalizer, two 64-bit multiplies
and three xor-shifts, on the critical path before a probe can start. Replacing
it with one multiply-shift took the row from 7.8us to **234us**, a thirty-fold
regression. Small integers as doubles have all-zero low words, so their entropy
sits high; the index takes the low bits of the result, and without the
xor-shift folds to bring entropy down there, every key lands in the same slot.
The two multiplies earn their keep. Reverted.

**Not counting an erasure of a scalar.** `nts_value_of_number(x)` cannot hold a
reference, so the retain and release emitted for it can never do anything. It
measured exactly zero on two rows: the tag test inlines, and a branch that is
never taken is predicted perfectly. Correct, unmeasurable, and reverted rather
than shipped — see `docs/records/0035`.

## The floor that was too weak

`tooling/memory/cases/map-and-set` came in *under* its ideal, which the harness
reports as a failure, and it was right to. The old `expected` ended by admitting
"the hundred and four is described rather than derived, and that is the weaker
half of this argument".

It derives exactly now, and the derivation is what the change was worth: fifty-one
`set` and `add` calls at one retain and one release each is a hundred and two,
plus one release each for the `Map` and the `Set` is a hundred and four — the
number the naive column still reports. Two remain.

A number nobody could justify turned out to be a number worth looking at.

## The three ratchets

**Correctness.** The full gate: examples agree with node, both backends, under
reference counting and without it.

**Memory.** `map-and-set` at 2 operations against a derived floor of 2, and 17
allocations against 17.

**Speed.**

    map-and-set   10.79 -> 6.85 us   1.54x node -> 0.98x   1.13x C++ -> 0.72x
    node-utf8     41.14 -> 30.19 us  1.22x node -> 0.91x
