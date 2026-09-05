package nts.rt;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.Arrays;
import java.util.Locale;

/** JavaScript operations not directly provided by JVM instructions. Java 8 ABI. */
public final class NtsRuntime {
    private NtsRuntime() {}

    /** ToInt32 via significand bits: truncation modulo 2^32, not a saturating cast. */
    public static int toInt32(double x) {
        long bits = Double.doubleToRawLongBits(x);
        int exponent = (int) ((bits >>> 52) & 0x7ff) - 1023;
        // Fractions smaller than one, and integral multiples of 2^32 (also NaN/Inf).
        if (exponent < 0 || exponent >= 84) { return 0; }
        long significand = (bits & 0x000fffffffffffffL) | 0x0010000000000000L;
        int low = exponent >= 52 ? (int) (significand << (exponent - 52))
            : (int) (significand >>> (52 - exponent));
        return bits < 0 ? -low : low;
    }
    public static int toUint32(double x) { return toInt32(x); }
    public static int toInt8(double x) { return (byte) toInt32(x); }
    public static int toUint8(double x) { return toInt32(x) & 0xff; }
    public static int toInt16(double x) { return (short) toInt32(x); }
    public static int toUint16(double x) { return toInt32(x) & 0xffff; }
    public static double round(double x) {
        if (Double.isNaN(x) || Double.isInfinite(x) || x == 0.0) { return x; }
        if (x > 0.0 && x < 0.5) { return 0.0; }
        if (x < 0.0 && x >= -0.5) { return -0.0; }
        double below = Math.floor(x);
        return x - below >= 0.5 ? below + 1.0 : below;
    }
    public static double trunc(double x) { return x < 0 ? Math.ceil(x) : Math.floor(x); }
    public static int idiv(int left, int right) {
        if (right == 0) { throw new NtsRefusal("an integer division by zero"); }
        return left / right;
    }
    public static int irem(int left, int right) {
        if (right == 0) { throw new NtsRefusal("an integer remainder by zero"); }
        return left % right;
    }
    public static long ldiv(long left, long right) {
        if (right == 0L) { throw new NtsRefusal("an integer division by zero"); }
        return left / right;
    }
    public static long lrem(long left, long right) {
        if (right == 0L) { throw new NtsRefusal("an integer remainder by zero"); }
        return left % right;
    }
    public static double charCodeAt(String text, double index) {
        int at = (int) index;
        return at < 0 || at >= text.length() ? Double.NaN : text.charAt(at);
    }
    public static boolean stringEq(String left, String right) { return java.util.Objects.equals(left, right); }
    public static boolean stringTruthy(String text) { return text != null && !text.isEmpty(); }
    public static Error unreachable() { return new NtsRefusal("control reached a block the compiler proved unreachable"); }
    public static void uncaught(NtsValue value, String detail) {
        StringBuilder line = new StringBuilder("nts: uncaught ");
        switch (value.tag) {
            case NtsValue.STRING: line.append((String) value.ref); break;
            case NtsValue.NUMBER: line.append(numberText(value.num)); break;
            case NtsValue.BOOLEAN: line.append(value.num != 0 ? "true" : "false"); break;
            case NtsValue.UNDEFINED: line.append("undefined"); break;
            case NtsValue.NULL: line.append("null"); break;
            default:
                line.append(value.ref == null ? "[object]" : value.ref.getClass().getSimpleName());
                if (detail != null) { line.append(": ").append(detail); }
        }
        System.out.flush(); System.err.println(line); System.err.flush(); System.exit(1);
    }
    public static double setTimeout(Object callback, double slot, double delayMs, boolean repeating) {
        if (!(callback instanceof NtsCallback)) {
            System.out.flush(); System.err.println("nts: a timer callback that is not callable");
            System.err.flush(); System.exit(1); return 0.0;
        }
        return NtsLoop.postDelayed((NtsCallback) callback, delayMs, repeating);
    }
    public static void clearTimeout(double id) { NtsLoop.cancelDelayed(id); }
    public static void cellReady(boolean ready, String name) {
        if (ready) { return; }
        System.out.flush(); System.err.println("nts: `" + name + "` was read before its declaration ran");
        System.err.flush(); System.exit(1);
    }
    private static String numberText(double value) {
        if (value == (long) value && Math.abs(value) < 1e15) { return Long.toString((long) value); }
        return String.format("%g", value);
    }
    public static double[] arrayFill(double[] array, double value) { Arrays.fill(array, value); return array; }
    public static boolean[] arrayFillBool(boolean[] array, boolean value) { Arrays.fill(array, value); return array; }
    public static Object[] arrayFillRef(Object[] array, Object value) { Arrays.fill(array, value); return array; }

