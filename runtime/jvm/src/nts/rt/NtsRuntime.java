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

    /**
     * The end of a program that threw and nothing caught it.
     *
     * <p>A transliteration of `nts_uncaught` in `runtime/c/nts_runtime.c`,
     * including the two things about it that are observable rather than
     * cosmetic. The line starts {@code "nts: "} because that prefix is how the
     * differential harness classifies a run as *declined* rather than *wrong* --
     * a lane that printed a Java stack trace instead would turn every case the
     * C lane legitimately declines into a defect. And it exits with status 1,
     * which is what node exits with on an uncaught throw, because the exit
     * status is compared too.
     *
     * <p>{@code System.exit} rather than rethrowing, for the C version's second
     * reason as well: the JVM would print its own trace and set status 1 by a
     * different route, and anything already written to {@code System.out} is
     * flushed here rather than left to a shutdown ordering.
     */
    public static void uncaught(NtsValue value, String detail) {
        StringBuilder line = new StringBuilder("nts: uncaught ");
        switch (value.tag) {
            case NtsValue.STRING:
                line.append((String) value.ref);
                break;
            case NtsValue.NUMBER:
                line.append(numberText(value.num));
                break;
            case NtsValue.BOOLEAN:
                line.append(value.num != 0.0 ? "true" : "false");
                break;
            case NtsValue.UNDEFINED:
                line.append("undefined");
                break;
            case NtsValue.NULL:
                line.append("null");
                break;
            default: {
                // The class name comes from the object itself, exactly as C
                // reads it from the descriptor: `Error`, `TypeError`, whatever
                // a user subclass is called. Only `message` needs the compiler,
                // being a field, and that is what `detail` carries.
                Object object = value.ref;
                line.append(object == null ? "[object]" : object.getClass().getSimpleName());
                if (detail != null) {
                    line.append(": ").append(detail);
                }
                break;
            }
        }
        System.out.flush();
        System.err.println(line);
        System.err.flush();
        System.exit(1);
    }

    /**
     * `%g`, which is what the C runtime prints an uncaught number with.
     *
     * <p>Not `Double.toString`: that gives `1.0E21` where C gives `1e+21`, and
     * this text is compared. Kept narrow deliberately -- it formats one number
     * on the way out of a dying program, and the general question is
     * `nts_grisu.h`, which is its own port.
     */
    private static String numberText(double value) {
        if (value == (long) value && Math.abs(value) < 1e15) {
            return Long.toString((long) value);
        }
        return String.format("%g", value);
    }

    /**
     * `Array.prototype.fill`, one entry point per element width.
     *
     * <p>Separate entry points rather than one generic call taking a width, for
     * the reason the C header gives: the compiler knows the element type, and a
     * runtime that had to be told it would be told it wrongly one day. The
     * reference form does no counting here -- the platform collector owns these
     * objects, which is the whole of RFC 13 -- so it is the same loop.
     */
    public static double[] arrayFill(double[] array, double value) {
        java.util.Arrays.fill(array, value);
        return array;
    }

    public static boolean[] arrayFillBool(boolean[] array, boolean value) {
        java.util.Arrays.fill(array, value);
        return array;
    }

    public static Object[] arrayFillRef(Object[] array, Object value) {
        java.util.Arrays.fill(array, value);
        return array;
    }

    // ----- Math -----------------------------------------------------------

    /**
     * {@code Math.pow}, and Java's agrees with JavaScript where C's does not.
     *
     * <p>C99 says {@code pow(1, NaN)} is 1.0. JavaScript says NaN, and so does
     * {@code java.lang.Math.pow} -- "if the second argument is NaN, then the
     * result is NaN", with no exception for a base of one. So the native
     * runtime needs its own and this one does not, which is the same shape as
     * {@code Math.min} agreeing about {@code -0.0} where {@code fmin} does not.
     */
    public static double mathPow(double base, double exponent) {
        return Math.pow(base, exponent);
    }

    public static double mathSinh(double x) {
        return Math.sinh(x);
    }

    /** `isFinite`: not NaN and not either infinity. */
    public static boolean isFinite(double x) {
        return !Double.isNaN(x) && !Double.isInfinite(x);
    }

    // ----- strings --------------------------------------------------------

    /**
     * `ToInteger`: truncate toward zero, and NaN is zero.
     *
     * <p>Not `(long) x`, which is right for the finite case and wrong for NaN
     * only by accident -- `(long) NaN` is 0 on the JVM and undefined in C, and
     * relying on that is how a rule ends up holding for a reason nobody wrote
     * down.
     */
    private static double toInteger(double x) {
        if (Double.isNaN(x)) {
            return 0.0;
        }
        return x < 0.0 ? Math.ceil(x) : Math.floor(x);
    }

    /**
     * An index into a string of {@code length}, clamped the way the language
     * clamps it.
     *
     * <p>{@code relative} is what separates `slice` from `substring`: a
     * negative index counts back from the end for the first and clamps to zero
     * for the second. A transliteration of `nts_str_clamp`, including that a
     * fraction and a NaN both go through `ToInteger` rather than being
     * truncated by the cast.
     */
    private static int clamp(double index, int length, boolean relative) {
        double at = toInteger(index);
        if (relative && at < 0.0) {
            at += length;
        }
        if (at < 0.0) {
            return 0;
        }
        if (at >= length) {
            return length;
        }
        return (int) at;
    }

    public static double strIndexOf(String s, String needle) {
        return s.indexOf(needle);
    }

    public static double strLastIndexOf(String s, String needle) {
        return s.lastIndexOf(needle);
    }

    public static boolean strIncludes(String s, String needle) {
        return s.contains(needle);
    }

    public static boolean strStartsWith(String s, String prefix) {
        return s.startsWith(prefix);
    }

    public static boolean strEndsWith(String s, String suffix) {
        return s.endsWith(suffix);
    }

    /**
     * How many code units the code point starting at {@code at} occupies: two
     * for a surrogate pair and one for everything else, including an unpaired
     * surrogate.
     */
    public static double strPointWidth(String s, double at) {
        int index = (int) at;
        if (index < 0 || index >= s.length()) {
            return 1.0;
        }
        return Character.charCount(s.codePointAt(index));
    }

    /** `String.fromCharCode`, which is `ToUint16` and then one code unit. */
    public static String stringFromCharCode(double code) {
        return String.valueOf((char) toUint16(code));
    }

    /** `String.fromCodePoint`, which is one or two code units. */
    public static String stringFromCodePoint(double code) {
        return new String(Character.toChars((int) toInteger(code)));
    }

    /**
     * `repeat`. Written out rather than `String.repeat`, which arrived in Java
     * 11 and this runtime targets 8 -- the floor that keeps the Android path
     * open.
     */
    public static String strRepeat(String s, double times) {
        int count = (int) toInteger(times);
        if (count <= 0 || s.isEmpty()) {
            return "";
        }
        StringBuilder out = new StringBuilder(s.length() * count);
        for (int i = 0; i < count; i++) {
            out.append(s);
        }
        return out.toString();
    }

    /** `padStart`, likewise a Java 11 method written out. */
    public static String strPadStart(String s, double target, String pad) {
        int want = (int) toInteger(target);
        if (want <= s.length() || pad.isEmpty()) {
            return s;
        }
        StringBuilder out = new StringBuilder(want);
        while (out.length() < want - s.length()) {
            out.append(pad);
        }
        out.setLength(want - s.length());
        return out.append(s).toString();
    }

    /** `substring`: negatives clamp to zero and the ends swap if out of order. */
    public static String strSubstring(String s, double from, double to) {
        int start = clamp(from, s.length(), false);
        int end = clamp(to, s.length(), false);
        if (start > end) {
            int swap = start;
            start = end;
            end = swap;
        }
        return s.substring(start, end);
    }

    /** `slice`: negatives count from the end, and an inverted range is empty. */
    public static String strSlice(String s, double from, double to) {
        int start = clamp(from, s.length(), true);
        int end = clamp(to, s.length(), true);
        return start >= end ? "" : s.substring(start, end);
    }

    /**
     * `trim`.
     *
     * <p>Not `String.trim`, which strips everything at or below U+0020 and
     * nothing above it -- JavaScript strips Unicode whitespace, which includes
     * U+00A0 and U+FEFF and excludes most control characters. `String.strip`
     * is the right one and is Java 11, so the predicate is spelled here.
     */
    public static String strTrim(String s) {
        int start = 0;
        int end = s.length();
        while (start < end && isJsWhitespace(s.charAt(start))) {
            start++;
        }
        while (end > start && isJsWhitespace(s.charAt(end - 1))) {
            end--;
        }
        return s.substring(start, end);
    }

    /**
     * The `WhiteSpace` and `LineTerminator` productions, which is what `trim`
     * removes and is not what any of Java's three answers removes.
     */
    private static boolean isJsWhitespace(char c) {
        switch (c) {
            case '\t': case '\n': case '\u000B': case '\f': case '\r': case ' ':
            case '\u00A0': case '\u1680': case '\u2028': case '\u2029':
            case '\u202F': case '\u205F': case '\u3000': case '\uFEFF':
                return true;
            default:
                return c >= '\u2000' && c <= '\u200A';
        }
    }

    /**
     * `split` with a string separator.
     *
     * <p>Not `String.split`, which takes a **regular expression**: `"a.b".split(".")`
     * is three empty strings there and `["a", "b"]` in JavaScript. The empty
     * separator is its own rule too -- it splits into code units, not code
     * points, so a surrogate pair becomes two halves.
     */
    public static String[] strSplit(String s, String separator) {
        if (separator.isEmpty()) {
            String[] units = new String[s.length()];
            for (int i = 0; i < s.length(); i++) {
                units[i] = String.valueOf(s.charAt(i));
            }
            return units;
        }
        java.util.ArrayList<String> parts = new java.util.ArrayList<>();
        int from = 0;
        while (true) {
            int at = s.indexOf(separator, from);
            if (at < 0) {
                parts.add(s.substring(from));
                break;
            }
            parts.add(s.substring(from, at));
            from = at + separator.length();
        }
        return parts.toArray(new String[0]);
    }

    /** `replace` with a string pattern: the first occurrence only. */
    public static String strReplace(String s, String pattern, String with) {
        int at = s.indexOf(pattern);
        if (at < 0) {
            return s;
        }
        return s.substring(0, at) + with + s.substring(at + pattern.length());
    }

    /** `replaceAll` with a string pattern; an empty pattern matches everywhere. */
    public static String strReplaceAll(String s, String pattern, String with) {
        if (pattern.isEmpty()) {
            StringBuilder out = new StringBuilder();
            out.append(with);
            for (int i = 0; i < s.length(); i++) {
                out.append(s.charAt(i)).append(with);
            }
            return out.toString();
        }
        StringBuilder out = new StringBuilder();
        int from = 0;
        while (true) {
            int at = s.indexOf(pattern, from);
            if (at < 0) {
                return out.append(s, from, s.length()).toString();
            }
            out.append(s, from, at).append(with);
            from = at + pattern.length();
        }
    }
}
