# The walk with no cursor, and a promise the program does not keep

`for...of` over a user type with `[Symbol.iterator]` lowers. Writing its
benchmark found a wrong answer that had nothing to do with iteration.

## The fourth walk

Three walks existed and all three are cursor-and-condition: an array is a
position against a length, a table is an entry index the runtime advances, a
string is a position stepped by one or two units. The protocol is not that
shape, and trying to make it that shape is where the design decisions are.

`next()` **both** advances the iterator and produces the element. So one call
answers two questions, and they are asked in different places:

```
header   r = it.next();  done = r.done;  cond = !done
body     element = r.value
```

The header dominates the body, so the body reads the element out of the same
result. Calling `next()` once for the test and again for the element would step
twice and yield every other item -- an answer wrong by a factor of two that
looks like arithmetic.

There is **no cursor**. The iterator holds its own place, so a loop-carried
index would be a value nothing reads. And the latch is the header, which is not
a saving: `continue` jumps to the latch and has to arrive at the `next()` call.
A protocol loop with a latch of its own steps the iterator nowhere and hangs.
`Step::None` already meant "the header is the latch" and needed nothing added.

Two tests pin exactly these, and both were broken on purpose: one counts the
`next()` calls in the emitted function, the other counts the loop's carried
values. Adding a cursor breaks both; reading the element from a second step
breaks the first.

## The floor I argued was eleven and the answer is zero

`work(1)` walks from 9, so `next()` is called ten times and each returns a fresh
`{ value, done }`. Add the iterator: eleven objects. That is what the source
says, and the measurement says **zero allocations and zero operations**.

The wrong step was "born in a loop, so each needs its own storage". That holds
in `store-elsewhere`, where thirty-three disks are threaded into a list and
every one is live at the end. It is false here: each result dies before the next
is made, so one frame slot serves all ten. *Simultaneously live* is the
condition, not *repeatedly made* -- and I had the wrong one written down since
the `kept-not-rewritten` case earlier the same day, where it happened not to
matter.

So the protocol allocates nothing on this shape, which is a stronger claim than
the case was written to make. `tooling/memory/cases/iterator-protocol` now
argues it, and the suite refused the over-argued version outright: *BELOW ideal
-- the argument in expected is wrong*. A floor that is too generous is as much
a defect as one that is too tight, and only one of those is obvious.

## `IteratorResult<T>` is refused, and that is a representation question

The standard spelling does not reach any of this. `lib.d.ts` defines
`IteratorResult<T>` as a union of `IteratorYieldResult<T>` and
`IteratorReturnResult<TReturn>`, whose `value` is `T` in one and `any` in the
other -- so the two lay out differently and the union has no representation. A
hand-written `{ value: number; done: boolean }` works.

Giving the union a layout means widening `value` to an erased sixteen-byte slot
in both members, which costs every element of every walk to make the standard
annotation compile. That is a trade rather than an oversight, and it is written
down rather than taken.

## The wrong answer, which was not about iteration

The benchmark for this row accumulated `total = (total + step.value) | 0` over a
long walk. nts answered **3221225471**; node answers **-1073741825**. The same
thirty-two bits, read as unsigned.

The emitted C was:

```c
v8 = v5->value;   /* int32_t */
v9 = v4 + v8;     /* int32_t + int32_t */
```

Signed overflow is undefined in C. Specialization narrows an accumulator to
`int32_t` wherever the values are whole, which is not the same as proving the
*sum* fits -- and the plain operator then tells clang the overflow cannot
happen. It happens, and the optimizer had been given a promise the program does
not keep.

Fixed by wrapping through the unsigned counterpart and casting back. That is
exactly the spelling `benches/cases/accumulate`'s hand-written reference uses,
with a comment there saying the wrapping *is* the semantics -- so the reference
was being held to a standard the emitted C was not.

The LLVM backend was never affected: its `add` carries no `nsw`, so it wraps by
definition. Nor is the JVM lane: `iadd` is defined to wrap. Both value models
make the right answer unavoidable, which is the third time in a day that a
backend has inherited a semantic for free from its representation -- and the
first time it cut in favour of the managed backends and against the native one.

## The check a differential cannot make

Three examples were written to catch the overflow. **All three agreed with node
with the fix reverted**, because clang chose to wrap anyway at those shapes.

That is what undefined behaviour is: the program may give the right answer on
Tuesday. A differential can only notice the days the optimizer takes the other
branch, which is precisely why this survived every example that exercised
`| 0` -- they all stayed inside the range, and the one that did not was a
benchmark nobody had written yet.

So the rule is held by a test that reads the **emitted text** and asserts the
spelling, broken on purpose to confirm it fails. The examples stay, with a
comment saying plainly that they do not catch it and where the check lives; a
reader who arrives at the bug from there should not have to find that out.

The general form is worth more than the fix: **a rule whose violation is
undefined behaviour rather than a wrong answer cannot be checked by running the
program.** It has to be checked on the output. The JVM lane reached the same
conclusion from the other side this week -- its `Code::depth` assertion checks
the emitter's model of the operand stack rather than any program's answer, and
that is what made twenty-nine disagreements findable instead of mysterious.

## The number, and it is bad

| | C++ | nts (C) | nts (LLVM) | node | bun |
| --- | ---: | ---: | ---: | ---: | ---: |
| `user-iterable` | 31.20 us | 689.54 us | 666.96 us | 426.88 us | 676.49 us |

**21.4x the C++ reference, and 1.56x slower than node** -- the first row in the
table where nts loses to node. Reported rather than buried: the feature works
and is correct, and it is slow.

The mechanism is visible in the emitted C without a profiler. `next()` is
inlined and nothing allocates -- the memory case is right about that -- but the
result object is *materialised in memory* on every iteration, header included:

```c
b1:;
    ...
    v33_frame.header.descriptor = &nts_desc_NtsObj_Type1;
    v33_frame.header.reserved = NTS_IMMORTAL;
    v33->value = ...;
    v33->done = ...;
    v6 = v33->done;
    v8 = v33->value;
```

Six memory operations per element for two scalars that never leave the loop
body. The C++ reference keeps both in registers, which is why it is at roughly
one cycle an element and this is at roughly thirty.

Two separable costs, and they want different fixes:

- **The header is rewritten every iteration.** The frame slot is the same
  storage each time round and its descriptor never changes, so the two stores
  are loop-invariant and are not being hoisted. That is a bug rather than a
  trade.
- **The object is not scalarised at all.** Its address never escapes the loop
  body and its two fields are written and immediately read, so both should live
  in registers. `nts f64` at 733 us says specialization is not the issue.

Not fixed here. It is a codegen and middle-end question rather than a lowering
one, and this record is about the walk. But the row is now in the table with
its mechanism written down, which is the difference between a carried-forward
item and a number nobody looked at.

That the JVM backend reads 1.46 ms on the same case is consistent with the same
cause one representation down, and consistent with 0080: a materialised object
per element is slot traffic, and slot traffic is what the JVM lane has no
optimizer to absorb.