    public static double mathPow(double base, double exponent) { return Math.pow(base, exponent); }
    public static double mathSinh(double x) { return Math.sinh(x); }
    public static boolean isFinite(double x) { return !Double.isNaN(x) && !Double.isInfinite(x); }
    public static double mathSin(double x) { return StrictMath.sin(x); }
    public static double mathCos(double x) { return StrictMath.cos(x); }
    public static double mathTan(double x) { return StrictMath.tan(x); }
    public static double mathAsin(double x) { return StrictMath.asin(x); }
    public static double mathAcos(double x) { return StrictMath.acos(x); }
    public static double mathAtan(double x) { return StrictMath.atan(x); }
    public static double mathAtan2(double y, double x) { return StrictMath.atan2(y, x); }
    public static double mathExp(double x) { return StrictMath.exp(x); }
    public static double mathLog(double x) { return StrictMath.log(x); }
    private static final double LN_2 = StrictMath.log(2.0);
    public static double mathLog2(double x) { return StrictMath.log(x) / LN_2; }
    public static double mathLog10(double x) { return StrictMath.log10(x); }
    public static double mathCosh(double x) { return StrictMath.cosh(x); }
    public static double mathTanh(double x) { return StrictMath.tanh(x); }
    public static double mathCbrt(double x) { return StrictMath.cbrt(x); }
    public static double mathHypot(double x, double y) { return StrictMath.hypot(x, y); }
    public static double mathSign(double x) { return Math.signum(x); }
    public static double mathFround(double x) { return (float) x; }
    public static double mathExpm1(double x) { return StrictMath.expm1(x); }
    public static double mathLog1p(double x) { return StrictMath.log1p(x); }
    public static boolean isInteger(double x) { return isFinite(x) && x == Math.floor(x); }
    public static boolean isSafeInteger(double x) { return isInteger(x) && Math.abs(x) <= 9007199254740991.0; }
    public static String boolToString(boolean value) { return value ? "true" : "false"; }
    public static String tagName(int tag) { return NtsValue.tagName(tag); }
    public static boolean isPresent(Object value) { return value != null; }

