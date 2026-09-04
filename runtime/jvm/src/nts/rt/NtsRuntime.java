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
     * `setTimeout`, with the signature the C header declares.
     *
     * <p>Every parameter is a `double` because `hir::runtime` says so, and
     * that table is the single answer about conversions: a version taking an
     * `int` delay would make the middle end insert a different conversion for
     * this backend than for the others, which is the exact trap
     * `runtime_agrees_with_hir` exists to catch.
     *
     * <p>`slot` is accepted and unused. The C runtime reaches the callback
     * through the object's descriptor at that slot; this backend dispatches by
     * name through {@link NtsCallback}, so the slot is already spent by the
     * time the call arrives. Dropping it from the signature would be this lane
     * disagreeing with `hir::runtime` about an entry point, which is worth
     * more than an unused parameter.
     */
    public static double setTimeout(Object callback, double slot, double delayMs, boolean repeating) {
        if (!(callback instanceof NtsCallback)) {
            // Not a refusal: a callback whose class does not declare the
            // interface is this backend having emitted the wrong class, which
            // is a defect and says so with the prefix that means one.
            System.out.flush();
            System.err.println("nts: a timer callback that is not callable");
            System.err.flush();
            System.exit(1);
            return 0.0;
        }
        return NtsLoop.postDelayed((NtsCallback) callback, delayMs, repeating);
    }

    /** `clearTimeout`. An id that already fired, or was never issued, is a no-op. */
    public static void clearTimeout(double id) {
        NtsLoop.cancelDelayed(id);
    }

    /**
     * A captured binding read before its declaration ran.
     *
     * <p>A transliteration of `nts_cell_unready`, and the wording is copied
     * rather than paraphrased because it is compared: the differential reads
     * stderr, and a line starting {@code "nts: "} that is <em>not</em>
     * {@code "nts: refused: "} is how both lanes say <em>defect</em>. Throwing
     * an {@link NtsRefusal} here would have prefixed it {@code refused:} and
     * quietly reclassified a temporal-dead-zone violation as a declined case --
     * the same class of mistake as a `VerifyError` reading as a decline, one
     * layer down.
     *
     * <p>The flag is a parameter rather than a branch at the call site because
     * this backend emits an operation as straight-line code and gets its
     * branches from terminators -- the same reason {@code bounds} takes the
     * index rather than being inlined as a compare. C2 inlines a method this
     * small, so what runs is the one predictable branch the C lane emits.
     */
    public static void cellReady(boolean ready, String name) {
        if (ready) {
            return;
        }
        System.out.flush();
        System.err.println("nts: `" + name + "` was read before its declaration ran");
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

    /**
     * The replacement text for one match, with the `$` patterns expanded.
     *
     * <p>`GetSubstitution` in the specification, and the reason `replace`
     * cannot be a splice: a **string** replacement is not literal. `$$` is a
     * dollar, `$&` is what matched, `` $` `` is everything before it and `$'`
     * everything after. `examples/string-methods` disagreed with node on 87
     * cases for exactly this -- it kept `[$&]` where node produces `[-]`.
     *
     * <p>`$1` and `$<name>` stay literal here, and that is correct rather than
     * unfinished: a string pattern has no capture groups, and the
     * specification says an unmatched `$n` is left alone.
     */
    private static void substitution(
        StringBuilder out, String matched, String whole, int at, String replacement) {
        int i = 0;
        while (i < replacement.length()) {
            char c = replacement.charAt(i);
            if (c != '$' || i + 1 >= replacement.length()) {
                out.append(c);
                i++;
                continue;
            }
            char next = replacement.charAt(i + 1);
            switch (next) {
                case '$':
                    out.append('$');
                    break;
                case '&':
                    out.append(matched);
                    break;
                case '`':
                    out.append(whole, 0, at);
                    break;
                case '\'':
                    out.append(whole, at + matched.length(), whole.length());
                    break;
                default:
                    // Not a recognised pattern: both characters are literal.
                    out.append(c).append(next);
                    break;
            }
            i += 2;
        }
    }

    /** `replace` with a string pattern: the first occurrence only. */
    public static String strReplace(String s, String pattern, String with) {
        int at = s.indexOf(pattern);
        if (at < 0) {
            return s;
        }
        StringBuilder out = new StringBuilder(s.length() + with.length());
        out.append(s, 0, at);
        substitution(out, pattern, s, at, with);
        return out.append(s, at + pattern.length(), s.length()).toString();
    }

    /** `replaceAll` with a string pattern; an empty pattern matches everywhere. */
    public static String strReplaceAll(String s, String pattern, String with) {
        StringBuilder out = new StringBuilder();
        if (pattern.isEmpty()) {
            // An empty pattern matches at every position including both ends,
            // so the replacement lands between every pair of code units.
            substitution(out, "", s, 0, with);
            for (int i = 0; i < s.length(); i++) {
                out.append(s.charAt(i));
                substitution(out, "", s, i + 1, with);
            }
            return out.toString();
        }
        int from = 0;
        while (true) {
            int at = s.indexOf(pattern, from);
            if (at < 0) {
                return out.append(s, from, s.length()).toString();
            }
            out.append(s, from, at);
            substitution(out, pattern, s, at, with);
            from = at + pattern.length();
        }
    }

    // ----- number to string -----------------------------------------------

    /**
     * {@code String(x)} for a number, to the letter of `Number::toString`.
     *
     * <p><b>Not {@code Double.toString}.</b> Two things are wrong with it and
     * only one of them is cosmetic. The format differs -- `1.0E21` where the
     * language says `1e+21`, and `1.0` where the language says `1` -- and that
     * alone would be enough, because the differential compares these as text.
     * The other is that before JDK 19 it does not produce the *shortest* digits
     * that read back, so on an older JVM it is a different number's spelling.
     * Depending on the host JDK for correctness is a cliff with nothing at the
     * edge of it.
     *
     * <p>The C runtime answers this with Grisu3 and an arbitrary-precision
     * fallback for the 0.22% of doubles Grisu declines. This does the exact
     * thing directly: {@code new BigDecimal(double)} is the double's *exact*
     * value, and rounding it to p significant digits and asking whether it
     * reads back is the shortest-digits search by definition. Slower than
     * Grisu and correct on every JDK, which is the right order to do them in --
     * the integer fast path below covers most of what programs actually print,
     * and a Grisu port is an optimisation with a measurement attached rather
     * than a prerequisite.
     *
     * <p>{@code HALF_EVEN} because the specification says so, and I had it
     * backwards first: "if there are two such possible values of s, choose the
     * one that is **even**". `HALF_UP` -- the larger -- disagreed with node on
     * 27 of 99,957 random doubles, every one of them a last digit 3 where node
     * says 2. Which is 0.027%: frequent enough that the corpus would eventually
     * have caught it, and rare enough that no example would.
     */
    public static String numberToString(double x) {
        if (Double.isNaN(x)) {
            return "NaN";
        }
        if (Double.isInfinite(x)) {
            return x > 0 ? "Infinity" : "-Infinity";
        }
        if (x == 0.0) {
            // Both zeroes print as "0": the sign of zero is observable through
            // `Object.is` and `1/x`, and not through `String`.
            return "0";
        }
        // Whole numbers a `long` can hold, which is most of what is printed.
        // The bound is 2^53 rather than `Long.MAX_VALUE`: above it a double's
        // neighbours are more than one apart, so the shortest representation is
        // not necessarily every digit of the integer.
        if (x == Math.floor(x) && Math.abs(x) < 9007199254740992.0) {
            return Long.toString((long) x);
        }

        boolean negative = x < 0;
        double magnitude = Math.abs(x);
        java.math.BigDecimal exact = new java.math.BigDecimal(magnitude);

        // Start from a guess rather than scanning 1..17.
        //
        // `Double.toString` is *not* trusted for the answer -- before JDK 19 it
        // does not produce the shortest digits, which is why this method exists
        // -- but it is a good guess at how many there are, and the round-trip
        // check below is what decides. A wrong guess costs a step in one
        // direction; scanning from one cost seventeen `BigDecimal` roundings on
        // every call, and `benches/cases/number-format-double` measured that at
        // 91us against 4.72us for the C lane.
        int precision = Math.max(1, Math.min(17, significantDigits(Double.toString(magnitude))));
        java.math.BigDecimal shortest = roundTo(exact, precision);
        if (shortest.doubleValue() != magnitude) {
            // The guess was short. Widen until it reads back; seventeen digits
            // always do.
            while (precision < 17) {
                precision++;
                shortest = roundTo(exact, precision);
                if (shortest.doubleValue() == magnitude) {
                    break;
                }
            }
        } else {
            // The guess reads back, but a shorter one may too.
            while (precision > 1) {
                java.math.BigDecimal shorter = roundTo(exact, precision - 1);
                if (shorter.doubleValue() != magnitude) {
                    break;
                }
                shortest = shorter;
                precision--;
            }
        }
        shortest = shortest.stripTrailingZeros();

        String digits = shortest.unscaledValue().toString();
        // `n` in the specification: the position of the decimal point, so that
        // the value is `0.digits * 10^n`.
        int n = digits.length() - shortest.scale();
        return (negative ? "-" : "") + layout(digits, n);
    }

    private static java.math.BigDecimal roundTo(java.math.BigDecimal exact, int precision) {
        return exact.round(new java.math.MathContext(precision, java.math.RoundingMode.HALF_EVEN));
    }

    /**
     * How many significant digits a `Double.toString` result carries.
     *
     * <p>Used only as a starting point, never as the answer: `1.0E21` is two
     * characters of digits and one significant one, and an older JDK's
     * non-shortest output is simply a guess that is too large.
     */
    private static int significantDigits(String text) {
        int digits = 0;
        int trailingZeroes = 0;
        boolean seen = false;
        for (int at = 0; at < text.length(); at++) {
            char c = text.charAt(at);
            if (c == 'E' || c == 'e') {
                break;
            }
            if (c < '0' || c > '9') {
                continue;
            }
            if (c == '0' && !seen) {
                // Leading zeroes are not significant: `0.001` has one digit.
                continue;
            }
            seen = true;
            digits++;
            trailingZeroes = c == '0' ? trailingZeroes + 1 : 0;
        }
        return Math.max(1, digits - trailingZeroes);
    }

    /**
     * The five cases of `Number::toString` step 5 onwards, given the shortest
     * digits and where the point goes.
     *
     * <p>The thresholds are the language's and are not round numbers by
     * accident: 21 digits is where it gives up on positional notation going up,
     * and -6 is where it gives up going down. `1e21` is exponential and
     * `1e20` is not.
     */
    private static String layout(String digits, int n) {
        int k = digits.length();
        if (k <= n && n <= 21) {
            StringBuilder out = new StringBuilder(n);
            out.append(digits);
            for (int i = 0; i < n - k; i++) {
                out.append('0');
            }
            return out.toString();
        }
        if (0 < n && n <= 21) {
            return digits.substring(0, n) + "." + digits.substring(n);
        }
        if (-6 < n && n <= 0) {
            StringBuilder out = new StringBuilder("0.");
            for (int i = 0; i < -n; i++) {
                out.append('0');
            }
            return out.append(digits).toString();
        }
        String exponent = (n - 1 >= 0 ? "+" : "-") + Math.abs(n - 1);
        if (k == 1) {
            return digits + "e" + exponent;
        }
        return digits.charAt(0) + "." + digits.substring(1) + "e" + exponent;
    }

    // ----- more Math -------------------------------------------------------
    //
    // `StrictMath` rather than `Math` for the transcendentals, on purpose.
    // `Math.sin` is allowed 1 ulp of slack and may use an intrinsic; `StrictMath`
    // is fdlibm, and V8's is an fdlibm port too -- so the strict one is the more
    // likely to produce the same bits as the oracle. `sqrt`, `floor`, `ceil` and
    // `abs` are exact in both and stay on `Math`, where they are single
    // instructions.

    public static double mathSin(double x) {
        return StrictMath.sin(x);
    }

    public static double mathCos(double x) {
        return StrictMath.cos(x);
    }

    public static double mathTan(double x) {
        return StrictMath.tan(x);
    }

    public static double mathAsin(double x) {
        return StrictMath.asin(x);
    }

    public static double mathAcos(double x) {
        return StrictMath.acos(x);
    }

    public static double mathAtan(double x) {
        return StrictMath.atan(x);
    }

    public static double mathAtan2(double y, double x) {
        return StrictMath.atan2(y, x);
    }

    public static double mathExp(double x) {
        return StrictMath.exp(x);
    }

    public static double mathLog(double x) {
        return StrictMath.log(x);
    }

    public static double mathLog2(double x) {
        return StrictMath.log(x) / StrictMath.log(2.0);
    }

    public static double mathLog10(double x) {
        return StrictMath.log10(x);
    }

    public static double mathCosh(double x) {
        return StrictMath.cosh(x);
    }

    public static double mathTanh(double x) {
        return StrictMath.tanh(x);
    }

    public static double mathCbrt(double x) {
        return StrictMath.cbrt(x);
    }

    public static double mathHypot(double x, double y) {
        return StrictMath.hypot(x, y);
    }

    /**
     * `Math.sign`, which is `Math.signum` exactly.
     *
     * <p>Both return the argument itself for a zero and for NaN, so `-0` stays
     * `-0` and NaN stays NaN -- the two cases a naive `x < 0 ? -1 : 1` gets
     * wrong, and the reason this is not written out.
     */
    public static double mathSign(double x) {
        return Math.signum(x);
    }

    /** `Math.fround`: through a `float` and back. */
    public static double mathFround(double x) {
        return (float) x;
    }

    // ----- number predicates ----------------------------------------------

    public static boolean isInteger(double x) {
        return !Double.isNaN(x) && !Double.isInfinite(x) && x == Math.floor(x);
    }

    public static boolean isSafeInteger(double x) {
        return isInteger(x) && Math.abs(x) <= 9007199254740991.0;
    }

    public static String boolToString(boolean value) {
        return value ? "true" : "false";
    }

    public static String tagName(int tag) {
        return NtsValue.tagName(tag);
    }

    // ----- more strings ----------------------------------------------------

    /**
     * `at`: a negative index counts from the end, and out of range is
     * `undefined` -- which is a null reference here, because the caller's type
     * is `string | undefined` and `T | null` costs nothing on this backend.
     */
    public static String strAt(String s, double index) {
        double at = toInteger(index);
        if (at < 0.0) {
            at += s.length();
        }
        if (at < 0.0 || at >= s.length()) {
            return null;
        }
        return String.valueOf(s.charAt((int) at));
    }

    /** `charAt`, which answers the empty string out of range rather than undefined. */
    public static String strCharAt(String s, double index) {
        double at = toInteger(index);
        if (at < 0.0 || at >= s.length()) {
            return "";
        }
        return String.valueOf(s.charAt((int) at));
    }

    /** `codePointAt`, which is NaN out of range. */
    public static double strCodePointAt(String s, double index) {
        double at = toInteger(index);
        if (at < 0.0 || at >= s.length()) {
            return Double.NaN;
        }
        return s.codePointAt((int) at);
    }

    public static double strIndexOfFrom(String s, String needle, double from) {
        return s.indexOf(needle, clamp(from, s.length(), false));
    }

    public static String strTrimStart(String s) {
        int start = 0;
        while (start < s.length() && isJsWhitespace(s.charAt(start))) {
            start++;
        }
        return s.substring(start);
    }

    public static String strTrimEnd(String s) {
        int end = s.length();
        while (end > 0 && isJsWhitespace(s.charAt(end - 1))) {
            end--;
        }
        return s.substring(0, end);
    }

    public static String strPadEnd(String s, double target, String pad) {
        int want = (int) toInteger(target);
        if (want <= s.length() || pad.isEmpty()) {
            return s;
        }
        StringBuilder out = new StringBuilder(want).append(s);
        while (out.length() < want) {
            out.append(pad);
        }
        out.setLength(want);
        return out.toString();
    }

    /**
     * `toLowerCase` and `toUpperCase`, with `Locale.ROOT`.
     *
     * <p>These were refused on the belief that Java's differ from JavaScript's
     * on final sigma -- a belief held from memory and **wrong**. Checked against
     * node on nineteen hostile cases including `ΣΣ`, `ἈΙ`, `İ`, `ß`, `ẞ`, `Ǳ`,
     * the `ﬀ` ligature and an astral pair: identical on every one, in both
     * directions. Both implement the Unicode conditional mappings, and
     * `Locale.ROOT` is what removes the Turkish dotted-I rule that would
     * otherwise be the real divergence.
     *
     * <p>`java.util.Locale.ROOT` is not optional. The no-argument overload uses
     * the *default* locale, so the same program would answer differently on a
     * machine set to Turkish -- a wrong answer that depends on the host, which
     * is the worst kind to ship.
     */
    public static String strToLowerCase(String s) {
        return s.toLowerCase(java.util.Locale.ROOT);
    }

    public static String strToUpperCase(String s) {
        return s.toUpperCase(java.util.Locale.ROOT);
    }

    /** `toWellFormed`: every unpaired surrogate becomes U+FFFD. */
    public static String strToWellFormed(String s) {
        StringBuilder out = null;
        for (int at = 0; at < s.length(); at++) {
            char c = s.charAt(at);
            boolean lone = false;
            if (Character.isHighSurrogate(c)) {
                lone = at + 1 >= s.length() || !Character.isLowSurrogate(s.charAt(at + 1));
            } else if (Character.isLowSurrogate(c)) {
                lone = true;
            }
            if (lone && out == null) {
                out = new StringBuilder(s.length()).append(s, 0, at);
            }
            if (out != null) {
                out.append(lone ? '\uFFFD' : c);
            }
        }
        return out == null ? s : out.toString();
    }

    /**
     * Truthiness of a reference that is not a string and not erased: it is
     * truthy exactly when it is there.
     *
     * <p>An empty array is truthy, and so is an object with no fields.
     * Emptiness is a *string* rule and only a string rule, which is why
     * `stringTruthy` exists separately rather than this covering both.
     */
    public static boolean isPresent(Object value) {
        return value != null;
    }

    public static double mathExpm1(double x) {
        return StrictMath.expm1(x);
    }

    public static double mathLog1p(double x) {
        return StrictMath.log1p(x);
    }

    /** `isWellFormed`: no unpaired surrogate anywhere. */
    public static boolean strIsWellFormed(String s) {
        for (int at = 0; at < s.length(); at++) {
            char c = s.charAt(at);
            if (Character.isHighSurrogate(c)) {
                if (at + 1 >= s.length() || !Character.isLowSurrogate(s.charAt(at + 1))) {
                    return false;
                }
                at++;
            } else if (Character.isLowSurrogate(c)) {
                return false;
            }
        }
        return true;
    }

    // ----- arrays, one entry point per element width ------------------------
    //
    // Overloaded rather than generic, for the reason `nts_runtime.h` gives
    // about its own `fill` family: the compiler knows the element type, and a
    // runtime that had to be told it would be told it wrongly one day. Java
    // picks the overload by descriptor, so the *backend* decides which by
    // reading the array's HIR type -- the same both-ends rule as everywhere
    // else here.
    //
    // A bare `double[]` is not an `Object[]`, so there is no generic version
    // to fall back to even if one were wanted.

    private static int[] range(int length, double from, double to) {
        int start = (int) clamp(from, length, true);
        int end = (int) clamp(to, length, true);
        return new int[] {start, Math.max(start, end)};
    }

    public static double[] arraySlice(double[] a, double from, double to) {
        int[] at = range(a.length, from, to);
        return java.util.Arrays.copyOfRange(a, at[0], at[1]);
    }

    public static boolean[] arraySlice(boolean[] a, double from, double to) {
        int[] at = range(a.length, from, to);
        return java.util.Arrays.copyOfRange(a, at[0], at[1]);
    }

    public static Object[] arraySlice(Object[] a, double from, double to) {
        int[] at = range(a.length, from, to);
        return java.util.Arrays.copyOfRange(a, at[0], at[1]);
    }

    /** `reverse` reverses **in place** and answers the same array. */
    public static double[] arrayReverse(double[] a) {
        for (int i = 0, j = a.length - 1; i < j; i++, j--) {
            double swap = a[i];
            a[i] = a[j];
            a[j] = swap;
        }
        return a;
    }

    public static boolean[] arrayReverse(boolean[] a) {
        for (int i = 0, j = a.length - 1; i < j; i++, j--) {
            boolean swap = a[i];
            a[i] = a[j];
            a[j] = swap;
        }
        return a;
    }

    public static Object[] arrayReverse(Object[] a) {
        for (int i = 0, j = a.length - 1; i < j; i++, j--) {
            Object swap = a[i];
            a[i] = a[j];
            a[j] = swap;
        }
        return a;
    }

    /**
     * `join`.
     *
     * <p>`null` and `undefined` become the empty string rather than "null" --
     * the one rule of `join` that is not "stringify each element", and the one
     * a `StringJoiner` would get wrong.
     */
    public static String arrayJoinStr(double[] a, String separator) {
        StringBuilder out = new StringBuilder();
        for (int at = 0; at < a.length; at++) {
            if (at > 0) {
                out.append(separator);
            }
            out.append(numberToString(a[at]));
        }
        return out.toString();
    }

    public static String arrayJoinStr(boolean[] a, String separator) {
        StringBuilder out = new StringBuilder();
        for (int at = 0; at < a.length; at++) {
            if (at > 0) {
                out.append(separator);
            }
            out.append(a[at] ? "true" : "false");
        }
        return out.toString();
    }

    public static String arrayJoinStr(Object[] a, String separator) {
        StringBuilder out = new StringBuilder();
        for (int at = 0; at < a.length; at++) {
            if (at > 0) {
                out.append(separator);
            }
            Object element = a[at];
            if (element != null) {
                out.append(element instanceof NtsValue
                    ? valueToString((NtsValue) element)
                    : element.toString());
            }
        }
        return out.toString();
    }

    /** `String(x)` on an erased value, which `join` needs and `+` will. */
    public static String valueToString(NtsValue value) {
        switch (value.tag) {
            case NtsValue.UNDEFINED: return "undefined";
            case NtsValue.NULL: return "null";
            case NtsValue.BOOLEAN: return value.num != 0.0 ? "true" : "false";
            case NtsValue.NUMBER: return numberToString(value.num);
            case NtsValue.STRING: return (String) value.ref;
            default: return String.valueOf(value.ref);
        }
    }

    /**
     * An index the program's `!` promised was in range, checked.
     *
     * <p>`xs[i]!` asserts the index is there; where it is not, JavaScript
     * answers `undefined` and a compiled program without exceptions stops. So
     * this refuses, with the same `nts:` prefix and the same wording the C
     * runtime's `nts_bounds` uses -- the differential reads that prefix to tell
     * a program the compiler correctly declined from one that went wrong, and a
     * Java `ArrayIndexOutOfBoundsException` would be counted as a defect on
     * every case the C lane also declines.
     *
     * <p>The **integrality** test is the half a bounds check alone misses.
     * `xs[0.5]` is `undefined` in JavaScript and `xs[0]` after a `d2i`, which
     * is a wrong answer rather than a crash: `examples/arrays` returned 10
     * where node returns NaN, on a fractional index the pool supplies and no
     * hand-written case would.
     */
    public static int bounds(int length, double index) {
        // `index == (double)(int) index` rather than `Math.floor(index)`, which
        // is what `nts_index` does and for the same reason: the round trip is
        // two register moves where the library call is a call. NaN fails it, as
        // it fails the two comparisons, so no separate test is needed.
        //
        // Split so the throwing half is its own method. A method that throws is
        // still inlinable, but keeping the raise out of line leaves this one
        // three comparisons long, which is what lets C2 fold it into the bounds
        // check the array access already has. With the raise inline and a
        // `Math.floor` beside it, `awfy-nbody` was 40.15ms against 8.66ms.
        if (index >= 0.0 && index < length && index == (double) (int) index) {
            return (int) index;
        }
        return outside(index, length);
    }

    private static int outside(double index, int length) {
        throw new NtsRefusal("index " + numberText(index) + " is outside [0, " + length + ")");
    }

    /**
     * The same check where the index is already an `int`.
     *
     * <p>Specialization makes a loop counter an `i32`, so the common indexed
     * read arrives with nothing to convert -- and routing it through the
     * `double` form cost a widening, two floating compares, a `Math.floor` and
     * a narrowing, per element, in a loop that previously emitted **nothing**.
     * `awfy-nbody` went from 8.66ms to 40.15ms and `awfy-towers` from 17.8us
     * to 31.4us before this existed.
     *
     * <p>An integer cannot be fractional, so only the range is in question --
     * and two `int` compares are what the JVM's own bounds check already does,
     * which is why C2 can fold this one into it in a counted loop.
     */
    public static int bounds(int length, int index) {
        if (index >= 0 && index < length) {
            return index;
        }
        return outside(index, length);
    }

    /**
     * The same, for an index the middle end keeps in an `i64`.
     *
     * <p>A `long` is exactly as unable to be fractional as an `int`, and this
     * overload exists because the emitter tested for `int` alone: an `i64`
     * index fell through to the `double` form and paid an `l2d`, two floating
     * compares and a whole-number test that is *provably true of a long*, per
     * element. `awfy-nbody` indexes with an `i64` and was still at 39.28ms
     * against hand-written Java's 7.97ms with the `int` overload already in
     * place -- the fix for that row had been written and did not cover it.
     *
     * <p>The narrowing is safe rather than merely convenient: `arraylength` is
     * an `int`, so an index that passes `index < length` is below 2^31 by
     * construction, and one that does not passes through {@link #outside}.
     */
    public static int bounds(int length, long index) {
        if (index >= 0L && index < length) {
            return (int) index;
        }
        return outside((double) index, length);
    }

    // ----- the bare-array searches ----------------------------------------
    //
    // A program that never grows an array keeps `double[]` and friends, so
    // these are the same operations `NtsArrayD` and `NtsArrayL` provide, over
    // storage with no length beside it. Overloaded rather than generic for the
    // reason the rest of this family is: the compiler knows the element type.
    //
    // `indexOf` on references is **identity** and on strings is **value**, and
    // they are different methods for that reason. Two equal strings need not be
    // one object -- and will be one often enough for a suite to pass.

    public static double arrayIndexOf(double[] a, double value) {
        for (int i = 0; i < a.length; i++) {
            if (a[i] == value) {
                return i;
            }
        }
        return -1.0;
    }

    public static double arrayLastIndexOf(double[] a, double value) {
        for (int i = a.length - 1; i >= 0; i--) {
            if (a[i] == value) {
                return i;
            }
        }
        return -1.0;
    }

    public static boolean arrayIncludes(double[] a, double value) {
        return arrayIndexOf(a, value) >= 0.0;
    }

    public static double arrayIndexOf(Object[] a, Object value) {
        for (int i = 0; i < a.length; i++) {
            if (a[i] == value) {
                return i;
            }
        }
        return -1.0;
    }

    public static double arrayLastIndexOf(Object[] a, Object value) {
        for (int i = a.length - 1; i >= 0; i--) {
            if (a[i] == value) {
                return i;
            }
        }
        return -1.0;
    }

    public static boolean arrayIncludes(Object[] a, Object value) {
        return arrayIndexOf(a, value) >= 0.0;
    }

    public static double arrayIndexOfStr(Object[] a, Object value) {
        for (int i = 0; i < a.length; i++) {
            if (java.util.Objects.equals(a[i], value)) {
                return i;
            }
        }
        return -1.0;
    }

    public static double arrayLastIndexOfStr(Object[] a, Object value) {
        for (int i = a.length - 1; i >= 0; i--) {
            if (java.util.Objects.equals(a[i], value)) {
                return i;
            }
        }
        return -1.0;
    }

    public static boolean arrayIncludesStr(Object[] a, Object value) {
        return arrayIndexOfStr(a, value) >= 0.0;
    }

    /** `at` with the `undefined` the checker already gave it. */
    public static NtsValue arrayAtValue(double[] a, double index) {
        double i = toInteger(index);
        if (i < 0) {
            i += a.length;
        }
        // `ABSENT_NUMBER`, not the shared undefined: `xs.at(9)!` unerases this
        // straight to a double, and `Number(undefined)` is NaN. A zero payload
        // answers 0, which is a plausible number in the middle of an
        // expression. `nts_absent_number()` in the C runtime, for the same
        // reason and with the same NaN.
        return i < 0 || i >= a.length ? NtsValue.ABSENT_NUMBER : NtsValue.ofNumber(a[(int) i]);
    }

    public static NtsValue arrayAtValue(Object[] a, double index) {
        double i = toInteger(index);
        if (i < 0) {
            i += a.length;
        }
        if (i < 0 || i >= a.length) {
            return NtsValue.UNDEFINED_VALUE;
        }
        Object element = a[(int) i];
        return element instanceof NtsValue ? (NtsValue) element : NtsValue.ofObject(element);
    }

    public static Object arrayAtRef(Object[] a, double index) {
        double i = toInteger(index);
        if (i < 0) {
            i += a.length;
        }
        return i < 0 || i >= a.length ? null : a[(int) i];
    }

    public static double arrayAt(double[] a, double index) {
        double i = toInteger(index);
        if (i < 0) {
            i += a.length;
        }
        return i < 0 || i >= a.length ? Double.NaN : a[(int) i];
    }
}
