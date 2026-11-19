// Arrays.sort on references is stable, just like JavaScript Array.sort.
import java.util.Arrays;
final class Ref extends Bench.Work {
    private static final class Item {
        final int key, tag;
        Item(int key, int tag) { this.key = key; this.tag = tag; }
    }
    static int work(int n) {
        int state = n ^ 0x6d2b79f5;
        n = (n & 3) + 1;
        int total = 0;
        for (int batch = 0; batch < n; batch++) {
            Item[] xs = new Item[256];
            for (int i = 0; i < xs.length; i++) xs[i] = new Item((i * 73 + batch * 11) % 257, i);
            for (int round = 0; round < 16; round++) {
                for (int i = xs.length - 1; i > 0; i--) {
                    state ^= state << 13;
                    state ^= state >>> 17;
                    state ^= state << 5;
                    int j = (int)(Integer.toUnsignedLong(state) % (i + 1));
                    Item held = xs[i]; xs[i] = xs[j]; xs[j] = held;
                }
                Arrays.sort(xs, (a, b) -> a.key != b.key ? a.key - b.key : a.tag - b.tag);
                for (int i = 0; i < xs.length; i++) total += (i + 1) * xs[i].tag + xs[i].key;
            }
        }
        return total;
    }
    private static volatile int seed = 0;
    @Override public double run() { return work(seed); }
}