    private static double toInteger(double x) { return NtsArrays.toInteger(x); }
    private static int clamp(double index, int length, boolean relative) {
        return relative ? NtsArrays.clamp(index, length) : Math.max(0, Math.min((int) index, length));
    }
    public static double strIndexOf(String s, String needle) { return s.indexOf(needle); }
    public static double strLastIndexOf(String s, String needle) { return s.lastIndexOf(needle); }
    public static boolean strIncludes(String s, String needle) { return s.contains(needle); }
    public static boolean strStartsWith(String s, String prefix) { return s.startsWith(prefix); }
    public static boolean strEndsWith(String s, String suffix) { return s.endsWith(suffix); }
    public static double strPointWidth(String s, double at) {
        int index = (int) at;
        return index < 0 || index >= s.length() ? 1.0 : Character.charCount(s.codePointAt(index));
    }
    public static String stringFromCharCode(double code) { return String.valueOf((char) toUint16(code)); }
    public static String stringFromCodePoint(double code) { return new String(Character.toChars((int) toInteger(code))); }
    public static String strRepeat(String s, double times) {
        int count = (int) toInteger(times);
        if (count <= 0 || s.isEmpty()) { return ""; }
        if (count == 1) { return s; }
        int length = NtsArrays.checkedLength((long) s.length() * count);
        StringBuilder out = new StringBuilder(length);
        for (int i = 0; i < count; ++i) { out.append(s); }
        return out.toString();
    }
    private static void appendPad(StringBuilder out, String pad, int amount) {
        int step = pad.length();
        while (amount >= step) { out.append(pad); amount -= step; }
        if (amount != 0) { out.append(pad, 0, amount); }
    }
    public static String strPadStart(String s, double target, String pad) {
        int want = (int) toInteger(target);
        if (want <= s.length() || pad.isEmpty()) { return s; }
        StringBuilder out = new StringBuilder(want);
        appendPad(out, pad, want - s.length());
        return out.append(s).toString();
    }
    public static String strPadEnd(String s, double target, String pad) {
        int want = (int) toInteger(target);
        if (want <= s.length() || pad.isEmpty()) { return s; }
        StringBuilder out = new StringBuilder(want).append(s);
        appendPad(out, pad, want - s.length());
        return out.toString();
    }
    /**
     * Two strings joined, which on this platform is what {@code +} already is.
     *
     * <p>A static here rather than a {@code String.concat} emitted at the call
     * site: the external table maps every {@code nts_} name to a static on this
     * class, and one entry spelled differently is the asymmetry that goes wrong
     * the next time somebody adds a name.
     *
     * <p>{@code --release 8} compiles {@code +} to a {@code StringBuilder}
     * rather than to {@code invokedynamic makeConcatWithConstants}, which is
     * what keeps the no-{@code invokedynamic} ratchet, and with it the Android
     * API 26 floor.
     */
    public static String concat(String a, String b) {
        return a + b;
    }

