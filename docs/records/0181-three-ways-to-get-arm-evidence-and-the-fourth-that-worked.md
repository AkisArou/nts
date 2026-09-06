# Three ways to get ARM evidence on an x86 machine, and the fourth that worked

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

## The fourth way, which does work

Written after the three above, because giving up on the manifestation is not the
same as giving up on the mechanism.

The chain from `volatile` to correct-on-ARM has two links. The keyword has to
survive into the class file, and the compiler has to turn it into a barrier. The
first was already ratcheted. The second was being taken on the specification's
word — and it is checkable on any device, because **ART will compile two methods
that differ only in that keyword and disassemble them for you.**

    public static void publishVolatile(Node from, Node to) { from.next = to; }
    public static void publishPlain(Node from, Node to)    { from.plainNext = to; }

Through `dex2oat --compiler-filter=speed` and `oatdump`, identical instruction
for instruction apart from the field offset, and then:

    publishPlain      0x000040e2:  4883C408      addq rsp, 8
                      0x000040e6:  C3            ret

    publishVolatile   0x00004112:  F083042400    lock add [rsp], 0
                      0x00004117:  4883C408      addq rsp, 8
                      0x0000411b:  C3            ret

39 bytes against 44, and the five are `F0 83 04 24 00`. One barrier in the whole
image. `tooling/android/barrier.sh` does it and fails if the volatile store has
no fence **or if the plain one has one** -- the second check matters, because a
barrier in both would make its presence in the first say nothing about the
keyword.

This is x86_64. On ARM64 the same store compiles to `dmb ish`, which is why the
script looks for a fence rather than a mnemonic. It is still not ARM evidence:
it shows the compiler discharges its obligation on the platform it was run on,
and the argument that it does so on ARM is the specification's rather than a
measurement's.

## What the evidence actually is

Three things now, in increasing order of how much they were worth getting:

1. `NtsInbox.Slot.next` carries `ACC_VOLATILE`, asserted by reflection in
   `inbox.rs`. A fact about the class file, checkable anywhere, and
   sabotage-proven -- removing the keyword gives *"NtsInbox.Slot.next is not
   volatile: the publication edge is gone"*.
2. ART's compiler emits a barrier for a store to that kind of field and not for
   a store to an ordinary one, measured on a device rather than argued from the
   Java Memory Model.
3. The JMM says the same obligation holds on every implementation, including the
   ones this machine cannot run.

The *manifestation* is still unmeasured and cannot be measured here: showing the
race needs hardware that reorders. But "the ratchet is the whole of it" was
wrong when I wrote it, and it was wrong because I stopped at three failures
instead of asking what a fourth attempt would be measuring.

## The general shape

Three of the four routes would have run, passed, and meant nothing — an emulator
and a user-mode translator both give the guest the host's memory model. A test
that cannot fail is not evidence, and a test that cannot fail *for a reason
specific to the platform it claims to be testing* is worse, because it looks
like exactly the coverage that is missing.

The fourth is the one that worked, and it worked by changing the question. The
first three asked "can I make the bug happen here", which needs hardware. It
asks "does the thing that prevents the bug get generated", which needs a
compiler -- and there is one on every device. When a property cannot be
observed, the next question is not a better emulator; it is which link in the
chain *can* be observed.

This is the same rule the rest of this repository keeps about sabotage, arriving
from the other direction: usually the question is whether a test can fail. Here
the question was whether a *passing* result could have meant anything, and for
two of the three the answer was no before it was ever run.
