# 0077 — Two things that must agree, and the second one should assert

The JVM backend produced two bugs of one shape on its first day, at two levels,
and the second one is only interesting because the first had already been fixed
the wrong way round.

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

## The same thing one level up, in the harness

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

## What the two have in common

Both are two places that must agree. The first was fixed by deleting one of
them. The second cannot be — the C driver and the JVM harness are genuinely
different programs — so the second place asserts instead of computing.

That is the general form, and it is worth stating because this repository keeps
meeting it: `costs_nothing` and `counted_here` answering one question two ways;
a descriptor's pointer table and its erased table both claiming a slot;
`module#init` spelled `module__init` in one backend and `@"module#init"` in
another. The house rule is already "decide it once, in `codegen/common`". This
record is the case where deciding once is not available, and the answer is that
the second place should be a check rather than a copy.

## Credit

The second half is a diagnosis this session got right and a fix it got wrong.
The proposal was to make the two casts agree; the session working on language
features pushed back with the argument above, and it is the better answer. The
distinction between "make them agree" and "make the second one assert" is the
whole content of this record, and it did not come from the person who found the
asymmetry.
