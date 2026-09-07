# I said unobtainable, and had not tried the emulator that works

For most of this project the ARM half of `docs/records/0181` has been written
down as blocked on hardware:

    FATAL | QEMU2 emulator does not support arm64 CPU architecture

That error is real. The SDK emulator runs an arm64 guest only on an arm64 host,
so the publication *race* — a reader observing a half-published object — needs
two ARM cores and there are none here. I recorded that, twice, and moved on.

**What I had not tried is the other emulator.** `qemu-user` does not emulate a
machine; it emulates a *process*. It has nothing to do with the SDK emulator's
refusal, it was one package away, and it runs ART's own arm64 binaries directly
on this host.

## What it gets

The arm64 `oatdump`, from the android-26 arm64-v8a system image, disassembling
the arm64 boot image:

    void java.util.concurrent.atomic.AtomicInteger.set(int)      volatile int value
      0x005fa070: 91002030   add  x16, x1, #0x8
      0x005fa074: 889ffe02   stlr w2, [x16]
      0x005fa078: d65f03c0   ret

    void java.io.CharArrayWriter.reset()                         plain int count
      0x001e8750: b900143f   str  wzr, [x1, #20]
      0x001e8754: d65f03c0   ret

`stlr` is ARM64's release store. The volatile write gets it and the plain write
does not, from the compiler that ships on the architecture this lane targets.
5,098 `dmb ish` instructions in the same image, for the barriers that are not
store-releases.

That is the compiler's half of the obligation, on the right architecture,
measured. `tooling/android/arm-barrier.sh` is now the check, beside the x86_64
one that answers the same question with `lock add [rsp], 0`.

## What it does not get, stated because the gap is the point

**Not the race.** Nothing here executes ARM64 for its behaviour — `oatdump`
reads a file and prints text. An emulator with wrong semantics would print the
same bytes, which is exactly why user-mode emulation is *sufficient* for this
and useless for the race.

**Not our code.** `dex2oat` under `qemu-user` opens the dex, closes it, and
exits. Its diagnostics go to a `logd` that a user-mode sysroot does not have:
`/dev/socket/logdw` is probed and absent **1,092 times in a single run**, and I
could not get one line of the failure out of it. I tried a Unix socket in the
sysroot at that path so qemu's path redirection would find it; qemu does not
redirect it. So the evidence is Android's own compiled code, and what carries
across is the compiler rather than the class.

## What I take from it

**"Unobtainable" is a claim about what was tried, and mine was doing more work
than it had earned.** The QEMU2 error is about system emulation. I generalised
it to "ARM is out of reach" and stopped, and the generalisation survived two
separate write-ups without anyone — me included — asking whether a different
kind of emulator would do, or whether the *compiler* could be reached without
the *machine*.

The tell was there in my own words. I had written that seeing ART emit `dmb ish`
"needs no race, only an ARM compiler" — which names a strictly weaker
requirement and then treats it as satisfied by the same blocker. A weaker
requirement blocked by the same thing is a claim worth checking, and I did not
check it.

It also took an outside push. The stopping condition kept naming ARM, and each
time I restated unobtainability more precisely instead of testing it. Restating
a blocker in better prose is not progress on it, and the second restatement
should have been the signal.
