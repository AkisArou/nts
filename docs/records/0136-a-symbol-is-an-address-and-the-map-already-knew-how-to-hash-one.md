# A symbol is an address, and the map already knew how to hash one

`docs/conformance/typescript.md` has carried this paragraph for a while:

> Representing it needs a symbol to *be* something at run time — a tag beside
> `NTS_TAG_OBJECT` and an interned cell whose address is its identity — and then
> `string | symbol` is an ordinary erased union.

That is exactly the design that landed, so this record is not about finding one.
It is about what the profile said the feature was worth, what it cost to give a
type a tag, and four mistakes that are all the same mistake.

## What it was worth, and why one property

The largest category in `runtime/node` was **393 sites** of *a property of
unrepresentable type (a union of `X` | undefined)*. Of those, **318 were one
property**: `EventEmitter._events`, typed
`Map<string | symbol, Registered | undefined> | undefined` and inherited by
every class that extends `EventEmitter`. One declaration, refusing 318 method
bodies.

The blocker was checked rather than assumed, by bisecting the type:

    Map<string, number>          lowered
    Map<string, A | undefined>   lowered
    Map<string, A | B>           lowered
    Map<string | number, V>      lowered
    Map<string | symbol, V>      refused

The union was never the problem and the erased value was never the problem. The
**`symbol`** was, and it was refused everywhere rather than in maps: `Symbol()`
was "a builtin this compiler does not provide" and `Symbol.for` "a global member
with no definition here".

    profile refusal sites   2170 -> 2043
    that category            393 ->   82

## The map needed no code

`nts_hash_key`'s heterogeneous arm already ended in

    default:
      return nts_hash_mix((uint64_t)(uintptr_t)nts_value_reference(key)) ^ 4u;

and `nts_key_eq`'s in `nts_value_reference(a) == nts_value_reference(b)`. For a
symbol those are not adequate fallbacks, they are **the specification**: identity
is the address, so hashing the pointer and comparing the pointer is what a
symbol key *means*. Two fallbacks written to be general, now load-bearing for a
type that postdates them — which is worth saying because a change making either
stricter would break symbols as map keys and nothing else.

## The tag, and the two orderings

`NTS_TAG_SYMBOL` goes between `FUNCTION` and `OBJECT`. That is the only slot,
and both constraints were prose in the header:

- outside `tag >= NTS_TAG_OBJECT`, or `typeof sym` answers `"object"` — the same
  reason `FUNCTION` sits below it;
- inside the contiguous reference range `STRING ..= OBJECT`, because a symbol is
  a reference and the tracer, retain, release and both emitters read that range.

**Nothing checked that the compiler's table and the runtime's held the same
numbers.** `hir::tags` opens by saying there are two copies and that the second
is unavoidable; no test compared them. The C backend is immune — it writes tag
*names* into the generated C — and the LLVM backend writes the number and links
the same runtime, so a disagreement there is a value that reads back as another
type, silently, on one lane. That check went in first, before the renumbering
that would have found it the hard way, and the orderings became `const`
assertions beside the table. The JVM session found a **third** copy in
`NtsValue.java` on the same day, and their own drift test then failed as a
fourth, because its expected list is hand-written.

## Four mistakes, and they are one mistake

**A wildcard answered for the newcomer, twice.** `spelling_of` ended
`HirType::Managed(_) => "object"`, so `typeof` on a symbol said `"object"` and
56 differential cases disagreed with node. Fixed, and then the *LLVM* backend's
`tag_of` did the same thing in its own file — C agreed and LLVM did not. The
comment directly above the second one already described the shape, about
closures, and `tooling/differential`'s `c_type` says it in general: *a default
that is right for its neighbours is wrong for the newcomer, and the newcomer is
exactly what nobody is looking at.*

**A promise that was nearly true.** `nts_symbol_for` carried `NTS_ALLOCATES`,
which is `__attribute__((malloc))` — the result aliases nothing. An **interning**
function exists to return the same pointer twice. The header's own comment had
already excluded the `_into` family for exactly this reason, and I had read it
that morning.

**A use-after-free that was not there.** The emitted C showed
`nts_release(v13)` on a symbol from `nts_symbol_for` with no matching retain, so
I diagnosed a premature free, retained in both helpers, and wrote a check for
it. `nts_map_get` and `nts_map_key_at` **retain before returning** — the
convention throughout, and what `own::produces_owned` assumes with no exception
for helpers. My fix was a leak. The tell was immediate once measured: seventeen
acquire-and-release cycles left the count at **twenty** rather than at one.

