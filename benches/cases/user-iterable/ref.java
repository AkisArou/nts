// What a Java programmer writes for a user-defined iterable: `Iterable` and
// `Iterator`, driven by a for-each.
//
// **The two protocols are not the same shape, and the difference is the row.**
// JavaScript's iterator returns a fresh `{ value, done }` object per step, so
// the TypeScript allocates once per element by construction. Java's returns the
// value and answers `hasNext()` separately, so it allocates nothing per step --
// except that `Iterator<Integer>` boxes, and `Integer.valueOf` caches only
// -128..127 while these values run 0..255. So roughly half the steps allocate
// here and all of them allocate there.
//
// A reference using a hand-rolled `interface IntSteps { boolean hasNext(); int
// next(); }` would avoid the boxing entirely and would also stop being what a
// person writes -- `for (int v : series)` does not exist for a custom type, and
// the moment you want a for-each you have taken `Iterable<T>` and its box. The
// idiomatic version is the honest one, and the comment is here so the ratio is
// not read as a claim about iteration protocols in the abstract.
//
// The seed sequence is identical to the TypeScript's. `hasNext()` is `at > 0`,
// so `next()` yields exactly `rounds` values for `at` running from `rounds - 1`
// down to 0 -- the same values, in the same order, as the for-of loop that stops
// when `done` first goes true. The TypeScript makes one further `next()` call to
// observe `done`, which advances its seed once more; that value is never added
// and the checksum confirms the two totals agree.
import java.util.Iterator;

final class Ref {
    static final class Steps implements Iterator<Integer> {
        int at;
        int seed;

        Steps(int at) {
            this.at = at;
            this.seed = 1;
        }

        @Override
        public boolean hasNext() {
            return at > 0;
        }

        @Override
        public Integer next() {
            at = at - 1;
            seed = seed * 31 + at;
            return seed & 255;
        }
    }

    static final class Series implements Iterable<Integer> {
        final int from;

        Series(int from) {
            this.from = from;
        }

        @Override
        public Iterator<Integer> iterator() {
            return new Steps(from);
        }
    }

    // `volatile` so the trip count is not a compile-time constant.
    private static volatile double rounds = 100000;

    static int run(int rounds) {
        int total = 0;
        for (int v : new Series(rounds)) {
            total = total + v;
        }
        return total;
    }

    static double benchRun() {
        return run((int) rounds);
    }
}
