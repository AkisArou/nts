# 0019 — What the erased values actually do

`docs/any-unknown.md` argues for whole-program representation analysis, and
argues for it with a table: 174 `unknown` parameters across thirteen `node:*`
modules, sorted by hand into *carried*, *examined* and *tested*. Its own closing
caveat is the reason this record exists:

> The table above is one person's reading of one program, and it is evidence
> about the shape of the problem rather than an input to the algorithm. When
> this is built, the compiler should produce that table itself.

`nts erasure` produces it. Nothing in it decides a representation and nothing in
it refuses a program — it is an instrument, built before the thing it is meant
to inform, so that the design is checked against real code rather than against
an intuition about real code.

## What it measures

Every declaration whose checker type is `any` or `unknown` — parameter,
variable, or field — and what the program does with the value:

- **carried** — only moved. Stored, passed on, thrown, assigned. Nothing reads
  it on any reachable path. A pointer would do.
- **tested** — narrowed by a type test, and everything that happens afterwards
  happens to the narrowed type. A tag and a branch would do.
- **examined** — read as a value: a property, a call, arithmetic, a coercion,
  an equality against another erased value. This is the case that needs general
  erasure.
- **unclear** — a use the pass cannot follow. Reported rather than assumed,
  because rounding it down to the cheap answer is how a measurement talks
  itself into the representation it was hoping for.

Each use is classified on its own and the site takes the strongest. A use that
hands the value to another erased site is a *flow edge* rather than a verdict,
and the set is iterated to a fixpoint — so a parameter that only passes its
value on inherits whatever the receiver does with it.

## The node profile, 566 `unknown` parameters

The whole profile compiled as one project, so the analysis can see across
modules the way the document says it must. Taken at `a347b67`, `runtime/node`
clean — named because the NodeJS session lost a factor of two to an unlabelled
number and the label is what got it corrected: a plausible figure does not
invite a second look.

| | whole-program | judged on its own uses |
| --- | ---: | ---: |
| carried | **227** (40%) | 320 |
| tested | **83** (15%) | 58 |
| examined | **185** (33%) | 127 |
| unclear | **71** (13%) | 61 |

**99 of 566 parameters get a different answer once calls are followed. 34 of
them are decided by a use in another file.**

## Three things the numbers say

### 1. The architectural claim is right, and for a sharper reason than stated

The document says a per-module or per-signature rule cannot find the cheapest
representation. What the measurement shows is stronger: a local rule is not
merely incomplete, it is *optimistic*. Every one of the 99 disagreements moves
in the same direction — a site that looks carried on its own uses turns out to
be examined once the value is followed. 93 parameters that a per-signature rule
would have given a pointer actually need general erasure.

So whole-program analysis is not first an optimization that finds cheaper
representations. Its first job is soundness. A representation planner built on
local evidence would be too small, and wrong in a way that only shows up at the
receiving end.

### 2. The document's own worked example reproduces, exactly

It names `console`'s `unknown` as decided by `formatWithOptions` in `node:util`.
The pass finds that edge without being told:

```
examined  unknown  * console/src/main.ts  dir.object   -- passed to `inspect`, which is examined
examined  unknown  * util/src/format.ts   formatWithOptions.value -- passed to `inspect`, which is examined
examined  unknown    console/src/main.ts  log.args[]   -- passed to `<anonymous>`, which is examined
```

`console.dir`'s parameter is carried within `console` and examined because a
function in a different module reads it. `log(...args)` — the flagship case —
reaches the same answer through its spread.

### 3. The distribution is not the one the document assumed

Its hand count put *tested* at 10 of 174, about 6%, and treated the category as
too small to matter: "the closed-union case does not rescue even the
validators". The compiler finds **83 of 566, about 15%** — two and a half times
the share.

The difference is not a disagreement about the validators. It is that a read of
a value *after* narrowing is not a read of the erased value, and counting it as
one collapses `tested` into `examined`. A first version of this pass made
exactly that mistake and reported 236 examined; using the checker's own type at
the use site — which the snapshot already carries — moved 52 parameters into
`tested`.

That matters for the representation decision. **55% of `unknown` parameters
need only a pointer or a tag**, against the roughly 32% the document's table
implies. The hard case is real and is a third of the population, not two
thirds.

