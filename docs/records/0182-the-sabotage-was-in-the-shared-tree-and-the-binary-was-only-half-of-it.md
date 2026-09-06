# The sabotage was in the shared tree, and the binary was only half of it

Proving a test can fail means breaking the thing it tests. Both sessions do it
constantly — `Uint8Clamped` against `Math.round`, the counter aggregation, the
raw `ToIndex` comparison, roughly thirty cycles between us in one day.

The method is: edit the source, rebuild, watch it go red, restore. In a
checkout three sessions share, that is a **window in which the shared tree is
wrong**, and the window is invisible from the outside because `git status` shows
a clean fix and the artifact disagrees.

## What it cost

`examples/function-values` was refused on all three backends for several
minutes while `target/release/nts` was a compiler built from a reverted fix.
The JVM session saw `NTS2006` twice, checked their own tree, found nothing of
theirs, and reported it — correctly — as my in-flight edit. I replied that the
fix was present and the tree was green, which was true of the *source* and not
of the binary they were running.

Then it happened a second time and was not a window at all: the same example
genuinely failed on the JVM lane, for a real reason, and I had just told them
the failure was an artifact. Believing my own explanation cost them an hour of
diagnosing the wrong thing.

## The fix I reached for is not sufficient

Building sabotage variants to a private `CARGO_TARGET_DIR` keeps a wrong binary
away from the shared path, and it works — verified by watching the sabotaged
crate fail its test in isolation while `target/release/nts` compiled the corpus
correctly.

But the JVM session identified the larger half, which I had missed: **the
source is wrong in the shared checkout for the whole window**, so anything
either session builds during it picks up the sabotage regardless of where the
output goes. Their gate ran through their own target directory and still saw
both `NTS2006`s, which is only explicable that way.

What removes the class is sabotaging a **copy of the tree**: copy, edit the
copy, build the copy. A private output directory protects the artifact; a
private input directory protects everyone else's.

## The general shape

This is the jar rewritten in place under seven test binaries, one layer up. It
is the memory suites sharing `nts-memory-{pid}`. It is the same failure three
times: **a shared mutable path, and a window in which it holds something no
reader expects.** Each time the symptom named the wrong layer — a compiler bug,
a missing anonymous class, an in-flight edit — and each time the cause was two
readers and one path.

The instrument being part of the system it measures, again. A sabotage is a
measurement that works by breaking the subject, and if the subject is shared,
the measurement breaks other people's answers too.
