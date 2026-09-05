# 0133 — Two optimisations that measured nothing, and a profile that measured the wrong tree

Three negative results from one afternoon, kept because the reasons are worth
more than the changes would have been.

## The store/load peephole, not built

Record 0099 measured `awfy-bounce` at 1.53x the reference's instructions and
named the store/load round trip. The obvious backend answer is a peephole:
`store N; load N` adjacent on one slot, delete both.

Counted before writing it:

    awfy-bounce   499 instructions,  10 adjacent store-then-load  (4.0%)
    loop          144 instructions,   3                           (4.2%)
    checksum      177 instructions,   3                           (3.4%)
    dispatch      715 instructions,   3                           (0.8%)

**`checksum` has the same rate as `awfy-bounce` and sits at 1.00x**, and
`dispatch` -- the worst row of the four -- has the least. The peephole cannot be
what separates them. Whatever 0099's 1.53x is, it is not the adjacent round
trip, and a peephole would have been a day spent to measure nothing.

## The literal divisor, built and reverted

`idiv` and `irem` throw on a zero divisor, so every integer division in this
backend goes through a runtime helper that raises the refusal instead. The
comment beside it says *"nothing upstream proves the divisor non-zero"* -- true
of the general case, and not true when the divisor is written in the program.
Five lines make `i % 3` a bare `irem`.

Instrumented rather than assumed, across 116 examples and every bench case:

    literal-divisor arm fired 2 times

Both in `examples/control`, in `assignedInALoop` and `assignedInASwitch`, and
neither is a hot loop in any measured row.

**The reason it fires twice is worth more than the change.** A TypeScript
`number` is an `f64`, so `%` lowers to `drem` and integer division barely exists
in this backend's output at all:

    %1 = const 3 : f64
    %2 = rem %0, %1 : f64

That is `benches/cases/instanceof`, whose whole subject is `i % 3`. The integer
helper it never calls was the thing I set out to remove.

## And the profile that sent me there was measuring a tree being rewritten

I read `NtsRuntime.irem` at **16.3% of `absences` and 16.5% of `instanceof`**
and went straight at it. Both rows compute `i % 3` and the story wrote itself.

The full-table run was publishing at the time, and it regenerates
`target/bench/*.jvm` and the runtime jar -- the exact directories I was
profiling. A second profile of `absences`, taken after, has no `irem` in it at
all.

So the number was real in the sense that a JVM produced it, and meaningless in
the sense that it described a classpath being overwritten underneath the
process. **A profile of a directory something else is writing is not a
measurement**, and the whole six-row batch taken in that window went in the bin
with it.

That is the second time today the tree moving under a measurement produced a
finding that was not there -- record 0132 has the first, where five numbers from
five trees looked like instrument noise. The rule that covers both: pin the
inputs, not just the machine. The lock stops another process competing for the
CPU and does nothing at all about one editing the files.

---

## Correction: the divisor was there and my predicate was looking one node too shallow

Everything above about the literal divisor is wrong, and the instrument that
said so was not.

`nts hir` prints the IR before preparation. The backend does not see that. What
`nts hir --prepared` prints for `absences` is:

    %16  = const 3 : i32
    %127 = convert %16 : u32
    %17  = rem %126, %127 : u32

**The `rem`'s divisor is a `Convert` of the literal, not the literal.**
`divisor_cannot_be_zero` matched `OpKind::ConstInt` on the operand it was handed,
found a `Convert`, and answered false every time. Two firings in the whole
corpus was an honest report of a predicate looking at the wrong node.

Following one conversion -- and testing the constant at the width it converts
*to*, because a narrowing can carry a non-zero literal to zero -- turns
`absences` from 10 helper calls into 10 bare `irem`, and `instanceof` from 2
into 2.

So the reason I gave, that integer division barely exists because a `number` is
an `f64`, is also wrong. It exists; specialization produces it; I was reading a
dump from before the pass that makes it.

**And "reading a stale dump" is too kind a description of the error.** Both
lines are true. `rem %11, %16 : f64` is a correct account of that operation
before preparation and `%17 = rem %126, %127 : u32` is a correct account of it
after. Neither is out of date. What I had was a **correct answer to an adjacent
question**, and the reason that is worse than a stale one is that a stale
artifact eventually contradicts something and an adjacent answer never does.
There was nothing in the first dump to notice.

**What should have caught this immediately is that I had two numbers that could
not both be true.** The same afternoon I counted ten `NtsRuntime.irem` call
sites in `absences`'s emitted bytecode and had a predicate claiming there was
nothing there to catch. A dead arm and ten live call sites for the same operator
in the same function is a contradiction, and I wrote both down without putting
them beside each other.

A negative result from a correct instrument aimed at the wrong node is
indistinguishable from a negative result about the world. Nothing in "fired 2
times" says which. The only defence is the other number.

## And a partial retraction of the retraction above

The section on the profile measuring a rewritten tree stands for the batch: six
rows profiled while the publishing run was regenerating the exact directories,
and a second `absences` trace taken in the same window showed no `irem` at all.

But re-taken properly -- classes copied out first, current jar, nothing else
writing -- `absences` reads **17.73% in `NtsRuntime.irem`**. That one was real
and I binned it with the bad ones.

Discarding a measurement because its conditions were unsound is right.
Discarding it *permanently*, rather than re-taking it under sound conditions, is
how a real finding gets lost, and I nearly did that here.

---

## Correction to the correction: it fires, and it is still worth nothing

The section above restores the literal-divisor optimisation on the grounds that
the predicate was looking one node too shallow, and that `absences` spends 17.7%
in `NtsRuntime.irem` while computing five literal remainders. Both facts are
true. The change is still worthless.

Two builds of `absences` differing in nothing but whether `i % 3` emits a bare
`irem` or a call, interleaved under the lock:

    bare-irem     553.8  553.7  553.4  553.4  553.5  553.5
    helper        553.6  553.5  553.6  553.9  553.6  553.6

**Identical**, on a row whose own spread is 0.0% over six runs, so there is no
noise for an effect to hide in.

The argument was that passing the divisor as an argument hides the constant from
C2, making it a variable divisor and a real hardware division where javac's
constant is strength-reduced. That is wrong. `NtsRuntime.irem` is three
bytecodes past the guard; C2 inlines it, sees the constant at the inlined call
site, and strength-reduces exactly as it would have. **The helper never hid
anything.**

So the 17.7% is real and is not a call overhead. It is the remainder itself,
attributed to the frame of an inlined callee -- which is what async-profiler
does and is not wrong, only easy to misread.

Reverted.

## The discriminator this hands over, which the profile does not

`toInt32` and `bounds` were the same shape -- a hot `NtsRuntime` entry, a large
share, an obvious call to remove -- and both paid. This one did not, and the
difference is not visible in a profile:

- `toInt32` decoded an exponent and shifted a significand. Removing the call did
  nothing; **replacing the work with a `d2l` and a compare** is what paid.
- `bounds` asked three floating-point questions where one integer question
  answers all of them. Again the work, not the call.
- `irem` does the same division either way. There was no work to remove, only a
  call, and C2 had already removed the call.

**A profile tells you where the time is, not whether there is anything cheaper
to do there.** Three entries that looked identical in the profile split two-one
on that question, and nothing short of building all three would have said which
way. Two of three is a good rate, and the third cost an hour and is the reason
the other two are trustworthy.
