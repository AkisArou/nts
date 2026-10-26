// Pair -> Leaf -> int, with the same three object creations per array entry.
final class Ref extends Bench.Work {
    private static final class Leaf {
        final int value;
        Leaf(int value) { this.value = value; }
    }
    private static final class Pair {
        final Leaf left, right;
        Pair(Leaf left, Leaf right) { this.left = left; this.right = right; }
    }
    static int work(int n) {
        n = (n & 3) + 1;
        int total = 0;
        for (int batch = 0; batch < 16 * n; batch++) {
            Pair[] xs = new Pair[256];
            for (int i = 0; i < xs.length; i++)
                xs[i] = new Pair(new Leaf(batch + i), new Leaf(batch - i));
            for (Pair pair : xs) total += pair.left.value + pair.right.value;
        }
        return total;
    }
    private static volatile int seed = 0;
    @Override public double run() { return work(seed); }
}
