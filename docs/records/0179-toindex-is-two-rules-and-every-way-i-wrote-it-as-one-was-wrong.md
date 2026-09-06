# `ToIndex` is two rules, and every way I wrote it as one was wrong

`ArrayBuffer` had no representation at all. It is `ManagedType::Buffer` now, on
the terms this enum already applies to `Date` and `Symbol`: one fixed runtime
struct, no element type that varies, so no payload to carry. What varies about
a buffer is its length and whether it is resizable, and both are runtime state
— `ArrayBuffer` is one TypeScript type whether or not `maxByteLength` was
passed, so a parameter declared `ArrayBuffer` may be either and the type cannot
say which.

The bytes are a separate allocation rather than a tail. A view must not be
invalidated by its buffer changing length, and a resizable buffer reserves its
**maximum** at construction so the block's address is stable for the buffer's
whole life. `resize` then moves a length and nothing else, and a view never has
to re-read where the bytes are.

## Three bugs, none of which I found by reading

`ToIndex` is *truncate toward zero*, then *range-check the result*. Written as
one rule it is wrong three different ways, and each one survived the reasoning
that produced it.

**One.** `(size_t)byte_length` on a legal input. `new ArrayBuffer(-0.5)` is an
empty buffer in the language — `-0.5` truncates to `-0` — and the cast is
undefined behaviour for a negative double. It asked for
9,223,372,036,854,775,808 bytes and aborted. I had written a safe conversion in
the plan for this change and then not used it.

**Two.** Comparing the length against the maximum before truncating either.
`0 > -0.5`, `0.5 > 0` and `3.7 > 3` are all true, and none of those comparisons
is one the language makes: it compares 0 with 0, 0 with 0, and 3 with 3. Three
shapes node accepts were refused.

**Three.** Truncating with `trunc` and comparing. `trunc(NaN)` is NaN, every
comparison with NaN is false, and `new ArrayBuffer(1, { maxByteLength: NaN })`
stopped throwing the `RangeError` node raises — the *quiet* direction, where a
missing throw is a missing answer rather than a wrong one.

The fix is one helper, `nts_to_index`, used by the comparison **and** by the
allocation size. They disagreed once already; sharing the rule is what stops
them disagreeing again.

## Allocation failure is an answer

Node raises `RangeError: Array buffer allocation failed` where the machine
cannot give the memory, and that is a different sentence from `Invalid array
buffer length` on purpose: one is what the specification refuses and the other
is what this computer could not do. So `nts_buffer_make` returns null rather
than aborting, and the lowering turns the null into the throw.

Node's own boundary between them is not a constant — it was 54,800,031,720
bytes here, and it is however much memory is free. A compiler cannot match a
number that moves, so this implements the rule and lets the allocation be the
allocation.

The bytes are allocated **before** the struct, so a failure has nothing to
unwind. Allocating the struct first and bailing out afterwards leaks it and
leaves `bytes_held` counting a buffer nobody can reach — `nts_live_bytes`
reporting a program that failed cleanly as one that leaked.

## The example catches everything, and its sizes are bounded

Every case is wrapped in `try`/`catch` and returns the error's class. That is
record 0175 from the other side: an uncaught throw ends the process and every
case after it goes unasked. Uncaught, this file checked **36 of 754**; catching,
it checks **841 of 841**, and the class is itself an answer that gets compared.

The sizes are capped at 4096 and the *rule* boundaries pass through untouched —
`NaN > 4096` is false, so NaN still means zero; `-1.5` still throws. What the
cap removes is the part that measures the machine: the pool holds 2^31 and
2^32-1, and node answered 2^31 correctly on its own while raising `Array buffer
allocation failed` for the same input inside the suite, because by then it had
allocated a dozen more. Both sides would be flaky and neither would be wrong.

## The memory case was argued and then measured

**17 operations, 34 allocations**, written down before running: two allocations
per buffer because the struct and the bytes are separate, and seventeen
reference operations because a value that lives and dies inside one block is
already the shape the elision wants. Measured: 17 and 34.

The number the case exists for is the seventeen being *there*. A buffer escape
analysis placed in the frame would read zero operations, look better, and never
reach `nts_free` — so `nts_free_storage` would never run and every `calloc`
block would leak. No answer the program computes would change; only the leak
check would see it.

## No benchmark row, and the reason

`benches/**` belongs to the JVM session, and there is nothing here worth asking
them for yet. A buffer is allocated and its length is read; the operations that
would be worth timing are element accesses, and those belong to the views this
change is the foundation for. A row now would measure allocation, which
`tooling/memory` already prices exactly.
