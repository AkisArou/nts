// What a Java programmer writes when they want a generator and will not pay for
// an `Iterator<Double>`: a class holding the state, and a `next` that advances
// it and says whether there was anything.
//
// A transliteration of `ref.cpp`, deliberately line for line, because the two
// references answer the same question for two lanes and a difference between
// them would be a difference in the question.
//
// This is the right reference precisely because it is what nts *emits*. The
// frame `hir::suspend` builds is this class -- a state, the element it stopped
// on, and the locals that outlive a suspension -- and the resumption is this
// `next`. So the ratio answers the one worth asking: does writing `function*`
// cost anything over writing the machine out by hand?
//
// It is not `Iterator<Double>` and not a `Stream`. Both box every element, and
// comparing against one would measure an allocator in one lane and not the
// other -- the same mistake `ref.cpp` avoids by declining `std::generator`.
// The fields are `double` rather than `int` for the same reason: a TypeScript
// `number` is an f64, and a reference that quietly used narrower storage would
// be measuring a different program.
// Package-private, not `public`, so the file can be called `ref.java` and sit
// beside `ref.cpp` under the same name. Java requires a *public* class to live
// in a file named after it; a package-private one may live anywhere, and the
// generated driver is compiled into the same (default) package.
final class Ref {
    static final class UpTo {
        double limit;
        double i;
        double yielded;
        int state;

        UpTo(double limit) {
            this.limit = limit;
            this.i = 0;
            this.yielded = 0;
            this.state = 0;
        }

        // True when there is nothing more, which is the `done` nts returns.
        boolean next() {
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

    // `volatile` for the reason the C++ reference's is: a loop-invariant input
    // lets the JIT hoist the whole call out of the timed loop and report an
    // impressive zero.
    private static volatile double seed = 5;

    static double benchRun() {
        double total = 0;
        for (int round = 0; round < 2000; round++) {
            UpTo walk = new UpTo(seed + 200);
            while (!walk.next()) {
                total = total + walk.yielded;
            }
        }
        return total;
    }
}
