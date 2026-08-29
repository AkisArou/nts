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

## Correction: what `919efb0` actually contains

That commit's message describes about a third of it. It carries 174 lines of
`runtime/c/nts_runtime.{c,h}` that are the **NodeJS session's** work, not mine:
`nts_promise_fulfill_value`, `nts_promise_value`, `NTS_PAYLOAD_VALUE`, the
promise's `tag` field, and the forwarder arm — the design they proposed and I
agreed to in preference to my own. The comment on the union member is their
wording. Their test for it is `6748d06`, eighteen checks, sabotaged five ways.

Recorded here rather than by rewriting the commit: their commit sits on top of
mine and they have cited its SHA, so rewriting mine to tidy my message would
rewrite theirs to pay for my mistake.

**The mechanism, because it has now happened twice in these same two files and
in both directions.** A private `GIT_INDEX_FILE` protects against staging the
other session's *files*. It does nothing about the other session's changes to a
file *you* are also staging, because `git add -- <path>` takes the whole file as
it stands on disk. Saying which files you hold edits in is necessary and was not
sufficient — neither of us said it, either time.

What would have caught it, and needs no coordination: `git diff HEAD -- <file>`
before staging any file the other session might be in, and `git show --stat` on
your own commit immediately after making it. Both times the line count was the
tell. A commit that claims to add a type and adds 174 lines of runtime is
visibly wrong at a glance, and neither of us looked.

# Deferred work, so it is findable

Written down because the alternative is a comment at one call site and a
sentence in a commit message, and neither is somewhere you would look when
asking "what is left to do here". Ordered by what the measurement says they are
worth, not by effort.

## 1. Specialize by verdict — the reason the measurement exists

Every erased site pays the general sixteen-byte representation today. The
measurement says **41% of `unknown` parameters are carried and 14% are tested**,
and `docs/any-unknown.md` is explicit that "programs that never require general
erased storage should not pay for a general erased-value runtime".

`nts erasure` already computes the verdicts. The work is consuming them: a
carried-only site whose reaching values are all references can be a plain
pointer; a tested-only site can be a tag with no payload. This is the largest
single win available and it is the one the whole record was written for.

## 2. Fold `typeof v === "number"` to an integer compare

Today it calls `nts_tag_name`, which **allocates a string**, and then compares
strings. Almost every use of `typeof` in real code is exactly this shape —
compared against a literal — so the allocation is on the common path.

The fix is a peephole: match a comparison whose operand is a `TagOf` and whose
other side is a string literal, and replace the whole thing with `TagOf ==
constant`. Deliberately *not* done inside lowering, because that would put the
tag-to-spelling table in two places and the two could disagree; as a peephole
over correct code it reads one table.

Nothing in the profile is affected yet — none of the erased code lowers — so
this is cheap to defer and should not be deferred past the first program that
uses `typeof` in a loop.

## 3. References in an erased value

Refused in both directions: erasing a string or an object, and unerasing to
one. A payload that is sometimes a pointer needs retain and release that switch
on the tag, and refcounting that is subtly wrong frees something still in use,
later, somewhere else.

The promise half of this is already solved, by the NodeJS session, and their
answer generalises: **decompose at the boundary rather than storing the union**.
A fixed-offset descriptor cannot express a slot that is a reference only when
its tag says so, so anywhere an erased value is *stored* — a field, an array
element, a promise payload — wants the tag beside an existing typed slot rather
than the struct whole.

## 4. `any`, which is not on this list

`any` gets no representation, now or later. That is the document's rule and not
a gap: it is the checker announcing it has stopped providing safety, and a
representation would accept the escape hatch the rule exists to close. An `any`
is legalized from evidence or refused.

# Phase 2: what erasure costs at run time

Every earlier number here was static -- bytes, instruction counts, emitted
lines. None of them says what a program *does*. `benches/cases/erasure-*` are
paired programs, identical but for `unknown` where the control has `number`, so
the ratio between their `nts` columns is the cost of erasure and nothing else.

| | typed | erased | cost |
| --- | ---: | ---: | ---: |
| through small functions | 191.75 us | 191.74 us | **0%** |
| stored in an array (2,000) | 99.32 us | 110.41 us | **11%** |
| stored in an array (500) | 91.31 us | 93.52 us | **2.4%** |

## The three rows say different things, and the third is the useful one

**Through small functions, erasure is free.** Not nearly free -- 191.75 against
191.74. With `-flto` clang inlines the erased boundary away, the sixteen bytes
never reach memory, and the `typeof` is an integer compare since the fold. The
representation costs nothing it cannot see.

**Stored in memory it costs 11%**, and the obvious reading is that this is the
tag test. It is not.

