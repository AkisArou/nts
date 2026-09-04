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
        if (System.getenv("NTS_BENCH_ALLOC") != null) {
            allocated(work);
            return;
        }
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

    /**
     * Bytes allocated per operation, which is how this project asks "did C2
     * scalar-replace that?" and gets a number back.
     *
     * <p>The obvious instrument is {@code -XX:+PrintEscapeAnalysis}, and it does
     * not exist on a JDK anyone ships -- it is {@code develop}-only, so it is
     * present in a debug VM and silently absent in a product one. This counter
     * is in every HotSpot, it costs nothing, and it answers the question more
     * directly anyway: escape analysis is a means, and what we actually want to
     * know is whether the allocation happened. **Zero means it did not.**
     *
     * <p>Printed instead of the timing rather than beside it, because the
     * runner parses that line and a lane that printed two would report a
     * disagreement it caused itself. So this is a separate run, under
     * {@code NTS_BENCH_ALLOC=1}, and nothing about the timed path changes.
     *
     * <p>The warmup is the timed path's, unchanged and for a sharper reason
     * here: an interpreter allocates what a C2 frame would not, so measuring
     * before steady state answers a question about the interpreter. The
     * measured window is deliberately long enough that the harness's own
     * fixed cost -- the {@code Work} instance, the counter's own boxing --
     * divides away to nothing.
     */
    private static void allocated(Work work) {
        com.sun.management.ThreadMXBean threads =
            (com.sun.management.ThreadMXBean) java.lang.management.ManagementFactory.getThreadMXBean();
        if (!threads.isThreadAllocatedMemorySupported()) {
            System.out.println("-- this JVM does not count thread allocation");
            return;
        }
        threads.setThreadAllocatedMemoryEnabled(true);
        long self = Thread.currentThread().getId();

        double sink = work.run();
        long until = System.nanoTime() + 300_000_000L;
        for (int i = 0; i < 20000 && System.nanoTime() < until; i++) {
            sink += work.run();
        }

        long probe = System.nanoTime();
        work.run();
        double one = System.nanoTime() - probe;
        long reps = (long) Math.floor(1e9 / Math.max(one, 1));
        reps = Math.min(Math.max(reps, 1000), 10_000_000L);

        long before = threads.getThreadAllocatedBytes(self);
        for (long i = 0; i < reps; i++) {
            sink += work.run();
        }
        long after = threads.getThreadAllocatedBytes(self);

        if (Double.isNaN(sink)) {
            throw new AssertionError("unreachable");
        }
        System.out.printf("%.2f bytes/op over %d ops%n", (after - before) / (double) reps, reps);
    }
}
