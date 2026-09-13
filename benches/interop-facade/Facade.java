// Does an instance forwarder cost anything?
//
// The proposed fix for `Program.Session$bump(s)` is an instance method on the
// class that forwards to the static:
//
//     public double bump() { return Program.Session$bump(this); }
//
// Three instructions -- `aload_0`, `invokestatic`, `dreturn`. The claim is that
// C2 inlines it to nothing and the Java caller pays zero for writing
// `s.bump()`. That is a claim about generated code, so it gets a number.
//
// Both arms call the SAME static through the SAME data, so the only difference
// is the forwarder. `state` is read from an array the JIT cannot fold away, or
// the whole loop disappears and both arms measure nothing -- which is how the
// first version of the interop-copy benchmark read 0.3554 ns for 1024 calls.
public final class Facade {

    static final class Program {
        static double Session$bump(Session s) {
            s.hits = s.hits + 1;
            return s.hits;
        }
    }

    static final class Session {
        double hits;
        // The facade: exactly what the emitter would generate.
        double bump() { return Program.Session$bump(this); }
    }

    private static final int N = 1024;
    private static final int[] DATA = new int[N];
    static {
        for (int i = 0; i < N; i++) { DATA[i] = i & 1; }
    }

    public static void main(String[] args) {
        final Session direct = new Session();
        System.out.print("static-call         ");
        Bench.measure(new Bench.Work() {
            public double run() {
                double acc = 0;
                for (int i = 0; i < N; i++) {
                    if (DATA[i] != 0) { acc += Program.Session$bump(direct); }
                }
                return acc;
            }
        });

        final Session through = new Session();
        System.out.print("through-facade      ");
        Bench.measure(new Bench.Work() {
            public double run() {
                double acc = 0;
                for (int i = 0; i < N; i++) {
                    if (DATA[i] != 0) { acc += through.bump(); }
                }
                return acc;
            }
        });
    }
}
