# The probe annotated a local where the corpus passes a parameter

Row 2024 — `for await...of` over an `AsyncIterable` — read green for an
afternoon, and the reason is worth more than the row.

## The probe that lied

Three arms, in a scratch package, to find out whether the row was still true:

```ts
for await (const v of counted(n & 3))                    // over the call
const source: AsyncGenerator<number> = counted(n & 3);   // through a type
const source: AsyncIterable<number> = counted(n & 3);    // through the supertype
```

Only the third is the row's claim, and all three compiled. So the row looked
already-true — the eighth of this session's ✗ rows to be narrower than stated,
and I nearly filed it as a ninth.

Then the same three arms went into `examples/an-async-generator`, where the
existing shape is a **parameter**:

```ts
async function drain(g: AsyncGenerator<number>): Promise<number>
```

and the refusal came straight back: `a parameter of unrepresentable type
(AsyncIterable)`.

A local annotation still has its **initialiser**, and the initialiser carries
the concrete generator type for the walk to read. The annotation is decoration
there; it constrains the checker and tells the lowering nothing it did not
already have. A parameter has no initialiser, so the declared type is the only
thing the representation can come from. My three arms differed in *position* as
well as in annotation, and I read the annotation.

The discipline this breaks is that a probe arm must differ in one thing, and
this is its second instance in two days. What makes it hard to see is that the
local form is the one you naturally write when you are probing a *type*: the
shortest program that mentions `AsyncIterable` at all is a local. The corpus
writes parameters because that is what functions are.

## What the row actually is

Two causes, not one, and only the second is the corpus's:

| parameter type | refusal |
|---|---|
| `AsyncIterable<number>` | a parameter of unrepresentable type (`AsyncIterable`) |
| a user-named interface | a `for...of` over `NumberStream` |

The first never reaches the walk: lib.d.ts's `AsyncIterable` has no
representation, so the parameter is refused before the body is read. The second
is representable — an ordinary object type — and the **walk** is what has no
case for it. That second one is `zlib`'s `transform(source: AsyncByteStream, …)`
and `stream`'s operators, and of the 38 `for await` sites in `runtime/node` the
ones not over a call are over a value whose declared type is an interface.

It also shrinks the work: the synchronous half is row 2007, green, through
`Walk::Protocol`. So this is an async counterpart to a walk that exists.

`blockers/an-async-walk-over-a-declared-interface` carries both arms and the
warning about the local.

## The row underneath, which has no row

Row 2023 — `for await` over a **synchronous** sequence — is refused on purpose:
its notes say approximating it with a plain `for...of` would get the elements
right and the interleaving wrong. But the correct lowering is available in
principle, since `for await` over an array is the sync walk with an `await` on
each element, and `await` is machinery this compiler has.

It is not available in practice:

```
an `await` of something that is not a promise is not supported by this lowering yet
```

So 2023 sits on a smaller and more general row — awaiting a plain value — and
**that row is not in the ledger at all**. Not ✗, not ◐, not deferred: absent.
Three `await` rows exist and all three are ✅.

The standing finding that a census by message is blind to obstacles that emit no
message has a mirror image here. This refusal *has* a message; the **ledger** is
what is blind. The gap was reachable only by following a recorded row down to
what stops it, and a census over the ledger's own rows could never produce it,
because the row does not exist to be counted.

The general row is the one to build. Awaiting a plain value is more general than
`for await` over an array, and closing it closes the row above it as a
consequence rather than as a second piece of work — which is the same shape as
every other time the narrower derivation turned out to be asking the general
question.
