// What a Java programmer writes for a convolution over a fixed table: a
// `double[]` and a `double` accumulator.
//
// The case exists to measure bounds-check elimination, and both lanes should
// get it: the JVM's check is mandatory *and* removed in a counted loop whose
// bound is the array's own length, which is exactly this shape. So the row asks
// whether our range analysis reaches the same conclusion C2 reaches from the
// loop form alone.
//
// **This was an `int[]` and an `int` accumulator**, on the argument that the
// elements are small integer literals, a person reading the TypeScript knows
// it, and `hir::elements` does not prove it -- so the narrower reference was
// the deliberate harder one and our `double[]` was a gap it should not hide.
//
// The rule says otherwise and the rule is right here: a field narrower than the
// f64 a TypeScript `number` is puts a cost in one lane only. On this row it is
// not even a small one. The prepared HIR holds `total` as an `f64` and the
// product as a `dmul`, so the `int` version was measuring `imul` against
// `dmul` down a dependency chain and calling the difference codegen.
//
// Worth keeping straight: on `array-predicates`, whose inner loops are compares
// rather than a multiply-accumulate, the same widening costs **+7.8% in
// instructions and +91% in cycles** -- so element width is not nearly free
// anywhere on this lane, and the two rows lose to it for different reasons. It
// is the latency of a floating-point compare there and the width of the
// multiply here.
//
// Correcting this row moved it from 1.35x to 1.02x, and **none of that is code
// generation.**
//
// `xs.length` is read in the condition rather than hoisted, as the TypeScript
// does. C2 hoists it; writing the hoist by hand would be optimising the
// reference past what a person writes.
final class Ref extends Bench.Work {
    private static final double[] XS = {
        0, 37, 74, 10, 47, 84, 20, 57, 94, 30, 67, 3, 40, 77, 13, 50,
        87, 23, 60, 97, 33, 70, 6, 43, 80, 16, 53, 90, 26, 63, 100, 36,
    };

    // `volatile` so `seed` is not folded into the sum as a constant.
    private static volatile double seed = 3;

    static double convolve(int seed) {
        double[] xs = XS;
        double total = 0;
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
