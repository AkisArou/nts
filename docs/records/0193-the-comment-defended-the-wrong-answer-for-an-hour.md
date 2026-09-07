# 0193 — The comment defended the wrong answer for an hour

`Array.isArray(x)` where the checker leaves `x` open had been refused for as
long as the compiler has had the call. The refusal was unusually good: it named
its cause, said the runtime test had been built and measured rather than merely
not attempted, and said exactly what closing it would take.

> **Not for want of a runtime test.** The test is available and was built: an
> erased value carries a reference tag, a header carries a descriptor, and
> `NtsDescriptor::kind` already separates an array from an object. It was
> written, and then measured against the thing it would have to answer.
>
> What blocks it is that `number[]` and `Float64Array` are **one representation
> here** [...] Closing it means carrying the distinction into the HIR type,
> which is what `ManagedType::Array` deliberately does not do.

`ManagedType::View` landed that morning and does. So the refusal became false a
few hours after it was written, and stayed on the site for the rest of the day.

It was not found by reading the compiler. It was found in another session's
build log, listed as one of five roots under a refused `ERR_INVALID_ARG_TYPE`
constructor — which is to say, by the consequence rather than by the cause.
Record 0185 is about an annotation ageing and 0190 about a rule stated in one
place; this is the third shape, a refusal outliving its reason **by hours**
rather than by months, in a compiler whose own record says to distrust one that
nobody has re-checked.

## The tuple, and a comment that read as an argument

The runtime test is a descriptor kind: `NTS_KIND_ARRAY` is an array,
`NTS_KIND_OBJECT` is not, and a typed array is an object named `TypedArray`.
That is exactly the line node draws, and the first version of this change tested
it and was wrong.

    Array.isArray([1, "a"])                     node: true
    const open: unknown = [1, "a"] as [number, string];
    Array.isArray(open)                         we:   false     (29 disagreements)

A heterogeneous tuple is laid out as a **struct**, because its elements have
different types, and the language calls it an Array.

What makes it worth a record is what had already been written about it. The C
header carried this, in my own hand, an hour old:

> A tuple is the one case the kind cannot answer, and it does not come here: the
> checker knows a tuple statically, `Array.isArray` folds to `true` for it at
> compile time, and its layout is a struct that would answer `false`.

Both premises are true. `Array.isArray` does fold for a static tuple, and a
tuple's layout is a struct. The conclusion does not follow, because the fold
happens at the **call site's** static type, and `const open: unknown = pair`
makes that `unknown`. The reasoning was written down, it read as sound, and it
was worth nothing until a program ran.

A comment that argues is more dangerous than one that asserts. An assertion
invites a check. An argument invites agreement, and this one had a premise, a
mechanism and a conclusion, which is what made it convincing to its author
twice — once when writing it and once when reading it back while writing the
code it was wrong about.

`NTS_KIND_TUPLE` is the fix: a kind that manages no storage and behaves exactly
as `NTS_KIND_OBJECT` at all three sites in the runtime that switch on a kind —
each tests MAP, BUFFER or ARRAY and falls through — and exists so that one
question can be answered.

### And one exception that had to be stated rather than found

The kind comes from the layout's generated name, which makes tuple names
*nominal* — the family record 0192 had just generalised. But tuples are the one
member that is nominal in one direction only: two tuples of the same shape
**must** merge, because the checker hands out more than one id for one written
tuple type, and blocking that emits two identical structs and then refuses to
pass one where the other is wanted. So the guard is `is_tuple(a) != is_tuple(b)`
rather than membership in `nominal_name`.

The JVM session's reading of this is the one worth keeping: on a lane with
descriptors a bad merge gives one object the wrong kind, and on a lane without
them the two layouts become **one class**, so there is no runtime field left to
disagree with and no test of the descriptor can see it.

## A conversion that was covered by accident

Writing the case the whole change exists for — `Array.isArray` of a `Uint8Array`
in an `unknown` — turned out to be impossible: erasing a `View` was refused,
twice, once by the lowering's whitelist and once by the C backend's.

Both lists enumerate the managed types that can be erased. A typed array was in
both while it was `ManagedType::Array`, by accident, and left both the moment it
got a variant of its own. Nothing noticed for a day, because nothing needed the
conversion until a feature did.

The two backends differ here and the difference is instructive rather than
settled. C enumerates; LLVM's `tag_of` ends in `HirType::Managed(_)`. The
wildcard was right this time and its own comment records being wrong twice
before — closures answered `"object"` to `typeof` and `examples/absent` read 42
where node reads 45; symbols did the same and `examples/symbol-values`
disagreed on one lane and agreed on the other. So:

  - the enumeration fails **loudly and late** — a refusal, at the first program
    that needs the conversion, possibly long after the change;
  - the wildcard fails **silently and early** — a wrong answer, immediately, at
    every site.

Neither is safe alone, and the pair is why a representation change has to be run
on both lanes. Three instruments each caught exactly one thing when `View`
landed; this is the fourth thing, and it took a fifth.

## What to take

A refusal ages, and it ages fastest when it is *good*. This one named its cause
precisely enough to say what would falsify it — and that same precision is what
let it be read, for the rest of the day, as an argument that had already been
checked.

Write the falsifier next to the refusal, in the imperative: *when a typed array
gets its own `ManagedType`, delete this.* A cause a reader has to re-derive is a
cause nobody re-derives.
