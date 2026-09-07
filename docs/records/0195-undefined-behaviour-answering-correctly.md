# 0195 — Undefined behaviour answering correctly

`instanceof Uint8Array` is two tests. All nine typed arrays share one struct and
one descriptor — they differ only in how their bytes are read — so the
descriptor says *some typed array* and the view's `kind` field says *which*.

Both are necessary and only one of them is guarded, which the sabotages say
plainly:

    kind test removed          29 disagreements   every Float32Array is a Uint8Array
    descriptor test removed     0 disagreements   all 261 cases still agree

The second is the interesting number. Without the descriptor test, the runtime
reads a `kind` field out of an object that has no such field — past the end of
a `Point`, into whatever follows a string's header — and the byte it finds
today does not happen to equal 1. So every case still agrees with node.

**That is undefined behaviour answering correctly, and it is the one failure a
differential cannot distinguish from correctness.** Record 0089 made the same
point about signed overflow: three examples written to catch it agreed with node
even with the fix reverted, because clang chose to wrap at those shapes. The
rule there was that a differential can hold "the emitted C never asks", not "the
answer came out right". This is the same shape one layer down — the C is asking,
and the answer is right anyway.

## What was done about it, and what was not

A case *could* be constructed that bites: choose an object whose byte at offset
49 is under the program's control, and the kind-only test reads it. It would be
pinned to a struct layout rather than to the property, and it would stop biting
the moment a field moved — a case that passes for a reason unrelated to the
thing it is named for, which is what the last two weeks have been about.

So the example says what it does not cover, and names the instrument that does.
On the JVM lane there is no stale byte to read: a class that does not declare
the field does not verify. The descriptor half is guarded there and unguarded
here, and that is written in the example's header rather than left as an
unqualified claim of coverage.

This is the third time the checked-cast backend has been the only thing able to
see a lie about a type, after the merged function-type layouts and the unerase
to `{}`. The pattern is now specific enough to state as a rule: **a change that
makes a pointer mean something it did not mean before goes to that lane before
it lands**, because the C lane's instrument is a differential and a differential
cannot see a type at all — only an answer.

## The third list of one fact in a day

Getting there needed the narrowing to be *readable back*, and it was not.

    erasable        Float Int Bool Void  String Object Array View Buffer
    readable_back   Float Int Bool       String Object Array

A `View` could go into an `unknown` and not come out. So `if (open instanceof
Uint8Array) return open[0]` had nowhere to go even once the test worked — and
a case that only checked the boolean would have passed against a compiler that
could not use the answer.

They are one function now, `readable_back` being `erasable` minus `Void`. The
asymmetry is real and is the reason it is not simply the same predicate:
`undefined` is a tag with no payload, so there is something to erase and nothing
to load.

That is the third pair of lists in one day found to disagree — after the two
erase whitelists and `NTS_READS_ONLY` against the C header — and all three
drifted the same way: something was covered by *accident*, under a name it
shared with something else, and left every list at once when it got a name of
its own. Nothing noticed until a feature needed the conversion.

## And two refusals that had aged out

`instanceof ArrayBuffer` was recorded in the goal document under "`ArrayBuffer`,
`RegExp`, `WeakSet` have no representation". It has had one since
`ManagedType::Buffer`. `instanceof Uint8Array` was recorded as blocked on typed
arrays being a distinct representation, which happened the same morning.

Two more claims that were true when written and were not re-checked. The tally
for one day is now four: these two, the `Array.isArray` refusal of record 0193,
and the erase whitelists above.

## What to take

When a test has two halves and one of them is a safety check rather than an
answer check, the differential covers the answer half and reports the other as
passing. Ask, of every guard: *if I delete this, does anything go red?* — and
when the answer is no, say which instrument would have to exist for it to go
red, rather than writing a case that appears to be that instrument.
