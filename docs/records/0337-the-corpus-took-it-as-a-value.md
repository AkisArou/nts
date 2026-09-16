# It agreed with node on 145 cases, and the corpus refuted it anyway

`Promise.withResolvers`, implemented, verified against node through two
backends, and reverted an hour later. The verification was real and could not
have caught what was wrong.

## What was built

[[0336]] carried `PromiseWithResolvers` across the library boundary as a
decomposed interface, which makes it representable but not constructible —
`ClosureInfo` is always tied to a source node, and the decomposed form needs two
function values `lib.d.ts` declares and no file writes.

So I represented the capability **as the promise itself**:

```text
    cap.promise      the receiver, unchanged
    cap.resolve(v)   the settle the promise already has
    cap.reject(e)    nts_promise_reject
```

One pointer, no struct, no closures — the same move as `Date` being a double.
The blocker fixture lowered completely, `examples/a-promise-with-resolvers`
agreed with node on **145 cases across 5 functions** through the C backend, and
the JVM lane independently ran the same example and got the same 145 across 5.

## What refuted it

The gate's `addons` step: **12 of 24 addons regressed**. Controlled properly
before believing it — HEAD built in a detached worktree, no uncommitted work from
any session in it — which gives `24 of 24 still build, 0 regressed`. So it was
mine.

The cause is four lines in `runtime/node/stream/src/iter/broadcast.ts`:

```ts
const pending = Promise.withResolvers<IteratorResult<ByteBatch>>();
if (state.resolve !== null) {
  state.pending.push(pending);
} else {
  state.resolve = pending.resolve;   // taken as a value
  state.reject = pending.reject;
```

`pending.resolve` is stored in a field. A capability represented as its promise
has no function object to hand back, so this is the **one shape the
representation cannot answer** — and I had named it as such, in the code comment
and in the record, immediately before asserting it does not occur:

> of the 25 `withResolvers` sites in `runtime/node`, every member use is a call

I measured `fs/src/promises.ts` and `stream/src/duplexify.ts`. Two files. Then I
wrote "all 25 sites" and built a representation on it.

The real figure, grepped afterwards in about thirty seconds — the wrong time to
run it, and the JVM lane ran it, not me:

```text
  25 sites across 11 files
  broadcast.ts:204   state.resolve = pending.resolve;
  broadcast.ts:205   state.reject  = pending.reject;
  broadcast.ts:290   const resolve = consumer.resolve;
  broadcast.ts:357   const resolve = consumer.resolve;
  broadcast.ts:372   consumer.resolve = next.resolve;
  broadcast.ts:373   consumer.reject  = next.reject;
```

**Six** value-uses, in one file, out of **11** files I generalised from two of.
Not a rare exception at the edge of the corpus — a quarter of one module's uses.

And it propagated. The JVM lane quoted the sentence back approvingly as "a fact
about the corpus rather than a preference" and called it the thing that justified
the design, which turned an unverified claim into corroboration: two sessions
agreeing about something neither had checked. Agreement between us is not
evidence when one of us is the source.

## Why the agreement was worthless here, which is the part to keep

145 cases across 5 functions, two backends, and node as the oracle. All of it
true, and none of it able to fail: **the example exercises the shapes I had
thought of.** It was written from the same understanding that produced the
representation, so it tested the representation against itself. The corpus is
the only thing in this project that was not written by whoever is currently
wrong.

This is the strongest form of a thing I have hit all day in weaker ones. A probe
whose arms differ in two things; an annotation true when written; a rule complete
over the cases in front of it. Here the instrument was *correct*, *comprehensive
within its scope*, run on *two independent backends* by *two different sessions*
— and its scope was drawn by the defect.

A control has to be able to fail. An example written by the author of the change,
after the change, from the change's own model of the problem, cannot.

This is a **fourth** distinct cause under one signature, and the worst of them.
The three from earlier in the day were an unintended second variable in an arm,
one shape reaching a polymorphic site, and an upstream pass answering before the
mechanism ran. Those are defects *in* an instrument. This one is an instrument
whose **boundary** was set by the same wrong model it was testing, so every
internal check of it passes — and a second session running it independently adds
conviction without adding a second scope.

Which sharpens what a two-armed control is for. Not "check both arms": the arms
have to **come from different places**. Mine were the same place twice.

## What stands

The revert is of the representation only. [[0336]]'s carried form stays, and my
calling it a dead end there was itself premature: **a struct with two function
fields is the *correct* representation** — `broadcast.ts` proves the members must
be first-class values — and it is blocked on constructing closures with no source
node, which is a missing capability rather than a wrong design. The two records
disagree about which route is dead, and this one is right.

What `Promise.withResolvers` actually needs is synthetic closures. That is a
real piece of work in `collect_closures` and it is not what I did.

## 2026-09-16: the lesson stands, the conclusion does not

The representation is right. It is landed, and the corpus check that refuted it
here passes: **24 of 24 addons build, 0 regressed**, controlled against the
pinned `072a53e7` binary which gives the same 24 of 24.

What refuted it in this record was not the representation. It was a latent defect
in `nts_promise_reject` that the representation made *reachable*, and I found it
the same way — by not believing my own example and running `addons.sh`, which
came back `12 of 24 still build, 12 regressed`, the identical number.

`nts_promise_reject` takes an `NtsHeader *`. An **erased** reason is an
`NtsValue`, a sixteen-byte tagged struct, and the emitter cast one to the other:

    error: operand of type 'NtsValue' where arithmetic or pointer type is
    required
        nts_promise_reject(v13, (NtsHeader *)v1);

`nts_promise_reject_value` reads the reference out of the tag and has existed all
along — an `async` function's `throw` of a rethrown `catch (e)` calls it. There
were **four** places that decided which helper a rejection takes. Two were right,
two emitted the wrong one, and no fixture reached either: `Promise.reject(x)` and
`new Promise((_, r) => r(x))` with an `unknown` reason both emit C that clang
refuses, **on this record's own binary**, with no `withResolvers` anywhere. Every
such reason in the corpus lives in `web-platform`'s streams, which were refused
earlier for a different reason — so the bug sat behind the refusal it would later
be blamed on. The four are one function now.

So the regression was real, was mine, and was not about first-class members.

**`broadcast.ts` is still right about what it needs, and it is not fatal.** Five
distinct sites take `.resolve` or `.reject` as a value, and they refuse by name:

    a promise capability's `resolve` used as a value rather than called

Against 22 distinct sites that now lower. A refusal at five sites drops those
functions; it does not stop a module building, which is the thing this record
measured and the thing that came back clean. "The one shape the representation
cannot answer" was accurate and the inference from it — that the representation
must therefore go — skipped the step of asking what the shape actually costs.

**What I want kept from this record is untouched**, and it is what let me find
this: *an example written by the author of the change, after the change, from the
change's own model of the problem, cannot fail.* Mine could not either. It agreed
with node on 203 cases across 7 functions and that was worth nothing until
`addons.sh` had run. The corpus is still the only thing here not written by
whoever is currently wrong — and this time it convicted a different defendant.

A synthetic closure is still what the five sites need, and [[0336]]'s decomposed
form is still where that goes. It is no longer in the way of anything.
