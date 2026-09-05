// What a Java programmer writes for `indexOf`, `lastIndexOf`, `includes` and
// `reverse` on an array of numbers: the loops, by hand.
//
// **Java gives an `int[]` none of these methods.** `java.util.Arrays` has
// `sort`, `fill`, `copyOf` and `binarySearch`, and no linear search at all; the
// methods this case names exist on `List`, which would box all sixteen elements
// and make the row about `Integer` rather than about a scan. So a person writes
// four small loops, and this reference writes them.
//
// That is a genuine asymmetry and it runs in our favour on effort and against
// us on nothing: `runtime/jvm` provides these as helpers because the TypeScript
// calls them, and the reference has to spell them out because Java does not.
// Both end up doing the same linear scans over the same sixteen `int`s, which
// is what makes the ratio meaningful.
//
// `int[]` rather than `double[]` is the same deliberate choice `arrays` makes:
// sixteen `int`s are one cache line and sixteen `double`s are two, and the
// compare is `if_icmpeq` against `dcmpl`. The TypeScript is `number[]` and the
// lane prepares `managed<[f64]>`, so the reference is scanning half the bytes.
// That is this lane's element-width gap rather than a translation liberty, and
// the row is here to show it -- the helpers themselves are the same hand loops,
// `NtsArrayD.indexOf` against the one below, so nothing else separates them.
//
// `xs.at(-1)` is `xs[xs.length - 1]`; the negative index is JavaScript's
// spelling of the same read and there is nothing to translate. `reverse` is in
// place in both languages, which matters because the array's order carries from
// one round to the next.
final class Ref {
    private static int indexOf(int[] xs, int value) {
        for (int i = 0; i < xs.length; i++) {
            if (xs[i] == value) {
                return i;
            }
        }
        return -1;
    }

    private static int lastIndexOf(int[] xs, int value) {
        for (int i = xs.length - 1; i >= 0; i--) {
            if (xs[i] == value) {
                return i;
            }
        }
        return -1;
    }

    private static void reverse(int[] xs) {
        for (int i = 0, j = xs.length - 1; i < j; i++, j--) {
            int held = xs[i];
            xs[i] = xs[j];
            xs[j] = held;
        }
    }

    // `volatile` so the searched-for value is not a constant.
    private static volatile double seed = 5;

    static int work(int seed) {
        int[] xs = {3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9, 3};
        int step = seed;
        int total = 0;
        for (int round = 0; round < 256; round++) {
            total = total + indexOf(xs, step) + lastIndexOf(xs, step);
            if (indexOf(xs, step) >= 0) {
                total = total + 1;
            }
            total = total + xs[xs.length - 1];
            reverse(xs);
        }
        return total;
    }

    static double benchRun() {
        return work((int) seed);
    }
}
