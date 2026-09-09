# The descriptor knows the width and not the kind

`indexing an array of any` is the widest root on the board and it blocks the
nearest module. Both lanes traced it independently to one expression:

    errors.ts:533  ->  inspectValueWithin  ->  inspectValue
                   ->  ERR_UNKNOWN_ENCODING#constructor
                   ->  StringDecoder#constructor

and, through `ERR_OUT_OF_RANGE`, `ERR_INVALID_ARG_VALUE` and
`ERR_SOCKET_BAD_PORT`, to `validateInt32`, `validateInteger`,
`validateNumberRange`, `validateUint32`, `validateArray`, `validatePort` and
their dependents -- **16 distinct functions within `os`'s cone alone**.

I built it, ran it, and backed it out. This is why.

## The argument, which is right up to the last step

`Array.isArray(v)` narrows an `unknown` to `any[]`, and `any` has no
representation. The **length** is readable: it is in the header every reference
carries, so reading it through the tag is sound for exactly the value the guard
proved, and that landed. The **elements** were refused because an element has a
width and the type does not say what it is.

But the descriptor says. `NtsDescriptor` carries `size`, the element width in
bytes, and `references`, which is 1 when the slots hold pointers. That is
everything an address needs. And the tag -- the harder half, because a reference
array does not say whether it holds strings or objects and `typeof` must answer
differently -- comes from the *element's own* descriptor kind, which is the only
place that fact exists.

So the read is dynamic rather than impossible. I wrote `nts_array_element`,
lowered to it, and it emitted.

## Where it fails, and it fails silently

    probe([7, 8, 9])   ->  length 3, first element `undefined`

The literal emits `nts_desc_int32_t`: **element size 4**. My switch handled 16
(an `NtsValue`), 8 (a `double`), 1 (a `bool`) and references, and fell through
to `undefined` for the commonest array in the corpus.

Adding a `size == 4` arm does not fix it, and **my first reason for that was
wrong**. I wrote that four bytes is `i32` or `f32`. It is not: `width_for`, the
only thing that chooses an array's element storage, returns
`HirType::Int { signed: true }` at **32 or 64 bits and nothing else**, and
`Float32Array` is a `View` rather than an `Array`, so `Array(Float { bits: 32 })`
is unreachable. Four bytes is unambiguously `i32`.

**The ambiguity is real and it is at eight bytes.** `nts_desc_double` and
`nts_desc_int64_t` are both `size == 8, references == 0`, and 64 bits is exactly
what `width_for` picks for an array whose values leave the `i32` range and stay
inside the safe integers. Reading an `int64_t` slot as a `double` is not a
rounding error, it is a different number.

So the conclusion stands and the width does not: the descriptor keeps `size` and
`references` and not the kind, and **eight bytes is `f64` or `i64` with nothing
at run time to tell them apart**. That the default storage is the ambiguous one
makes it worse than the version I first described, not better.

Found by the JVM lane asking a question rather than accepting the claim: on
their lane a `number[]` is always a `double[]` -- there is no `NtsArrayI` -- so
they asked whether the tag should be NUMBER regardless of the width this lane
chose, and whether the field would therefore be recording a representation
decision rather than a language fact. The tag *should* be NUMBER either way. The
**value** cannot be read without knowing which.

The `name` field holds `"int32_t[]"`, so the fact is *recorded* -- but reading
it means a string comparison per element access, and a stringly-typed
discriminator in the one place the runtime must not guess is not an answer.

## Why it was backed out rather than narrowed

A dynamic read that answers `undefined` for an `i32` array is a **wrong answer
where the refusal was honest**. That is worse than the gap: the refusal sends a
reader to the feature, and `undefined` sends them nowhere while satisfying every
check that asks only whether the program compiled.

It is the same trade as three other things this session. A `Map` predicate that
answered true for a `Set`. A binding published as `undefined` because its
initializer was excised. A prototype refused with a better message and the body
still emitting the assignment clang rejects. Each time the loud failure was the
useful one.

## What it needs, stated so the next attempt starts here

**An element kind on the descriptor.** One field, four or five values --
reference, `NtsValue`, double, integer-of-width, boolean -- set where
`element_descriptor` already picks the name from the C type, and read by one
runtime helper. It is a representation change: the C backend writes the
descriptors, the LLVM backend shares them, and the JVM lane has its own array
classes, so it wants their agreement before it is written rather than after.

Everything above it is already built and measured: the length half landed, the
tag-from-the-element half is written and correct, and the lowering site is known
to two lines. What is missing is one fact the descriptor never recorded.

## And the thing that found it

Running the program. The emission was correct, the fixture would have passed an
`emits-c` assertion, and the C compiled and linked. `probe([7,8,9])` answering
`4003` instead of `1003` is the only instrument in the chain that could tell the
difference, and it is the same instrument that caught `Map` answering `Set`
and `lastChar` failing `.equals`.
