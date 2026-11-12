// The JVM side of the same measurement, kept deliberately parallel to
// benches/common/bench.mjs and benches/common/main.cpp: same warmup, same
// calibration, same best-of-five, same output.
//
// Same *constants*, not merely the same shape. Three lanes measured three ways
// are three experiments, and the ratios between them would be about the
// harnesses.

public final class Bench {
    private static volatile double consumed;

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
        // Counting mode (tooling/bench/README.md is the spec), spelled exactly
        // as bench.mjs and main.cpp spell it. The timed path below is the
        // original code shape on purpose; counting branches before it.
        String countMode = System.getenv("NTS_BENCH_COUNT_MODE");
        if (countMode != null) {
            double counted = work.run();
            if (countMode.equals("calibrate")) {
                calibrate(work, counted);
            } else if (countMode.equals("count")) {
                count(work, counted);
            } else {
                throw new AssertionError("unknown NTS_BENCH_COUNT_MODE: " + countMode);
            }
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
        // `NTS_BENCH_WARMUP_MS` raises the time bound, to price whether the
        // bound is what makes six rows unquotable. The paragraph above says a
        // count guarantees the compile was *requested*, not installed -- so a
        // run that starts timing with C2's output still in flight measures C1,
        // and five such runs of one binary disagree by exactly the 1.2x-1.9x
        // those rows carry. Default unchanged, so this measures nothing until
        // somebody asks it to.
        long started = System.nanoTime();
        long budget = 300_000_000L;
        String raise = System.getenv("NTS_BENCH_WARMUP_MS");
        if (raise != null) {
            budget = Long.parseLong(raise) * 1_000_000L;
        }
        long until = started + budget;
        int cap = raise == null ? 20000 : Integer.MAX_VALUE;
        for (int i = 0; i < cap && System.nanoTime() < until; i++) {
            work.run();
        }
        boolean settled = settle(work, started);

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
        // Publish the exact accumulated value after timing/counting completes.
        consumed = sink;

        // The sixty-four bits, not the number's text. `Double.toString` gives
        // `1.437497244444425E7` where C's `%.17g` gives `14374972.44444425` and
        // JavaScript gives the same as C -- and the runner compares checksums as
        // strings, so a lane that printed its own spelling would report a
        // disagreement it caused itself.
        long bits = Double.doubleToRawLongBits(checksum);
        System.out.printf("%.4f %016x%s%n", best, bits, settled ? "" : " warm-capped");
    }

    // The one loop counting mode warms up and counts, spelled once so warmup
    // tiers up the very loop the counter then brackets.
    private static double runLoop(Work work, long reps) {
        double sink = 0;
        for (long i = 0; i < reps; i++) {
            sink += work.run();
        }
        return sink;
    }

    private static String bits(double value) {
        return String.format("%016x", Double.doubleToRawLongBits(value));
    }

    private static void calibrate(Work work, double checksum) {
        // The timed path's warmup bounds: 20,000 calls or 300 ms, then settle.
        long started = System.nanoTime();
        long until = started + 300_000_000L;
        long warmed = 0;
        while (warmed < 20000 && System.nanoTime() < until) {
            work.run();
            warmed++;
        }
        settle(work, started);
        long reps = 1;
        long elapsed = 0;
        double sink = 0;
        for (;;) {
            long began = System.nanoTime();
            sink += runLoop(work, reps);
            elapsed = System.nanoTime() - began;
            if (elapsed >= 20_000_000L || reps >= 50_000_000L) {
                break;
            }
            reps = Math.min(reps * 2, 50_000_000L);
        }
        if (Double.isNaN(sink)) {
            throw new AssertionError("unreachable");
        }
        System.err.println("NTS_BENCH_SINK " + bits(sink));
        System.out.printf("{\"checksum\":\"%s\",\"warmup\":%d,\"nsPerOp\":%s,\"reps\":%d}%n",
            bits(checksum), warmed, Double.toString((double) elapsed / (double) reps), reps);
    }

