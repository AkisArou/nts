# A handler synthesised where the source wrote none

    try { return await failing(n) } finally { ran = ran + 1 }

Node runs the `finally`. This compiler did not — a wrong answer, refused by
name — and it is the sibling of the row closed one commit earlier. **29
occurrences across 6 sites**, and the sites split evenly between two shapes that
turned out to need very different amounts of work.

## The half that was already done

    try { await p } catch { … } finally { … }

works the moment the refusal is lifted. A rejection reaches the handler, the
handler's normal exit runs the `finally`, and that is `run_finallys_to` doing
what it does for every other way out of a `catch`. Three of the six sites.

This is worth recording precisely because it is uninteresting: the refusal
covered *any* `await` inside a `try` with a `finally`, and it was written when
neither half worked. Half of it had been true and untested since the rejection
edge landed a commit ago, and nothing would have said so.

## The half that needed a handler that does not exist

    try { await p } finally { F }

has nowhere for a rejection to go. The `finally` is on the exit stack, so a
`throw` finds it — but a rejection is not a `throw`, it is an edge `suspend`
creates, and an edge needs a block.

So one is synthesised where the source wrote none:

    try { … } finally { F }   ->   try { … } catch (e) { F; throw e } finally { F }

which is what explicit cleanup *means*, and what `run_finallys_to` already does
inline at every other abrupt exit. `lower_unguarded` builds it, and three things
about it are load-bearing:

**Only where a rejection recorded itself.** A handler block with no predecessors
is one the verifier rejects, so building it unconditionally turns every
defensive `try`/`finally` in the program into an invalid function. The lazy
creation the `throw` path already uses is the same rule.

**The `finally` comes off the exit stack while its own copy is written.** The
copy is being lowered here and the rethrow at the end belongs to whatever
encloses this `try` — leaving it on makes the `finally` run twice, which
`onceNotTwice` reports as an answer of the wrong sign.

**The rethrow is of an erased value.** `throw_erased` is split out of
`lower_throw` for it: a rethrow has no expression to lower, only whatever
`nts_promise_reason` handed back. And that value is `unknown`, because
`catch (e)` is — so `nts_promise_reject_value` reads the reference out of the
tag rather than the compiler guessing a type for it. A reason is always a
reference, and the header is the one place that knows which.

## What the differential caught that a test did not

`examples/async-unsupported` began disagreeing with node. Its `guarded` — the
`try { return await p } finally { }` that was the fixture *for* this refusal —
had started compiling, and the file's own header says what to do:

> Keep this file to constructs the lowering genuinely does not accept. When one
> of them lands, move it out rather than deleting the fixture.

Fourth time this session a fixture has told me a feature landed before I had
finished writing it down.

## Ratchets

- `examples/async-finally` — 145 cases against node on C, LLVM and under
  counting: a `finally` with a `catch` beside it, one without, two awaits under
  one `finally` with a local the paths disagree about, a `throw` through a
  `finally` that must run it **once and not twice**, and a `try`/`finally`
  around code that can neither throw nor reject.
- `examples/async-unsupported` — `guarded` moved out, as that file instructs.
- `compiler/core/tests/async_catch.rs` — two tests added, two mutations. Not
  synthesising the handler fails one; leaving the `finally` on the stack around
  the rethrow runs it twice and the differential says so.
- The pair that matters is the second test: a `try`/`finally` around code that
  cannot reject must leave **no block behind**, checked by walking that one
  function's reachability. The whole-program verifier cannot say it — it runs
  after the passes that would have removed the orphan.
- No memory case: the rejection path reads a field, calls a helper and jumps.
  It allocates nothing, and the async frame it runs inside is what
  `tooling/memory/cases/async-method` already counts.
- No benchmark row: `benches/cases/exceptions` times a `throw` and a `catch`,
  and an `await` that is not rejected takes exactly the branch it already took.
- **The JVM lane refuses it** until `nts_promise_reject_value` exists in
  `runtime/jvm`, by name. Its floor is a minimum, so the gate is unaffected.
