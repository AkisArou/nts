# 0016 — A value with no facts is a value nothing can specialize

Typed arrays landed and the benchmark written to show them off ran at **2.36x
the C++ reference and slower than node**. The feature was correct — 292
differential cases agreeing — and it was slow for a reason that had nothing to
do with typed arrays.

## What the measurement said

`bytes` is Adler-32 over 4096 bytes, sixty-four times. Its inner loop is two
`% 65521`. The emitted C:

```c
v58 = fmod(v56, v87);
v61 = fmod(v59, v88);
```

Two library calls per byte, half a million of them. `fmod` is the general
floating-point remainder; the program wanted `%` on an `int32_t`, which is one
instruction.

`hir::specialize` already knew how to do that. `BinOp::Rem` is in the list of
operations it will move into integer arithmetic, and it declines only when it
cannot *prove* both operands whole and in range. It could not prove it here, and
the reason was three passes upstream.

## The cause

A typed array's element is narrow and every expression around it is `number`, so
lowering emits an `OpKind::Convert` between them. `hir::flow` had no transfer
function for `Convert`. It fell to the catch-all and produced `TOP`.

So every byte read was an unknown number, `a + data[i]` was unknown, `a` was
unknown on the next iteration, and the modulo that could have been an
instruction stayed a call.

Nothing was wrong with the specializer, the fact lattice, or the typed array.
One arm was missing from one match, and the cost of it was 2.4x — on a program
where every other pass was doing its job.

## The two fixes, and why the second is the better one

**A conversion keeps the value it was given.** `Convert`'s facts are its
operand's, narrowed to what the result type can hold. Obvious in hindsight and
the arm should always have been there.

**A machine type's width *is* a range.** A `u8` holds 0 to 255, no fraction and
no NaN, and no analysis has to derive that. This matters more than it looks:
`hir::elements` records what a narrowed array holds because it did the
narrowing, but a *declared* `Uint8Array` was never narrowed by anything, so
nothing recorded it. The width was the only fact available and it was being
thrown away.

```text
bytes   1.98 ms -> 838 us      2.36x the C++ reference -> 1.00x
```

## Correctness said yes, and the point of the feature was missing

The gap between "the feature works" and "the feature is worth having" was one
benchmark. Everything the differential harness checks was already green: 292
cases across eight widths, agreeing with node on NaN, negative zero, fractions
and every out-of-range store. Correctness said yes and the point of the feature
was still missing.

The general form, worth checking whenever a lattice gains a producer: **an
operation with no transfer function does not fail, it returns `TOP`** — and a
`TOP` is indistinguishable from an honest unknown at every use downstream. It
degrades silently, at a distance, and in a pass that is working correctly.
`hir::flow`'s catch-all now has two arms fewer, and the next thing to reach it
should be looked at rather than accepted.

## The sharper form, from two more instances

The Node session went looking in their own code after reading this and found
`isDeepStrictEqual(new WeakMap(), new WeakMap())` answering **true** — no own
enumerable properties, so the key walk found two empty objects and agreed. Their
refinement of the rule is better than the one above:

> The tell is not "a default". It is **a default that is right for a
> neighbouring case.** `TOP` for an unmodelled operation and `false` for an
> unmodelled operation are both defaults; only one of them is silently
> plausible.

Their fall-through is the *correct* answer for a `WeakRef`, which genuinely has
nothing to compare, and the wrong one for a `WeakMap` — and nothing at the point
of the fall-through distinguishes them. `TOP` is correct for a call whose callee
is not analyzed and wrong for a conversion, in the same match.

## And the instrument has to be able to fail

Twice in one night, here and there:

- Their first fuzzer built two independent random structures. Those are almost
  never equal, so both implementations answered `false` and it agreed on
  everything while testing nothing.
- The unsigned-arithmetic work in `hir::specialize` that followed this record
  passed `bitwise`, `arith`, `typed-arrays`, `literals` and `conditionals`, and
  failed `negative-zero` and `mathops`. It was wrong in three separate ways —
  a comparison against a parameter that may be negative, and `Math.abs`
  compiling to `x < 0 ? -x : x` with `x` unsigned, where the test cannot be
  true. Every one of those was found by a pool that includes negative values.
  A pool of positives would have been green and meaningless.

A green result that is well-formed and means nothing is the same failure as a
diagnostic that is well-formed about the wrong subject. Ask of any measurement
what input would make it fail, and check that the input is in it.

## The companion rule, and it cuts both ways

