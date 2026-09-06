# Three ways to get ARM evidence on an x86 machine

The goal asks for device evidence of ARM publication ordering. `NtsInbox.Slot.next`
is `volatile` because the link write is the publication edge that makes a
worker's bytes visible to the owner lane, and **on x86 that keyword is
unfalsifiable**: x86-TSO does not reorder stores with stores, so a build with
the keyword and a build without it behave identically on every input.

I said this was unavailable, then went and tried three ways to get it anyway.
None of them work on this machine, and the reasons are worth having written
down so the next person spends the afternoon on something else.

## An arm64 emulator image

The Android SDK here has `emulator`, `platform-tools`, three `build-tools` and
one `system-images/android-36.1`, which is **x86_64 only**. Fetching an arm64
image needs `sdkmanager`, which lives in `cmdline-tools`, which is not
installed. So the route exists and the tool that opens it does not.

Worth noting that this would have been real evidence if it had worked: an arm64
image under the emulator is full CPU emulation, and QEMU's TCG does *not*
reproduce weak memory ordering faithfully — it serialises. So even with the
image, a passing run would have proved nothing about ARM. **The route that
looked most like the answer is the one that would have produced a green tick
and no information.**

## `qemu-user` with an aarch64 JDK

Same objection, one layer down, and it is the decisive one rather than a
practical obstacle: `qemu-user` executes guest instructions on the host and
gives them the host's memory model. A missing barrier is invisible there for
exactly the reason it is invisible natively. The package is also not installed,
which is the lesser problem.

## Cross-compiling to arm64 and reading the instructions

This one nearly worked and is the interesting failure.

ART's `dex2oat` is a cross-compiler: `--instruction-set=arm64` is accepted on
an x86_64 device and produces an ELF that `file` reports as `ARM aarch64`. The
plan was to compile one class with a `volatile` field and one without, and
check that the volatile store emits `dmb ish` and the plain one does not —
which would not prove the race manifests, but *would* prove the barrier is
generated from the keyword, on the actual target, by the actual compiler.

    llvm-objdump -h --triple=aarch64 barrier-arm64.oat
      6 .text          00000000 0000000000004000 TEXT

`.text` is empty. `dex2oat` will verify for a foreign instruction set and will
not compile for one without a boot image built for that same set, and an
x86_64 device has no arm64 boot image. `--boot-image=/nonexistent` does not
change it. On-device `oatdump` aborts on the arm64 file as well, being built
for one architecture.

## What the evidence actually is

Two things, and the second is the one that carries it:

1. `NtsInbox.Slot.next` carries `ACC_VOLATILE`, asserted by reflection in
   `inbox.rs` so the keyword cannot be deleted quietly. That is a fact about the
   class file, checkable anywhere.
2. The Java Memory Model derives the ordering from that flag. The barrier is not
   something the runtime asks for and might get wrong; it is the compiler's
   obligation given the flag, on every implementation.

So the honest statement is that the *mechanism* is verified and the
*manifestation* is not, and cannot be here. An execution test needs ARM
hardware. Until there is some, the ratchet is the whole of it, and calling
anything else coverage would be worse than the gap.

## The general shape

Two of the three routes would have run, passed, and meant nothing — an emulator
and a user-mode translator both give the guest the host's memory model. A test
that cannot fail is not evidence, and a test that cannot fail *for a reason
specific to the platform it claims to be testing* is worse, because it looks
like exactly the coverage that is missing.

This is the same rule the rest of this repository keeps about sabotage, arriving
from the other direction: usually the question is whether a test can fail. Here
the question was whether a *passing* result could have meant anything, and for
two of the three the answer was no before it was ever run.
