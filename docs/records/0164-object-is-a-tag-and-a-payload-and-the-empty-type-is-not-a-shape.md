# `object` is a tag and a payload, and `{}` is not a shape

Two rows, 678 occurrences between them, and one wrong answer found on a lane
that is not this one.

    an `in` on something that is not an object, which JavaScript throws for
        334 occurrences, 67 sites — the most of any refusal in runtime/node

    a parameter of unrepresentable type (a structured type (flags 0x20000))
        344 occurrences, 36 sites

The flag is `TypeFlags.NonPrimitive`. Both rows are **`object`**, and it is
there because it is what `typeof value === "object"` narrows an `unknown` to —
so it is the type at the bottom of every duck-typing idiom in the profile:

    value !== null && typeof value === "object" && "message" in value

## `object` is erased

That is the whole of the second row. "Some object, which one is not known" *is*
a tag and a payload — the same representation `unknown` gets, in a type that has
ruled the primitives out. Nothing narrower is available, because the entire
content of the type is the absence of a guarantee.

Four lines, and 344 occurrences.

## `in` over `object` is the closed set, one set wider

`in` was already the right operation. `"k" in v` over a union is a comparison
against the arms that declare `k` — record 0089 — and the refusal was not about
the test but about the type: an open one had no arms to ask.

For `object` the candidate set is **every object type the program has**, by the
same closed-world argument. A compiled program gains no types.

The soundness comes from somewhere unusual and worth naming: `"k" in 5` throws
in JavaScript, and nothing here emits that throw. What makes the answer right is
that **the program has already proved the value is an object** — the `typeof`
guard is written one operator to the left, at every one of the 67 sites, because
a JavaScript programmer has to write it. So the licence is the *source's* proof
rather than this compiler's, which is why an unguarded `unknown` is still
refused: there the type says nothing and neither can we.

### Not every class

The first version asked `hierarchy.name`, which holds classes.

    "label" in { label: "l" }      nts: false     node: true

An object literal typed by an interface has a layout and no hierarchy entry. 20
of 29 cases, from a fixture written to check exactly this — the second time this
week a candidate set was built from the wrong table.

The set is now every id in the type table. That is coarse and cheap: an id no
layout claims names no object that can exist, so it contributes no comparison.

## What it refuses, and both refusals are the interesting part

**A key a natively represented type answers for.** `object` includes an array, a
`Map`, a `Set`, a `Promise` and a `Date`, and none of them has a layout to find
a name on — so a set built from the layouts answers *false* for them, and for
their own property names JavaScript answers *true*. `then` is the one that
bites: four sites ask it, and it is how every thenable test in the world is
written. A promise would have been told it is not one, and the differential
would have agreed with node on every case that did not happen to pass a promise.

**A key some type declares optionally**, at 165 sites. With the value typed
`object`, an instance of *any* type can reach the test — so a type declaring the
key optionally makes the question unanswerable in both directions: including it
answers true for a property never written, excluding it answers false for one
that was. The refusal names the type, because the fix is at the declaration and
"some class" points at nothing.

So the row went 334 → 309 and closed about 25 sites, which is a quarter of what
the raw count suggested. The 344 next door is the win, and the two arrived
together because the same type blocks both.

## `{}` is not a shape, and only the JVM could say so

    java.lang.ClassCastException: class nts.gen.Messaged
    cannot be cast to class nts.gen.Type117

`Type117` is `{}`. The checker narrows `unknown` to the empty object type after
`!== null`, and this compiler was **unerasing to it** — which is a claim that
the value *is* one of those, about a type no object belongs to.

`{}` is the checker saying *not null and not undefined*. It names no shape and
declares no member, so reading the payload through it buys precisely nothing in
exchange for the lie. It now declines to narrow to an anonymous object type that
declares nothing, and reads the tag instead.

On a lane with pointers the cast is unchecked and invisible: `nts check` on C
and LLVM agreed with node on all 377 cases with the lie in place. **Third time a
checked cast has been the only instrument in this repository that could see one**
— after the function-type layouts of 0096 and the erased-singleton scan the JVM
session found under `class-values` this morning.

The same run found the other half: `NTS4001 an instanceof against an unknown
class`. The C emitter resolves each class id to a layout and silently drops the
misses; the JVM refuses. **The JVM is right**, and the filter has moved into
`hir::drop_classes_without_layouts` so that neither backend needs an opinion —
which makes the C emitter's silent drop unreachable rather than load-bearing.

## Measured

    runtime/node   7,324 refusals  ->  6,895

Some rows went *up*: `instanceof` +41 and `unknown` narrowed to `BigInt` +34,
because code that now lowers reaches gaps further in. That is the expected shape
and the third time this session it has been worth saying.

## The memory case argued zero and measured 35

`tooling/memory/cases/duck-typed` was written with `message = "m"` and read **35
operations** against an argued floor of zero. Four controls, one line apart:

    a string field, no erasure          0
    a string field, erased, one class   0
    two classes joined, erased         26   <- the cause
    the same with no call at all       26

Neither the string nor the erasure nor the call. **The join**: two frame-placed
objects of different classes reaching one erased slot. The emitted C says why —
`nts_value_retain` on a value whose payload is `NTS_IMMORTAL` frame storage, the
object's field teardown moved to just after the erase, and a release in each arm
of the test. Every one is a no-op at run time and every one is a call.

That is record 0091's finding a fourth time, in a place `rc` does not look: it
has a frame rule for a *store* and none for an `Erase`. **Named work with a
26-operation reproduction**, and not this feature's — the shape predates it, and
`imported-instanceof` reads zero only because it joins two objects of one class.

The shipped case uses a number field and is 0 / 0, with the four controls in its
`because` so the next person does not have to find them again.

## Ratchets

- `examples/in-operator` — three exports added, 377 cases against node on C,
  LLVM, JVM and under counting: duck-typing against a class, against an object
  **literal**, and against a number, which the guard rejects before the `in`.
- `examples/unsupported` — `"then" in value`, which must stay refused.
- `compiler/core/tests/in_operator.rs` — four tests, three mutations. Asking the
  hierarchy fails the literal test; narrowing to `{}` fails the unerase test;
  dropping the native-key list fails the `then` refusal.
- `tooling/memory/cases/duck-typed` — 0 / 0, with the 35 and its four controls
  written down.
- **No benchmark row.** `in` over `object` emits `nts_is_class` — a tag test and
  a pointer compare, the same operation `benches/cases/instanceof` times, over a
  longer `||` chain whose length is a property of the program rather than of the
  feature. `object` as erased is a representation the erasure benchmarks already
  price: `erasure-typed` and `erasure-unknown` are exactly this value.
