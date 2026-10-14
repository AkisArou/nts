// What a Java programmer writes for `indexOf`, `lastIndexOf`, `includes` and
// `reverse` on an array of numbers: the loops, by hand.
//
// **Java gives a `double[]` none of these methods.** `java.util.Arrays` has
// `sort`, `fill`, `copyOf` and `binarySearch`, and no linear search at all; the
// methods this case names exist on `List`, which would box all sixteen elements
// and make the row about `Double` rather than about a scan. So a person writes
// four small loops, and this reference writes them.
//
// That is a genuine asymmetry and it runs in our favour on effort and against
// us on nothing: `runtime/jvm` provides these as helpers because the TypeScript
// calls them, and the reference has to spell them out because Java does not.
// Both end up doing the same linear scans over the same sixteen `double`s,
// which is what makes the ratio meaningful -- `NtsArrayD.indexOf` against the
// one below, and nothing else between them.
//
// **This was an `int[]`**, deliberately, on the argument that sixteen `int`s
// are one cache line and sixteen `double`s are two and that the gap was ours to
// show. The rule forbids a field narrower than the f64 a TypeScript `number`
// is, and it is right: the gap it was showing is a middle-end representation
// choice, not something this backend decides, and putting it in the ratio meant
// the ratio stopped being about code generation. It is filed with `hir` where
// it can be acted on, with a number.
//
// Correcting it moved the published row from 1.67x to 1.18x, and **none of
// that is code generation.**
//
// What is left on this row and is not width: `indexOf` returns a `double` from
// the runtime, which the middle end converts to an `i64` and then to an `i32`,
// so every call emits `d2l; l2i` where `d2i` would do. Those are not the same
// instruction -- `d2l` saturates at the `long` bounds and `l2i` truncates,
// where `d2i` saturates at the `int` ones -- so the backend cannot fuse them
// and the fix is the return type upstream.
//
// `xs.at(-1)` is `xs[xs.length - 1]`; the negative index is JavaScript's
// spelling of the same read and there is nothing to translate. `reverse` is in
// place in both languages, which matters because the array's order carries from
// one round to the next.
final class Ref extends Bench.Work {
    private static int indexOf(double[] xs, double value) {
        for (int i = 0; i < xs.length; i++) {
            if (xs[i] == value) {
                return i;
            }
        }
        return -1;
    }

    private static int lastIndexOf(double[] xs, double value) {
        for (int i = xs.length - 1; i >= 0; i--) {
            if (xs[i] == value) {
                return i;
            }
        }
        return -1;
    }

    private static void reverse(double[] xs) {
        for (int i = 0, j = xs.length - 1; i < j; i++, j--) {
            double held = xs[i];
            xs[i] = xs[j];
            xs[j] = held;
        }
    }

    // `volatile` so the searched-for value is not a compile-time constant.
    private static volatile double seed = 5;

    static int work(int seed) {
        double[] xs = {3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9, 3};
        double step = seed;
        int total = 0;
        for (int round = 0; round < 256; round++) {
            total = total + indexOf(xs, step) + lastIndexOf(xs, step);
            if (indexOf(xs, step) >= 0) {
                total = total + 1;
            }
            total = total + (int) xs[xs.length - 1];
            reverse(xs);
        }
        return total;
    }

    @Override public double run() {
        return work((int) seed);
    }
}
