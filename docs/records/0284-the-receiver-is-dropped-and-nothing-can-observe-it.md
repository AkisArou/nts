# The receiver is dropped, and nothing can observe it

    const callback = handler.callback;
    const result = callback.call(this, ...args);

    NTS1001 a method `call` with no declaration in the hierarchy

`EventEmitter#emit`, and under it `http.createServer` — 274 failing test files —
and `Readable`/`Writable` at 249. Seventeen `.call` sites across seven modules.

The message was literally true and pointed nowhere: `call` is not a member of
anything this compiler declares, because it belongs to `Function.prototype`.

## What was proposed, measured, and then not built

The obvious design is a receiver parameter in the closure calling convention.
It was measured first, on 300,000,000 indirect closure calls through
`descriptor->methods[0]`:

    (Closure *, double)            0.42 s   (five runs, no variance)
    (Closure *, double, double)    0.45-0.47 s

**~0.13 ns per call, about 0.4 cycles, and ~9% on a loop whose whole body is
the dispatch.** Not free, and `emit` is the hottest dispatch path in the tree.

It is also not necessary, which is the better reason. The receiver can be
*dropped*, and that is a substitution rather than a narrowing because **the set
of function values that could observe one is empty**:

- a `function` expression whose body reads `this` is refused — ``a `function`
  expression that uses its own `this` ``;
- a function *declaration* that does is refused — `` `this` outside a method ``;
- a **method**, whose `this` is a real parameter and therefore observable,
  cannot be taken as a value at all — ``declared by `C` with a type that has no
  representation (a function type)``;
- an arrow has no `this` of its own by the language's rule; it captures the
  enclosing one where it is written, which a call cannot rebind.

Three existing refusals, each argued years apart on its own terms, together
making a fourth thing correct. `blockers/a-call-with-a-receiver-that-is-read`
exists to say so, because a reader implementing `this` in a function body has no
reason to look at `lower_call_with_receiver` unless something points there — and
that day the lowering becomes silently wrong.

## Two things the first cut got wrong

**The signature came from the wrong place.** `f.call(receiver, ...rest)` resolves
to `Function.prototype.call`, whose *own* second parameter is a rest — so the
rest position and the rest element type both described `call` rather than `f`,
and `...args` reached the ordinary argument path as ``a spread element``. The
fix is a `callee_signature` override **keyed by the call node**: an argument may
contain a call of its own, which asks the same two functions with its own node
and so gets its own signature. A bare `Option<TypeId>` would have been inherited
by every nested call in the argument list.

**The receiver's type is not the value's type.** `emit`'s `callback` is a field
declared `Listener`, and that survives; `const f = twoArgs` is a *closure class*
whose id is synthetic, above `SYNTHETIC_TYPE_FLOOR`, with no record in the
snapshot at all. Asking it for a signature answered nothing, so the fixture
refused on all five functions while the module that motivated the work compiled.
The signature is a property of the source the receiver was read from, not of the
lowered value.

## The receiver is evaluated, except where it provably cannot run anything

`f.call(g(), x)` calls `g`. Discarding a value is not discarding its effects.

But lowering the receiver unconditionally refused the whole call with ``null` or
`undefined` where what it stands in for is not a reference`` — `undefined` has no
representation here, and it is what every one of these sites writes when there is
no receiver to pass. So a name, `this`, and the literals are skipped; everything
else is lowered and may refuse. A short list of forms that *cannot* run anything,
rather than an analysis of which ones do: a form missing from it costs a value
nobody reads, and a form wrongly added to it would silently drop a call.

## What moved

**Zero `.call` refusals remain** in `events`, `http`, `stream`, `util`,
`assert`, `dgram`, `async_hooks` or `url` — all seventeen sites lower.

`EventEmitter#emit` now stops one link further along, on `addCatch`, which
refuses at `promise.then(undefined, …)` — an absent callback argument, a
different blocker. Said plainly because [[0283]] recorded the same mistake at
four different rungs in one evening: **the cone moved one link, and no module
publishes anything new.**

## Coverage, and the two forms landing on two guards

    sabotage: remove the hook          differential "nothing to check", ledger 0 -> 5
    sabotage: skip the receiver's      differential, 20 cases on
              side effects             `receiverIsEvaluated`

And a third thing caught it that neither sabotage would have: the fixture
failed under **reference counting** while passing without it. Its accumulator
was a module-scope string, so `order` was still held when the run ended, and the
harness compares what is held after the first case against what is held at the
end — `held 0 object(s) after the first case and 1 at the end`. True, and about
the fixture rather than the lowering: each function passed alone, because alone
the first case is also the one that writes the global. Making the accumulator
local fixed it. A fixture that observes a side effect wants somewhere local to
put it.

The first removes code and the second changes an answer, which is [[0281]]'s
pair again — and the rule that predicts it: **does the break remove code or
change code?** Removed code is caught by counting what is present; changed code
only by running it. `receiverIsEvaluated` exists solely for the second, and
without it the effects half of this lowering would have no guard at all.
