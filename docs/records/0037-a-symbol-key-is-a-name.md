# 0037 — A symbol key is a name, and a symbol value is a feature

The queue's fifth primitive, and the one where the conformance table's `✗` is
misleading in both directions.

## Representation

There are two questions here wearing one word.

**A symbol used as a key** has no runtime representation at all, and that is the
right answer rather than a missing one. `const kRefed = Symbol("refed")` at
module scope is *one* symbol, known where it is written, so `[kRefed]` is a
field with an unusual name — TypeScript spells it `__@kRefed@2` — and it is laid
out beside `plainRefed` in the same struct. Reading it is a load at an offset.

The match is on the description, because the checker's id does not survive into
the snapshot, and two symbols sharing one description on one type is refused
rather than guessed.

**A symbol used as a value** has no representation either, and that one *is* a
gap. `NtsValue` could carry it — it is a tag and a reference — but there is no
`NTS_TAG_SYMBOL` and no cell whose address is an identity.

## Operations

Keys work: read, write, beside a plain field, through a call, in one layout.

The value form is refused, and this is what it costs:

    a union of `string | symbol` in a parameter        292
    a property of type `string | symbol`                25
    a function returning `symbol`                       21
    `string | symbol | undefined` in a parameter        17

`PropertyKey` is `string | number | symbol`, so it turns up wherever node's
sources touch a key generically. **355 sites**, the largest single number this
audit has found — sixteen times `BigInt`'s twenty-two.

It is still a refusal with a reason rather than an oversight. Making
`string | symbol` representable means giving a symbol a runtime identity: a tag
beside `NTS_TAG_OBJECT`, a cell whose address distinguishes two symbols with the
same description, `typeof` answering `"symbol"`, and `Symbol.for`'s registry.
Then the union is ordinary erasure and needs nothing new. That is a feature, and
naming it as one is the point of counting it.

## The two ratchets

**Memory.** `tooling/memory/cases/symbol-keys`, at `ideal 0` / `allocated 0`,
with both spellings written on every iteration of one loop. The thing that would
falsify "a symbol key is a field" is a property map, and a hash lookup
allocates where a field does not.

**Speed.** The `symbol-keys` row, and its comparison is unusual: the interesting
one is *within* the row rather than against another language.

    symbol-keys   308.3 ns   C++ 301.4 ns   node 1.61 us   1.02x C++   0.19x node

The C++ reference is a plain struct with four fields, two per spelling. Being at
parity with it *is* the claim `typescript.md` makes — a symbol key costing
exactly what a named field costs — and the two halves of the loop do not
separate. Node is 5.3x slower because V8 keeps symbol-keyed properties out of
the object's shape; we keep them in it.

## The row measured constant folding twice first

Written with `for (round = 0; round < 512; round++)` and a running sum, it
reported **1.9ns against node's 325** — clang had found the closed form and
computed the answer at compile time. Making the trip count depend on the seed
was not enough; a sum still has a closed form. It took a dependent chain
(`(count * 31) ^ round`) before the loop had to run.

That is the third time this session a benchmark measured the optimizer rather
than the program, and the tell is always the same: a number too good to be true,
against a node figure that did not move.
