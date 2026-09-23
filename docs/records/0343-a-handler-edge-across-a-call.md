# A handler edge across a call

    function raiser(n) { if (n >= 0) throw new Error("raised"); return n; }

    try { throw new Error("x"); } catch { return 5 }   caught
    try { return raiser(n);    } catch { return 5 }   refused

Node answers 5 to both. The second was refused, because a `throw` lowers to a
jump to the handler's *block* and a callee has no edge to its caller's blocks.

Record 0246 measured how much of the corpus that costs and stated the price of
fixing it: "the plumbing is an afternoon, the leak is the design". `NtsLanding`
is a `jmp_buf` stack and a `longjmp` out of compiled code does not run the
releases reference counting inserted between the throw and the frame it lands
in, so a thrown-through call leaks -- and because the throw path here is
*validation*, it would leak on ordinary input.

## Nothing jumps

`lower_try`'s own header had already said what to do instead, about the case it
could do:

> An unwinder's tables exist to *recover*, from a machine frame at run time,
> which values that frame owns; this compiler computes that at compile time
> already, in `super::own`, and `super::rc` emits the releases an edge implies
> for every other edge in the program. A handler edge is not a special kind of
> edge, so it needs no special machinery -- it needs to be an edge.

So the callee leaves by an ordinary `return`, and so does every frame between it
and the handler. `nts_raise` records the value on the environment and returns;
the caller tests `nts_raising` and branches. Every edge on that path is an edge
`rc` already emits releases for, which is 0246's objection answered by
construction rather than with a cleanup list.

    %r = call.extern nts_raising()
    br %r != 0, took, carry_on
  took:
    %v = call.extern nts_raise_take()
    jump handler(%v, ...)          -- or, with no handler here, a `ret`
  carry_on:

The test is emitted **immediately after the call**, not at the end of the
statement: the callee returned a value of the right width and no meaning, and
`f(g())` with `g` raising would otherwise call `f` with a zero.

## A copy, because one body cannot answer both

A `throw` nobody catches must end the program -- that is what node does, and
every caller compiled so far expects it. A `try` around the call needs the
opposite. The two cannot be one body, so the callee is compiled a second time:
a **raising copy**, suffix `@raises`, exactly as a generic instantiation or a
structural cast is copied, named through the same `generic_calls` map.

**The invariant that makes it sound is that a raising copy is named only by a
site that tests.** An ordinary call still names the plain function and still
ends the program on an uncaught throw. Nothing that was correct becomes a wrong
answer by the copy existing, no boundary learns anything, and the cost on every
path that does not use a `try` is zero.

## What it does not reach, and why the bound is where it is

- **A method, a constructor, an accessor.** `function_copies` is consulted for
  `FUNCTION_DECLARATION`s, so there is no copy to name. The same boundary
  `blockers/an-interface-reached-by-six-routes` records for the structural
  copies, drawn by the same line of code.
- **A bound foreign member**, which can raise on the JVM lane and has no body
  here to copy.

The refusing arm is in `examples/a-throw-that-stays-in-its-function` beside the
ones that must keep compiling, and asserted by name -- record 0300 is why.

## A chain of callees, and the fixpoint has to be the greatest one

The first version stopped at a callee whose every `throw` was its own, because a
copy of a callee that only *passes a throw on* would call the plain one and end
the program -- a `try` that compiles and still does not catch, which is worse
than a refusal.

Closing it is a copy of a copy, and the set has to be computed the other way
round:

> `f` is copyable when `f` is a plain function this compiler can copy, and every
> callee of `f` that can raise is itself copyable.

**Optimistic, then shrunk.** A least fixpoint grows from functions that call
nothing, which admits a caller before its callees are established; this assumes
every plain raiser qualifies and removes any that reaches one that does not.
Recursion stays in, which is right -- `f` calling `f` is satisfied by `f`, and a
least fixpoint would drop it.

Run twice, at two levels, and the second is not redundant. `Throwing::copyable`
is over **symbols**, and copies are keyed by **declaration**: a symbol with an
overload signature beside its implementation answers for one of them, and a call
resolving to the other would be left calling the plain function. So
`raising_copies` shrinks again over the declarations' own bodies, with the same
predicate `calls_compiled_code` uses -- an indirect callee counts as able to
raise -- and what a copy may contain and what a `try` may contain stay one rule.

And a third arm in the example, because two frames is satisfied by a closure
that runs one round and stops.

**Unbounded recursion is deliberately not an arm.** A `countdown` that throws at
the bottom compiles now, and a large `n` overflows the C stack and takes the
process where node raises a catchable `RangeError`. That divergence is older
than this feature and reachable with no `try` at all -- the same shape with no
throw already disagrees with node -- and it is recorded nowhere, which is worth
someone's attention and is not this.

## Measured

    runtime/node, 25 modules     before   self-contained   +transitive
    NTS1001 sites                 1,298          1,293         1,284
    NTS1001 occurrences          14,651         14,629        14,695
    definitions                  29,968         29,968        29,968
    NTS2006 / NTS2009 / NTS1005            unchanged throughout

Sites fell by 14 while occurrences rose, and the two disagree for a structural
reason rather than an interesting one: **a copy is a body**, so every refusal
inside a copied function is reported once more. Definitions identical module for
module is what says the rise is a second reading rather than a second defect.
The gate's ceiling carries that sentence now, because this number will drift up
as more callees become copyable and the site count is the one to read.

Sites cleared in `stream` (6), `fs` (5), `url` (3), `zlib` (2), `events` (2),
`web-platform`, `util` and `timers`. Some `try` blocks moved one call along
rather than clearing: a `try` whose first call is now handled reports its
*second*, which is the compiler naming one blocker at a time.

    agreements                    4 disagreeing -> 1
    a-throw-across-a-call         DISAGREES -> agrees
    exception-seams               DISAGREES -> agrees

Definitions did not move, and that is the honest reading: the functions holding
those five `try` blocks still refuse for other reasons. What moved is
conformance -- two fixtures that ran and were wrong now run and agree.

## Three things found on the way, each of which passed a build

**A function-valued `const` was outside the throwing set.** `const f = () => {
throw ... }` declares `f` at the *variable*; the arrow is its initialiser. The
set was keyed on the declaration's own kind, so `f` looked unable to raise and
`try { f() } catch` **compiled and threw** where node answers 5 -- on every
binary before this one, while the two siblings spelled `function` were correctly
refused. Three spellings of one program and two of them right.

**A raising copy inherited `export`, and `exported` is what keeps a function
alive through `hir::dce`.** Every copy became a root: 41 in `runtime/node/fs`
alone, each emitted twice and called from nowhere. The export surface names the
plain function; the copy is internal.

**A copy is a body, so an unreachable one re-reports its refusals.** Making a
copy for every qualifying function and trusting `dce` to drop the rest added
**+273 NTS1001 and +400 NTS1003 occurrences against zero definitions** -- noise
that reads like a regression, over the gate's ceiling. `calls_guarded_by_a_try`
answers reachability syntactically before any body is lowered.

And one promise not made: `nts_raising` is **not** `NTS_READS_ONLY`. `pure` says
the result depends only on arguments and memory, and this takes none, so a
compiler that cannot see the write may answer the second call from the first.
The check exists to catch a raise; one the optimiser folded away would be
invisible in exactly the way that matters, and it costs a load beside a call
that has already happened.
