# A slot with nowhere to put the absence

    unescapeBuffer("%0日")
      nts:  refused: index 26085 is outside [0, 256), core dumped
      node: "%0�"

`querystring`'s `unhexTable` is 256 entries and `nextChar` is a `charCodeAt`,
so it can be anything. The source handles it on the line it reads it:

    const hexLow = unhexTable[nextChar] ?? -1;
    if (!(hexLow >= 0)) { out[outIndex++] = 37; continue; }

A refusal costs a test. This costs the process, and it is reachable from three
characters any query string can contain. Found by the Node lane's differential.

## The compiler had the fact

`noUncheckedIndexedAccess` is on in `runtime/node`'s config, so tsgo already
types that read `number | undefined`. The `??` is not the author being
defensive — it is the author doing what the type demands. So this was a decision
in the lowering rather than a gap in what it knew, which is a much better place
to start from than the reverse.

The decision was deliberate and its comment says why:

> The element's representation comes from the *array*, not from the access
> node's type. Under `noUncheckedIndexedAccess` that type is `number |
> undefined`, and **there is no `undefined` to put in a double**.

That sentence is correct, and taking it literally is the whole fix. It is a
statement about the *slot*, not about element access — so it applies exactly
where the slot cannot represent the absence, and nowhere else.

## Three narrowings, two of which came from measurement

`nts_array_element` already answers `undefined` out of range, already exists for
the case a guard proved an array without proving what it holds, and is already
emitted by all three backends. So this is a routing decision and not an ABI
change — nothing to coordinate.

Routing every erased-typed access there was wrong three times over.

**`xs[i]!` must keep the trap.** Under this flag the checker types *every*
element access `T | undefined` and narrows only at the parent, so the access
node cannot tell `xs[i]!` from `xs[i] ?? d` on its own. The first version routed
both, and every counted loop in the corpus would have paid a call and a tag test
for an index the author had already sworn to. An abort on a violated `!` is the
documented bargain and it stays.

**`unknown[]` must keep the load.** Its slot *can* hold the absence, so paying a
call to discover that buys nothing. `benches/cases/erasure-stored-unknown` reads
`values[i]` 200,000 times in its inner loop, and the wide rule turned that load
into a call **in the hottest loop of a benchmark**.

That one was caught by emitting the benchmark program and counting the calls —
1 with the wide rule, 0 with the narrow one — **before any timing was run**.
Worth naming as a technique: a representation change that adds a call can be
falsified by looking for the call, and zero calls has no error bar. Timing would
have taken a quiet machine, a bench window negotiated with another lane, and a
number with a confidence interval, to answer a question `grep -c` answered
exactly.

**A view keeps the trap**, because `nts_array_element` opens with
`if (!nts_is_array(array)) abort()` and a typed array is an `NtsView`. Routing
one there trades an abort for a different abort, and a worse one: it would read
as a proof failure rather than an out-of-range read.

## The fixture measured a different language than the corpus

The first probe was written against `tsconfig.fixtures.json`, which does not set
`noUncheckedIndexedAccess`. The `??` folded away before lowering saw it, the HIR
read `array.get` straight into a comparison, and the fixture agreed with node
about a program that was not the one under test. Nothing in the output said so;
the tell was that the fix appeared to do nothing.

The example sets the flag itself and says why in its header. Any fixture about
indexing has to, or it is about a different language.

## What is left, and where

`blockers/an-out-of-range-read-that-still-traps` carries both remaining halves,
guarded by `lacks-c nts_array_element` — which guards the *decision* rather than
the defect, because no fixture can assert an abort: the process is gone before
anything reads the result. The answer-level record belongs in `agreements/`.

The erased-slot half has a cheap proper fix that was not taken today:
`ArrayGet` can *answer* the undefined tag out of range, because that slot has
room for it, with no call at all. The view half wants a view-shaped helper.

Controlled by adding the routed read to the fixture, which reported
`FIXED ... the backend now emits it`. `FIXED` rather than `REGRESSED`, because
an absence form reads presence as resolution — right for a `lacks-c` filed
against something that should stop being emitted, and misleading for one filed
against something that should stay absent.

174 cases in the example agree with node, 146 blockers as expected, 0 calls in
the benchmark program.
