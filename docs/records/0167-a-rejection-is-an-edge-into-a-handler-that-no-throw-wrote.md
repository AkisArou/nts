# A rejection is an edge into a handler that no `throw` wrote

    try { await failing() } catch { return -99 }

compiled, ran, and **rejected**, where node returns -99. It was refused by name
for exactly that reason — a wrong answer is worse than a gap — and the refusal
stated the fix:

> a suspension has to record which handler it is inside, so the rejection
> branch can jump there with the reason instead

**89 occurrences across 17 sites** in `runtime/node`, and the shape is teardown:
`try { await reader.close() } catch {}`, so that a close failure does not
replace the data error that caused the teardown.

## Why the suspension could not find the handler itself

Exceptions here are **fully lowered**. A handler is a block, a `throw` is a jump
the lowering emits, and there is no unwinder and no handler stack — `OpKind`'s
own comment says so, in the course of explaining why a runtime `ReferenceError`
cannot be raised.

So by the time `suspend` runs there is no `try` left to find. It sees blocks.
The one thing it has to do — send a rejected resumption to the enclosing
handler — is the one thing the IR at that point cannot tell it.

## The shape of the answer

A rejection is an edge into a handler, exactly like a `throw`, and it differs in
one way that decides the whole design: **the block it leaves does not exist
yet.** `suspend` creates it when it splits the function at the `await`.

So `OpKind::Await` carries a `Rejection { handler, args, reason_at }`, settled by
the lowering and read by `suspend`. Everything else falls out of machinery that
was already there:

- **The handler's parameters** are the thrown value followed by one per name the
  edges disagreed about. A rejection is one of those edges, so its bindings
  snapshot joins the computation — and `bothEdges`, a `try` with a `throw` and
  an `await` and a local they disagree about, is what says so. Left out, the
  rejection path read `mark` at whatever the `throw` path had left it.
- **The handler block** is created lazily by the first `throw`, so that a `try`
  around code that cannot throw leaves no block with no predecessors. A
  rejection is a predecessor, and forgetting that left the handler dead and the
  rejection still going to the shared exit: node -99, nts rejected.
- **`suspend` remaps the block** with `segment_layout`'s `starts`, which already
  records where each original block's first segment lands.

## Three things it broke on the way, and each was loud

**`Unreachable { block: BlockId(3) }`.** The shared rejection exit is reserved
for every async function, and a function all of whose awaits are caught has no
path to it. It is now reserved only when something reaches it — and the first
attempt at that took a block away from **every generator**, because one variable
named `shared` was doing two jobs: a landing block per suspension, which every
async function needs, and the shared exit, which is now conditional.
`examples/generators` failed, which is what the corpus is for.

**`NotDominated { value: %14, used_in: b6 }`, twice, for opposite reasons.**
First because the values a rejection owes its handler cross the suspension and
do not follow from liveness — they are read *at* the `await` as far as the
analysis is concerned, so one used nowhere else dies there, and the landing
block is reached from the dispatch and dominated by nothing that defined it.
Then again because `rejection_of` reads the operation out of `build.values`,
which is the arena `shifted_arena` already rewrote — so shifting the arguments a
second time passed the handler the value *after* the one it wanted.

The second is the more interesting failure. It produced a program that was
internally consistent and wrong, and the only reason it was caught is that the
value one past the one intended happened to be defined in the segment that
suspended. **A different program would have passed a live value of the wrong
type and compiled.** The verifier caught this one; nothing guarantees it catches
the next, and the fix is that there is now exactly one place that shifts.

## What the runtime needed

One helper, and its absence was a design statement rather than an oversight:

    /* Reject `result` with whatever `source` was rejected with. One call, so
     * the reason never has to become a typed value on the compiler's side. */
    void nts_promise_reject_with(NtsPromise *result, const NtsPromise *source);

While a rejection could only be *forwarded*, the reason never had to be named.
`catch (e)` is exactly the case that names it, and `e` is `unknown` — so
`nts_promise_reason` answers erased, with the tag read from the header rather
than assumed.

## Measured

    runtime/node   6,895 refusals  ->  7,033

**Up**, and that is the fourth time today it has been the right direction. The
row itself went 89 → 0; what rose is code that now lowers far enough to reach a
real gap — `JSON.stringify` +21, an erased value where a concrete
representation is wanted +28, and `a finally that spans an await` +16, which is
the *sibling* refusal now reached by functions that previously stopped at the
`catch`.

## Ratchets

- `examples/async-catch` — 203 cases against node on C, LLVM and under counting:
  a plain `catch`, a bound reason read with `instanceof`, a `throw` and an
  `await` reaching one handler with a local they disagree about, two awaits in
  one `try`, nesting, a rethrow out of a handler that was itself reached by a
  rejection, and an `await` **inside** a handler, which belongs to whatever
  encloses the `try` rather than to the handler it is in.
- `compiler/core/tests/async_catch.rs` — three tests, four mutations. Not
  recording the handler fails two; leaving rejections out of the parameter
  computation fails the third; shifting the arguments twice and dropping them
  from `crossing` each produce a `NotDominated` on the example.
- The pair that matters: an `await` with **no** handler must record `None`.
  Recording one for every `await` satisfies the first test and sends every
  rejection into a block that does not enclose it.
- No memory case: the feature adds a branch and a helper call on the rejection
  path and nothing at all on the success path, and it neither allocates nor
  takes a reference. The values it keeps alive across the suspension were
  already spilled if any later use read them; what changed is that the handler's
  use now counts as one.
- No benchmark row. `benches/cases/exceptions` times a `throw` and a `catch`,
  and this changes neither: an `await` that is not rejected executes one extra
  `nts_promise_is_rejected` — which it already executed — and takes the same
  branch it already took.
- **The JVM lane refuses it** until `nts_promise_reason` exists in `runtime/jvm`,
  by name and loudly: `NTS4001 a call to nts_promise_reason, which this backend
  has no name for`. Its floor is a minimum, so the gate is unaffected.
