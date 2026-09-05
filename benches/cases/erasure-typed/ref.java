// The control for `erasure-unknown`, in Java: the same loop with the types a
// person would write.
//
// The pair is the measurement and neither number means much alone, so these two
// files differ in exactly one thing -- `double` here, `Object` there -- and
// nothing else. Any other difference between them would land in the ratio and
// be read as the cost of erasure.
//
// `kindOf` returns a literal 1 because `typeof v === "number"` on a `double` is
// trivially true and that is what a person writes. The compiled control folds
// it the same way; the point of a control is to be the easy program.
final class Ref {
    private static double widen(double value) {
        return value;
    }

    private static int kindOf(double value) {
        return 1;
    }

    private static double readBack(double value) {
        return value;
    }

    // `volatile` so the sum is not a compile-time constant.
    private static volatile double seed = 12345;

    static double erasureTyped(double seed) {
        double total = 0;
        for (int i = 0; i < 200000; i++) {
            double carried = widen(seed + i);
            total = total + kindOf(carried) + readBack(carried);
        }
        return total;
    }

    static double benchRun() {
        return erasureTyped(seed);
    }
}
