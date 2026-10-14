// Build item 3: what does an interop copy actually cost?
//
// The plan prices several copies and then says: "If the copy is noise next to
// the call, the cliff matters less than this document assumes." That sentence
// has never had a number under it. This puts one there.
//
// Each case is a `Work` so it goes through the same warmup, time bound and
// best-of-five the rest of the suite uses, and `NTS_BENCH_ALLOC=1` prints
// bytes/op instead of nanoseconds.
public final class Copies {

    private static final int N = 1024;
    private static final int ENTRIES = 64;

    private static final double[] DOUBLES = new double[N];
    private static final int[] INTS = new int[N];
    private static final String[] KEYS = new String[ENTRIES];
    static {
        for (int i = 0; i < N; i++) {
            DOUBLES[i] = i;
            INTS[i] = i;
        }
        for (int i = 0; i < ENTRIES; i++) {
            KEYS[i] = "k" + i;
        }
    }

    /** A foreign method that does almost nothing: the floor a call costs. */
    public static int trivial(int x) {
        return x + 1;
    }

    /** A foreign method taking an array and reading it: no copy anywhere. */
    public static double readNoCopy(double[] xs) {
        double sum = 0;
        for (int i = 0; i < xs.length; i++) { sum += xs[i]; }
        return sum;
    }

    /**
     * A call site the JIT cannot reduce to one target, allocating nothing.
     *
     * <p>Four implementations reached through an interface makes the site
     * megamorphic, so there is no bimorphic guard to inline through and the
     * dispatch is a real one. That is the cost an uninlinable *call* has. The
     * reflective case below measures something else and says so.
     */
    public interface Step {
        int of(int x);
    }

    private static final Step[] STEPS = {
        new Step() { public int of(int x) { return x + 1; } },
        new Step() { public int of(int x) { return x + 2; } },
        new Step() { public int of(int x) { return x + 3; } },
        new Step() { public int of(int x) { return x + 4; } },
    };

    public static void main(String[] args) {
        String which = args.length > 0 ? args[0] : "all";

        // NOTE: an earlier version of this arm looped `trivial(acc)` 1024 times
        // and read 0.3554 ns for the whole loop -- impossible, and the tell that
        // C2 had folded 1024 increments into one add. A benchmark arm that the
        // JIT can compute without running the thing being measured is not an
        // arm. Both forms below are data-dependent on an array the JIT cannot
        // see through, so the calls survive.

        if (which.equals("call") || which.equals("all")) {
            // An inlinable call: what a call costs when the JIT gets to erase
            // it. This is the honest floor, and it is near zero on purpose.
            System.out.print("inlinable-call      ");
            Bench.measure(new Bench.Work() {
                public double run() {
                    int acc = 0;
                    for (int i = 0; i < N; i++) { acc += trivial(INTS[i]); }
                    return acc;
                }
            });
        }

        if (which.equals("mega") || which.equals("all")) {
            // **The uninlinable call, without the boxing.** The reflective arm
            // below allocates 28,688 bytes per op -- a boxed argument, a boxed
            // result and a varargs array per call -- so its number is mostly
            // allocation and its label said "a call the JIT cannot inline".
            // This one allocates nothing, so the difference between the two is
            // what reflection costs on top of a dispatch.
            System.out.print("megamorphic-call    ");
            Bench.measure(new Bench.Work() {
                public double run() {
                    int acc = 0;
                    for (int i = 0; i < N; i++) { acc += STEPS[i & 3].of(INTS[i]); }
                    return acc;
                }
            });
        }

        if (which.equals("reflect") || which.equals("all")) {
            // **Reflection, and it is named for what it is now.** This used to
            // be called `uninlinable-call` and stand in for a foreign call
            // crossing into code we did not compile. It allocates 28,688 bytes
            // per op -- `Integer.valueOf` on the argument, a boxed `Integer`
            // result, and the varargs `Object[]` that `Method.invoke` takes --
            // so most of what it measured was allocation, not dispatch.
            //
            // Kept rather than deleted, because the comparison against
            // `megamorphic-call` above is the useful thing: same work, one
            // allocating and one not.
            System.out.print("reflective-call     ");
            final java.lang.reflect.Method m;
            try {
                m = Copies.class.getMethod("trivial", int.class);
            } catch (NoSuchMethodException e) {
                throw new AssertionError(e);
            }
            Bench.measure(new Bench.Work() {
                public double run() {
                    int acc = 0;
                    try {
                        for (int i = 0; i < N; i++) {
                            acc += ((Integer) m.invoke(null, Integer.valueOf(INTS[i]))).intValue();
                        }
                    } catch (Exception e) {
                        throw new AssertionError(e);
                    }
                    return acc;
                }
            });
        }

        if (which.equals("nocopy") || which.equals("all")) {
            System.out.print("pass-array-no-copy  ");
            Bench.measure(new Bench.Work() {
                public double run() { return readNoCopy(DOUBLES); }
            });
        }

        if (which.equals("d2i") || which.equals("all")) {
            // The `number[]` -> `int[]` copy. 1024 elements, one allocation.
            System.out.print("copy-double-to-int  ");
            Bench.measure(new Bench.Work() {
                public double run() {
                    int[] out = new int[DOUBLES.length];
                    for (int i = 0; i < DOUBLES.length; i++) { out[i] = (int) DOUBLES[i]; }
                    return out[out.length - 1];
                }
            });
        }

        if (which.equals("i2d") || which.equals("all")) {
            System.out.print("copy-int-to-double  ");
            Bench.measure(new Bench.Work() {
                public double run() {
                    double[] out = new double[INTS.length];
                    for (int i = 0; i < INTS.length; i++) { out[i] = INTS[i]; }
                    return out[out.length - 1];
                }
            });
        }

        if (which.equals("map") || which.equals("all")) {
            // The Map boundary: 64 entries, boxing every value.
            System.out.print("build-hashmap-64    ");
            Bench.measure(new Bench.Work() {
                public double run() {
                    java.util.HashMap<String, Integer> m =
                        new java.util.HashMap<String, Integer>();
                    for (int i = 0; i < ENTRIES; i++) {
                        m.put(KEYS[i], Integer.valueOf(i));
                    }
                    return m.size();
                }
            });
        }

        if (which.equals("maptouch") || which.equals("all")) {
            // The control for the row above: the same 64 puts into a map that
            // already exists, so the difference is construction and growth
            // rather than hashing.
            System.out.print("reuse-hashmap-64    ");
            final java.util.HashMap<String, Integer> reused =
                new java.util.HashMap<String, Integer>();
            Bench.measure(new Bench.Work() {
                public double run() {
                    for (int i = 0; i < ENTRIES; i++) {
                        reused.put(KEYS[i], Integer.valueOf(i));
                    }
                    return reused.size();
                }
            });
        }
    }
}
