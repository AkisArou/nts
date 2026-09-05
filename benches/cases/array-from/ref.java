// What a Java programmer writes for `Array.from` over an array and over a
// `Set`: `Arrays.copyOf` and `Set.toArray`.
//
// `Array.from(xs)` on an array is a copy and nothing else, which is what
// `Arrays.copyOf` is. `Array.from(set)` walks the set and materialises it,
// which is `toArray` -- and `toArray` on a `HashSet` allocates an `Object[]`
// and fills it by iterating, exactly as the lowering does.
//
// **`double[]` and `Set<Double>`, not `int[]` and `Set<Integer>`.** The
// narrower pair was here deliberately, as the harder reference; it is the
// thing the rule forbids, and on a row that is mostly `Arrays.copyOf` of 256
// elements the width is half the bytes moved. `Set<Integer>` is worse than
// narrow -- `Integer.valueOf` caches -128..127 and `Double.valueOf` caches
// nothing, so half the keys here were free on one lane and allocated on the
// other. Our own `NtsMap` keys through `Double.valueOf`, so `Set<Double>` is
// the matched representation rather than the generous one.
//
// Correcting it moved the published row from 2.39x to 1.95x, and **none of
// that is code generation.** What is left is `Arrays.copyOf` of 256 elements,
// two thousand times, which is the thing the row is for.
//
// The *length* of the listed set, not an element: a `Set`'s iteration order is
// insertion order for us and a hash order for `HashSet`, so indexing one would
// compare two orders rather than two copies. The walk runs to the end either
// way, which is the part being measured.
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

final class Ref extends Bench.Work {
    // `volatile` so the contents are not compile-time constants.
    private static volatile double seed = 5;

    static double work(int seed) {
        double[] xs = new double[256];
        for (int i = 0; i < 256; i++) {
            xs[i] = i + seed;
        }
        Set<Double> marks = new HashSet<>();
        for (int i = 0; i < 256; i++) {
            marks.add((double) (i * 3 + seed));
        }

        double total = 0;
        for (int round = 0; round < 2000; round++) {
            double[] copied = Arrays.copyOf(xs, xs.length);
            total = total + copied[round % 256];
            Object[] listed = marks.toArray();
            total = total + listed.length;
        }
        return total;
    }

    @Override public double run() {
        return work((int) seed);
    }
}
