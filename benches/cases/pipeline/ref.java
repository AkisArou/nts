// What a Java programmer writes for map-then-reduce over numbers:
// `Arrays.stream`, a `DoubleStream`, and a lambda apiece.
//
// `toArray()` is called between the two rather than chaining straight into
// `reduce`, and that is the whole reason this file needs a comment. A chained
// stream is lazy and would fuse the map into the fold, allocating no
// intermediate at all -- which would be a *better program* than the TypeScript
// and would make the row a measurement of stream fusion rather than of the
// pipeline. `.map(...)` in JavaScript returns an array, so the reference
// materialises one too, and the two lanes allocate the same 1024 doubles per
// round.
//
// The reduce is sequential, so the fold runs left to right in the order
// `Array.prototype.reduce` specifies, and floating-point addition is not
// associative -- a parallel stream would give a different answer and the
// checksum would catch it. That is a reason to write `Arrays.stream` rather
// than `.parallel()` beyond the obvious one.
//
// `round` is copied into a local because a lambda captures effectively-final
// variables and a `for` index is not one. That copy is free and is not a
// difference between the lanes; it is Java's capture rule.
import java.util.Arrays;

final class Ref {
    // `volatile` so the initial fill is not a compile-time constant.
    private static volatile double seed = 7;

    static double work(double seed) {
        final int length = 1024;
        double[] xs = new double[length];
        for (int i = 0; i < length; i++) {
            xs[i] = seed * 0.5 + i * 0.25;
        }

        double total = 0;
        for (int round = 0; round < 64; round++) {
            final double r = round;
            double[] scaled = Arrays.stream(xs).map(v -> v * 3.5 + r).toArray();
            total = total + Arrays.stream(scaled).reduce(0, (acc, v) -> acc + v * 0.5);
        }
        return total;
    }

    static double benchRun() {
        return work(seed);
    }
}