**The third row is the same program with a smaller array**, sized so that both
fit in L1 where the 2,000-element pair does not. The cost falls to 2.4%. Same
tag test per element, same branch, same work -- the only thing removed is the
cache pressure of sixteen bytes where eight would do.

So the 11% is roughly **2.4% tag test and 8.6% memory traffic**, and the split
is what orders the rest of the work.

## What that changes

The plan had specialization before NaN-boxing, on the grounds that 55% of sites
need only a pointer or a tag. The measurement says otherwise:

- **NaN-boxing removes the larger half and removes it everywhere.** Sixteen
  bytes to eight halves the traffic for *every* erased value, including the
  genuinely mixed arrays that no specialization can collapse. It is also the
  smaller change -- the runtime header and one emitter, which is precisely why
  `HirType::Erased` names no layout.
- **Specialization removes both halves, where it applies.** A site proven to
  hold only numbers becomes a `number[]` with no tag at all. Strictly better
  than NaN-boxing on the sites it reaches, and it reaches only the homogeneous
  ones.

So NaN-boxing first. It is the bigger win, the more general one, and the
cheaper one, and none of those three was apparent before the third row existed.

## A prediction this benchmark should be held to

`erasure-stored-unknown` holds only numbers. Specialization should therefore
collapse it to the typed case exactly, and the gap closing to zero is what will
show that it worked -- which is a better test than any assertion about the pass.
If it lands and the gap does not close, the pass is not doing what it claims.

# NaN-boxing: tried, measured, reverted

The plan put NaN-boxing before specialization, on the strength of the L1
experiment above: an erased array cost 11% against a typed one, and shrinking
the array to fit in cache took that to 2.4%, so most of the cost looked like the
extra eight bytes.

It was built. Every reader in the runtime, the emitter, the differential
harness and four test suites went through accessors first, so the swap really
was a change to one file. `sizeof(NtsValue)` went 16 to 8, an erased array
reached a typed array's footprint exactly, and `NtsPromise` returned to 56 --
removing the one cost typed async code was paying for erasure existing.

**It bought nothing.**

| | 16 bytes | 8 bytes, NaN-boxed |
| --- | ---: | ---: |
| stored in an array | 110.41 us | 110.29 us |
| through small functions | 191.74 us | 203.10 us |

The memory-bound case did not move — 0.1%, noise. The tag-heavy case got **6%
slower**, because reading a tag went from a field load to a mask, a compare and
a shift. Removing the NaN canonicalisation changed nothing (203.36), so the cost
is the decode and not the encode.

## The part that matters more than the result

**It falsified the L1 experiment, and that experiment was mine.**

If the 11% had been the extra eight bytes, halving the value would have removed
it. The footprint is now identical to the typed array's and the gap is
unchanged. So the 11% is the per-element tag test, and the earlier reading was
confounded: that experiment changed the array size *and* the round count
together, and attributed the difference to cache.

Two variables, one conclusion, and the conclusion was wrong. It survived being
written into this record and into a commit message, and what caught it was not
review -- it was building the thing it recommended and finding the number did
not move.

## What it means for the plan

Specialization comes back to the front, and for a better reason than it had
before. The cost is the tag test; the only thing that removes a tag test is not
having a tag, which is what specializing a homogeneous site does.
`erasure-stored-unknown` holds nothing but numbers, so it should collapse to
`erasure-stored-typed` exactly -- and the gap closing is the evidence.

NaN-boxing is not ruled out forever. It is ruled out as a *performance* change:
it is a space change, worth revisiting only where space is the constraint, and
the accessors it required have been kept so that revisiting it is cheap.

# Specialization: an `unknown[]` of one kind stops being erased

The prediction this record made was that `erasure-stored-unknown` -- an
`unknown[]` holding nothing but numbers -- should collapse onto its typed
control exactly, and that the gap closing would be the evidence.

| | typed | erased | gap |
| --- | ---: | ---: | ---: |
| before | 98.01 us | 110.41 us | 11% |
| after | 98.01 us | **97.11 us** | none |

The emitted C contains no `NtsValue` and no tag read at all. `unknown[]`
compiles to what `number[]` compiles to.

## What the pass is allowed to do

An array whose element type is erased, allocated in this function, that never
escapes, and every store of which erases a value of the same representation:
the element becomes that representation, the erasures before the stores go, and
the reads come back concrete.

## What it must not do, which is most of it

**Aliasing is the whole risk.** If the array escapes, another function may
store a string into it, and an element typed `f64` would then read a pointer as
a double -- silently, because nothing at run time would notice. So
`escape::is_frame_local` decides, and anything it cannot prove is left alone.

Conservative three times over, and each one is a case that would otherwise be
wrong rather than merely missed:

- stores that disagree sink the array, because it genuinely needs a tag;
- a store of a value that was erased *elsewhere* sinks it, because that tag was
  chosen by another site and unwrapping it asserts something about that site;
