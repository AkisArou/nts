# The frame is the iterator

`function*` was refused as *"needs the `Generator<T>` object"*. There is no
`Generator<T>` object. The frame `hir::suspend` already builds for an `async`
function is one — a state, the locals that outlive a suspension, and somewhere
to put the thing it stopped on — and a `for...of` over a generator is one call
and one field read.

    for (const value of upTo(limit)) { ... }

    b1:  %4 = call upTo__resume(%2) : bool     <- the step and the test
         %5 = not %4
         br %5, b2, b3
    b2:  %7 = field.get %2.1 : f64             <- the element

Nothing per element. `Walk::Protocol` — the walk for a user type with
`[Symbol.iterator]` — has to read `value` and `done` off whatever `next()`
returned; this reads the element off the frame it already has. **A walk of any
length allocates once**, and `tooling/memory/cases/generator-walk` says so at
0 / 0.

## What differs from `await`, which is less than it looks

`suspend.rs` grew a `Mode` and nothing structural. The cut at each suspension,
the liveness question, the spill, the dispatch on a stored state: all identical.

What differs is **who resumes it**. An `await` hands control to the event loop
and comes back through a subscription, so the suspension leaves one behind and
the resumption returns to nobody. A `yield` hands control to the caller, who is
*standing right there* — so the suspension is an ordinary `return`, and the
resumption returns `done` to someone who reads it.

Everything else follows from that one sentence:

- An `async` frame has three fixed fields (`state`, `result`, `awaited`); a
  generator's has **two** (`state`, `yielded`). There is no promise and nothing
  is awaited, and there is no `done` field either — the resumption *returns*
  done, so storing it would be a second copy of one fact.
- An `async` resumption has a rejection-test block per suspension, because a
  promise settles either way. Nothing resumes a generator with a failure.
- The entry function for an `async` function starts the machine; for a
  generator it does **not**. Calling a generator runs none of the body.
- `give_the_frame_back` is `async`-only: the resumption there consumes a
  reference, because it either finishes or leaves the frame with the runtime. A
  generator's borrows it from the loop, which owns it.

## Two passes had to agree about one offset

The `for...of` is lowered long before `hir::suspend` runs, and it has to name
the frame's type and the resumption's function. Neither exists yet.

The resumption's name is derived (`{f}__resume`, from one function so the two
spellings cannot drift into a link error), and `drop_callers_of_refused` had to
learn that **a function about to be split provides both of its names** — without
it every loop over a generator was dropped as calling something refused.

The frame's *type* could not be derived, because an `async` frame is named by
its index in `funcs` and refusals remove functions before the pass runs. So the
lowering **reserves** it — `Func::frame: Option<GeneratorFrame>`, a type id and
the element's representation — and both sides read it from there. One authority,
because the failure mode is a load typed one way against a store typed the
other, at the same offset of the same object: a wrong answer rather than an
error, and invisible to C.

The ids are their own half of the frame space. Sharing a counter with `async`
frames would have them collide in any program with both, and the two counters
cannot see each other by construction — one is chosen before refusals and one
after.

## The comment that said the work was not done

    //! # What is not done yet
    //!
    //! Spilling. A value that is live across an `await` [...] needs a frame
    //! slot and every use of it rewritten to a load. That is the general case,
    //! and it is refused by name until it is written [...]

Spilling is implemented. `crossing()` computes it, `frame_fields` allocates the
slots, `reload` and `carry` rewrite the uses. Generators need it — `upTo`'s
`i` is live across the `yield` and is not a parameter — and I had budgeted for
writing it.

That is the **fifth stale comment** this stretch, and the third that described
work as undone that was done. They are more expensive than the reverse: a
comment claiming a gap gets believed, and the belief is what does the damage.
0092's was the mirror image — a `break` whose stated reason ("a rest parameter
is refused") had stopped being true, and the gap between the code and its reason
was one missing empty array.

## The test that could not fail, again, and the shape is the same as the last four

`the_element_is_read_from_the_frame` asserted the walk reads
`suspend::FIELD_YIELDED`. Setting that constant to `0` — so the walk reads the
*state* out of the frame — left **all eight tests passing**.

The assertion compared the constant with itself. Moving it moved both sides.

Fixed by deriving the expected slot from somewhere else: the layout the pass
built, which names its fields. `frame_fields` writes the name and `rewrite`
writes the offset, and those are different places, so `FIELD_YIELDED = 0` now
fails two tests.

That is five in this stretch and every one has been the same shape: **an
assertion about *whether*, where the claim is about *which*.** The array
callback's index, the `-0` fixture, the table walk's parameter order, the
`forEach` value-versus-key, and now this. The tell is that the test names the
thing it is checking — if the assertion and the code read the same constant,
the check is `x == x`.

