# 0126 — The optional chain materialises a tag at a join and tests it twice

The 1.9x this record's predecessor left unattributed is the lowering of `?.` and
`??`, and it is not this backend's.

`total + (h.fn?.(1) ?? 1)` emits, per iteration:

    181: invokevirtual Fn5__5.call:(D)D
    188: d2i
    191: iconst_2                        <- tag = NUMBER, on this path
    192: istore 26
       ... the other path stores tag = UNDEFINED ...
    198: iload 26; iconst_0; if_icmpeq   <- tag == UNDEFINED?
    217: iload 26; bipush 6; if_icmpeq   <- tag == NULL?

Both arms write a `(tag, payload)` pair into slots, join, and then the tag is
compared against two constants. On each arm the tag *is* a constant --
`iconst_2` is right there -- and it stops being one at the join, which is
exactly where the comparisons are.

The reference writes a null check and a call.

## Why this is not a backend gap

The C lane pays it too, and pays more:

    nts C     87.98 us   against C++'s 10.01     8.79x
    nts JVM   74.62 us   against Java's 35.21    2.12x

This lane is *better* relative to its own reference than the C lane is relative
to its. The shape is shared and it lives in the lowering, so a JVM-side peephole
would be a second answer to a question `hir::tags` already owns -- the thing
this codebase refuses to do.

## What was excluded first

The obvious suspect was the erased *field*: `fn?: (x: number) => number` makes
it hold an `NtsValue`, so every read is `getfield .ref` plus a `checkcast` where
the reference holds the function directly. Extending `unbox` to fields would fix
that, and it is the same move that took `widen` from locals to fields and won
`generator`.

    direct field   35.19 us
    erased field   38.40 us    1.09x

Nine percent, because C2 scalar-replaces the wrapper -- `bytes/op` is 0.00 --
so `.ref` is a register read and the tag test a compare against a constant. Not
worth a second encoding of absence in a backend with one bug's worth of history
distinguishing `null` from `undefined`.

## And a constant that decides two orders of magnitude

`run$whole` executes a `drem` per iteration, and by this morning's measurement a
`drem` costs about 5 ns -- which for 100,000 iterations would be 500 us against
a row that measures 74. The divisor here is **2.0**, a power of two, which C2
strength-reduces. `instanceof`'s reference divided by **3** and paid 956 us.

Same instruction, two orders of magnitude apart, decided by the constant. Worth
knowing before reading `drem` in a listing as a finding.
