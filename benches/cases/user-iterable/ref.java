// What a Java programmer writes for a user-defined iterable, under the two
// rules a reference here has to keep -- and this file broke both, in opposite
// directions, before the numbers were in.
//
// **No `Iterator<T>` where the subject boxes nothing.** The first version used
// `Iterator<Integer>`, on the argument that `for (int v : series)` is what a
// person writes and that wanting a for-each is what commits you to `Iterable`
// and its box. That is true and it is not the test: `bytes/op` says this lane
// allocates **zero** per step, so a boxing reference is measuring `Integer`
// against our codegen. A hand-rolled primitive iterator is the honest analogue,
// and it costs the reference its for-each loop, which is a fair price for
// comparing the same work.
//
// **No field narrower than the f64 a TypeScript `number` is.** The first
// version gave `Steps` `int at` and `int seed`. TypeScript says `number`, and
// field specialization does not narrow it, so this lane carries doubles and
// calls `NtsRuntime.toInt` twice per step for the two `| 0`s. A reference with
// `int` fields gets the narrowing for free and is measuring a proof this
// compiler has not made rather than the code it emitted.
//
// The two corrections pull opposite ways -- dropping the box makes the
// reference faster, widening the fields makes it slower -- and both are
// required, which is the point of having the rules written down rather than
// deciding per row.
//
// **`(int)` on a double is not `| 0`, and here the difference is live.** A cast
// saturates where `ToInt32` wraps, and `seed` is not bounded: only the value
// *returned* is masked to 255, while the field itself is a full int32, so
// `seed * 31` reaches 2^36 and wraps every step. `(int) (long) x` truncates
// modulo 2^32 for anything inside `long`, which is `ToInt32` on this range.
//
// The first draft of this file asserted the two agreed "because `seed` is
// masked" -- reading the mask on the return as though it were on the field --
// and the checksum caught it immediately. Which is the argument for the f64
// field rule doing more than fairness: with `int` fields the wrap is the
// hardware's and the mistake is unavailable, so the reference cannot show you
// that this compiler is calling `NtsRuntime.toInt` twice a step to get it.
final class Ref extends Bench.Work {
    // The primitive analogue of the JS iterator protocol: a value and a
    // question, no wrapper object per step and no box.
    interface Steps {
        boolean hasNext();
        double next();
    }

    static final class Counting implements Steps {
        double at;
        double seed;

        Counting(double at) {
            this.at = at;
            this.seed = 1;
        }

        @Override
        public boolean hasNext() {
            return at > 0;
        }

        @Override
        public double next() {
            at = at - 1;
            seed = (int) (long) (seed * 31 + at);
            return (int) (long) seed & 255;
        }
    }

    static final class Series {
        final double from;

        Series(double from) {
            this.from = from;
        }

        Steps iterator() {
            return new Counting(from);
        }
    }

    // `volatile` so the trip count is not a compile-time constant.
    private static volatile double rounds = 100000;

    static double run(double rounds) {
        double total = 0;
        for (Steps it = new Series(rounds).iterator(); it.hasNext(); ) {
            total = (int) (long) (total + it.next());
        }
        return total;
    }

    @Override public double run() {
        return run(rounds);
    }
}