    private static void perfCommand(java.io.OutputStream control, java.io.InputStream acknowledgement, String value)
        throws java.io.IOException {
        control.write((value + "\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        control.flush();
        StringBuilder message = new StringBuilder();
        for (;;) {
            int next = acknowledgement.read();
            if (next < 0) {
                throw new AssertionError("perf control acknowledgement missing");
            }
            if (next == 0) {
                continue; // perf appends a NUL after ack\n
            }
            message.append((char) next);
            if (next == '\n') {
                break;
            }
        }
        if (!message.toString().equals("ack\n")) {
            throw new AssertionError("unexpected perf acknowledgement: " + message);
        }
    }

    private static void count(Work work, double checksum) {
        long n;
        long warmed;
        try {
            n = Long.parseLong(System.getenv("NTS_BENCH_COUNT_N"));
            warmed = Long.parseLong(System.getenv("NTS_BENCH_COUNT_WARMUP"));
        } catch (RuntimeException bad) {
            throw new AssertionError("fixed counts are required: NTS_BENCH_COUNT_N and NTS_BENCH_COUNT_WARMUP");
        }
        if (n < 0 || warmed < 0) {
            throw new AssertionError("fixed counts are required: NTS_BENCH_COUNT_N and NTS_BENCH_COUNT_WARMUP");
        }
        // Warm up the loop being counted, outside the bracket, then let the
        // JIT go quiet as the timed path does before it measures.
        runLoop(work, warmed);
        settle(work, System.nanoTime());
        double sink;
        long elapsed;
        try (
            java.io.OutputStream control = new java.io.FileOutputStream(System.getenv("NTS_BENCH_COUNT_CONTROL"));
            java.io.InputStream acknowledgement = new java.io.FileInputStream(System.getenv("NTS_BENCH_COUNT_ACK"))
        ) {
            perfCommand(control, acknowledgement, "enable");
            long began = System.nanoTime();
            sink = runLoop(work, n);
            elapsed = System.nanoTime() - began;
            perfCommand(control, acknowledgement, "disable");
        } catch (java.io.IOException failed) {
            throw new AssertionError("perf control acknowledgement missing", failed);
        }
        if (Double.isNaN(sink)) {
            throw new AssertionError("unreachable");
        }
        System.out.printf("{\"checksum\":\"%s\",\"warmup\":%d,\"n\":%d,\"elapsedNs\":%d,\"nsPerOp\":%s,\"sink\":%s}%n",
            bits(checksum), warmed, n, elapsed, Double.toString(n == 0 ? 0 : (double) elapsed / (double) n), Double.toString(sink));
    }

    /** How long the JIT must add no compilation time for warm-up to be over. */
    private static final long QUIET_NS = 200_000_000L;

    /** How long warm-up may run, from its start, before a row is timed anyway. */
    private static final long WARM_CAP_NS = 5_000_000_000L;

    /**
     * Keep warming, past the floor above, until compilation goes quiet: until
     * the JVM's total compilation time stops rising for {@link #QUIET_NS} of
     * calls. Whether it answers that it settled before the cap.
     *
     * <p>**A trial timed while C2 is still compiling measures C1 code**, not a
     * slow run of ours. `json-serialize` on 2026-10-21: in one run in about
     * thirty, its 860-byte entry had not reached C2 when the result was printed,
     * 870 ms in, and every one of the five trials ran its C1 code -- 20.6 us
     * against 12.5. The fixed floor is the JavaScript side's, and the JVM is the
     * one that can say when it is done: `getTotalCompilationTime` is the
     * compiler threads' own account, flag-free, so the column stays what a
     * user's JVM runs.
     *
     * <p>A row still compiling at the cap is timed anyway and marked
     * `warm-capped` on its line, which `nts-bench` names, rather than its
     * figure passing for a steady state. A JVM that keeps no account answers
     * settled, as the floor alone always did.
     */
    private static boolean settle(Work work, long started) {
        java.lang.management.CompilationMXBean jit =
            java.lang.management.ManagementFactory.getCompilationMXBean();
        if (jit == null || !jit.isCompilationTimeMonitoringSupported()) {
            return true;
        }
        long compiled = jit.getTotalCompilationTime();
        long window = System.nanoTime();
        for (;;) {
            work.run();
            long now = System.nanoTime();
            if (now - window >= QUIET_NS) {
                long after = jit.getTotalCompilationTime();
                if (after == compiled) {
                    return true;
                }
                compiled = after;
                window = now;
            }
            if (now - started >= WARM_CAP_NS) {
                return false;
            }
        }
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
        // Publish the exact accumulated value after timing/counting completes.
        consumed = sink;
        System.out.printf("%.2f bytes/op over %d ops%n", (after - before) / (double) reps, reps);
    }
}
