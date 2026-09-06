# The signature a call matched is not the function it reaches

TypeScript resolves a call to whichever *overload signature* fits. Those are
separate declarations with no bodies, and only the implementation beside them is
emitted. So everything a call is built from has to come from the
implementation — and four separate sites were asking the signature.

    pick(a: number): number;
    pick(a: number, b: number): number;
    pick(a: number, b?: number): number { ... }

    p.pick(n)     matches `pick(a: number)`
                  lands on `Picker#pick(this, a, b)`
                  CallArgumentCount { expected: 3, found: 2 }

The four sites are one fact repeated, and each broke on its own:

- **how many arguments are owed** — `omitted_after` filled from the signature's
  parameter list, which is shorter.
- **what each argument is represented as** — `pick(a, b)`'s `b` is a bare `f64`
  and the implementation's `b?: number` is `Erased`, so a correct arity coerced
  to the wrong slot: `CallArgumentType { at: 2, expected: Erased, found: Float }`.
- **where a rest begins** — `total(a, b)` beside `total(a, ...rest: number[])`
  has no rest of its own, so nothing gathered and a bare number reached a
  parameter wanting an array.
- **whether the callee is defined at all** — asking the *signature* whether it
  has a body answers no, so a plain overloaded function was called external:
  `undefined reference to 'combine'` from the linker, on a program that reported
  no refusal. Methods did not have this, because a method call takes its name
  from the hierarchy and a plain function has only the declaration to ask.

All four are `implementation_of(callee)`, which walks from the resolved
declaration to the sibling that has the body and is the identity when it already
does. The parameter list is then read off the implementation's **syntax** rather
than off a signature, because the checker gives the implementation's declaration
node the *overloaded* type — its call signatures are the overloads, so asking
`node_types` hands back one of the things being corrected for.

## The ledger said ✅ while this was refused

`docs/conformance/typescript.md` §3 read:

    | ✅ | overload signatures |

It was not true, and the evidence was checked in beside it: `examples/unsupported`
held a `class Overloaded` with a comment explaining why a signature cannot be
emitted, and `compiler/core/tests/abstract_methods.rs` asserted that all three
declarations were refused. A fixture in the unsupported corpus and a ✅ in the
ledger, about the same construct, for as long as both have existed.

This is the first false row I have caught this ledger holding. It is worth more
than the feature: the ledger is what says which work is left, and a row that
claims a capability the compiler does not have is a piece of work nobody will
ever schedule.

### And then a second one, from looking

Having found one, I looked. §12, *The runtime*:

    | ✗ | date and time |

`nts_time_clip`, `nts_date_new` and `nts_date_value` are in `runtime/c`, added
earlier this week, with §2 carrying a ✅ row for `Date` twelve hundred lines
above. **One document, two rows, opposite answers about the same capability.**

The direction is the mirror of the first: §3 claimed more than the compiler had
and §12 claimed less. Neither could have been caught by anything that runs,
because nothing runs against this file. The gate reads the fixtures and never
reads the table.

And the second one is not the same failure as the first, which is the JVM
session's observation and it is worth the separation. §3 was a *claim*
disagreeing with a *fixture* — two artifacts of different kinds, which a check
could in principle compare. §12 is a claim disagreeing with **another claim**, in
the same file, about one capability. Neither side of it is a fixture. So the
expensive check — a row naming the test that backs it — would have caught §3 and
would not have caught §12, and the only thing that found §12 was going back over
the neighbourhood of a bug already fixed.

So the generalisation is narrower than "instruments drift": **a claim and an
artifact about the same construct, in different files, with no step that compares
them.** Two rows in one afternoon is a rate, not an accident.

The JVM session added the sharper half: the two directions are not equally
likely to survive. A ✗ beside a working feature gets noticed the first time
somebody wonders why something they can see is listed as missing — people notice
being under-credited. A ✅ beside a refused fixture survives, because everything
green stays green. So the direction that persists is the one that claims more,
and a check catching only the other direction would catch nothing.

Their proposal for the cheap version: for every ✅ row, assert no fixture under
`examples/unsupported` names that construct. A grep, no new fixtures, aimed at
exactly the surviving direction. **I ran it against the pre-change tree and it
flags zero.** The row says `overload signatures` and the fixture's comment says
`overload signature`, and an exact substring match on the plural finds nothing.
Stemmed, it flags four of 129 green rows — the real one, plus `compound
assignment`, `abstract method` and `typed array`, each because the fixture's
prose *mentions* a supported construct while refusing something narrower.

Four lines to read is affordable. What is not affordable is what the experiment
also showed: matching against the compiler's **refusal messages** instead of the
fixture's prose — the more principled version, since messages are artifacts and
comments are not — misses it too. The message was *"an overloaded method"* and
the row was *"overload signatures"*; no stemmer relates them. The grep works only
because whoever wrote the fixture's comment happened to reuse the table's
vocabulary, which is a coincidence and not a property.

So there is no reliable cheap version, and saying so is the result. What would
have caught this is a row naming the fixture or test that backs it, checked for
existence and for outcome — the expensive version, and now the one with an
argument behind it rather than a preference.

## Then the refusal was itself a wrong answer

