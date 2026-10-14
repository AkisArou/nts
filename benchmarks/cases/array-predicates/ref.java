// What a Java programmer writes for `some`, `every`, `findIndex` and `filter`
// over numbers: the four loops, by hand, over a `double[]`.
//
// **This reference has been wrong twice, in opposite directions**, and both
// corrections are worth keeping visible because between them they moved the row
// from 0.71x to 4.28x and then to 3.28x without this compiler changing at all.
//
// It was four `IntStream` pipelines -- `anyMatch`, `allMatch`, and a `filter`
// materialised with `toArray` -- and that is what a Java programmer writes
// first. It ran in 7.47 us against these loops' 1.19 us, **6.3x**, and the row
// published at 0.71x on the strength of it. `IntStream` does not box, which is
// what the rule names, but the clause before it is the one that mattered: a
// stream pipeline over 256 elements puts a cost in one lane only. This compiler
// inlines the four callbacks -- there is no closure call anywhere in the row's
// profile -- so our lane paid nothing for the abstraction and the reference
// paid 6.3x, and the ratio stopped measuring code generation.
//
// It was then an `int[]`, on the argument that the elements are `i * 7 + seed`
// with `seed` an int32, that a person would not box them, and that our
// `double[]` was a real gap the reference should not hide. That is the thing
// the rule forbids, and it was not the small thing I first measured it to be.
// Instructions an operation barely move -- 33,139 to 35,717, **+7.8%** -- and
// cycles nearly double: 6,969 to 13,293, **+91%**, an IPC of 4.76 against 2.69.
// The row *stalls* rather than issues, so the instruction counter that settled
// the other three factors here is blind to this one. `some`, `every` and
// `findIndex` each break on their own comparison, so the compare's latency is
// the loop-carried dependence and `dcmpl` is several cycles where `if_icmplt`
// is one.
//
// Correcting it moved the published row from 3.28x to 1.71x. **None of that is
// code generation** -- it is the correction of a reference that was faster than
// the program it stands for, and a reader discounting the column should
// discount exactly that much.
//
// What the row is actually about, measured by writing the same program nine
// ways: the growable-array wrapper. Hand-written Java over `nts.rt.NtsArrayD`
// lands within 0.3% of what we emit, so there is no codegen gap here at all --
// records 0146 and 0147 have the ladder.
//
// The four differ in what stops them and what they carry, and one round asks
// all four so that no single one is the whole measurement: `some` stops at the
// first match, `every` is never false and so walks the whole array, `findIndex`
// carries an index rather than a flag, and `filter` allocates.
//
// `findIndex` has no analogue in the JDK at all -- `findFirst` answers with the
// element, not its position -- which is the one place the Java is wordier than
// the TypeScript for a reason that is Java's rather than ours.
final class Ref extends Bench.Work {
    // `volatile` so the length and the contents are not compile-time constants.
    private static volatile double seed = 3;

    static int predicates(int seed) {
        final int n = 256 + seed;
        final double[] xs = new double[n];
        for (int i = 0; i < n; i++) {
            xs[i] = i * 7 + seed;
        }

        int total = 0;
        for (int round = 0; round < 8; round++) {
            final double target = round * 13 + seed;
            boolean some = false;
            for (int i = 0; i < n; i++) { if (xs[i] == target) { some = true; break; } }
            if (some) { total = total + 1; }
            boolean every = true;
            for (int i = 0; i < n; i++) { if (xs[i] < 0) { every = false; break; } }
            if (every) { total = total + 2; }
            int found = -1;
            for (int i = 0; i < n; i++) { if (xs[i] > target) { found = i; break; } }
            total = total + found;
            double[] kept = new double[n];
            int keptCount = 0;
            for (int i = 0; i < n; i++) { if (xs[i] > target) { kept[keptCount++] = xs[i]; } }
            total = total + keptCount;
        }
        return total;
    }

    @Override public double run() {
        return predicates((int) seed);
    }
}
