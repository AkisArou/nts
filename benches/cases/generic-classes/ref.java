// What a Java programmer writes, and the third answer to the question.
//
// Java generics are **erased**: one `Box` class whose field is an `Object`, so
// the `int` is boxed into an `Integer` and the `boolean` into a `Boolean`. That
// is the implementation this feature rejects, written out -- and C2's escape
// analysis is what decides whether the boxing survives, which is the whole
// interest of the column.
final class Ref extends Bench.Work {
    static final class Box<T> {
        private final T v;
        Box(T v) { this.v = v; }
        T get() { return v; }
    }

    // `volatile` so the inputs are not compile-time constants.
    private static volatile double seed = 5;

    static int work(int seed) {
        final int step = seed;
        int total = 0;
        for (int i = 0; i < 4096; i++) {
            final int size = (i ^ step) & 0xffff;
            final Box<Integer> counted = new Box<>(size);
            final Box<Boolean> flagged = new Box<>((i & 1) == 0);
            total = total ^ counted.get() ^ (flagged.get() ? 1 : 0);
        }
        return total;
    }

    @Override public double run() {
        return work((int) seed);
    }
}
