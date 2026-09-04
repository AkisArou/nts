# `in` is `instanceof` with a different question

`"radius" in shape` was refused, and the ledger said why: *"needs a decision
about an optional property, whose slot exists here and not in JavaScript."*
That decision is real and is still refused. It was not what stood in the way.

224 source sites in `runtime/node` across 41 files, which is the largest single
language-feature refusal there. It is closed for a literal key, and the whole
implementation is one lowering function.

## The design that was not needed

The first plan was a property-name table in the descriptor: names in rodata
beside the reference map, `property_count` and `property_names` appended to
`NtsDescriptor`, and a `nts_has_property(obj, name)` walking them. It would have
been an ABI change in three backends, a runtime helper, and a string comparison
per test.

It would also have been answering a question the compiler already knows the
answer to. **Which types declare a property is static.** The only thing not
known at compile time is *which of them the value is* — and there is already an
operation for that:

    InstanceOf { value: ValueId, classes: Vec<TypeId> }

`instanceof` computes `classes` from the hierarchy: `C` and everything that
extends it. `in` computes it from the property: every arm of the operand's type
that declares the name. Same operation, same three backends, nothing new
anywhere.

So the lowering is a partition. Take the operand's static type, split a union
into arms, and ask each arm whether it declares the name:

- **Every arm does** — constant `true`.
- **No arm does** — constant `false`.
- **Some do** — `InstanceOf` against exactly those.

## Two things the shape gets for free

**The operand is still evaluated.** `in` has no short circuit, and the constant
cases would otherwise drop a call. `"nope" in look(n)` is false whatever `look`
returns and `look` still has to run — `examples/in-operator` counts the calls
through a module-scope variable and compares the count with node.

**An earlier test makes a later one cheaper**, and this was not designed, it was
discovered by a test failing. `chained` has three arms and asks `"duplex" in s`
then `"read" in s`. `read` is declared by two of the three, so the second test
should name two classes — and it names one. After the first test is false,
TypeScript has already narrowed `s` to the two arms that remain, and only one of
those declares `read`. The set comes from the **narrowed** static type. The
assertion was written as `[1, 2]` from the un-narrowed union, failed, and that
is the only reason this is written down.

## What it refuses, and why both are about the key

**An optional property.** This is the ledger's decision and it stands. An
optional property holds `T | undefined`, and a fresh allocation is zeroed, which
is already the `undefined` tag — a representation that is right for reading the
property and wrong for asking whether it is there. JavaScript distinguishes `{}`
from `{ limit: undefined }`: `"limit" in` the first is false and in the second
is true. Here they are the same object. A presence bit separate from the tag
would answer it; that is a layout change for a question no site in the profile
asks.

**A computed key.** Without the name there is no set to compute, and answering
it needs exactly the descriptor table this design avoids.

Both refuse **by property name**, which is the part worth insisting on.
`"label" in o` is supported on the same object whose `"limit" in o` is refused,
and `examples/in-operator` has that pair. A refusal reading "`in` is not
supported" would say the feature is absent when one property of one type is.

A third arm — `in` on something that is not an object — is defensive and cannot
fire from well-typed source: `"a" in v` where `v: Fixed | number` is
`TS2322 Type 'number | Fixed' is not assignable to type 'object'`, so the
checker refuses it before the lowering sees it.

## What the sites actually needed

The `runtime/node` sites are duck typing —
`"pipeThrough" in value && isFunction(value.pipeThrough)` — and I expected `in`
alone not to unblock them, because the narrowing afterwards has to produce a
representable type. A probe before building anything said otherwise for the
union case: `Reader | Writer` narrowed by `in`, with each arm reading its own
field, refused **only** on `in`.

It said the other thing too. The same probe on a genuinely `unknown` value
refuses on more than `in`, and a union whose arms share a property refuses with
"`shared` on a union, whose members lay their fields out differently". So this
closes the discriminated-union half and not the duck-typing half, and the second
half is waiting on things that are not `in`.

## Measured

    case            C++       nts C     nts LLVM   node       nts/C++   nts/node
    in-narrowing    1.51 us   1.49 us   1.59 us    10.55 us   1.05x     0.15x

The C++ reference maintains a `Kind` tag by hand and switches on it, which is
what a C++ programmer writes and is the fair bar in both directions: the tag is
storage the TypeScript does not spend, because the shape is already
distinguishable by its descriptor; and the switch is a jump table where a
descriptor test is a comparison chain. 1.05x says those roughly cancel at three
arms.

Memory, floors argued in `expected` before the run and met exactly:

    in-narrowing   naive 34   actual 0   ideal 0   100%   alloc 0   floor 0

Seventeen shapes built and dropped inside the iteration that made them, and a
test that reads a descriptor pointer and compares it takes no reference and
gives none back.

## The ledger

One row closed, one added, so the count is unchanged at 41 — and the trade is
worth stating rather than hiding. What went is `in`, whole. What arrived is `in`
naming an optional property or with a computed key: narrower, about the key
rather than the operator, and covering none of the 224 sites the closed row
covered.

## Ratchets

- `examples/in-operator` — 232 cases against node on C, LLVM and under counting:
  narrowing both directions, all-arms and no-arms constants, a single type, a
  required property beside an optional one, an operand with an effect, and a
  three-arm chain.
- `compiler/core/tests/in_operator.rs` — four tests, three mutations, each
  failing a different one: naming every arm rather than the declaring ones,
  dropping the operand of a constant answer, and treating an optional property
  as always present.
- `tooling/memory/cases/in-narrowing` — 0 / 0.
- `benches/cases/in-narrowing` — 1.05x C++, 0.15x node.
