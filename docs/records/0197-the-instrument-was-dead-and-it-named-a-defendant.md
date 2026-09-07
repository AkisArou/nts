# The instrument was dead and it named a defendant

The owner authorised fetching the Android command-line tools, so API 26 became
runnable — the floor this library declares, rather than the API 36 that had been
standing in for it. The suite is green on it now. Between here and there were
three defects, and the third is the one worth the record.

## The two that were ordinary

**PKCS12.** A modern `keytool` writes PBES2 with `HmacPBESHA256`. API 26's
bundled BouncyCastle cannot read that MAC, so every TLS case died before the
first handshake. `app_process` reports the death as `Killed`, with the exception
only in logcat — so the run looked like a hang, and I spent twenty minutes
giving the emulator more memory.

**The ART tools moved.** `barrier.sh` named `/apex/com.android.art/bin/dex2oat64`
only. There is no APEX on API 26 and no `dex2oat64` at all. The command sends
its errors to `/dev/null`, so on the declared floor it compiled nothing, dumped
nothing, and would have reported a barrier count of zero for *both* methods —
which the script reads as "the volatile case has no barrier" and fails on. A
correct failure for an incorrect reason.

Both are the same shape: a tool that exists at one API level and not another,
and a script written against the one it was developed on.

## The third

    FAILED: after close, the runtime still retains its callbacks

This is the weak-reference retirement check, and it is one of the plan's named
obligations. It passes on a desktop JVM and on API 36. On API 26 it failed.

I raised the collection budget from 60 attempts to 400 and the allocation churn
four-fold. It still failed. That is the evidence that usually settles it: not a
timing problem, therefore a real retention — a genuine difference between ART
8.0 and ART 16, exactly the kind of thing running on the floor is *for*.

I was one commit away from recording "the runtime retains its callbacks on API
26" as a finding.

The control took four lines:

    static WeakReference<Object> deadReference(ReferenceQueue<Object> queue) {
        return new WeakReference<Object>(new Object(), queue);
    }

A weak reference to an object with no relationship to this runtime at all.

    NEVER enqueued -- a weak reference to a dead object was not cleared,
    so this instrument says nothing about any subject

Nothing on that configuration clears anything, and the queue stays empty
whatever the subject does. The test was not measuring my runtime; it was
reporting a property of the collector as a property of my code.

**And then I got the explanation wrong, which is the second half of this
record.** I wrote — in the code, in a commit message, and to the repository
owner — that ART's reference-processing daemons are started by the zygote and
not by a bare `app_process`. It reads well and it is false:

    java.lang.Daemons.start()  ->  IllegalStateException: already running

They are running. A plain `WeakReference` with no queue at all is not cleared
either, so it is not a queueing problem. Whatever prevents collection there, it
is not the thing I said, and I had already shipped the sentence.

A second explanation followed, and it is wrong too. Perhaps the frame pins the
most recent allocation and my control used exactly one object. Two hundred
references, made in a loop in another method: **none of them clear either**.

I then wrote that the cause was unestablished and would stay that way, which was
the honest state and was also giving up one probe too early.

## The cause, on the fourth attempt

    System.gc();                 60 attempts, 64 MB of churn   ->  never enqueued
    System.gc();
    System.runFinalization();    1 attempt,  1.6 MB of churn   ->  enqueued

Isolated: it is `runFinalization`, not the allocation volume. Four hundred times
the churn without it still never enqueues.

`System.gc()` is a *request for a collection*. ART hands reference processing to
a daemon and `gc` does not wait for it, so a loop that asks sixty times and
never waits can watch a queue stay empty forever while every collection it asked
for happened. `runFinalization` waits. The daemons were running the whole time,
which is why that explanation looked so plausible when I tested it and found
them up.

**So the skip is gone.** The retirement check runs on API 26 now and the runtime
passes it -- 26 checks, no skip, on the floor this library declares.

## Why this one is worse than the others

A failing test that is wrong about *why* is a nuisance. A failing test that
names the wrong defendant is a trap, because every subsequent step is
investigation of something that is not happening. The larger budget did not
disconfirm it — it *strengthened* the wrong conclusion, because ruling out
timing is exactly the reasoning that makes a retention look proven.

The check now runs its control first and skips with a message saying which of
the two it is measuring:

    SKIP retirement: this runtime never cleared a reference to a plainly dead
    object, so the queue says nothing about any subject

The general form: **a test whose instrument can be dead has to prove the
instrument before it reports on the subject** — and the proof has to be
something the subject cannot influence. `notEnqueued` had a careful comment
about frame liveness, a `ReferenceQueue` chosen specifically because polling
`get()` cannot work under ART's read barriers, and a bounded loop so a
collection that never comes is not a hang. Every one of those was right. None of
them asks whether the collector is running at all.

## The one that came free

`SDK_MEMBERS` was ten Android members and their API levels, written down because
there was no API-26 `android.jar` on the machine to ask. Installing the platform
made the list a second statement of a fact the jar already holds, so it is
deleted: the library is compiled against `platforms/android-26/android.jar` and
`javac` answers. A member that does not exist there is a compile error naming
it.

That is the third time in two days the right fix was to **delete one of two
lists** rather than to assert they agree — after the R8 keep rules and the
source sets, and after `guard_aligned_offset`'s four unconverted guards on the
other lane. A list has to be maintained. A jar cannot be forgotten.
