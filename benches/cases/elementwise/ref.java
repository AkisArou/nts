// What a Java programmer writes for scaling a buffer in place: a `double[]` and
// two nested loops.
//
// The array is a static field refilled at the top of every run, which is what
// `ref.cpp` does and for the same reason: the driver hands the same array to
// every call, so without the refill the contents compound across iterations and
// the checksum depends on how many times the harness happened to call it. The
// allocation stays outside the timed region and the state does not carry.
//
// This is the row where a JIT and an ahead-of-time compiler are asked the same
// question -- 512 passes over 4096 doubles with a loop-invariant multiplier is
// exactly the shape both are supposed to vectorise -- so if the numbers differ
// it is about whether the loop was recognised, not about the arithmetic.
final class Ref {
    private static final int N = 4096;
    private static final double[] XS = new double[N];

    // `volatile` so `k` is not a constant the loop can be rewritten around.
    private static volatile double seed = 1.0000001;

    static double scale(double[] xs, double seed) {
        final double k = seed;
        for (int round = 0; round < 512; round++) {
            for (int i = 0; i < xs.length; i++) {
                xs[i] = xs[i] * k;
            }
        }
        return xs[0] + xs[xs.length - 1];
    }

    static double benchRun() {
        for (int i = 0; i < N; i++) {
            XS[i] = 1.0;
        }
        return scale(XS, seed);
    }
}
