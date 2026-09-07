# Sixty-four lanes asked for the one environment and got sixty-two

`NtsEnv.current()` answers for a thread that entered no environment. `runtime/c`
has the same thing and documents it in one line: *"the environment this lane is
running in. Never null: a program that never asks for one still has exactly
one."*

Exactly one. Here it was:

    private static NtsEnv fallback;
    ...
    if (fallback == null) { fallback = new NtsEnv(false, DEFAULT_INBOX); }

which is the textbook unsafe lazy singleton, and the textbook is usually
describing a race that is hard to hit. This one is not:

    64 threads racing current()   ->  56, 58, 59, 59, 61, 62 distinct environments

Six runs, near enough one environment per thread every time. Not a window — the
common case.

## Why I looked

I had just argued to the compiler owner that the environment parameter should
come out of the `nts_jvm_web_*` intrinsics, because it is redundant: both
runtimes have an ambient current environment, and a parameter is something a
caller can pass *wrong*. That argument is right and I still believe it. But it
moves all the weight onto `current()` being correct, and I had not read
`current()`.

The thing you have just made load-bearing is the thing to read next. I got there
by asking what my own design decision now depended on, which is a question worth
asking every time and one I do not ask often enough.

## What it costs

Two lanes with two environments is not a slow program, it is a silent one. A
completion is posted into the inbox of the environment the *submitting* lane
holds and delivered by whoever drains the environment *they* hold. Two
environments means the second never sees the first's work, and nothing anywhere
reports it: no exception, no refusal, no count out of place. The liveness
accounting is per environment and both of them are internally consistent.

## The two halves, and only one is testable here

**Identity.** Fixed by initialization-on-demand — a private holder class whose
static field the JVM initializes exactly once, under a lock it takes itself.
Sixty-four lanes now see one environment, and the test asserts that number
rather than asserting "not zero".

**Publication.** The other half is that a thread can see a non-null reference to
an object whose fields are not yet written. That needs hardware which reorders,
which is record 0181's problem and still unsolved. The holder class makes it
unreachable *by construction* rather than by a barrier I would then have to
test: class initialization is specified to happen-before every read of the
class's fields. There is nothing left for a memory model to get wrong, which is
the better answer than a `volatile` I could not check.

## The part that is a decision rather than a repair

Making it one environment introduces a question that sixty-two environments did
not have: which lane owns it? `NtsInbox.post` wakes `owner`, and `ownedBy`'s
doc has always said "called once, by it" — while `current()` was calling it for
every thread that asked. One environment with two claimants means the second
steals the wake, and the first parks in `drain` holding work it will never be
told about. A hang that points nowhere.

So the second lane is **refused by name**. That is worse than working and much
better than hanging, and it is the rule this repository already keeps
everywhere else: a thing this backend cannot do correctly is absent and
reported, not approximated.

## What the earlier code was accidentally right about

One environment per thread has no ownership contention, because no two lanes
share an inbox. That is why nothing had ever failed. The bug was not producing
wrong answers; it was producing a *different architecture* than the one
everything else assumes, and it would have kept doing so until two lanes needed
to see each other's work — which on this lane is the day a provider posts a
completion from an I/O thread to a program that never called `enterEnv`.
