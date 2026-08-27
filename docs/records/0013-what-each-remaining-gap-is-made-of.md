# 0013 — What each remaining gap is made of

Every benchmark now sits between 0.46x and 2.4x of hand-written C++, and ahead
of both JavaScript engines almost everywhere. The interesting question is no
longer "how fast is it" but "what is each remaining gap *made of*", because the
answers turn out to be of three quite different kinds — and only one of them is
a compiler defect.

This is written down so the next person does not re-derive it.

## A length a caller knows and a callee does not

`Sieve#sieve(flags, size)` had a bounds check in both of its loops. Everything
else about it was already ideal: every value an `int32`, the inner loop six
instructions. The check stayed because the *length* of `flags` is not knowable
inside `sieve` — it is a parameter — while the one caller allocates it five
thousand long and says so.

`fields::lengths` had solved the same problem for the other way a reference
arrives: a method reading `this.flags` has no allocation in front of it either.
`fields::parameter_lengths` is that pass for arguments, joined over every call
site the same way parameter *facts* already are, and living in the same fixpoint
because it reads the arguments at every call and that loop is already there.

**The soundness condition had to be relaxed to be useful, and relaxing it made it
stronger.** `allocated_length_is_exact` asked whether the array had ever been
passed to a call — because a callee could `push` to it, and the object does not
move, so every reference would see the new length. But *every* array a program
does anything with is passed somewhere: `fill` it, hand it to the method that
reads it. The test refused them all.

The question it was approximating is whether anything can change an array's
length, and only two operations do. So `arrays_can_grow` asks that of the whole
program, and where the answer is no, an array's length is decided where it is
allocated and true forever. That is coarse — one `push` anywhere loses every
length in the program — and it is deliberately coarse: the precise version is a
may-grow fixpoint over parameters and fields, and this answers "no" for every
program that never pushes, which is most of them and all of Are We Fast Yet.

`sieve` and `permute` now have **no bounds checks at all**. It is worth 4–7%,
which is less than it sounds like it should be: a check clang can predict
perfectly is nearly free, and the value of removing one is mostly that it
*sharpens the facts* downstream rather than that it removes a test.

## Two gaps that are semantic, not defects

Both were worth chasing to the point of being sure, because "we are slower here"
and "we are slower here and cannot help it" are very different entries.

### `fib` — 1.9x C++, and the reference is not computing the same thing

`fib__whole` takes an `int32_t` and does `int32_t` arithmetic. It **returns a
`double`**, so `fib(n - 1) + fib(n - 2)` is a floating-point add where the
reference's is an `int64` add.

That is not a missed narrowing. `signatures::narrow_results` needs the returns to
be provably inside 2^53, and fib's are not — for arbitrary `n` they are
unbounded. JavaScript requires the exact double there; the C++ reference wraps in
`int64` because its author declared `std::int64_t`. Making ours match would mean
computing in `int64` and *checking* for the escape to doubles, which is
speculation with deoptimization — an RFC-level feature, not a lowering fix.

We are 0.58x V8 and 0.90x Bun on it, which is the meaningful comparison, since
those two have to obey the same rule.

### `objects` — 1.00x C++, and Bun beats them both

The generated loop is instruction-for-instruction the C++ reference: both `Vec2`s
in the frame, no allocation, the same four floating-point operations. So the gap
to *C++* is zero and there is nothing to fix.

Bun is 1.16x faster than us and 0.87x of hand-written C++, which is the
interesting number. It gets there by keeping `total` an integer, which turns a
four-cycle dependency chain into a one-cycle one. We cannot: `total` is
`Σ i·seed + (i+1)·(seed+1)` over 4096 iterations, which reaches about 2^56 for an
arbitrary `int32` seed — outside the exactly-representable integers by a factor
of eight. Bun assumes it stays small and deoptimizes if it does not.

**Both of these are the same feature.** If speculation is ever worth building,
these two are its benchmark.

## What is still a defect

- **`substrings` at 2.4x**, and record 0012 says what the remainder is: an
  out-of-line helper re-deriving indices the compiler already proved whole and in
  range.
- **`accumulate` at 1.4x** and **`queens` at 1.2x**, both unexamined.

## And one that looks like a defect and is a missing analysis

`bounce` is 1.9x, and `Ball`'s `x`, `y`, `xVel` and `yVel` are declared `number`
and stored as doubles where the reference stores `int`. `fields::representations`
is exactly the pass for that, and it declines. It is worth being precise about
why, because "it does not fire" invites someone to go looking for a bug.

The values really are small — `random.next() % 500`, then clamped into
`[0, 500]` every step. But `fields::analyze` joins every store into a field over
the whole program, with no flow sensitivity, and one of the stores is

```ts
this.x += this.xVel;                          // and only then
if (this.x > 500) { this.x = 500; }           // is it clamped
if (this.x < 0)   { this.x = 0; }
```

The first store is real and observable, so `x` genuinely holds `x + xVel` for an
instant. Joining that back in makes the next round's `x + xVel` wider by another
`xVel`, and the fixpoint walks outward by 150 a round until it gives up. What
bounds it in truth is the *clamp two statements later*, and a whole-program join
over stores cannot see that a read at the top of the method only ever observes
clamped values.

Threshold widening does not rescue it either: `x = x + x` is not stable at any
width, because the sum of two `int32`s is not an `int32` and the sum of two
values in `[-2^53, 2^53]` is not one of those.

So this needs **flow-sensitive field facts within a method** — treating `this.x`
between stores the way an SSA value is treated, so the branch that clamps it
refines it. That is a real feature and a sound one, and `bounce` is its
benchmark. It is not a bug in the pass that exists.
