# A function type is a signature, and shape cannot tell two of them apart

Every `Fn` layout is empty. A function type is a signature rather than a class,
so `layout_of` builds it with no fields, no methods and no base — and
`collect_layouts` merges by `same_shape(fields, methods, base)`.

So all of them were one layout. `examples/function-values`:

    FNLAYOUT Fn8 types=[8, 10, 11, 32, 36, 44, 45, 54]
             keys=[([2],2), ([2],2), ([2],2), ([2],30), ([2,2],2), ([2],2), ([2],2), ([2],2)]

**Eight type ids, three different signatures, one layout.**
`(number) => number`, `(number) => void` and `(number, number) => number`
sharing a single `NtsObj_Fn8`.

That was harmless for as long as nothing dispatched through a function type. It
stopped being harmless this afternoon.

## How it surfaced

The JVM session prototyped closure bases — a closure's layout naming its
function type as its base, plus an `abstract_declaration` in that type's method
table so there is something to dispatch to. Three examples that had never
compiled on their lane started agreeing with node. A fourth did not:

    NTS4009 `Closure9.call` is `(D)V` where the method it overrides is `(D)D`

Their diagnosis was `unerase::narrow_returns`, which excludes dispatched
functions and would not have known these closures were now dispatched. It is a
good hypothesis and it is wrong: that pass only touches functions whose
`return_type` is `Erased`, and `Closure9`'s is `Void`. Neither `(D)V` nor `(D)D`
is an erased return, which is what made me check instead of agreeing.

Instrumenting the relation printed the table above in one run. Their matching
code was correct throughout — there was only ever one candidate for it to find.

## The fix, and why it belongs beside the error classes

`collect_layouts` already carries one exception to shape:

> The provided error classes are the exception, because they are the one family
> this compiler asks a *nominal* question about. All four hold a `message` and a
> `name` and nothing else, so shape merged them into one layout with one
> descriptor.

Function types are the second, and for a sharper reason: the error classes have
a shape and it happens to be shared, while a function type's shape is **empty**.
There is nothing for `same_shape` to be right or wrong about.

Two changes:

**A signature layout is named by its signature.** `Fn2__2` is `(a) => b` and
`Fn2_2__2` is `(a, b) => c`. The double underscore is load-bearing — joining
with one would make those the same string. Parameter type ids, then the
return's, and an `A` for an async signature.

**`collect_layouts` refuses to merge two differently-named signature layouts**,
exactly as it refuses two differently-named error classes.

The naming does the work that matters. Two ids for one *written* signature
render to one name and merge — which they must, because an arrow's inferred type
and the declared type of the slot it is stored into are two ids over one
signature, and a store between them needs one layout. Two different signatures
render differently and stay apart. That is the distinction `same_shape` cannot
make about a shape with nothing in it.

The emitted C says it plainly now:

    typedef struct NtsObj_Fn2__2  NtsObj_Fn2__2;    // (a) => b
    typedef struct NtsObj_Fn2__30 NtsObj_Fn2__30;   // (a) => void
    typedef struct NtsObj_Fn2_2__2 NtsObj_Fn2_2__2; // (a, b) => c

## What this was, in the terms I had been using

I have been refusing to give closures a base since this morning, on the grounds
that the same structural type can be two ids — `layout_of` names an anonymous
type from whichever id a builder saw first, and `Type17#step` against
`Type14#step` is what reverted object-literal methods. I said I would not build
on it until there was a naming authority.

**The actual bug was the mirror image.** Not one type with two ids, but two
types with one layout. The direction I was worried about turned out to be
handled; the direction I was not is what bit. And the fix is a naming authority
after all — for the one family where the structure is a signature the checker
has already interned, so the name can be computed rather than invented.

## Instruments

This is the clearest case yet of the thing the JVM session and I have been
cataloguing. **No instrument on this lane could have found it.** All 98 examples
agree on C before and after; the memory suite is green before and after; the
corpus reads `invalid HIR 0` either way. A pointer to a `Closure9` is a pointer
to an `Fn8`, and C has no opinion about whether that is a lie.

The JVM's `NTS4009` is the only thing in the repository that could say so, and
it exists because a class file must name what a method overrides. Reverting the
signature naming reproduces it exactly, which is how the mutation is checked.

## Ratchets

- `compiler/core/tests/signature_layouts.rs` — four tests, two mutations. Naming
  by type id again fails three of them **and** reproduces the JVM's NTS4009;
  dropping the merge guard fails one. The second test is the half a naive fix
  breaks: one written signature must still be one layout however many ids the
  checker gives it.
- `examples/function-values`, `closures`, `absent` and `module-functions` — all
  four now agree with node through the **JVM** backend, where three of them had
  never compiled. 98 of 98 unchanged on C.
- No new example, and the reason is the finding: a fixture that fails without
  this change cannot be written on this lane. The instrument is the other
  backend.
- No benchmark row: the emitted C differs only in the names of structs nothing
  reads.
- No memory case: no allocation, no counting, and the suite is green either way.
