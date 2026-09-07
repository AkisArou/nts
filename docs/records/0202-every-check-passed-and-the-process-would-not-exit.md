# Every check passed and the process would not exit

Record 0200 ends by deleting a device case and writing down the standard that
killed it: *a case that cannot be run twice in a row is not evidence a suite can
carry, whatever it showed once.* The standard is right. The diagnosis under it
was not, and this is what it actually was.

## What it looked like

`DefaultNetworkDeliveryTest` registers a real `ConnectivityManager` callback and
asserts the platform delivers a default network and that the first delivery is
not a change. It passed about three times and then hung. So did its predecessor.
A probe that registered nothing ran indefinitely without trouble.

`dumpsys connectivity` gave me a cause that fit:

    TRACK_DEFAULT registrations: 22
    root-owned: 20
          4 uid/pid:1000/1643
          4 uid/pid:0/2727      <- dead
          4 uid/pid:0/2493      <- dead
          4 uid/pid:0/2232      <- dead
          4 uid/pid:0/2009      <- dead

Four leaked registrations per run, owned by `app_process` pids that no longer
exist, accumulating in `system_server` until it stops delivering. That explains
every symptom: why it survives a few runs, why it then hangs, why a probe that
registers nothing is immune. I wrote it into two comments and a skip path.

## What it was

I had never timed a passing run. When I did, the run that printed

    delivery: 4 checks, 0 failures

took **150 seconds** — exactly the bound I had just put around it. Every check
passed, in about three seconds, and then the process sat there until something
killed it.

`Looper.prepareMainLooper()` and `ActivityThread.systemMain()` — the two calls
that make a system `Context` reachable from `app_process` at all, which is
record 0200's own finding — start non-daemon threads. `main` returned. The VM
had no reason to exit and did not.

    System.exit(failures == 0 ? 0 : 1);

One line. The file already had `System.exit(1)` for the failing case, so the
only path that hung was the passing one.

## The direction was backwards

The leaked registrations were real. They were also **downstream**: the harness
kills a process that will not exit, and a killed process never runs the
`finally` that unregisters. Four per killed run, and every killed run was killed
because of the missing line.

So the causal chain ran the other way from the one I wrote down. The evidence I
collected was not wrong — it was a consequence I read as a cause, and it fit
well enough that I stopped looking. It even predicted the right things: more
runs, more leak, eventual failure. A theory that explains every symptom can
still have the arrow reversed.

Five consecutive runs, on the device still holding those twenty leaked
registrations:

    run 1: 3s  delivery: 4 checks, 0 failures
    run 2: 3s  delivery: 4 checks, 0 failures
    run 3: 4s  delivery: 4 checks, 0 failures
    run 4: 3s  delivery: 4 checks, 0 failures
    run 5: 3s  delivery: 4 checks, 0 failures
    registrations after: 22

Flat. The wedged state I had spent the morning diagnosing turns out not to
affect delivery at all.

## What I take from it

**A passing test has a duration, and it is evidence.** I read the last line of
the output and moved on, three separate times, because the last line said what I
wanted. `time` on a green run would have ended this at the start — and the
number was in front of me in the harness bound I chose, which I picked to be
generous rather than because I knew what the run cost.

**`docs/records/0197` was about a control that accused the code under test.**
This is the same shape one level out: a diagnosis that accused the *device*.
Both are cases of an explanation that made the instrument the suspect, and in
both the instrument was fine.

And record 0200's deleted case deserves a second look. It was deleted for
flakiness of exactly this description, and I no longer believe the deletion was
justified by what I knew at the time. The standard in 0200 stands; the case it
was applied to may not have needed it.
