// This case hands the *same* buffer to every call and mutates it in place, so
// there is no argument expression for the generated driver to synthesise and no
// way for it to reset the state between runs. `ref.cpp` refills at the top of
// `bench_run` for the same reason: without it the contents compound across
// iterations and the checksum depends on how many times the harness called it.
//
// The array is allocated once, outside the timed region, and refilled inside
// it -- which is what `ref.cpp` and `ref.java` both do, so all three columns
// time the same work.
public final class Case {
    private static final int N = 4096;
    private static final double[] xs = new double[N];
    // `volatile` for the reason every generated input is: a loop-invariant
    // multiplier lets the JIT hoist the whole call out of the timed loop.
    private static volatile double seed = 1.0000001;

    public static void main(String[] argv) {
        Bench.measure(new Bench.Work() {
            @Override public double run() {
                for (int i = 0; i < N; i++) {
                    xs[i] = 1.0;
                }
                return nts.gen.Program.scale(xs, seed);
            }
        });
    }
}
