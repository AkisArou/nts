# 0077 — Two things that must agree, and the second one recomputing the first

**The second place that must agree should not recompute the first.** In one day
the JVM lane produced five instances of that sentence, at five levels, and only
the last one has nothing to do with compilers — which is what makes it the
clearest.

## The comparison and the branch that reads it

The JVM has no instruction that leaves a boolean on the stack. A floating
comparison is `dcmpl` or `dcmpg`, which push -1, 0 or 1, and then a branch that
tests the result against zero. The two forms differ on exactly one input:

    dcmpg   NaN -> 1
    dcmpl   NaN -> -1

JavaScript requires every relational operator to be false against `NaN`, so each
comparison needs the form whose `NaN` answer the following branch rejects:

    a <  b   dcmpg + iflt      1 is not < 0
    a <= b   dcmpg + ifle      1 is not <= 0
    a >  b   dcmpl + ifgt     -1 is not > 0
    a >= b   dcmpl + ifge     -1 is not >= 0

The doc comment was written before the test and said `dcmpl` for `<`. That is
exactly backwards: -1 *is* less than zero, so `dcmpl` + `iflt` makes `NaN < 1`
**true**. A hand-built class printed 1 where node prints `false`.

**The fix is not the pairing.** It is that there was a pairing to get wrong.
`Code::branch_float` now emits the comparison and the branch as one call and
chooses the form itself, so six operators are one table instead of six call
sites. The bug is silent on every input except `NaN`, and the differential's
hostile pool carries one — which means it would have been found eventually, much
later and much further from the cause.

## The same thing one level up, in the emitter

`branch_float` removed the opportunity to pair `dcmpl` with `iflt` by hand. It
did not remove the *class*, and the proof arrived four hours later from the
differential's first run: `examples/conditionals` answered `sign(NaN)` as 1
where node answers 0.

`sign` is `x > 0 ? 1 : x < 0 ? -1 : 0`. The branch fell through to the true arm,
so the emitter wanted the branch taken when `x > 0` is *false*, and got it by
inverting the comparison to `x <= 0`. **That is not the complement.** Against
`NaN` both are false, so the negation of the first is true and the second is
not: the relational operators are not a total order, and negation and complement
come apart exactly where an unordered value exists.

Concretely, `a > b` is `dcmpl` then `ifgt`, and `NaN` makes `dcmpl` answer -1,
which `ifgt` rejects. Its negation must be `dcmpl` then `ifle`, which -1
accepts. Inverting the comparison picks `dcmpg` instead — a different `NaN`
answer — and rejects it twice.

So the comparison chooses the `dcmp` form and the negation chooses only the
branch. `Compare::inverted()` is the helper that made the wrong pairing
available again, one layer above the one that had just been closed.

## And a third time, in the operand widths

`binary` took its opcode and its stack effect from the operation's *result*
type, while loading operands by their own kinds. Those agree in every prepared
HIR — until `touint32 %2 : i64`, where an `i32` operand has an `i64` result
because a coercion is a reduction to thirty-two bits *and then* a widening.
Emitting the reduction alone left an `int` on the stack where the slot wanted a
`long`.

That one was not fixed. It was **asserted**: the operand kinds are now checked
against the result kind and a disagreement is a refusal naming both. Which is
this record's own conclusion, applied to the code that had just violated it.

## And a fourth, in the harness that would have judged them

The differential feeds every parameter from a pool of doubles, whatever the
parameter's type is, so both lanes have to narrow. The C driver writes the
narrowing as a literal cast in generated source — `(int32_t)1e21`, which is
undefined out of range, and clang picks. The JVM side would narrow at run time,
where the JVM **saturates** to `Integer.MAX_VALUE`.

So the two lanes would feed different arguments and disagree for a reason that
is entirely the tooling's. The instinct is to make one match the other.

That is the wrong goal, and asking which of them matches *node* shows why:
**neither, because in the source there is no `int32` parameter at all.** It is
`number`. The `I` exists only because the compiler proved the value is an
int32 — so a pool value outside that range means one of exactly two things:

    the proof is wrong
    the pool filter ignored it

Both are findings. Two harnesses quietly agreeing on a value the source cannot
produce is strictly worse than two that disagree, because the disagreement is at
least visible.