    public static String strSubstring(String s, double from, double to) {
        int start = clamp(from, s.length(), false), end = clamp(to, s.length(), false);
        return start <= end ? s.substring(start, end) : s.substring(end, start);
    }
    public static String strSlice(String s, double from, double to) {
        int start = clamp(from, s.length(), true), end = clamp(to, s.length(), true);
        return start >= end ? "" : s.substring(start, end);
    }
    private static boolean isJsWhitespace(char c) {
        switch (c) {
            case '\t': case '\n': case '\u000B': case '\f': case '\r': case ' ':
            case '\u00A0': case '\u1680': case '\u2028': case '\u2029':
            case '\u202F': case '\u205F': case '\u3000': case '\uFEFF': return true;
            default: return c >= '\u2000' && c <= '\u200A';
        }
    }
    public static String strTrim(String s) {
        int start = 0, end = s.length();
        while (start < end && isJsWhitespace(s.charAt(start))) { ++start; }
        while (end > start && isJsWhitespace(s.charAt(end - 1))) { --end; }
        return s.substring(start, end);
    }
    public static String strTrimStart(String s) {
        int start = 0;
        while (start < s.length() && isJsWhitespace(s.charAt(start))) { ++start; }
        return s.substring(start);
    }
    public static String strTrimEnd(String s) {
        int end = s.length();
        while (end > 0 && isJsWhitespace(s.charAt(end - 1))) { --end; }
        return s.substring(0, end);
    }
    /** Two scans exchange extra searching for an exact-sized result and no list backing array. */
    public static String[] strSplit(String s, String separator) {
        if (separator.isEmpty()) {
            String[] units = new String[s.length()];
            for (int i = 0; i < units.length; ++i) { units[i] = String.valueOf(s.charAt(i)); }
            return units;
        }
        int step = separator.length(), first = s.indexOf(separator);
        if (first < 0) { return new String[] {s}; }
        int count = 2;
        for (int at = s.indexOf(separator, first + step); at >= 0; at = s.indexOf(separator, at + step)) { ++count; }
        String[] parts = new String[count];
        int from = 0, i = 0;
        for (int at = first; at >= 0; at = s.indexOf(separator, from)) {
            parts[i++] = s.substring(from, at);
            from = at + step;
        }
        parts[i] = s.substring(from);
        return parts;
    }
    private static void substitution(StringBuilder out, String matched, String whole, int at, String replacement) {
        if (replacement.indexOf('$') < 0) { out.append(replacement); return; }
        for (int i = 0; i < replacement.length(); ++i) {
            char c = replacement.charAt(i);
            if (c != '$' || i + 1 == replacement.length()) { out.append(c); continue; }
            char next = replacement.charAt(i + 1);
            switch (next) {
                case '$': out.append('$'); break;
                case '&': out.append(matched); break;
                case '`': out.append(whole, 0, at); break;
                case '\'': out.append(whole, at + matched.length(), whole.length()); break;
                default: out.append('$'); continue;
            }
            ++i;
        }
    }
    public static String strReplace(String s, String pattern, String with) {
        int at = s.indexOf(pattern);
        if (at < 0) { return s; }
        StringBuilder out = new StringBuilder(s.length());
        out.append(s, 0, at); substitution(out, pattern, s, at, with);
        return out.append(s, at + pattern.length(), s.length()).toString();
    }
    public static String strReplaceAll(String s, String pattern, String with) {
        int first = s.indexOf(pattern);
        if (first < 0) { return s; }
        StringBuilder out = new StringBuilder(s.length());
        if (pattern.isEmpty()) {
            substitution(out, "", s, 0, with);
            for (int i = 0; i < s.length(); ++i) {
                out.append(s.charAt(i)); substitution(out, "", s, i + 1, with);
            }
            return out.toString();
        }
        int from = 0, at = first;
        do {
            out.append(s, from, at); substitution(out, pattern, s, at, with);
            from = at + pattern.length(); at = s.indexOf(pattern, from);
        } while (at >= 0);
        return out.append(s, from, s.length()).toString();
    }
    public static String strAt(String s, double index) {
        int at = NtsArrays.offset(index, s.length());
        return at < 0 ? null : String.valueOf(s.charAt(at));
    }
    public static String strCharAt(String s, double index) {
        int at = (int) index;
        return at < 0 || at >= s.length() ? "" : String.valueOf(s.charAt(at));
    }
    public static double strCodePointAt(String s, double index) {
        int at = (int) index;
        return at < 0 || at >= s.length() ? Double.NaN : s.codePointAt(at);
    }
    public static double strIndexOfFrom(String s, String needle, double from) {
        return s.indexOf(needle, clamp(from, s.length(), false));
    }
    public static String strToLowerCase(String s) { return s.toLowerCase(Locale.ROOT); }
    public static String strToUpperCase(String s) { return s.toUpperCase(Locale.ROOT); }
    public static boolean strIsWellFormed(String s) {
        for (int at = 0; at < s.length(); ++at) {
            char c = s.charAt(at);
            if (Character.isHighSurrogate(c)) {
                if (at + 1 >= s.length() || !Character.isLowSurrogate(s.charAt(at + 1))) { return false; }
                ++at;
            } else if (Character.isLowSurrogate(c)) { return false; }
        }
        return true;
    }
    public static String strToWellFormed(String s) {
        StringBuilder out = null;
        for (int at = 0; at < s.length(); ++at) {
            char c = s.charAt(at);
            if (Character.isHighSurrogate(c) && at + 1 < s.length() && Character.isLowSurrogate(s.charAt(at + 1))) {
                if (out != null) { out.append(c).append(s.charAt(at + 1)); }
                ++at;
                continue;
            }
            boolean lone = Character.isSurrogate(c);
            if (lone && out == null) { out = new StringBuilder(s.length()).append(s, 0, at); }
            if (out != null) { out.append(lone ? '\uFFFD' : c); }
        }
        return out == null ? s : out.toString();
    }

