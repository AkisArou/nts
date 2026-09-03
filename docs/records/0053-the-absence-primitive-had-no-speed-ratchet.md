# 0053 — The absence primitive had no speed ratchet

Auditing the queue against its two *measurable* ratchets — a `tooling/memory`
case and a benchmark row — found the nine primitives covered except one:

    number      number-to-string        number-format, loop, fib
    string      string-append, -build   strings, substrings, node-utf8
    absence     boolean-flags           --
    bigint      bigint-arithmetic       bigint
    symbol      symbol-keys             symbol-keys
    array       array-methods, -mutations   arrays, array-predicates, -mutations
    object      subclass-field, nulled-field    objects, dispatch
    closure     closure-capture         closures, dispatch
    Map/Set     map-and-set             map-and-set

`boolean, null, undefined` had correctness (`examples/absent`, twenty functions)
and memory (`boolean-flags`, zero and zero) and had never been timed. This is
that row, and it is the worst on the board against C++.

    absences   186.9ns C++   791.2ns nts C   837.4ns nts LLVM   801.3ns node

    4.48x C++    1.05x node    1.29x bun

## What the row asks

The three parts of the claim `examples/absent` makes, each against what a C++
programmer writes for it: `string | null` against a pointer that may be null,
`number | undefined` against `std::optional<double>`, and `T | null | undefined`
against a small tagged struct. Representation against representation, rather
than against a language with no absence.

## What it costs, measured

Instructions per operation, from `perf stat` over the operations each binary
reported:

    nts   14,280 per op   IPC 3.20
    C++    4,627 per op   IPC 4.18

Three times the work, so not a layout question. `objdump` says why:

    vector instructions   nts 45   C++ 149

C++ vectorised the loop and we did not. Its `optional` and its tagged struct are
PODs, so the conditionals become selects and four iterations go at once. Ours
are erased values built through block parameters, and `perf annotate` puts the
hot instructions at `cvtsi2sd` and `cvttsd2si` — an integer going into the
erased value's payload, which is a `double`, and coming back out again once per
iteration.

**V8 pays the same.** node is 801ns against our C backend's 791. This is not a
place we are behind a JIT; it is a place where a tagged sixteen-byte value
cannot be vectorised and a POD can.

## The fix, and a first answer that was wrong

The first version of this record said `hir::unerase` already had the conditions
and only the scalar case was missing. That is wrong, and the code says so.

`unerase` narrows an **array** whose element type is erased when
`single_representation` holds: *every* store into it erases a value of the same
representation `R`, so the element can become `R` and the tag can go. The
pattern here cannot satisfy that:

    held = cond ? undefined : i       // a block parameter, erased
    total += held ?? -1

The two incoming erasures are `ConstUndefined` and an `int32`. They do not share
a representation — that is what makes it a union — so the condition fails by
construction rather than by omission. Extending `unerase` to block parameters
would leave this exact shape untouched.

What the shape wants is a **split**, not an unerasure: one `bool` saying whether
the value is present and one `R` carrying the payload, with the absent edge
passing anything. Then `held ?? -1` is a select rather than a tag test, and a
select is what vectorises.

That is the "unions that lay out differently" item the goal lists under the type
layer, and it is a different pass from this one. Recorded with the wrong answer
left visible, because the wrong answer is the interesting part: the two look
alike from the call site and are not alike at all in what they need.

## What this says about the audit

The gap was invisible because the primitive's other two ratchets were green.
`examples/absent` is twenty functions and `boolean-flags` reads zero and zero,
and both are true — an absence on a reference really is free, and the case
really does allocate nothing. Neither of them can see that the *scalar* union
round-trips through a double once per use.

A primitive with two ratchets is not a primitive with three.