`representable()` therefore refuses to emit the case, naming the parameter and
the value, rather than casting and hoping. If it never fires, an assumption has
become a checked one for nothing.

## And a fifth, in the lock, with no compiler anywhere near it

```sh
mkdir "$LOCK" 2>/dev/null || echo "busy"
if [ -d "$LOCK" ]; then  ...measure...  rmdir "$LOCK"; fi
```

The `mkdir` correctly failed and correctly said `busy`. Then `[ -d ]` tested
**existence**, which was true precisely because another session held it — so the
measurement ran under that session's gate and released a lock this one never
had, mid-certification.

Acquisition is `mkdir` returning zero. It is a fact, and the second line
re-derived it by looking at something that cannot distinguish "mine" from
"theirs".

`tooling/gate/with-lock.sh` fixes it in the strongest available form, which is
better than a variable: the release is a `trap` installed **only on the path
where the `mkdir` succeeded**, so on a path that did not acquire, the release
does not exist. Not checked — unrepresentable.

## What they have in common

Every one is two places that must agree.

    the comparison and the branch that reads it   deleted one of them
    the comparison and its negation               deleted one of them
    an operation's result type and its operands   asserted
    the C driver's cast and the JVM harness's     asserted
    taking a lock and releasing it                made unrepresentable

Three responses, in descending order of how much they are worth:

1. **Make the wrong state unrepresentable.** The lock's release does not exist on
   the path that did not acquire. Nothing can call it wrongly because there is
   nothing to call.
2. **Delete one of the two.** `branch_float` emits the comparison and the branch
   together, so there is no pairing to get wrong — but note that this closed an
   *instance* and not the class, and the fix itself opened the next one.
3. **Make the second place check rather than compute.** For the two where
   deleting is unavailable: an operation's result type and its operand types are
   separate facts the middle end decides, and the C driver and the JVM harness
   are genuinely different programs.

The five are not one mistake repeated. They are one class surfacing at five
levels, each invisible from where the last was fixed.

That is the general form, and it is worth stating because this repository keeps
meeting it: `costs_nothing` and `counted_here` answering one question two ways;
a descriptor's pointer table and its erased table both claiming a slot;
`module#init` spelled `module__init` in one backend and `@"module#init"` in
another. The house rule is already "decide it once, in `codegen/common`". This
record is the case where deciding once is not available, and the answer is that
the second place should be a check rather than a copy.

## Reading a comment is not applying it

The third instance has a sharper version. `codegen/llvm`'s `coercion` carries a
paragraph about *exactly* this bug, written after it cost a module that stopped
verifying several instructions from the cause:

> Producing `i32` and calling it the result's type made a value whose emitted
> width disagreed with its recorded one. Nothing complained at the definition;
> every later reader converted from the width the HIR claimed.

That comment was read while writing the JVM backend, and the backend was written
with the bug in it anyway. **A record prevents nothing by being read.** It
prevents something by being turned into a check, which is what this one now is
in `codegen/jvm`, and which is the difference between the two halves of every
entry in the table above.

The same gap has a companion at the archive level: nothing links a record
forward to the one that overturned it. Record 0013 called `substrings` "the
largest single gap in the project" at 6.64x; records 0059 and 0062 retired that
and the row is 0.92x. The only reason it was caught is that somebody went to
cite it and checked. A statement that was true when written, with nothing
watching for the day it stopped being, is the same shape as everything above.

## Credit

The fourth entry is a diagnosis this session got right and a fix it got wrong.
The proposal was to make the two casts agree; the session working on language
features pushed back with the argument above, and it is the better answer. The
distinction between "make them agree" and "make the second one assert" is the
whole content of this record, and it did not come from the person who found the
asymmetry.

That session also had the same class the same day, in a place neither of us
would have connected: `??=` and `||=` are two predicates that agree on every
value except the ones the operator exists to distinguish — which is
`!(a > b)` versus `a <= b` with falsy standing in for `NaN`. Their test asserts
on the *shape of the emitted test* rather than on an answer, for the same reason
the operand-width check here asserts rather than computes. Two backends, one
lowering, three sessions, one class.
