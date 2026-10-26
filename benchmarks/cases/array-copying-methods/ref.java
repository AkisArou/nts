// Copy before sort/reverse/with; separate result arrays for map and filter.
import java.util.Arrays;
final class Ref extends Bench.Work {
    static int work(int n) {
        n = (n & 3) + 1;
        int total = 0;
        for (int batch = 0; batch < n; batch++) {
            int[] xs = new int[64];
            for (int i = 0; i < xs.length; i++) xs[i] = (i * 37 + batch) & 1023;
            for (int round = 0; round < 32; round++) {
                xs = xs.clone();
                Arrays.sort(xs);
                int[] reversed = xs.clone();
                for (int i = 0; i < xs.length; i++) reversed[i] = xs[xs.length - 1 - i];
                xs = reversed;
                xs = xs.clone();
                xs[round % xs.length] = round + batch;
                int[] mapped = new int[xs.length];
                for (int i = 0; i < xs.length; i++) mapped[i] = (xs[i] + 17) & 1023;
                xs = mapped;
                int kept = 0;
                for (int x : xs) if (((x + round) & 3) != 0) kept++;
                int[] filtered = new int[kept];
                int at = 0;
                for (int x : xs) if (((x + round) & 3) != 0) filtered[at++] = x;
                xs = filtered;
                // Java arrays have no spare capacity. Grow once for the known
                // refill, rather than reallocating at every simulated push.
                int length = xs.length;
                xs = Arrays.copyOf(xs, 64);
                for (int i = length; i < xs.length; i++)
                    xs[i] = (batch + round + i * 13) & 1023;
                for (int x : xs) total += x;
            }
        }
        return total;
    }
    private static volatile int seed = 0;
    @Override public double run() { return work(seed); }
}
