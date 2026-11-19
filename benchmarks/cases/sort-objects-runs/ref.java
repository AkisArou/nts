import java.util.Arrays;
final class Ref extends Bench.Work {
    private static final class Item {
        final int key, tag;
        Item(int key, int tag) { this.key = key; this.tag = tag; }
    }
    static int work(int seed) {
        int n = (seed & 3) + 1;
        int offset = seed & 255;
        int total = 0;
        for (int batch = 0; batch < n; batch++) {
            Item[] ordered = new Item[256];
            for (int i = 0; i < 256; i++) ordered[i] = new Item(i, i);
            for (int round = 0; round < 16; round++) {
                offset = (offset + 73) & 255;
                Item[] xs = new Item[256];
                for (int i = 0; i < 256; i++) xs[i] = ordered[(i + offset) & 255];
                Arrays.sort(xs, (a, b) -> a.key != b.key ? a.key - b.key : a.tag - b.tag);
                for (int i = 0; i < xs.length; i++) total += (i + 1) * xs[i].tag + xs[i].key;
            }
        }
        return total;
    }
    private static volatile int seed = 0;
    @Override public double run() { return work(seed); }
}
