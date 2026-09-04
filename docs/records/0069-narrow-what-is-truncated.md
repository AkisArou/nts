# 0069 — Narrow what is truncated

`absences` is 2.12x, the largest LLVM-versus-C gap, and 0067 established it is
ours: the C backend's own program through `clang -x ir` runs at 186.6ns against
187.4 as C, so the ingestion path costs nothing and the whole gap is what we
emit. This is the fix, measured, and sound.

## The number

Editing the bench's own `absences.specialized.ll` and relinking against the same
objects:

```text
baseline                                 397.7 ns
induction variable kept i64, rest i32    188.1 ns
every i64 narrowed (unsound)             188.1 ns
C backend                                187.5 ns
```

The sound version is worth the entire gap. Parity with the C backend, and with
C++ at 186.5.

## Why every partial test said no

Eight hypotheses were refuted before this one, and three of them were partial
versions of it:

    the string-length chain alone     no change
    the payload chain alone           397.97 against 397.6 -- no change
    both, without the rest            no change

The transformation only pays applied **transitively**. One narrowed chain feeding
a widened one converts at the boundary and nothing is saved; the whole
`toint32`-terminated subgraph has to move together. Each partial test looked
like a refutation of the idea, and was a refutation of a fraction of it.

That is the shape of the mistake worth keeping: a change with a threshold reads
exactly like a change with no effect, right up until the last piece.

## Why it is sound

`add`, `sub` and `mul` are congruent modulo 2^32, so a chain whose result is
`ToInt32` computes the same answer at 32 bits as at 64. `absences` is
`total = (total + (held ?? -1)) | 0` -- every accumulation ends in a `| 0`.

The induction variable is the exception and must stay `i64`: `n = 256 + (seed |
0)` reaches 2^31+255, and `i` is *compared* against it rather than truncated, so
narrowing it changes behaviour. Keeping it costs nothing — the IV already
reaches its data uses through `trunc i64 %v11 to i32`, three of them, and only
the payload took it whole.

## The rule

A value of integer type wider than 32 bits, every use of which is either
`ToInt32` or an `Add`/`Sub`/`Mul` that is itself narrowable, can be computed at
32 bits. Transitive, and excluding any value reaching a comparison or a call.

Where it belongs is `hir`, after specialization, so both backends get it — the C
backend already gets this from clang for free, which is exactly why its column
does not show the gap, and it should not depend on that.

## Built

`hir::narrow`, a fixpoint that starts optimistic and removes: every value wider
than 32 bits whose definition is retypeable begins in the set, and any whose use
can observe its width comes out. Starting pessimistic takes nothing, because the
chains are cyclic through loop parameters — an accumulator's width depends on
its own.

It runs **before `shed_erasure`**, which is not incidental: that pass removes
`x | 0` once `x` is an `i32`, and those truncations are exactly the evidence
this one reads. Run after, it would find nothing. And before `reconcile`, which
inserts the one truncation the boundary needs.

```text
absences   2.12x C++ -> 1.02x,  0.51x node -> 0.24x,  0.62x bun -> 0.29x
           LLVM 402.3ns -> 189.8ns, against the C backend's 188.7
```

`array-predicates` came along for it: 1.24x to 1.12x. The gate is green on all
thirteen steps and the memory suite is at every floor.

Seven tests, and the ones that matter are the refusals: a value that is compared
keeps its width, a value that is returned keeps its width, and **one observing
use sinks the whole chain** — the shape that made three partial attempts read as
refutations of the idea.
