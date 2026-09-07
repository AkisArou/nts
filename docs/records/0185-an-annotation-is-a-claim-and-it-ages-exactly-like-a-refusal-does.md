# 0185 — An annotation is a claim, and it ages exactly like a refusal does

A refusal is a claim about what the compiler cannot do, and this repository has
learned to distrust one that nobody has re-checked: half of `finally across an
await` had been working for a commit and the refusal still covered it.

An **attribute** is the same kind of claim, pointed at the optimiser instead of
at a reader, and it fails in a worse way. A stale refusal costs a feature that
already works. A stale attribute is a promise the compiler is entitled to act
on, so the source stays correct and the *binary* stops being.

Four this week, in two families.

## `NTS_ALLOCATES` promising a pointer that can be null

    #define NTS_ALLOCATES __attribute__((malloc, returns_nonnull))

`nts_buffer_new` carried it, and then learned to answer null: node raises
`RangeError: Array buffer allocation failed` where the machine cannot give the
memory, so the runtime returns null and the lowering turns that into the throw.

`returns_nonnull` makes the caller's null check **dead code by the compiler's
reading**. The guard that produces node's answer is entitled to be deleted, and
nothing in the source looks wrong. There is an `NTS_ALLOCATES_OR_NULL` without
it now, and the LLVM table says `noalias ptr` rather than `noalias nonnull ptr`
for the same reason.

## `NTS_READS_ONLY` promising purity of a function that retains

    #define NTS_READS_ONLY __attribute__((pure))

`nts_dataview_buffer` and `nts_view_buffer` returned the buffer a view sits on.
Every other helper that hands back a managed reference hands back an **owned**
one — `nts_array_at_ref` retains before returning — and these two did not. The
caller releases what it is given, so `view.buffer` dropped a count it had never
been given: the buffer was freed under the view still pointing at it, and
`new DataView(view.buffer).getUint8(0)` read memory that had gone back to the
allocator.

**The second half is the one that matters.** Adding the retain and leaving the
attribute would have looked fixed. `pure` lets the compiler fold two calls with
the same argument into one, so `a.buffer` twice becomes one retain against two
releases — the same premature free, arriving only under optimisation. A fix
that is right in the source and wrong in the binary is exactly the shape
reading cannot catch.

## Only one lane could see it

Under `Provider::NoGc` nothing is ever freed, so a borrowed return and an owned
one are indistinguishable and the program is correct by accident. `llvm-rc` is
the only place this could show, and it showed as one example falling 115 to
114.

That is the third instrument this week whose value was *discrimination* rather
than coverage: the checked-cast backend seeing type lies that C compiles
happily; `Uint8ClampedArray`'s exact halves separating half-to-even from
`Math.round`; and reference counting separating a borrow from a transfer. **An
instrument that can tell two rules apart is worth more than a bigger corpus
that cannot.**

## And writing it down demonstrably worked

The JVM session checked the rest of their `DataView` patch after the first
report and found their annotations correct everywhere else — including
`NTS_ALLOCATES_OR_NULL` on the two constructors, which they reached for
*because the previous instance had been written down*. One error, and it was
the one instance nobody had recorded yet.

That is the argument for the records being worth their cost, in the one form
that is hard to fake: the next person did not repeat the mistake that had been
written down, and did repeat the one that had not.

## The rule

Every attribute in `nts_runtime.h` is a claim about the function underneath it,
and the function can change without the claim being re-read. When a helper
learns to fail, to retain, to allocate or to touch anything it did not touch
before, **the attribute is part of the change** — and `runtime::READS_ONLY`,
`erases_class`, `erases_result` and the LLVM signature table are all the same
claim written in four more places, which is why three separate tests exist to
make them agree.
