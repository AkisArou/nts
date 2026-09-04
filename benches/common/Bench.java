// The JVM side of the same measurement, kept deliberately parallel to
// benches/common/bench.mjs and benches/common/main.cpp: same warmup, same
// calibration, same best-of-five, same output.
//
// Same *constants*, not merely the same shape. Three lanes measured three ways
// are three experiments, and the ratios between them would be about the
// harnesses.

public final class Bench {
    private Bench() {}

    /**
     * The thing being timed.
     *
     * <p>An abstract class rather than a {@code DoubleSupplier} lambda, for two
     * reasons that both matter. A lambda goes through {@code LambdaMetafactory},
     * which spins a hidden class at its first execution -- noise in a cold-start
     * measurement, and an {@code invokedynamic} that Android needs API 26 for.
     * The rest of this project already refuses {@code invokedynamic} for that
     * reason, and a benchmark harness that used one would be measuring a
     * configuration the compiler will not ship.
     *
     * <p>One implementation per process also keeps the call site monomorphic, so
     * C2 inlines through it and the harness disappears from the timed loop.
     */
    public abstract static class Work {
        public abstract double run();
    }

    public static void measure(Work work) {
        // One call before anything: it takes the checksum, loads the classes and
        // runs every `<clinit>`, so none of that lands inside a timed region.
        double checksum = work.run();

        // Let the JIT reach steady state. Timing a cold interpreter would
        // flatter us enormously and mean nothing.
        //
        // Bounded by *time* as well as by count, exactly as the JavaScript side
        // is and for the same reason: twenty thousand iterations is right for a
        // one-microsecond case and absurd for a twenty-millisecond one.
        //
        // The JVM needs both bounds for a sharper reason than V8 does. C2
        // compiles at roughly five thousand invocations and does it on a
        // background thread, so a count guarantees the *request* was made and
        // not that the compiled code is installed. And a call that never
        // returns often enough to be counted -- `awfy-mandelbrot` is 22ms of it
        // -- tiers up inside itself through on-stack replacement instead, which
        // is time rather than invocations.
        long until = System.nanoTime() + 300_000_000L;
        for (int i = 0; i < 20000 && System.nanoTime() < until; i++) {
            work.run();
        }

        long probe = System.nanoTime();
        work.run();
        double one = System.nanoTime() - probe;
        long reps = (long) Math.floor(1e8 / Math.max(one, 1));
        reps = Math.min(Math.max(reps, 1), 50_000_000L);

        double best = Double.POSITIVE_INFINITY;
        double sink = 0;
        for (int trial = 0; trial < 5; trial++) {
            long began = System.nanoTime();
            for (long i = 0; i < reps; i++) {
                sink += work.run();
            }
            double per = (double) (System.nanoTime() - began) / (double) reps;
            if (per < best) {
                best = per;
            }
        }

        if (Double.isNaN(sink)) {
            throw new AssertionError("unreachable");
        }

        // The sixty-four bits, not the number's text. `Double.toString` gives
        // `1.437497244444425E7` where C's `%.17g` gives `14374972.44444425` and
        // JavaScript gives the same as C -- and the runner compares checksums as
        // strings, so a lane that printed its own spelling would report a
        // disagreement it caused itself.
        long bits = Double.doubleToRawLongBits(checksum);
        System.out.printf("%.4f %016x%n", best, bits);
    }
}
