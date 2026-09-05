// What a Java programmer writes for a convolution over a fixed table: an
// `int[]` literal and an `int` accumulator.
//
// The case exists to measure bounds-check elimination, and both lanes should
// get it: the JVM's check is mandatory *and* removed in a counted loop whose
// bound is the array's own length, which is exactly this shape. So the row asks
// whether our range analysis reaches the same conclusion C2 reaches from the
// loop form alone.
//
// `int[]` rather than `double[]`, with the same reasoning as `dispatch`: the
// elements are small integer literals and a person reading the TypeScript knows
// it, but `hir::elements` does not yet prove it, so this lane emits a
// `double[]`. That is a real gap and the reference should not hide it.
//
// `xs.length` is read in the condition rather than hoisted, as the TypeScript
// does. C2 hoists it; writing the hoist by hand would be optimising the
// reference past what a person writes.
final class Ref extends Bench.Work {
    private static final int[] XS = {
        0, 37, 74, 10, 47, 84, 20, 57, 94, 30, 67, 3, 40, 77, 13, 50,
        87, 23, 60, 97, 33, 70, 6, 43, 80, 16, 53, 90, 26, 63, 100, 36,
    };

    // `volatile` so `seed` is not folded into the sum as a constant.
    private static volatile double seed = 3;

    static int convolve(int seed) {
        int[] xs = XS;
        int total = 0;
        for (int round = 0; round < 128; round++) {
            for (int i = 1; i < xs.length; i++) {
                total += xs[i] * xs[i - 1] + seed;
            }
        }
        return total;
    }

    @Override public double run() {
        return convolve((int) seed);
    }
}
