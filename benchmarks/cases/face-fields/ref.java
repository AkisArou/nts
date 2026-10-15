// What a Java programmer writes for one shape three classes have: an interface
// of accessors, implemented by each, and `invokeinterface` at a site that sees
// all three.
//
// The TypeScript says no `implements` anywhere; Java has no structural types,
// so this is the closest a Java programmer gets, and it is what nts emits for
// the split face too -- the row asks whether everything around the calls is
// equal.
final class Ref extends Bench.Work {
    interface Point {
        int x();
        void x(int value);
        int y();
    }

    static final class Flat implements Point {
        int x;
        int y;
        int z;

        Flat(int x, int y) {
            this.x = x;
            this.y = y;
        }

        @Override public int x() { return x; }
        @Override public void x(int value) { x = value; }
        @Override public int y() { return y; }
    }

    static final class Swapped implements Point {
        int tag = 1;
        int y;
        int x;

        Swapped(int x, int y) {
            this.x = x;
            this.y = y;
        }

        @Override public int x() { return x; }
        @Override public void x(int value) { x = value; }
        @Override public int y() { return y; }
    }

    static final class Literal implements Point {
        int x;
        int y;

        Literal(int x, int y) {
            this.x = x;
            this.y = y;
        }

        @Override public int x() { return x; }
        @Override public void x(int value) { x = value; }
        @Override public int y() { return y; }
    }

    // `volatile` so the sizes are not compile-time constants.
    private static volatile double seed = 5;

    static int weigh(Point p) {
        return p.x() * 3 + p.y();
    }

    static int work(int seed) {
        int step = seed;
        Point[] points = {new Flat(step, 1), new Swapped(2, step), new Literal(3, step)};
        int total = 0;
        for (int i = 0; i < 4096; i++) {
            Point p = points[i % 3];
            p.x((p.x() + i) & 0xffff);
            total = total ^ weigh(p);
        }
        return total;
    }

    @Override public double run() {
        return work((int) seed);
    }
}