## Where it is honest rather than complete

The 72 unclear parameters, by reason:

- an argument to a function outside the compiled set — the dominant one, and
  the correct answer for a call into a declaration file;
- a value passed to something the pass has not yet decided about, which is the
  fixpoint reporting its own incompleteness rather than hiding it;
- an assignment into a target more complex than a name;
- a return from a function nothing in the program calls.

Returns *are* followed now, to the call sites of the function returning them.
It was expected to be the largest missing edge and it was not: it moved one
parameter out of unclear. Worth recording, because the reason is the shape of
the code rather than the analysis — a returned `unknown` in this profile is
almost always returned from a function whose callers are outside the compiled
set, so following the return arrives at the same wall from the other side.

What is left is dominated by one thing: **59 of the 71 unclear parameters are
arguments to a function outside the compiled set.** That is the correct answer
rather than a gap — the callee is a declaration file, and there is no body to
look at. It bounds what any whole-program analysis can conclude about a program
that links against something it cannot see, which is a fact about the
representation decision and not about this pass.

## Two smaller findings

**The examples corpus has no `any` or `unknown` at all.** Not one of the 60
example programs contains either, so the differential gate exercises none of
this. Whatever representation is chosen will need an example before it can be
compared against node.

**The checked-out TypeScript corpus has 29 erased sites** across 24 candidate
files, and they are overwhelmingly `any` and overwhelmingly carried — a
different population from real library code, and not evidence for a
representation either way.

## What this does not do

It does not choose a representation, and it should not: the question of whether
`unknown` becomes a tagged word, a boxed pointer, or a closed union per site is
a decision about the RFC, not about this pass. What it removes is the excuse for
making that decision from a table someone counted by hand.

# The representation, decided from the measurement

Written before reading `~/Projects/scriptc`, deliberately. The risk in reading
another compiler is not adopting its answer, it is *skipping the derivation* —
and a position recorded first turns that reading into a comparison rather than a
default.

## Scope: `unknown`, and not `any`

`unknown` gets a representation. `any` does not, and that is the document's own
rule rather than a limitation: "no `any` type, unresolved representation
variable, or generic dynamic operation may reach HIR or MIR". `any` is the
checker announcing it has stopped providing safety, and giving it a runtime
representation would quietly accept the escape hatch the rule exists to close.
An `any` value is legalized from evidence or refused, as before.

## One representation now, specialized later

The measurement says 55% of `unknown` parameters are carried or tested — a
pointer or a tag would do — and 31% are examined. The document concludes from
that: "programs that never require general erased storage should not pay for a
general erased-value runtime."

That is right and it is the *second* step. A per-site representation is chosen
by comparing against a fallback, so the fallback has to exist and be correct
first. Building the cheap cases before the general one means every specialized
site is validated against nothing.

So: one general erased value now, and `nts erasure`'s verdicts drive
specialization afterwards. The order is not a compromise — a specialization that
cannot be checked against a working general case is a guess.

## `HirType::Erased`, and the layout is the backend's business

The IR gains one type and three operations:

- `Erase` — a concrete value becomes an erased one, tagged with what it was.
- `TagOf` — the tag, which is exactly what `typeof` needs and what the current
  refusal (`which needs a runtime tag`) names.
- `Unerase` — an erased value becomes a concrete one, at a type the checker has
  already narrowed to.

**The layout is not in the IR.** A tagged struct and a NaN-boxed word are the
same three operations with different sizes, and putting the choice in the IR
would make changing it a refactor of every pass rather than of one emitter.
Sixteen bytes of `{tag, payload}` first, because it is correct and debuggable
and interacts with nothing; NaN-boxing later is then a backend change with the
differential already in place to catch it. "No compat shims across refactors"
is the requirement, and this is what satisfies it.

## Where the correctness actually lives

Not in `Erase` — that is a store. It is in `Unerase`: the checker narrows
`typeof x === "number"` and the *use* inside the branch has static type
`number`, while the declaration is `unknown`. Lowering has to notice that
disagreement and insert the unerase, and it has to be impossible to reach an
unerase the narrowing did not license. That is the one place a wrong answer
would be silent rather than loud, so it is where the examples point.