    // ---- Number::toString --------------------------------------------------
    //
    // The shortest decimal that reads back as this double, which is what
    // JavaScript specifies and what node prints.
    //
    // **Not `Double.toString`.** An audit of this runtime proposed exactly
    // that, gated on `java.specification.version >= 21` because only JDK 19+
    // produces the shortest form. It was 5.2x faster and correct on this JDK,
    // and it fails in the one place that matters: ART does not report 21, so
    // Android -- the platform this backend exists for -- would take a fallback
    // that is both slower and wrong, and no test here would ever run it. A
    // number formatter that depends on the JRE is a program whose output
    // depends on the JRE.
    //
    // The `MathContext` cache below is the half of that audit worth keeping:
    // one object per precision, made once, rather than a `new MathContext` on
    // every rounding.
    private static final class DecimalContexts {
        static final java.math.MathContext[] ALL = make();

        private static java.math.MathContext[] make() {
            java.math.MathContext[] all = new java.math.MathContext[18];
            for (int p = 1; p <= 17; p++) {
                all[p] = new java.math.MathContext(p, java.math.RoundingMode.HALF_EVEN);
            }
            return all;
        }
    }

    /**
     * Scratch for the digit generator and the placement pass.
     *
     * <p>Reused rather than allocated per call, on the same confinement
     * `NtsMap` states: this collection, like the event loop, runs on one
     * thread. Two arrays a conversion was 25,072 bytes/op on
     * `number-format-double`, which is 131 bytes to print one number.
     *
     * <p>Neither escapes: the digits are consumed by `layoutDigits`, and the
     * placement buffer is copied by the `String` constructor before either is
     * touched again.
     */
    private static final byte[] SHORTEST_DIGITS = new byte[24];
    /** Forty covers every placement; see {@link #layoutDigits}. */
    private static final byte[] LAYOUT = new byte[40];

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

        // Grisu2 first, which answers with integer arithmetic and one 128-bit
        // multiply, and declines rather than guessing when the interval does
        // not close. The exact path below is what it declines *to* -- the same
        // arrangement `runtime/c` has, so the two lanes agree by construction
        // rather than by both being careful.
        long packed = NtsGrisu.shortest(magnitude, SHORTEST_DIGITS);
        if (packed != NtsGrisu.UNPROVEN) {
            int length = (int) (packed & 0xFFFFFFFFL);
            int point = (int) (packed >> 32);
            // Grisu can leave a trailing zero where the shortest form does not
            // need it; `stripTrailingZeros` is what the exact path calls, and
            // the decimal point does not move when one goes.
            while (length > 1 && SHORTEST_DIGITS[length - 1] == '0') {
                length--;
            }
            return layoutDigits(SHORTEST_DIGITS, length, point, negative);
        }

        java.math.BigDecimal exact = new java.math.BigDecimal(magnitude);