Reading the emitted C and concluding about where the retain lives is answering
from an artifact that does not carry the answer. The JVM session made the same
error the same day with `nts hir` against `nts hir --prepared`, and their
phrasing is the one to keep: **a correct answer to an adjacent question never
announces itself.** A stale artifact eventually contradicts something; an
adjacent one does not.

**A check that inspected the thing it was asking about.** The first version of
the ownership test read `first->header.flags` after releasing, and passed with
the bug in place — freed memory that nothing has reused reads back exactly what
it held. It takes two instruments and neither implies the other: `nts_live_count`
is outside the block and catches one retain **too few**, and cannot catch one too
many, because a leaked reference keeps the object live and the count is
identical; reading `header.reserved` catches the leak, and is safe only because
the live check established the object was not freed.

## Three more tables, and a generator narrower than the table it writes

A new `ManagedType` variant is a compile error in every exhaustive match, which
is the JVM backend's own comment working as intended — *"adding a variant
upstream is a compile error rather than a silent refusal"*. Six files, all
refusals except the C backend's. The N-API one has a reason worth keeping: a
symbol's identity is the address of a cell in **this** runtime, so handing one
across that boundary hands out an address the other side cannot reproduce —
`Symbol.for` over there is a different registry.

Then the LLVM lane declined every symbol call as *"a `static inline` and so
exposes no symbol for"*, which is a sentence about the runtime that was false.
There are **two** signature tables: `hir::runtime`, which the middle end reads
for argument conversions, and `codegen/llvm/src/signatures.rs`, which is
binary-searched and whose sortedness test already records that a missing entry
*"cost the LLVM column of a whole benchmark row, with a refusal message pointing
at the wrong file"*.

The second is generated, and regenerating it **deleted two entries**:

    - nts_str_to_lower_case
    - nts_str_to_upper_case

They are declared in `nts_unicode.h`, and the generator reads only
`nts_runtime.h`. So they had been added by hand — which is what "added three
rows too late" in that comment means — and every regeneration since would have
removed them. It removed them for me, and `examples/strings` failed on the LLVM
lane for the second time in that function's history, for the same reason,
against the test that documents the first time.

Fixed at the generator: it reads both headers, so the table is genuinely
generated and `NTS_REGENERATE=1` is safe. **A generator whose source of truth is
narrower than the table it generates is a trap that springs on whoever next has
a reason to run it**, and the person it sprang on had read the warning.

## A registry is not a leak, and the check could not tell

Under counting, `examples/symbol-values` reported *"held 0 objects after the
first case and 6 at the end, so 6 were never given back"*. The six are the
registry: one map, its block, two symbols and two keys.

The check's model is right and is written down where it is taken — *"whatever a
module sets up on the way to answering once is state it is entitled to keep, and
the question is only whether the rest of the run adds to it"*. `Symbol.for` is
one-time setup **per key**, so a second key used by a later function is growth
after the baseline. Bounded, intentional, and indistinguishable from a leak by
anything the checker could see.

So the runtime says so: `nts_permanent_count()` is what it holds for the life of
the process by design, and a leak check subtracts it while a "what is still
held" question does not. It is measured rather than enumerated —
`nts_live_count()` either side of the insertion — because enumerating it would
be a second copy of the map's own growth rule and would be wrong the first time
that rule changed.

## The benchmark harness had never called `module__init`

The first run of `benches/cases/symbol-keyed-map` disagreed with node: 32768
against 10240. Reproduced by deleting one line from a hand-written driver over
the same emitted C, and confirmed correct under three builds — NoGC at
`-O2 -flto`, `-O0`, and RC — all 10240.

Without module evaluation the five module-level symbols are **null**, so
`set(a..d)` writes one entry keyed by null and both lookups find it: 4 + 4 = 8 an
iteration against a mean of 2.5. And the answer is 10240 for *every* seed, since
`(i ^ step) & 3` visits all four keys in each block of four whatever the step —
which ruled out the driver's seed handling in one line of arithmetic.

`tooling/differential` calls `module__init`. `grep -rn module__init benches/`
found nothing, and the hand-written `nts.cpp` files it replaced did not call it
either. **No benchmark case had ever had module-level state whose
initialisation mattered**, so a missing call read as working code for 49 cases.
The JVM session found the layer under it — `module#init` is not exported, so
`Roots::Entry` had dropped it from the *program*, and adding the call gave a
link error rather than a working benchmark — and fixed both halves.

