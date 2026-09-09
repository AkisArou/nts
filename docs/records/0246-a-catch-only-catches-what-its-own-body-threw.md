# A catch only catches what its own body threw

    function raiser(n) { if (n >= 0) throw new Error("raised"); return n; }

    try { throw new Error("x"); } catch { return 5 }   caught
    try { return raiser(n);    } catch { return 5 }   escapes

Node answers 5 to both. The Node lane found this with `agreement.mjs` and
narrowed it in seven more cases: the catch binding, a rethrow reaching an outer
catch, a thrown number arriving as a number, and `finally` after a caught
exception all agree. Everything that crosses a call escapes.

## It is not that the catch misses. The `try` is deleted.

    double fromACall(double v0) {
        double v1;
        v1 = raiser(v0);
        return v1;
    }

No landing pad, no catch block, nothing. And the working case is not exception
machinery either — `inTheBody` compiles the `throw` into `return 5.0`, because
the lowering can see statically which catch a lexically-enclosing throw reaches.

So there are two different things here that look like one feature:

    a throw inside the try's own body     routed at compile time, correct
    a throw from anything it calls        no mechanism at all

`grep -c landing compiler/core/src/hir/lower.rs` is **0**. Same for the C
backend. A `throw` in a function not lexically inside a `try` becomes
`nts_uncaught`, which in a standalone program prints and exits and in an addon
unwinds to the boundary and out — which is why it looks like "escapes" from
outside rather than "aborts".

## The mechanism is already built, and the decision not to use it is written down

`NtsLanding` is a stack with `previous`, `thrown` and `detail`. `nts_uncaught`
already walks it, pops the innermost, stores the value, and `longjmp`s. A `try`
needs `setjmp` plus `nts_landing_push` on entry, a jump to the catch on the
non-zero return, and `nts_landing_pop` on the ordinary way out. That is the
whole of the plumbing.

It was left at the boundary deliberately, and `nts_runtime.h` says why:

> a non-local jump out of compiled code does not run the releases that the
> reference-counting provider inserted between the throw and this frame, so a
> thrown-through call leaks whatever those frames held. That is the same trade a
> C program makes with `longjmp`, it is bounded by the throw being exceptional,
> **and it is why this is at the boundary rather than inside the lowering — an
> ordinary `try` never comes near it.**

The reasoning is sound and the last clause is false of this corpus.
`internal/validators.ts` throws and every caller catches; node's own tests are
largely `assert.throws(() => …)`. A throw here is not exceptional, it is the
validation path, and it runs on ordinary inputs.

**This is the most useful kind of stale decision: correct when made, documented
with its own premise, and falsified by a measurement of the corpus rather than
by an argument.** Nothing had measured how often a `try` contains a call until
`agreement.mjs` existed.

## What it costs to fix, stated rather than started

The plumbing is an afternoon. The leak is the design.

Under `Provider::NoGc` nothing is ever released and a `longjmp` costs nothing,
so a first version is correct there and the memory gate would not see it. Under
reference counting every throw through a frame leaks what that frame held — and
because the throw path here is *validation*, that is a leak on ordinary input
rather than on a rare one. The gate's `memory` step says "nothing leaked" and
would be right to fail.

So the work is an unwind that runs the releases: a per-frame cleanup list the
landing walks, or an error-return discipline that never jumps at all. Choosing
between those is a representation decision of the same size as the erased-slot
one, and it belongs to whoever has a whole session for it rather than to the end
of this one.

## What the axis figure does not cover

38 compiled passes, 29 behaviour-dependent, is exactly what it says and is a
narrower claim than it reads as: those 29 demonstrate behaviour in which no
exception crossed a call. The Node lane has not revised the number, which is
right — it is what it measured — and has written into the ledger what it does not
reach.

## And the example that would have hidden it

I wrote one. `gate.sh` reported **"agreed on every case"** — over 16 of 145
cases, with 17 *declined* because the compiled program aborted. The declines are
the finding, and the summary line does not say so.

Removed rather than kept. An example that reports agreement while the thing it
was written to test aborts is the fourth vacuous instrument of this session, and
the only one I wrote on purpose.
