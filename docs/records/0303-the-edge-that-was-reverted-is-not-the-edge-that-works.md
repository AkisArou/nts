# The edge that was reverted is not the edge that works

`a-class-stored-and-compared` was the last example the JVM backend disagreed on,
and the goal counts that as unlanded however well the other two do. It is
closed. What took the time was not the fix — it is one pass and a page of
comment — but that **three places in the tree said it had been tried and did not
work**, and all three were describing a different rule.

## What was declined

    storing a `Ctor_Other` where a `Fn3__1` is declared,
    and the first does not extend the second here

`Ctor_Other` is an empty layout with no base. `Ctor_Message`, beside it, has
`base 11 -> Fn3__1`.

## The two rules

`lower::token_base` gives a token the base of its **own** `typeof`. That is the
right relation when the program declares that type — `typeof Message` is
`Fn3__1`, so `Ctor_Message` extends it and the store verifies.

The rule that closes the other token is the signature layout it is **stored
into**.

They **coincide on `Ctor_Message`** and differ on `Ctor_Other`. That is the
whole difficulty: `81c5200e` moved the JVM floor 178 → 179 with the first rule,
which made it look like the general answer that was merely insufficient, and a
second attempt to extend it was built and reverted on 2026-09-10 because
`typeof Other` names a *different* signature and produced `Ctor_Other extends
Fn3__6` against a slot wanting `Fn3__1`.

Both of those are true and neither is evidence about the rule that works. In
that program `typeof Other` is never a declared type at all: `nts layouts` emits
exactly one `Fn` layout, and there is no `Fn3__6` for the reverted rule to have
reached for.

## What the comments cost

    tooling/gate/all.sh   "that edge was built and reverted on 2026-09-10"
    lower::token_base     "two genuinely different signatures rather than two
                           ids for one. A base cannot relate those"

Both were written while looking at `cond ? TypeError : RangeError`, where a
token genuinely must be two things at once and single inheritance cannot express
it. Stated as facts about the *pair of types* rather than about the *number of
bases needed*, they read as a closed question.

**A correct sentence about a neighbouring question is worse than a wrong one,
because it stops the next person looking.** It stopped me: I wrote the second
one, and when the JVM lane proposed the rule that works my first reaction was to
quote my own comment back. The fourth instance of this shape in a day — the
others being `growth-grown` "at its floor", `dex2oat` recorded as inaccessible
when only a way to *produce* the artefact was, and a memory floor raised from a
sibling's number.

## Why it is a pass and not a lookup

The question is whole-program. Lowering reaches stores one at a time, so "how
many signatures does this token reach" is always "the ones so far": the first
store gives a base and a later store to a second signature finds one already
there. Whichever way that resolves, one of the two callers is wrong **with
nothing emitted to say so** — record 0096's merge hazard one level up, where
`M === Message` answers true for a program that says false.

Reaching two is left alone and stays declined. That is the union case, and it
wants a representation rather than a base.

## The evidence, and why the first version of it was not enough

The JVM lane's first derivation was the two NTS4001 lines, both naming
`Fn3__1`. They then corrected it themselves: `assignable` returns `Err` on the
first bad store in a function, so the backend reports **one refusal per
function** and stops. The refusal set is a *floor* on the target set, not the
set.

Derived from the program instead — every declared managed slot a token can
reach:

    func Server#constructor(this: managed<obj#10>, M: managed<obj#11>)
    func Closure0#call(this: managed<obj#0>, M: managed<obj#11>)
    field.set %0.0 = %5        Server.#Message : managed<obj#11>

Three sites, one type, and `obj#10` is `Server`'s receiver where no token can
go. I recomputed it the way the pass computes it rather than confirming it the
way the conclusion was reached — otherwise it is one derivation agreeing with
itself.

## The result

116 cases across four functions, agreeing with node on **all three backends**.
The JVM lane's floor moves 187 → 188 with its own run behind it.

The slot's declared type is not tested for being a function type. The checker
refuses any program that stores a token somewhere else, so asking again here
would be a second derivation of a fact the frontend owns — which is the failure
this record is otherwise about.
