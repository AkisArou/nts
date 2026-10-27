// Same 64-slot ring of strong parent/child cycles as the TypeScript row.
// Replaced pairs die without unlinking or forced collection.
final class Ref extends Bench.Work {
    private static final class Link {
        final int value;
        Link parent, child;
        Link(int value) { this.value = value; }
    }
    static int work(int n) {
        n = (n & 3) + 1;
        int total = 0;
        Link[] ring = new Link[64];
        for (int i = 0; i < 2048 * n; i++) {
            int slot = i & 63;
            if (i >= 64) {
                Link old = ring[slot];
                total += old.child.value + old.child.parent.value;
            }
            Link parent = new Link(i);
            Link child = new Link(i + 1);
            parent.child = child;
            child.parent = parent;
            ring[slot] = parent;
        }
        for (Link parent : ring) {
            total += parent.child.value + parent.child.parent.value;
        }
        return total;
    }
    private static volatile int seed = 0;
    @Override public double run() { return work(seed); }
}
