package nts.rt;

/**
 * The operations a compiled program calls that the JVM does not already have.
 *
 * <p>Deliberately short. Most of what the C runtime carries -- retains,
 * releases, descriptors, allocation, bounds checks -- has no counterpart here,
 * because the platform collector owns the heap and the JVM checks its own array
 * bounds. What is left is the handful of places where <b>Java's answer is not
 * JavaScript's</b>, and every one of them is a method rather than an inlined
 * instruction sequence so that there is one implementation to be right.
 *
 * <p>What is <i>not</i> here matters as much: {@code Math.min}, {@code max},
 * {@code floor}, {@code ceil}, {@code abs} and {@code sqrt} are called straight
 * from {@code java.lang.Math}, because those six agree with JavaScript exactly,
 * including on {@code NaN} and on the sign of zero. C's {@code fmin} and
 * {@code fmax} do not, which is why the native runtime has to provide its own.
 */
public final class NtsRuntime {
    private NtsRuntime() {}

    private static final double TWO_32 = 4294967296.0;

    /**
     * ECMA-262 {@code ToInt32}: total, and wrapping modulo 2^32.
     *
     * <p><b>Not {@code d2i}.</b> The JVM's double-to-int conversion saturates --
     * {@code (int) 1e19} is {@code Integer.MAX_VALUE} -- where JavaScript wraps,
     * and it answers 0 for NaN, which is right by accident rather than by rule.
     * Java is <i>defined</i> where C is undefined here and still gives a
     * different answer, which is the more dangerous of the two failures.
     */
    public static int toInt32(double x) {
        if (Double.isNaN(x) || Double.isInfinite(x)) {
            return 0;
        }
        double whole = x < 0.0 ? Math.ceil(x) : Math.floor(x);
        // `%` on doubles is fmod, which is exact: no rounding error is
        // introduced even for a magnitude far past 2^53.
        double wrapped = whole % TWO_32;
        if (wrapped < 0.0) {
            wrapped += TWO_32;
        }
        return (int) (long) wrapped;
    }

    /**
     * {@code ToUint32}, which is the same thirty-two bits read the other way.
     *
     * <p>The JVM has no unsigned int, so an unsigned value lives in an
     * {@code int} and the operations that care -- division, remainder,
     * comparison, widening -- say so at the point of use.
     */
    public static int toUint32(double x) {
        return toInt32(x);
    }

    public static int toInt8(double x) {
        return (byte) toInt32(x);
    }

    public static int toUint8(double x) {
        return toInt32(x) & 0xFF;
    }

    public static int toInt16(double x) {
        return (short) toInt32(x);
    }

    public static int toUint16(double x) {
        return toInt32(x) & 0xFFFF;
    }

    /**
     * {@code Math.round}, which {@link java.lang.Math#round(double)} is not.
     *
     * <p>Java's returns a {@code long}, so it saturates at the extremes, answers
     * 0 for {@code NaN}, and cannot represent the {@code -0} that
     * {@code Math.round(-0.4)} must produce. It is also specified as
     * {@code floor(x + 0.5)}, which is wrong for
     * {@code 0.49999999999999994}: adding a half rounds that up to exactly 1.
     * Comparing the fraction against a half instead is exact.
     */
    public static double round(double x) {
        if (Double.isNaN(x) || Double.isInfinite(x) || x == 0.0) {
            return x;
        }
        if (x > 0.0 && x < 0.5) {
            return 0.0;
        }
        if (x < 0.0 && x >= -0.5) {
            return -0.0;
        }
        double below = Math.floor(x);
        return x - below >= 0.5 ? below + 1.0 : below;
    }

    /**
     * {@code Math.trunc}, which {@code java.lang.Math} has no equivalent of.
     *
     * <p>{@code (long) x} would lose the sign of zero and saturate, so this is
     * the pair of roundings the sign chooses between. {@code trunc(-0.5)} is
     * {@code -0}, which {@code Math.ceil} gives and a cast does not.
     */
    public static double trunc(double x) {
        return x < 0.0 ? Math.ceil(x) : Math.floor(x);
    }

    /**
     * Integer division, where the JVM throws and C is undefined.
     *
     * <p>A compiled program reaches this only where the specializer proved both
     * operands integral and did <i>not</i> prove the divisor non-zero. The C
     * lane emits a bare {@code /} there and executes undefined behaviour; this
     * refuses instead, which is a different answer only for a program the other
     * lane was already miscompiling.
     */
    public static int idiv(int left, int right) {
        if (right == 0) {
            throw new NtsRefusal("an integer division by zero");
        }
        return left / right;
    }

    public static int irem(int left, int right) {
        if (right == 0) {
            throw new NtsRefusal("an integer remainder by zero");
        }
        return left % right;
    }

    public static long ldiv(long left, long right) {
        if (right == 0L) {
            throw new NtsRefusal("an integer division by zero");
        }
        return left / right;
    }

    public static long lrem(long left, long right) {
        if (right == 0L) {
            throw new NtsRefusal("an integer remainder by zero");
        }
        return left % right;
    }

    /**
     * {@code String.prototype.charCodeAt}, which is not {@code String.charAt}.
     *
     * <p>Two differences, both observable. Out of range JavaScript answers
     * {@code NaN} where Java throws {@code StringIndexOutOfBoundsException};
     * and a fractional index truncates toward zero rather than being an error,
     * because the specification runs {@code ToIntegerOrInfinity} on it first.
     *
     * <p>Reached only where the compiler could *not* prove the index in range.
     * Where it could, the emitter calls {@code charAt} directly and this is not
     * in the program at all.
     */
    public static double charCodeAt(String text, double index) {
        int at = (int) index;
        if (at < 0 || at >= text.length()) {
            return Double.NaN;
        }
        return text.charAt(at);
    }

    /**
     * JavaScript equality on two strings, which compares by *value*.
     *
     * <p>{@code java.util.Objects.equals} rather than {@code a.equals(b)}: a
     * `string | null` is an ordinary reference here with `null` as its absence,
     * so either side may be null and `equals` would throw where JavaScript
     * answers false. The C runtime has the same rule written the other way
     * round -- a null comparison is settled before the string one, "because
     * `s === null` is a question about the pointer and answering it by reading
     * through the pointer reads through the null one".
     */
    public static boolean stringEq(String left, String right) {
        return java.util.Objects.equals(left, right);
    }

    /**
     * JavaScript truthiness of a string, which is emptiness and not nullness.
     *
     * <p>{@code ""} is falsy and so is a null one, and both have to be tested:
     * a length check alone throws on the absent case.
     */
    public static boolean stringTruthy(String text) {
        return text != null && !text.isEmpty();
    }

    /**
     * The terminator for a block the compiler proved unreachable.
     *
     * <p>The C backend writes {@code __builtin_unreachable()} here, which is a
     * licence for the optimizer to compute anything at all. The JVM has no such
     * construct and its verifier requires every path to end in a transfer, so
     * this returns a throwable for the caller to {@code athrow}: four bytes,
     * always verifiable, and a claim that turns out to be wrong becomes a stack
     * trace rather than silence.
     */
    public static Error unreachable() {
        return new NtsRefusal("control reached a block the compiler proved unreachable");
    }
}