The mutations that do work, in the order they were tried: the wrong slot fails
two; a finishing exit answering *not done* fails one; dropping the spill fails
one; a loop that runs while `done` fails one; and an entry that starts the body
eagerly fails **87 differential cases**, which is the one no unit test caught.

## The wrong answer generators made observable

    let closed = 0;
    function* guarded(n) { try { yield n; yield n + 1; } finally { closed++; } }

    for (const v of guarded(n)) { total += v; break; }   // node: closed === 1
                                                          // nts:  closed === 0

**26 of 29 cases disagreed.** A `for...of` left by `break` or `return` calls
`gen.return()` on the way out, which resumes the generator *inside its `try`* so
that the `finally` runs. Nothing here does that: an abandoned walk simply stops
calling the resumption, and the frame sits at whatever state it stopped in.

That is **iterator closing**, which has been an ✗ in the ledger for as long as
there has been a `for...of` — and it was a row about a correctness detail nobody
could reach, because no walk this compiler supported had anything to close. A
generator does, and the row became a wrong answer that runs the same afternoon
the feature landed.

So a `finally` spanning a `yield` is refused by name, beside the `finally`
spanning an `await` that `refused_by_name` already carried for the same reason
and had already written the argument for.

**A `catch` spanning a `yield` is not refused, and that is measured too: 29 of
29 agree.** The `await` rule refuses one because a rejected resumption goes to a
shared exit that knows no handler; nothing resumes a generator with a failure,
so a `throw` in the body and the handler that catches it are both in the
resumption, in blocks the split preserved. Copying the `await` rule wholesale
would have refused something that works.

Found by probing what the feature made *reachable* rather than by testing the
feature — the fourth time in five records. `in` came out of the upcast's
example, the dead C stub out of its benchmark, `Object.keys` out of `delete`'s
soundness argument, and this out of asking what `break` now means.

## The other two backends got it for nothing

`OpKind::Yield` never reaches a backend. `hir::suspend` runs immediately after
lowering and removes every one of them, and what is left is field reads, field
writes, a comparison chain and returns — ordinary HIR.

So the refusal I added to the JVM backend to make it compile is unreachable, and
the benchmark says so: `nts JVM` produced **557.28 us** for a program the JVM
lane declines to lower a `yield` for. Neither backend was touched.

## Measured

    case         C++         nts C       nts LLVM    node       bun       nts/C++   nts/node
    generator    161.76 us   179.98 us   172.69 us   3.18 ms    2.90 ms   1.07x     0.05x

**Seven percent over writing the machine out by hand in C++**, and 17.7x faster
than node. The reference is a struct with a `state`, a `yielded` and a `next()`
returning `bool`, which is the right one precisely because it is what nts
*emits* — the ratio answers "does writing `function*` cost anything over writing
the machine yourself". Not `std::generator`: a C++20 coroutine allocates its
frame through `operator new` unless the compiler elides it, and that would
measure an allocator in one lane and not the other.

    generator-walk (memory)   ideal 0   allocated 0   actual 0   alloc 0

Argued before measuring and right first time, which is rarer than it should be.
The argument: exactly one managed object exists, it is made by the caller and
dies with the loop, and nothing can store it — a generator held and *returned*
is refused, and one passed to a function is refused at that function's
parameter. So escape analysis reaches it, and `ObjectNew { frame: false }` —
which `suspend` emits because an `async` frame has no choice — becomes a frame
slot after all.

## The ledger stayed at 40

Three ✗ closed and three arrived: `yield*`, the **value** of a `yield`, and a
generator walked somewhere other than where it was made. Each is a wrong answer
this compiler now declines to give rather than a convenience it lacks — the
second most clearly, since `const v = yield x` under a `for...of` is always
`undefined`, and a program written expecting a conversation would run and
produce numbers.

Twice in three records the count has not fallen. That is the count working: it
measures what the compiler will not do, and finding a new way to be wrong is
worth a row.

## Ratchets

- `examples/generators` — **298 cases against node on C, LLVM and under
  counting**, across fifteen functions: an empty walk, a single `yield`, two
  suspensions in a row, `break`, `continue`, a `return` from the body, nested
  walks with two live frames, a string element, the frame held in a `const`,
  the same generator walked twice (the second yields nothing, as node agrees),
  two frames one after another, a parameter read after the suspension, a
  `yield` nested two loops deep, and a generator that `return`s early.
- `compiler/core/tests/generators.rs` — eight tests, five mutations, four of
  them caught here and the fifth by the differential.
- `examples/generator-unsupported` — the four refusals, each by name. Its own
  fixture rather than a corner of `examples/unsupported`, because that one
  asserts every export in it is refused *by the lowering* and three of these are
  refused one step later, by `drop_callers_of_refused`. Both are honest and they
  are not the same shape; the gate caught the conflation.
- `tooling/memory/cases/generator-walk` — 0 / 0, argued before measuring.
- `benches/cases/generator` — 1.07x C++, 0.05x node, against a hand-written
  state machine.