From the Node session, after they built a `--sabotage` mode that hands every
test an empty object instead of the module under test — "what input makes this
go red, and is it in the set", made executable. It found that 46 of their 51
passing `node:buffer` files passed with the module *removed*, because node's
tests reach `Buffer` as a global rather than through the export. Their honest
number is 15.

The part worth copying is what they had done hours earlier: they had tried
installing the global, watched the count fall from 51 to 15, concluded they had
broken node's internals, reverted, and *written it up as a documented negative
result*. Without reading a single failure. Nothing was broken. The count fell
because the measurement had started working.

> A measurement that changes sharply has at least two explanations, and the
> flattering one is that the instrument is broken.

51 → 15 reads as "I broke it". 2.36x → 1.00x reads as "I fixed it". Neither
reading is *entailed* by the number, and the discipline is the same in both
directions.

For the `bytes` number above, what makes it a measurement rather than a hope:
the runner computes a checksum from every variant and refuses to report a case
whose variants disagree, so the fast version is known to compute what the slow
one did; the seed is `volatile`, so the loop cannot be folded away; and the
`nts f64` column — the same program with specialization off — did not move while
the specialized column fell by 2.4x. If the instrument had broken, both columns
would have moved together.

That check is worth writing down beside any speedup, because the alternative
explanation is always available and is never the one you reach for.

## Postscript: the optimization that paid for itself somewhere else

Having fixed the facts, `bytes` still lost to node — which should not happen,
because node was also beating the C++ reference. That was signed `%`: C has to
correct for the sign of the dividend, and the unsigned form does not. Measured
standalone at **1.88x**, and the facts already prove the accumulators
non-negative, so `hir::specialize` can choose `uint32_t` for a class it can
prove never holds a negative.

Three bugs, all caught by the differential harness and all described in
`unsigned_classes`. Then a fourth thing, which no differential could catch
because it was not a correctness problem:

```text
awfy-sieve   1.74x the C++ reference -> 2.20x
```

`sieve` contains no division. It went unsigned because its bound is a known
5000 and every index is non-negative, and it got **26% slower**. Signed
overflow is undefined in C, and that is exactly what lets a compiler assume an
induction variable never wraps and transform the loop on that basis. Unsigned
wraparound is *defined*, so the same loop has to be preserved as written. The
optimization is real and it was being applied to code that could not use it.

The rule is now that the class has to contain the operation that pays. The
operands are coerced to the operation's type anyway, so making the remainder's
own class unsigned is enough to get the unsigned instruction.

```text
bytes        2.36x the C++ reference -> 1.03x, against an unsigned reference
awfy-sieve   unchanged
```

The reference had to move too. It was written with `int32_t` accumulators, and
zlib's `adler32` uses unsigned — so the honest comparison is against the faster
C++, and the thing worth measuring is whether the compiler works out on its own
what the C++ programmer knew.

**What would have hidden this: measuring the case being optimized.** `bytes`
alone said the change was a win. Only the full suite said what it cost, and it
cost it somewhere with no remainder in it, which is not where anyone would look.


## Two instruments, and neither is the other's weaker form

The night ended with two checks that did not exist when it started, and the
useful thing is that they are not ordered.

**The conservation law.** *Every function the checker knows about is either
lowered or refused, and never neither.* `hir::unaccounted` asks it and
`hir::lower` enforces it. It says nothing about whether the answer is right,
only whether anything vanished.

Attribution is **per node, by span containment**, and that is the property to
preserve rather than an implementation detail. Counting per *file* would have
been simpler and blind to the thing it actually caught: nine of its first
fourteen findings were a diagnostic filed against the wrong node — a method
whose receiver layout failed was reported at the *class*, so from outside the
method "refused elsewhere" and "not refused" were the same observation. A law
sensitive to *where* a refusal landed catches the wrong-subject bug that this
record's other sections are about. A law that only counts does not.

**The compile check.** Every corpus program goes to `clang -fsyntax-only`, and
`UNCOMPILABLE C` must stay at zero beside invalid HIR. It reports nothing today,
which is not vacuous: if clang were absent the process would fail to start and
*every* file would count, so a zero means clang ran and accepted each one.

Neither subsumes the other. The conservation law cannot see `"" + n` emitting
`(NtsString *)someDouble`, because that function *was* lowered. The compile
check cannot see an object-literal method, because that came out as nothing at
all and nothing compiles fine. Coverage is the union, not the maximum — which is
the same shape as the differential harness and the cross-variant checksum, one
of which proves the fast path matches the slow path and the other that the slow
path was right to begin with.
