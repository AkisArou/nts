// Replacement states plus Arrays.copyOf for [...xs, v]. No in-place shortcut.
import java.util.Arrays;
final class Ref extends Bench.Work {
    private static final class State {
        final int k, a, b, c;
        State(int k, int a, int b, int c) { this.k = k; this.a = a; this.b = b; this.c = c; }
    }
    static int work(int n) {
        n = (n & 3) + 1;
        int total = 0;
        for (int batch = 0; batch < 4 * n; batch++) {
            State state = new State(batch, 7, 11, 13);
            int[] xs = new int[0];
            for (int i = 0; i < 256; i++) {
                state = new State(state.k + i + 1, state.a, state.b, state.c);
                xs = Arrays.copyOf(xs, xs.length + 1);
                xs[xs.length - 1] = state.k;
                total += state.a + state.b + state.c + xs[(i * 17) % xs.length];
            }
            total += xs.length + state.k;
        }
        return total;
    }
    private static volatile int seed = 0;
    @Override public double run() { return work(seed); }
}
