# 0072 — `resolve` is not a value

`new Promise(executor)` was the second-largest language gap and had a stated
reason for being hard, written in the example that held it:

> The executor is the hard half: the constructor calls a function it supplies
> `resolve` to, so `resolve` is a closure over the promise, and settling has to
> reach back through it. That is a real piece of work and it is not done.

The premise is wrong, and one word in the specification says why: the executor
runs **synchronously**. `new Promise(f)` calls `f` before the constructor
returns. So when `f` is written at the call — which is how essentially every
executor is written — its body belongs at the construction site, and `resolve`
and `reject` never have to become values at all.

    NtsPromise * later(double v0) {
        v1 = nts_promise_new();
        nts_promise_fulfill_number(v1, v0);
        return v1;
    }

That is the whole of `later`. No closure, nothing captured, and `resolve(n)` is
the same helper an `async` function's `return` already emits — `settle` was
reusable unchanged, which is the sign the shape was right.

It is the same trick, and the same refusal, as an array method whose callback is
inlined: an executor that arrives as a *name* is a genuine indirect call, and
answering that needs the real closure the old comment described. It says so
rather than guessing.

## The other refusal, which is the deferred pattern

    new Promise(r => { saved = r })

`resolve` used as a value rather than called. This is how a deferred is made,
and it is refused — with a message that says the executor would have to become a
real closure over the promise, rather than the "`resolve`, a name from an
enclosing scope" it first produced, which is true of the symbol and explains
nothing.

## Two wrong answers at the seam with 0071

Neither existed yesterday, and one of them was *created* yesterday. Writing the
first `new Promise` test found both.

**A `throw` in an `async` function ended the program.** node rejects the
promise; this called `nts_uncaught` and exited. It now rejects the promise it
already owns and hands it back, which is exactly what its `return` does through
`settle` — the reference and not the erased value, because a reason is an
`NtsHeader *` and a thrown number has no pointer to store. That was wrong
before 0071 too; nothing could see it, because `nts_thrown` also ended the
program.

**A rejected `await` inside a `try` did not reach the `catch`.** This one 0071
created. A resumption's rejection goes to one shared exit that rejects the
function's own promise, and `suspend.rs` says why in a comment that was true
when it was written:

> With no `try`/`catch` across an `await`, rejecting this function's own promise
> is the whole of what a rejection can do.

There is a `try`/`catch` now. So `try { return await failing(n) } catch { return
-99 }` compiled, ran, and rejected where node returns −99 — a wrong answer, not
a refusal, which is the worst thing this compiler can produce. It is refused
now: *a `catch` that spans an `await`*, beside the `finally` that spans one,
which has been refused for the same kind of reason for longer.

The fix is known and is the same question `throw` across a call asks: a
suspension has to record which handler it is inside, so its rejection branch can
jump there with the reason rather than to the shared exit.

## The premise that had already expired

The example was in a file of its own because a `new Promise<T>` in a file was
said to cost every *other* promise in it its type arguments — "not yet
understood", and the reason four working functions were moved out of
`async-unsupported`.

It does not reproduce. An `async` function returning `Promise<number>` compiles
and agrees with node in the same file as the constructor. Something fixed it
and nothing noticed, which is the same shape as the stale `lower_throw` comment
0071 found: a note about a limitation outlived the limitation, and the next
person to read it would have budgeted for work that was already done.
