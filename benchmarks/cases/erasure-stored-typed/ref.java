// The control for `erasure-stored-unknown`: a `double[]`, where the element
// type says what is in it and nothing needs asking.
//
// Differs from its pair in `double[]` versus `Object[]` and in nothing else.
final class Ref extends Bench.Work {
    // `volatile` so the array's contents are not compile-time constants.
    private static volatile double seed = 12345;

    static double erasureStoredTyped(double seed) {
        double[] values = new double[2000];
        for (int i = 0; i < 2000; i++) {
            values[i] = seed + i;
        }
        double total = 0;
        for (int round = 0; round < 100; round++) {
            for (int i = 0; i < 2000; i++) {
                total = total + values[i];
            }
        }
        return total;
    }

    @Override public double run() {
        return erasureStoredTyped(seed);
    }
}
