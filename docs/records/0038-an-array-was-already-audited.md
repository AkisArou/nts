# 0038 — An array was already at its floor, and the gaps are not its methods

The queue's sixth primitive, and the first that is genuinely *managed* —
allocated, reference-counted, escaping. All three audit questions have
substantive answers rather than "it is a machine value", and all three ratchets
were already standing before this audit began. The rule for that case is
explicit: closed by one measurement, not assumed.

## Representation

    typedef struct NtsArray {
      NtsHeader header;
      uint32_t capacity;   /* what the block holds */
      void *elements;      /* header.length is what it *does* hold */
    } NtsArray;

`elements` points just past the struct until something grows the array, so a
fixed array keeps its contents next to its header and reads them with the same
locality. What that costs is one load, and the load is loop-invariant — clang
hoists it out of any loop that does not call something which could grow the
array, which is most loops.

Element width is a decision rather than a default: `hir::elements` narrows what
an array holds when every store puts a small whole number in, which is what lets
a `switch` over one become a jump table and halves the memory besides.

## Operations, and what is actually missing

Not the methods. The profile's array-shaped refusals are dominated by things
that are not `Array.prototype` at all:

    a property of unrepresentable type (an array type)      273
    ArrayBuffer / ArrayBuffer.isView / SharedArrayBuffer     137
    Array.isArray of a value whose type is open               50
    a rest parameter that is not an array                     48
    `buffer`, where an array has only `length`                40
    Array.from                                                33

The first is an array whose *element* cannot be represented, and cascades from
other gaps rather than from arrays. The rest are `ArrayBuffer` and the reflective
globals.

The methods that are refused are refused on **typed** arrays, and for a stated
reason rather than for want of writing them:

    includes 17, set 11, slice 9, pop 7, unshift 6, push 6, subarray 1, map 1

The runtime's helpers read a block at one width — `nts_array_index_of` takes a
`const double *` — so handing a `Uint8Array` to one reads pairs of elements as a
single value. `hir::elements` refuses to *narrow* an array that reaches a helper
for exactly this reason, having been caught by a benchmark that returned -512
for 4864; this is the same rule from the other side. Fixing it means a helper
per width, or compiling each method as a loop the way `forEach`, `map` and
`reduce` already are. Only one of those 58 sites wants a method that is already
a loop, so reordering the check buys one site and is not the fix.

## The three ratchets, measured rather than assumed

**correctness** — six examples, all agreeing with node: `arrays`,
`array-references`, `growable`, `typed-arrays`, `typed-array-subclass`,
`typed-array-subclass-methods`.

**memory** — four cases at both floors. `array-of-objects` at 18/18 and
`guarded-push` at 18/18 are the allocating shapes; `loop-break` at 16/16 is the
one that leaves early; `global-array` at 0/0 is the one that never allocates at
all.

**speed** — three rows, every one ahead of node:

    arrays          1.38 us   C++ 1.32 us    node 2.47 us    1.05x C++   0.56x node
    array-methods   1.24 us   C++ 2.34 us    node 5.73 us    0.53x C++   0.22x node
    elementwise      193 us   C++  143 us    node  910 us    1.35x C++   0.21x node

`array-methods` is *faster than the C++ reference*, which is what compiling
`forEach` and `map` as loops buys over `std::` algorithms through a lambda.
`elementwise` at 1.35x C++ is the widest gap to the floor any array row has, and
it is the one place further array work would start — but it is 0.21x node, so it
is not where the mandate points.

## Why this record exists at all

Because "already done" is a claim, and the queue's own rule is that a primitive
at its floor is *closed by one measurement, not assumed*. The measurement is
above. What the audit changed is not the code but what is known: the array
method surface is adequate for the profile, and the gaps behind the word "array"
are `ArrayBuffer`, reflection, and element types that belong to other primitives.
