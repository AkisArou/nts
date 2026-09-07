# I called it blocked without testing the claim

For most of a day I reported two obligations as blocked on hardware:

> **Blocked, not skipped:** ARM hardware for the publication race, an API-26
> device for lifecycle and network-transition coverage, and HTTP/2.

One of those was true. The other was a guess I had written down often enough
that it started reading like a measurement.

    $ emulator -list-avds
    Medium_Phone_API_36.1

There is an SDK on this machine, an emulator, and an AVD. `tooling/android/
on-device.sh` had been written weeks earlier, its paths checked, and never run.
Eleven minutes after looking:

    ok 1..11  org.nts.web.NetworkPrimitivesTest      (API 36, x86_64, ART)
    EnvTest          26 checks, 0 failures
    CloseRaceTest    240 checks, 0 failures
    Stress           16 producers x 200 rounds, credits balanced
    ok 1..11  again, against the R8-shrunk library
    device: every suite green on ART

An emulator is not hardware, and I had let one word stand for the other. ART is
a different implementation of every primitive this lane depends on — a
concurrent copying collector with read barriers, Conscrypt over BoringSSL,
framework natives `dalvikvm` does not link — and none of that requires a phone.
What requires a phone is a *radio* and an *ARM core*, and the honest blocker
list is those two things and not "a device".

## What the run found immediately

It failed, on keep rules I had added an hour before:

    Proguard configuration rule does not match anything:
      `-keep class org.nts.web.OkHttpNetworking { public *; }`

The device script compiled `src/main`, `src/android` and `src/test`, and not
`src/okhttp`. That is the **third** time in this lane that a keep rule and the
compiled source list have disagreed: `AndroidNetworking`'s rule matched nothing
because the same script never compiled `src/android`; then `src/okhttp` was
absent from the R8 *test*; and now from the R8 *runner*. Each time the rule
reads as protection and protects nothing.

Three occurrences of one shape is not three mistakes, it is a missing
invariant. The rules and the sources are two lists that must agree and only one
of them can be deleted — record 0077's rule — and nothing asserts it. What
saved it each time was R8 printing a warning that something happened to read.

## And the thing the device made me look at

Chasing what else a device could cover, I grepped for `ConnectivityManager`.
Nothing. No `NetworkCallback` anywhere in the library.

`NetworkPrimitives.networkChanged()` closes every open connection and documents
why in six lines: a socket on a replaced network reports nothing, so the failure
a program eventually sees is a timeout long after the cause, describing the
wrong thing. It was reachable from a test, and from the shared layer calling it
by hand. On a real handover it was never called at all.

So the lane had a correct, carefully documented, well-tested **response** to a
transition, and nothing anywhere that noticed one. That is not a bug in the
method. It is the shape of a system assembled from parts that were each tested
against their own description.

## The rule

Two of the three failures this day produced were the same: **a claim about the
environment, repeated until it read as a finding.** "Blocked on hardware" and
"nothing calls this" are both statements about the world outside the code, and
both were checkable in under a minute by a command I did not run.

Test the blocker before reporting it. `command -v` is cheaper than a paragraph
explaining why something cannot be done.
