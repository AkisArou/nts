// Strong parent/child cycles, dropped without unlinking or forced collection.
// HotSpot may scalar-replace a graph; that is a legitimate optimization here.
final class Ref extends Bench.Work {
    private static final class Link {
        final int value;
        Link parent, child;
        Link(int value) { this.value = value; }
    }
    static int work(int n) {
        n = (n & 3) + 1;
        int total = 0;
        for (int i = 0; i < 2048 * n; i++) {
            Link parent = new Link(i);
            Link child = new Link(i + 1);
            parent.child = child;
            child.parent = parent;
            total += parent.child.value + child.parent.value;
        }
        return total;
    }
    private static volatile int seed = 0;
    @Override public double run() { return work(seed); }
}
