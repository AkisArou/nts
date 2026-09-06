// A table keyed by identity, which is what a symbol is.
//
// `IdentityHashMap` rather than `HashMap`: a symbol is compared by address and
// nothing else, and `HashMap` would call `equals` — which for `Object` is `==`
// anyway, but says so by accident rather than by choice. The distinction is the
// whole subject of the row.
import java.util.IdentityHashMap;

final class Ref extends Bench.Work {
    // Five distinct identities. `new Object()` is the cheapest thing on this
    // platform whose identity is its own.
    private static final Object A = new Object();
    private static final Object B = new Object();
    private static final Object C = new Object();
    private static final Object D = new Object();
    private static final Object ABSENT = new Object();

    // `volatile` so the seed is not a compile-time constant.
    private static volatile double seed = 5;

    static int work(int seed) {
        final int step = seed;
        // `Double` values, not `Integer`. The TypeScript is
        // `Map<symbol, number>` and this lane holds the value in an `f64`, so
        // an `Integer` is a field narrower than the `number` it stands for --
        // and narrower in the way that matters here, since `Integer.valueOf`
        // caches -128..127 and every value in this table is inside that cache
        // while `Double.valueOf` caches nothing. The *keys* are symbols on both
        // sides and are matched.
        final IdentityHashMap<Object, Double> events = new IdentityHashMap<>();
        events.put(A, 1.0);
        events.put(B, 2.0);
        events.put(C, 3.0);
        events.put(D, 4.0);
        int total = 0;
        for (int i = 0; i < 4096; i++) {
            final int which = (i ^ step) & 3;
            final Object key = which == 0 ? A : which == 1 ? B : which == 2 ? C : D;
            final Double found = events.get(key);
            total = total + (int) (found == null ? 0.0 : found);
            final Double missing = events.get(ABSENT);
            total = total + (int) (missing == null ? 0.0 : missing);
        }
        return total;
    }

    @Override public double run() {
        return work((int) seed);
    }
}
