// What a Java programmer writes for `h.fn?.(1) ?? 1`: a null check.
//
// Java has no optional-call operator, so the reference spells it out, and the
// translation is exact because the field holds a reference: `?.` fires on null
// or undefined, and a Java field has only one of those. There is no shape here
// where the two could disagree, which is not true of `?.` in general.
//
// A `Held` is allocated per iteration in both lanes, and half of them get a
// function assigned, so the field is genuinely sometimes-null and the branch is
// genuinely taken both ways. That is what stops this from measuring a predicted
// branch.
//
// `plusOne` is a static method behind a one-method interface rather than a
// lambda, because the TypeScript assigns the *same* function to every `Held`
// and `f === f` has to hold. This backend gives a `ClosureStatic` a
// `private static final INSTANCE` for exactly that reason -- which is also why
// `LambdaMetafactory` is the wrong tool even before Android's API 26 floor --
// so a `static final` singleton here is the matching shape rather than a
// fresh capture per assignment.
final class Ref extends Bench.Work {
    interface Fn {
        double apply(double x);
    }

    static final class Held {
        Fn fn;
    }

    private static double plusOne(double x) {
        return x + 1;
    }

    private static final Fn PLUS_ONE = Ref::plusOne;

    // `volatile` so the trip count is not a compile-time constant.
    private static volatile double rounds = 100000;

    static double run(int rounds) {
        double total = 0;
        for (int i = 0; i < rounds; i = i + 1) {
            Held h = new Held();
            if (i % 2 == 0) {
                h.fn = PLUS_ONE;
            }
            total = total + (h.fn != null ? h.fn.apply(1) : 1);
        }
        return total;
    }

    @Override public double run() {
        return run((int) rounds);
    }
}