Refusing only the signatures was the first attempt and left invalid HIR: the
implementation stayed lowered and the call sites resolved against whichever
signature TypeScript picked. Refusing the implementation with them made the
method disappear. Both were fixed by moving the work to the call — but the
signatures kept the refusal, in words that named them accurately:

    NTS1001 an overload signature, which declares a call shape rather than a
    body -- the implementation beside it is what every call reaches

Accurate, and still wrong, because **NTS1001 is what this compiler cannot do**.
A signature is not a capability that is absent: nothing calls it, every call
resolving to it is built against the implementation, and the answer is right.
Reporting it inflates the one number this project steers by.

The asymmetry is what made it visible. `examples/overloads` has eleven
signatures — seven on methods, four on plain functions — and the differential
printed **seven** refusals. A plain function's signatures had never said
anything. Two paths, one construct, and they disagreed.

So a signature is now *skipped*, the way a `static` member is skipped on a
class's second copy. `runtime/node`, by the gate's own count:

    9489 refusals  ->  9214      (-275)

Of which:

    an overload signature ...        83  ->    0
    a method without a body         196  ->   82     (-114)
    a parameter of unrepresentable type (the type parameter `T`)
                                     38  ->   18
    a rest parameter whose element type has no representation
                                     79  ->   63
    a parameter of unrepresentable type (a union of `ArrayBuffer` | ...)
                                     13  ->    0

The 114 is the part I did not predict. The old condition asked whether some
same-named sibling has **no** body — which is true when there are three or more
declarations, and false for the ordinary case of one signature and one
implementation, whose only sibling has one. So the two-declaration overload set,
the common one, was reported as *"a method without a body"* all along. The
message naming overloads only ever fired on the sets with three.

**197 refusals, in the profile, for a construct handled exactly.** The rest of
the 275 is the parameters of declarations that are never emitted: a signature's
`ArrayBuffer | ArrayLike | Iterable` parameter was lowered and refused as
unrepresentable, for a function nothing calls.

And one number went **up** — `` `Error` used as a value `` 731 → 752 — because
methods that used to vanish with their overload set now lower and reach a gap
that is real. A refusal count that only falls is measuring the wrong thing.

## Deliverables

**Example.** `examples/overloads`, 145 cases against node on C, LLVM and under
reference counting: two-arity method overloads, three arities where the *middle*
signature is what some calls match, an implementation whose extra parameter is a
**default** rather than an optional, a plain function, and an implementation
taking a **rest**.

**Tests.** `compiler/core/tests/overloads.rs` — six, and seven mutations, each
failing at least the test that names it:

| mutation | fails |
|---|---|
| shapes from the resolved signature | arity, rest |
| rest position from the resolved signature | rest |
| representation from the resolved signature | representation, arity, rest |
| `defined` without `implementation_of` | external |
| a signature emitted as an abstract declaration | one-per-set, arity |
| a signature refused instead of skipped | one-per-set |
| skipping on the **name** alone | ambient |

The last needed a fixture nothing else in the tree had. Skipping on the name
alone survives every test above, because the guard already excludes anything
with a body — so the sibling check looks unreachable. It is reachable through an
**ambient** class:

    declare class Platform {
      read(a: number): number;
      read(a: number, b: number): number;
    }

Legal TypeScript, two bodiless declarations, and no implementation. With the
check, two refusals naming them. Without it, both are dropped silently and the
caller reports `NTS1003 ... which was refused above` — with nothing refused
above. One diagnostic instead of three, and the survivor points at a refusal
that does not exist.

**Memory.** `tooling/memory/cases/overloaded-call` — **0 / 0**, argued before
measuring and exactly right. An overload set is erased before anything is
emitted, so there is nothing to allocate for the choosing; the one argument that
is not a bare double is the omitted `b`, which is `Erased`, and an erased number
is a tag and a payload in registers rather than a box. A lowering that boxed it
would read four per iteration. The **rest** overload is deliberately absent: its
empty array per call is one allocation each, and record 0092 measured that exact
shape at 17/17 with a floor of zero that cannot be reached while `ArrayNew`
carries no `frame` flag.

**No benchmark row**, and the reason is measured rather than asserted, the way
0095 measured `delete`. The same function called through an overload set and
called directly emits **byte-identical C**:

    $ nts emit-c overloaded/ > a.c ; nts emit-c plain/ > b.c ; diff a.c b.c
    $

An overload set is a compile-time question with no run-time residue. There is
nothing here to time.

## Ratchets

- `examples/overloads` — 145 cases, three lanes.
- `examples/unsupported` — the `Overloaded` fixture moved out, as that file's
  own header instructs when a construct lands, and was replaced by the ambient
  class, which is refused and is meant to stay so.
- `compiler/core/tests/overloads.rs` — six tests, seven mutations.
- `compiler/core/tests/abstract_methods.rs` — its overload test replaced by the
  ambient one, which is what remains of "a bodiless method that is not
  abstract".
- `tooling/memory/cases/overloaded-call` — 0 / 0.
- `tooling/gate/all.sh` — the profile ceiling lowered 9600 → 9350.
- `docs/conformance/typescript.md` §3 — the row now says what is true, and says
  that it did not. §12's `date and time` corrected in the other direction, from
  ✗ to ◐, naming the three entry points it has and the clock and calendar it
  does not.