        // Start from a guess rather than scanning 1..17. `Double.toString` is
        // not trusted for the *answer* -- see above -- but it is a good guess
        // at how many digits there are, and the read-back check decides. A
        // wrong guess costs a step in one direction; scanning from one cost
        // seventeen roundings on every call.
        int precision = Math.max(1, Math.min(17, significantDigits(Double.toString(magnitude))));
        java.math.BigDecimal shortest = readableAt(exact, precision, magnitude);
        if (shortest == null) {
            while (precision < 17) {
                precision++;
                shortest = readableAt(exact, precision, magnitude);
                if (shortest != null) {
                    break;
                }
            }
        } else {
            while (precision > 1) {
                java.math.BigDecimal shorter = readableAt(exact, precision - 1, magnitude);
                if (shorter == null) {
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
        return layout(digits, n, negative);
    }

    /**
     * The shortest `precision`-digit decimal that reads back as `magnitude`,
     * or `null` when none does at that width.
     *
     * <p>**Rounding the exact value is not the algorithm.** Two ways it fails,
     * both found by sweeping every power of two against node:
     *
     * <p>`2^-24` is exactly `...5390625`. Rounding to sixteen digits is a
     * perfect tie, `HALF_EVEN` breaks it to `...539062`, and that is a
     * different double. `...539063` is the same one and is what node prints.
     *
     * <p>`7.1202363472230444e-307` rounds to `...223044` at sixteen digits and
     * that is also a different double, while `...223045` is not -- and this is
     * not a tie at all. The rounding interval of a binary value is not centred
     * on its decimal rounding, so **"nearest" and "reads back" are different
     * questions** and only the second one is being asked here.
     *
     * <p>So all three candidates at each width are tried. Before this, 46 of
     * 2,098 powers of two printed with one digit too many, and the 100,000
     * random doubles in `number_to_string.rs` found none of them: a random bit
     * pattern essentially never has a short binary representation, and a
     * program produces almost nothing else.
     */
    private static java.math.BigDecimal readableAt(
        java.math.BigDecimal exact, int precision, double magnitude) {
        java.math.BigDecimal nearest = roundTo(exact, precision);
        if (nearest.doubleValue() == magnitude) {
            return nearest;
        }
        java.math.BigDecimal step =
            java.math.BigDecimal.ONE.scaleByPowerOfTen(-nearest.scale());
        java.math.BigDecimal up = nearest.add(step);
        if (up.doubleValue() == magnitude) {
            return up;
        }
        java.math.BigDecimal down = nearest.subtract(step);
        return down.doubleValue() == magnitude ? down : null;
    }

    private static java.math.BigDecimal roundTo(java.math.BigDecimal exact, int precision) {
        return exact.round(DecimalContexts.ALL[precision]);
    }

    /**
     * How many significant digits a `Double.toString` result carries.
     *
     * <p>Used only as a starting point, never as the answer: `1.0E21` is two
     * characters of digits and one significant one.
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
            if (c < '0' || c > '9' || (c == '0' && !seen)) {
                continue;
            }
            seen = true;
            digits++;
            trailingZeroes = c == '0' ? trailingZeroes + 1 : 0;
        }
        return Math.max(1, digits - trailingZeroes);
    }

    /**
     * {@link #layout}, writing the digits straight out of Grisu's buffer.
     *
     * <p>The same placement rules, and the reason for a second copy of them is
     * allocation rather than taste. Going through {@code layout} meant a
     * {@code String} built from the byte buffer only to be handed to a
     * {@code StringBuilder}, which copied it again and copied once more on
     * {@code toString} -- about seven allocations and 185 bytes a conversion,
     * measured, where two will do. The digits are ASCII by construction, so the
     * output length is known and one pass fills it.
     *
     * <p>Forty bytes covers every case: 21 integral digits and a sign, or two
     * for "0." plus six zeroes plus seventeen digits, or a mantissa with a
     * three-digit exponent.
     */
    private static String layoutDigits(byte[] digits, int k, int n, boolean negative) {
        byte[] out = LAYOUT;
        int at = 0;
        if (negative) { out[at++] = '-'; }
        if (k <= n && n <= 21) {
            System.arraycopy(digits, 0, out, at, k);
            at += k;
            for (int i = k; i < n; ++i) { out[at++] = '0'; }
        } else if (0 < n && n <= 21) {
            System.arraycopy(digits, 0, out, at, n);
            at += n;
            out[at++] = '.';
            System.arraycopy(digits, n, out, at, k - n);
            at += k - n;
        } else if (-6 < n && n <= 0) {
            out[at++] = '0';
            out[at++] = '.';
            for (int i = 0; i < -n; ++i) { out[at++] = '0'; }
            System.arraycopy(digits, 0, out, at, k);
            at += k;
        } else {
            out[at++] = digits[0];
            if (k != 1) {
                out[at++] = '.';
                System.arraycopy(digits, 1, out, at, k - 1);
                at += k - 1;
            }
            out[at++] = 'e';
            int exponent = n - 1;
            if (exponent >= 0) {
                out[at++] = '+';
            } else {
                out[at++] = '-';
                exponent = -exponent;
            }
            if (exponent >= 100) { out[at++] = (byte) ('0' + exponent / 100); }
            if (exponent >= 10) { out[at++] = (byte) ('0' + (exponent / 10) % 10); }
            out[at++] = (byte) ('0' + exponent % 10);
        }
        return new String(out, 0, at, java.nio.charset.StandardCharsets.ISO_8859_1);
    }

    private static String layout(CharSequence digits, int n, boolean negative) {
        int k = digits.length();
        StringBuilder out = new StringBuilder(25);
        if (negative) { out.append('-'); }
        if (k <= n && n <= 21) {
            out.append(digits);
            for (int i = k; i < n; ++i) { out.append('0'); }
        } else if (0 < n && n <= 21) {
            out.append(digits, 0, n).append('.').append(digits, n, k);
        } else if (-6 < n && n <= 0) {
            out.append("0.");
            for (int i = 0; i < -n; ++i) { out.append('0'); }
            out.append(digits);
        } else {
            out.append(digits.charAt(0));
            if (k != 1) { out.append('.').append(digits, 1, k); }
            out.append('e');
            if (n - 1 >= 0) { out.append('+'); }
            out.append(n - 1);
        }
        return out.toString();
    }
    static void appendNumber(StringBuilder out, double value) {
        if (value == (long) value && Math.abs(value) < 0x1p53) { out.append((long) value); }
        else { out.append(numberToString(value)); }
    }
    static void appendJoinElement(StringBuilder out, Object element) {
        if (element == null) { return; }
        if (element instanceof NtsValue) {
            NtsValue value = (NtsValue) element;
            if (value.tag == NtsValue.NULL || value.tag == NtsValue.UNDEFINED) { return; }
            if (value.tag == NtsValue.NUMBER) { appendNumber(out, value.num); }
            else { out.append(valueToString(value)); }
        } else { out.append(element.toString()); }
    }
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

    // ---- Bare arrays: results are fresh objects even for empty slices. ------
    public static double[] arraySlice(double[] a, double from, double to) {
        int start = NtsArrays.clamp(from, a.length), end = Math.max(start, NtsArrays.clamp(to, a.length));
        return Arrays.copyOfRange(a, start, end);
    }
    public static boolean[] arraySlice(boolean[] a, double from, double to) {
        int start = NtsArrays.clamp(from, a.length), end = Math.max(start, NtsArrays.clamp(to, a.length));
        return Arrays.copyOfRange(a, start, end);
    }
    public static Object[] arraySlice(Object[] a, double from, double to) {
        int start = NtsArrays.clamp(from, a.length), end = Math.max(start, NtsArrays.clamp(to, a.length));
        return Arrays.copyOfRange(a, start, end);
    }
    public static double[] arrayReverse(double[] a) {
        for (int i = 0, j = a.length - 1; i < j; ++i, --j) { double t = a[i]; a[i] = a[j]; a[j] = t; }
        return a;
    }
    public static boolean[] arrayReverse(boolean[] a) {
        for (int i = 0, j = a.length - 1; i < j; ++i, --j) { boolean t = a[i]; a[i] = a[j]; a[j] = t; }
        return a;
    }
    public static Object[] arrayReverse(Object[] a) {
        for (int i = 0, j = a.length - 1; i < j; ++i, --j) { Object t = a[i]; a[i] = a[j]; a[j] = t; }
        return a;
    }
    public static String arrayJoinStr(double[] a, String separator) {
        StringBuilder out = new StringBuilder(NtsArrays.joinCapacity(a.length, separator, 3));
        for (int i = 0; i < a.length; ++i) { if (i != 0) { out.append(separator); } appendNumber(out, a[i]); }
        return out.toString();
    }
    public static String arrayJoinStr(boolean[] a, String separator) {
        StringBuilder out = new StringBuilder(NtsArrays.joinCapacity(a.length, separator, 5));
        for (int i = 0; i < a.length; ++i) { if (i != 0) { out.append(separator); } out.append(a[i] ? "true" : "false"); }
        return out.toString();
    }
    public static String arrayJoinStr(Object[] a, String separator) {
        StringBuilder out = new StringBuilder(NtsArrays.joinCapacity(a.length, separator, 3));
        for (int i = 0; i < a.length; ++i) { if (i != 0) { out.append(separator); } appendJoinElement(out, a[i]); }
        return out.toString();
    }
    public static int bounds(int length, double index) {
        if (index >= 0.0 && index < length && index == (double) (int) index) { return (int) index; }
        return outside(index, length);
    }
    public static int bounds(int length, int index) {
        return index >= 0 && index < length ? index : outside(index, length);
    }
    public static int bounds(int length, long index) {
        return index >= 0L && index < length ? (int) index : outside((double) index, length);
    }
    /**
     * The refusal an out-of-range subscript raises, callable from the array
     * classes so their reads need one call rather than two.
     *
     * <p>`NtsArrayD.get` was `a.items[bounds(a.length, (int) at)]`, and a
     * profile of `array-predicates` put 25.6% in `get` and a further 9.6% in
     * `bounds` -- a third of the row on element reads, where the reference
     * indexes an array. The check is not the problem and cannot go: reading
     * past `length` but inside the capacity returns a stale slot from an
     * earlier grow. The second call level is the problem.
     */
    public static double outOfRange(double index, int length) {
        return outside(index, length);
    }

    private static int outside(double index, int length) {
        throw new NtsRefusal("index " + numberText(index) + " is outside [0, " + length + ")");
    }
    public static double arrayIndexOf(double[] a, double value) {
        for (int i = 0; i < a.length; ++i) { if (a[i] == value) { return i; } } return -1.0;
    }
    public static double arrayLastIndexOf(double[] a, double value) {
        for (int i = a.length - 1; i >= 0; --i) { if (a[i] == value) { return i; } } return -1.0;
    }
    public static boolean arrayIncludes(double[] a, double value) {
        if (value == value) { return arrayIndexOf(a, value) >= 0; }
        for (double x : a) { if (x != x) { return true; } } return false;
    }
    public static double arrayIndexOf(Object[] a, Object value) {
        for (int i = 0; i < a.length; ++i) { if (a[i] == value) { return i; } } return -1.0;
    }
    public static double arrayLastIndexOf(Object[] a, Object value) {
        for (int i = a.length - 1; i >= 0; --i) { if (a[i] == value) { return i; } } return -1.0;
    }
    public static boolean arrayIncludes(Object[] a, Object value) { return arrayIndexOf(a, value) >= 0; }
    public static double arrayIndexOfStr(Object[] a, Object value) {
        for (int i = 0; i < a.length; ++i) { if (java.util.Objects.equals(a[i], value)) { return i; } } return -1.0;
    }
    public static double arrayLastIndexOfStr(Object[] a, Object value) {
        for (int i = a.length - 1; i >= 0; --i) { if (java.util.Objects.equals(a[i], value)) { return i; } } return -1.0;
    }
    public static boolean arrayIncludesStr(Object[] a, Object value) { return arrayIndexOfStr(a, value) >= 0; }
    public static NtsValue arrayAtValue(double[] a, double index) {
        int at = NtsArrays.offset(index, a.length);
        return at < 0 ? NtsValue.ABSENT_NUMBER : NtsValue.ofNumber(a[at]);
    }
    public static NtsValue arrayAtValue(Object[] a, double index) {
        int at = NtsArrays.offset(index, a.length);
        if (at < 0) { return NtsValue.UNDEFINED_VALUE; }
        Object element = a[at];
        return element instanceof NtsValue ? (NtsValue) element : NtsValue.ofObject(element);
    }
    public static Object arrayAtRef(Object[] a, double index) {
        int at = NtsArrays.offset(index, a.length); return at < 0 ? null : a[at];
    }
    public static double arrayAt(double[] a, double index) {
        int at = NtsArrays.offset(index, a.length); return at < 0 ? Double.NaN : a[at];
    }
}
