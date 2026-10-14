// Erasure where it cannot be inlined away: an `Object[]`, so every element
// really is a boxed `Double` and the scan really asks each one what it is.
//
// This is the half of the erasure question that matters. `erasure-unknown`
// passes erased values through small functions, where inlining can fold the
// representation out entirely; here the values live in memory and cannot be
// scalar-replaced, so a reader really is a pointer chase plus an `instanceof`.
//
// 2,000 boxed `Double`s, all far outside `Double.valueOf`'s -128..127 cache, so
// the fill allocates 2,000 objects and the scan dereferences one per element --
// which is the cost this row exists to price, on both sides.
//
// Differs from `erasure-stored-typed/ref.java` in `Object[]` versus `double[]`
// and in nothing else.
final class Ref extends Bench.Work {
    // `volatile` so the array's contents are not compile-time constants.
    private static volatile double seed = 12345;

    static double erasureStoredUnknown(double seed) {
        Object[] values = new Object[2000];
        for (int i = 0; i < 2000; i++) {
            values[i] = seed + i;
        }
        double total = 0;
        for (int round = 0; round < 100; round++) {
            for (int i = 0; i < 2000; i++) {
                Object held = values[i];
                if (held instanceof Double) {
                    total = total + (Double) held;
                }
            }
        }
        return total;
    }

    @Override public double run() {
        return erasureStoredUnknown(seed);
    }
}
