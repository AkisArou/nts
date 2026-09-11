# Positions that disagree are erased, not refused

    constructor(...given: [] | [input: string, base?: string | URL])

    NTS1001 a rest parameter whose element type has no representation

Record [[0282]] fixed the half where every position represents the same way and
filed the other half: `URL`'s holds `string` at one position and
`string | URL | undefined` at the other, and no concrete element is both.

There is one that is neither: **erased**. The general representation is what a
tagged value is for, the call site erases each argument into the array, and a
read at a constant index comes back through the tag. Agreeing positions keep
their concrete element and pay no tag test, which matters — an erased array
costs about 11% against a typed one, all of it the per-element test.

## Four things stood between that idea and a program

**A latent bug in `hir::unerase`, found by the first probe.** A rest parameter
of `unknown[]` produced `CallArgumentType { expected: Array(Erased), found:
Array(Managed(String)) }` — invalid HIR, caught by the verifier and by nothing
else. `narrow_arrays` retypes an erased array whose stores all erase the same
representation, guarded by escape analysis; it checks the uses of *reads* and
never checked the uses of the **array**. A call argument is one: the callee's
parameter is declared `[erased]` and cannot be renegotiated from the caller.

Escape analysis did not stop it and should not have. An array a callee only
reads *is* frame-local — a true statement about aliasing that says nothing about
a signature. Two questions, and the pass was asking one.

**`names_a_property` asked the checker rather than the value.** After
`given.length === 0` returns, the checker narrows `given` to the remaining
tuple — an *object* type — so `given[0]` asked for a member named `0` and got
``\`0\`, where an array has only `length` ``. True about the value, produced by
consulting the type. Where the value is already in hand it decides: an index
into something held as an array is an element, whatever the source type narrowed
to.

**`element_of` already had a heterogeneous-tuple branch, and it was a cast.**
A tuple whose slots are references agrees on width, so restoring the declared
type is `Convert`. A tuple-union rest whose positions disagree is an array of
`NtsValue`, and the same branch emitted `v17 = (NtsString *)v16;` — ``operand of
type 'NtsValue' where arithmetic or pointer type is required``. One branch, two
storage shapes, one of them a cast.

**And the unerase had to be licensed.** `coerce` refuses an erased value where
something concrete is wanted, rightly. The license here is the same *kind* it
accepts for an upcast and stronger than a narrowing: position `k` is declared
once per arm, `gather_rest` erased exactly the argument written there, and every
arm that has a `k` agrees about it. Asked of the position rather than of the
access node, because under `noUncheckedIndexedAccess` the access type is
`T | undefined` and represents to nothing — which is why a *scalar* position
fell through the existing branch entirely.

## What moved

`url.ts:41`, `:56` and `:73` — `URL#constructor`, `URL.parse`, `URL.canParse` —
no longer refuse at their signatures. The constructor now stops one link along,
at `new URLSearchParams()`: `an omitted argument for a parameter with nowhere to
put \`undefined\``, which is `searchparams.ts:161`'s unrepresentable union seen
from the call side.

**So `fileURLToPath`, `fileURLToPathBuffer` and `pathToFileURL` still cascade,
and `url` publishes the same one name.** The cone moved one link. Said that way
because [[0283]] recorded the same claim being wrong at four rungs in one
evening.

## Three sabotages, three different guards

    no Erased fallback        ledger 0 -> 5; the differential said
                              "agreed on every case"
    no Unerase on a position  backend declined 2 functions
    unerase pass unfixed      invalid HIR: CallArgumentType

The first is [[0281]]'s pair once more: removing the fallback makes the
functions *refuse*, they leave the comparison, and agreement over the survivors
reads as green. The third is the only defect of the three that no fixture would
have caught — the verifier is what stands under it, and it is why a pass that
retypes a value has to account for every consumer of that value rather than for
the ones it rewrites.