- a read used as anything but an unerase or a tag read sinks it, because such a
  use wants the general representation.

`compiler/core/tests/programs/erased-mixed` is the negative case and matters
more than the positive one: half numbers and half strings, and the tags stay.

## Where this leaves the plan

The 41% of `unknown` parameters that are *carried* and the 14% that are
*tested* still pay the general representation, because this pass covers arrays
inside one function and not parameters across them. That is the next increment
and it is monomorphization: a function whose erased parameter is only ever
reached by one representation gets a copy taking that representation, which is
what `generics.rs` already does for type arguments.

What this one establishes is that the win is real and the measurement can see
it, which was not certain before -- NaN-boxing looked equally promising and
bought nothing.

# Specialization, part two: parameters

The array pass covered one function. This one covers the boundary between them,
which is where the measurement said most of the population lives: 41% of
`unknown` parameters carried, 14% tested.

A function that is not exported, is not in any method table, whose every call is
direct, and whose every caller passes a fresh erasure of the same
representation, gets that representation as its parameter type. Inside, the
unerase becomes the identity and the tag read becomes a constant.

It is monomorphization with a different driver. `generics.rs` copies a function
per set of type arguments; this retypes one per reaching representation, and it
can retype rather than copy precisely because it only fires when every caller
agrees -- there is one copy to make.

## Both benchmarks are now at parity

| | typed | erased |
| --- | ---: | ---: |
| through small functions | 191.90 us | 191.73 us |
| stored in an array | 97.98 us | 97.88 us |

`unknown` costs nothing in either shape. That was not true four hours ago and it
is not true of the general representation -- what changed is that neither
benchmark needs the general representation any more, which is the whole point.

## Which is also the honest limit of it

Both benchmarks are homogeneous by construction. The pass declines on
`examples/unknown`'s `kind`, which sees a number from one caller and an
already-erased value from another, and on
`tests/programs/erased-mixed`, whose array holds numbers and strings. Those
still pay the general representation, and should: they need it.

So the claim is not "erasure is free". It is that **erasure is free where it was
not needed**, and the compiler can now tell the difference. What remains paying
is the genuinely polymorphic population -- the 31% the measurement calls
*examined*, plus every site two kinds reach.

## What is left on this axis

- **Fields and globals.** An erased class field or module-scope binding gets the
  same treatment an array element now gets, and by the same argument.
- **Returns.** `keeps(value: unknown): unknown` stays erased because its return
  type does, even where every caller unwraps it immediately.
- **Copies rather than retypes.** Where callers disagree, `generics.rs`-style
  duplication would give each its own specialization instead of sinking the
  site. That is the version the document calls polymorphic recovery, and it is
  strictly more than this.

# A union is a closed erased value

Heterogeneous unions were unimplemented -- `number | string`,
`number | undefined` and a union of object types all refused, and only a union
whose members shared one representation (`"on" | "off"`) worked. They are
implemented now, and almost nothing was built for them.

A union and `unknown` want the same machine value. The difference is what the
checker knows, not what the machine holds:

| | tag domain |
| --- | --- |
| `unknown` | any of five |
| `number \| string` | one of two |
| `number \| undefined` | one of two |

So a union lowers to `HirType::Erased`, and `Erase`, `TagOf`, `Unerase`, the
collector's erased slots, the `typeof` fold and both specialization passes all
apply to it unchanged.

## `number | undefined` is why a union needs a tag

A nullable *reference* has always worked here: the absence is a null pointer.
A nullable number cannot be, because a double has no spare bit pattern to be
absent in — which is exactly the situation a tag exists for. The old code said
so, in the line that refused it: "nowhere to put the absence."

`undefined` reaching an erased slot is `ConstNull` with an erased type, and
`v === undefined` is a tag test in which neither operand is ever built.

## Naming: kept, and the prose corrected instead

`NtsValue` and `HirType::Erased` both keep their names, deliberately.

Naming the mechanism after either source construct would be wrong for the
other, and both produce it. `Erased` is accurate for a union too: the
*specific* type is erased at compile time and recovered from the tag, which is
the same fact with a smaller domain. What was wrong was a dozen comments
written when `unknown` was the only source; those say what the thing is now.

## What is still refused, and it is a different problem

A union of object types — `{kind: "circle"} | {kind: "square"}`. Every member is
a pointer, so the *value* is representable; what is missing is that a field
lives at a different offset in each member, so reading `v.kind` needs the
layouts reconciled or the discriminant tested first. Discriminated unions are
not the same feature as this one and should not be assumed to fall out of it.

The refusal says so now. It used to say "`kind`, a property of a value with no
fields", which is the wrong sentence about something that has several sets of
them.
