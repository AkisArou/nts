// A transliteration of `ref.cpp`, deliberately line for line, because the two
// references answer the same question for two lanes and a difference between
// them would be a difference in the question.
//
// The sibling of `generator/ref.java`, differing in one thing: `next` is
// dispatched through an abstract base rather than called on a concrete class.
// That is what nts emits once a generator arrives as a parameter.
//
// An abstract class rather than an interface, and it is **not** a coin toss.
// The 2.04x and 2.06x that suggested one are the *ART* pair; the same probe on
// HotSpot, which is the runtime this column is published from:
//
//     HotSpot   field read 1056   virtual, 1 subclass 1079 (1.02x)
//                                 interface, 1 impl   1230 (1.16x)
//     ART       field read 1058   virtual, 1 subclass 2178 (2.06x)
//                                 interface, 1 impl   2162 (2.04x)
//
// At one implementer an interface costs **14% more than a virtual call on
// HotSpot**. They are indistinguishable on ART and they are not here. So an
// interface would have made the *reference* 14% slower on the runtime the row
// is quoted from, which flatters this compiler -- the one direction a harness
// must never be wrong in, and the same trap `benches/jvm-rows.md` records for
// `awfy-sieve`, where one extra static call cost its reference 18%.
//
// It also happens to be what nts emits, which is a good tie-breaker and not the
// reason. The reason is that it is the *faster* reference of the two.
//
// Measured at one implementer and at three; this case has **two**, where
// HotSpot guards two direct calls bimorphically and neither number applies
// directly. The direction at one is what the choice rests on.
//
// Fields are `double` rather than `int` for the reason `generator/ref.java`
// gives: a TypeScript `number` is an f64, and a reference using narrower storage
// would be measuring a different program.
final class Ref extends Bench.Work {
    abstract static class Steps {
        double yielded;
        // True when there is nothing more, which is the `done` nts returns.
        abstract boolean next();
    }

    static final class UpTo extends Steps {
        double limit;
        double i;
        int state;

        UpTo(double limit) {
            this.limit = limit;
            this.i = 0;
            this.state = 0;
        }

        @Override boolean next() {
            if (state == 1) {
                i = i + 1;
            }
            if (!(i < limit)) {
                return true;
            }
            yielded = i * 3;
            state = 1;
            return false;
        }
    }

    static final class DownFrom extends Steps {
        double i;
        int state;

        DownFrom(double limit) {
            this.i = limit;
            this.state = 0;
        }

        @Override boolean next() {
            if (state == 1) {
                i = i - 1;
            }
            if (!(i > 0)) {
                return true;
            }
            yielded = i * 3;
            state = 1;
            return false;
        }
    }

    // Takes the steps rather than making them, which is the whole point.
    private static double drain(Steps walk) {
        double total = 0;
        while (!walk.next()) {
            total = total + walk.yielded;
        }
        return total;
    }

    // `volatile` for the reason the C++ reference's is: a loop-invariant input
    // lets the JIT hoist the whole call out of the timed loop and report an
    // impressive zero.
    private static volatile double seed = 5;

    @Override public double run() {
        double total = 0;
        for (int round = 0; round < 2000; round++) {
            total = total + drain(new UpTo(seed + 200));
        }
        // Reached once, so the site is not monomorphic and cannot be speculated
        // into a direct call. One walk against two thousand.
        total = total + drain(new DownFrom(seed + 200));
        return total;
    }
}
