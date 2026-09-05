// The same `double[]` as `growth-fixed/ref.java`, on purpose.
//
// **Java's answer does not change between the two halves of this pair, and that
// is the measurement.** The TypeScript differs by one word -- `push` into a
// literal instead of `new Array(n)` -- which flips `arrays_can_grow` for the
// whole program and moves every array in it behind a wrapper. A Java programmer
// writing this with `n = 2048` in front of them writes `new double[n]` either
// way; the JDK has no growable primitive array, and an `ArrayList<Double>`
// boxes 2,048 elements and is a different data structure rather than the same
// one with a flag set.
//
// So the Java column is identical on both rows and the difference between our
// two numbers is what the flag costs us. Pairing this row with a boxed list
// instead would have produced a much friendlier ratio and measured `Double`.
//
// The fill is written as a counted loop rather than an append, which is the
// same reason: appending in Java means a `List`, and the row is not about
// lists.
final class Ref {
    // `volatile` so the contents are not compile-time constants.
    private static volatile double seed = 3;

    static double scan(int seed) {
        final int n = 2048;
        double[] xs = new double[n];
        for (int i = 0; i < n; i++) {
            xs[i] = i * 7 + seed;
        }
        for (int round = 0; round < 64; round++) {
            for (int i = 1; i < n; i++) {
                xs[i] = xs[i] * 0.75 + xs[i - 1] * 0.25;
            }
        }
        double total = 0;
        for (int i = 0; i < n; i++) {
            total = total + xs[i];
        }
        return total;
    }

    static double benchRun() {
        return scan((int) seed);
    }
}
