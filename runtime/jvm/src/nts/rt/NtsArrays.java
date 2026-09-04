package nts.rt;

/**
 * The part of an array wrapper that does not mention its elements.
 *
 * <p>`NtsArrayD`, `NtsArrayL` and `NtsArrayZ` are three classes because the JVM
 * has three storage widths and no way to write one class over them -- see the
 * measurement in any of their headers. Of the twenty-seven methods they carry,
 * **three** do not have the element type in a signature or a body, and those
 * three live here.
 *
 * <p>`static`, and that is the whole reason this is free. A call with no
 * receiver is monomorphic by construction, so C2 inlines it and there is a call
 * in the bytecode and none in the machine code. Sharing the same logic through
 * an abstract base's *virtual* methods would not be free: three subclasses make
 * every `get` and `set` a polymorphic site, and an inline cache that handles
 * one or two receivers well handles three poorly -- in the innermost loop of
 * every array program.
 *
 * <p>So the duplication that remains is the duplication that cannot be removed
 * without boxing, and this is the part that can.
 */
final class NtsArrays {
    private NtsArrays() {}

    /**
     * `ToInteger`: truncate toward zero, NaN is zero.
     *
     * <p>`at` applies this **before** turning a negative index into an offset
     * from the end, and the order is observable: `at(-1.5)` truncates to `-1`
     * and reads the last element, where adding the length first and truncating
     * after reads the one before it.
     */
    static double toInteger(double x) {
        if (Double.isNaN(x)) {
            return 0.0;
        }
        return x < 0.0 ? Math.ceil(x) : Math.floor(x);
    }

    /**
     * An index into `length` elements, clamped the way `slice` clamps it: a
     * negative one counts back from the end, and both ends saturate.
     */
    static int clamp(double index, int length) {
        double at = toInteger(index);
        if (at < 0.0) {
            at += length;
        }
        if (at < 0.0) {
            return 0;
        }
        return at >= length ? length : (int) at;
    }

    /** Where `at` lands, or -1 when it lands outside. */
    static int offset(double index, int length) {
        double at = toInteger(index);
        if (at < 0.0) {
            at += length;
        }
        return at < 0.0 || at >= length ? -1 : (int) at;
    }
}