Worth naming: node evaluates on import and the JVM runs `<clinit>`, so **the C
lane was the only one that could be wrong here, and it was the only one nobody
had a reason to check.** Two lanes get it from the platform and the third has to
be told.

## The memory case, and the one that could not be written

    interned-symbol   naive 18   actual 18   ideal 18   alloc 18   floor 18

Argued before measuring and exactly right. Eighteen symbols, one release each,
and the argument is a list of what is **absent**: no description string, because
`Symbol()` with no argument has none and the absence is a null pointer rather
than an empty string; no registry entry, because `Symbol()` does not intern; no
table, because identity is the address and there is nothing to hash. An
implementation that did any of those would answer every program identically and
show up here.

The case that could not be written is the interesting one. Seventeen calls to
`Symbol.for("k")` allocate **nothing** in the measured run — the registry is
written during the harness's warm-up call, and a registered symbol is reachable
for the life of the runtime by the specification's own rule. But each call still
hands back an owned reference that is retained and released: five operations an
iteration against zero allocations, and the suite refuses that combination in
its own words —

    expected contradicts itself: 0 allocations cannot need 1 operations

— which is correct. **Eliding the count on a value the registry pins is named
work**, and it is what a `Symbol.for` case needs before it can exist. So the
interning claim is measured where it can be, in `runtime/c/tests/symbols.c`.

## The benchmark, and why it has no number yet

`benches/cases/symbol-keyed-map` times `Map<symbol, V>.get` — four keys and one
never inserted, so the miss path runs as often as the hit path, which is what an
emitter does. The claim is that a symbol key needs no hashing, so the references
are an `unordered_map<const void*, int>` and an `IdentityHashMap` rather than
string maps: a string-keyed reference would be measuring exactly the work the
row exists to say is absent.

Measured, on the rebuilt harness:

    case              C++       nts C     nts LLVM   Java      node       bun
    symbol-keyed-map  14.45 us  22.09 us  22.20 us   7.51 us   41.83 us   8.68 us
                                          nts/C++ 1.54x   nts/node 0.53x

**The claim holds against node and does not hold against C++ or Java**, and the
row is worth keeping for the second half rather than the first. We are 1.54x an
`unordered_map<const void*, int>` and 2.9x an `IdentityHashMap`, on a row whose
whole thesis is that a symbol key needs no hashing.

The thesis is not what is wrong. `NtsMap` is a *general* map: `nts_hash_key`
dispatches on the tag before it can mix a pointer and `nts_key_eq` switches on
the tag before it can compare one, so a `Map<symbol, V>` pays a dispatch on
every probe where `IdentityHashMap` **is** the identity case and compiles to a
compare. The absent hashing is real and the tag dispatch is eating it. That is a
measurement about the map's generality, it is the same shape as `map-and-set` at
1.88x, and it is named work rather than a defect in this feature.

The JVM cell reads `refused`, correctly: `runtime/jvm` has no `NtsSymbol`, and
`types::descriptor` declines by name rather than aliasing a symbol to `String` —
which would make two symbols of one description compare equal.

## Ratchets

- `examples/symbol-values` — 348 cases against node on C, LLVM and under
  counting, over 12 exports: fresh symbols differing, `typeof`, a symbol in a
  field, two symbols of one description as two map keys, a `string | symbol`
  map where a symbol and a string spelled alike are two keys, `Symbol.for`
  sharing and `Symbol.keyFor` answering, and a symbol with no description
  against one described as `""`.
- `compiler/core/tests/symbol_values.rs` — four tests, three mutations, each
  caught. The fourth test guards the shipped `symbol-keys` row against becoming
  a map lookup, and is itself checked by pointing it at a fixture that does make
  symbols.
- `compiler/core/tests/tag_agreement.rs` — the two tag tables, with the
  orderings as `const` assertions in `hir::tags`.
- `runtime/c/tests/symbols.c` — 31 checks. Mutating `nts_key_eq` to compare
  descriptions passes all of them, because the hash still separates by pointer
  and equality is never consulted; only the **coherent** wrong design, hashing
  and comparing by description together, is catchable. Written into the file
  rather than left looking stronger than it is.
- `tooling/memory/cases/interned-symbol` — 18 / 18, argued first.
- `benches/cases/symbol-keyed-map` — written, number pending.
