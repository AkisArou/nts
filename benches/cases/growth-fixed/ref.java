// What a Java programmer writes for a fixed-size numeric buffer: `double[]`.
//
// This row is one half of a pair -- `growth-fixed` against `growth-grown` --
// asking what `arrays_can_grow` costs. That question is about a whole-program
// analysis in this compiler, and Java has no analogue of it: a `double[]` never
// grows and an `ArrayList<Double>` is a different data structure, not the same
// one with a flag set. So the Java column prices the *fixed* case against the
// natural Java answer, and the cliff itself stays a C-column measurement.
//
// Saying that is better than pairing this with an `ArrayList<Double>` reference
// and calling the ratio "what growth costs": boxing every element would make
// that number about `Double` objects rather than about the length check.
//
// `new double[n]` rather than a literal, as the TypeScript does, so the fill
// loop is really measured.
final class Ref extends Bench.Work {
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

    @Override public double run() {
        return scan((int) seed);
    }
}
