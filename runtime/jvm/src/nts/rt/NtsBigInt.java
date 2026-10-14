package nts.rt;

import java.math.BigInteger;

/**
 * Signed 128-bit arithmetic, preserving the existing compiler ABI.
 * This is the runtime's fixed-width bigint, NOT an arbitrary-precision JS BigInt.
 * Arithmetic, width conversions, decimal formatting and numeric conversions do
 * not allocate BigInteger temporaries. Public BigInteger adapters remain available.
 *
 * <p>**An arithmetic result past 128 bits stops by name** ({@link #overflow}),
 * as C's and LLVM's checked operations call {@code nts_bigint_overflow}: node's
 * bigint grows there, and a wrapped answer would be a wrong one. Only
 * {@code asIntN} and {@code asUintN} wrap, because wrapping is what they ask
 * for, and {@code asUintN} still stops where its unsigned result needs bit 127.
 */
public final class NtsBigInt {
    public final long hi;
    public final long lo;
    private NtsBigInt(long hi, long lo) { this.hi = hi; this.lo = lo; }
    public static final NtsBigInt ZERO = new NtsBigInt(0L, 0L);
    private static final NtsBigInt ONE = new NtsBigInt(0L, 1L);
    private static final NtsBigInt MINUS_ONE = new NtsBigInt(-1L, -1L);
    private static final NtsBigInt MINUS_128 = new NtsBigInt(-1L, -128L);
    private static final NtsBigInt ONE_TWENTY_EIGHT = new NtsBigInt(0L, 128L);

    /** The one text a result past 128 bits stops with: C's {@code nts_bigint_overflow}. */
    static final String PAST_128_BITS = "a bigint past 128 bits, which this runtime does not hold";

    /** C's {@code nts_bigint_overflow}, for a call the emitter writes. */
    public static void overflow() { throw pastBits(); }

    /** The refusal itself, so a method here can {@code throw} it and stay definite. */
    private static NtsRefusal pastBits() { return NtsRefusal.missing(PAST_128_BITS); }

    public static NtsBigInt of(long hi, long lo) {
        return hi == 0L && lo == 0L ? ZERO : new NtsBigInt(hi, lo);
    }
    public static NtsBigInt fromLong(long value) { return of(value >> 63, value); }
    public static NtsBigInt add(NtsBigInt a, NtsBigInt b) {
        long low = a.lo + b.lo;
        long high = a.hi + b.hi + (Long.compareUnsigned(low, a.lo) < 0 ? 1L : 0L);
        // Past 128 bits exactly when both operands' sign differs from the result's.
        if (((a.hi ^ high) & (b.hi ^ high)) < 0L) { throw pastBits(); }
        return of(high, low);
    }
    public static NtsBigInt sub(NtsBigInt a, NtsBigInt b) {
        long high = a.hi - b.hi - (Long.compareUnsigned(a.lo, b.lo) < 0 ? 1L : 0L);
        // Past 128 bits exactly when the operands' signs differ and the result's is b's.
        if (((a.hi ^ b.hi) & (a.hi ^ high)) < 0L) { throw pastBits(); }
        return of(high, a.lo - b.lo);
    }
    public static NtsBigInt neg(NtsBigInt a) {
        // The one value whose negation does not fit: -2^127.
        if (a.hi == Long.MIN_VALUE && a.lo == 0L) { throw pastBits(); }
        long low = -a.lo;
        return of(~a.hi + (low == 0 ? 1L : 0L), low);
    }
    /**
     * The product of the two magnitudes, which fits only if one of them is
     * under 2^64; then the sign, where -2^127 is the one magnitude of 2^127
     * that fits.
     */
    public static NtsBigInt mul(NtsBigInt a, NtsBigInt b) {
        boolean negative = (a.hi ^ b.hi) < 0L;
        long ah = a.hi, al = a.lo, bh = b.hi, bl = b.lo;
        if (ah < 0L) { al = -al; ah = ~ah + (al == 0 ? 1L : 0L); }
        if (bh < 0L) { bl = -bl; bh = ~bh + (bl == 0 ? 1L : 0L); }
        if (ah != 0L && bh != 0L) { throw pastBits(); }
        if (ah != 0L) {
            long h = ah, l = al;
            ah = bh; al = bl; bh = h; bl = l;
        }
        // Now a < 2^64: a * b = a*bl + (a*bh) * 2^64.
        if (bh != 0L && unsignedMultiplyHigh(al, bh) != 0L) { throw pastBits(); }
        long cross = al * bh;
        long low = al * bl;
        long high = unsignedMultiplyHigh(al, bl) + cross;
        if (Long.compareUnsigned(high, cross) < 0) { throw pastBits(); }
        if (high < 0L) {
            if (negative && high == Long.MIN_VALUE && low == 0L) { return of(Long.MIN_VALUE, 0L); }
            throw pastBits();
        }
        if (negative) { low = -low; high = ~high + (low == 0 ? 1L : 0L); }
        return of(high, low);
    }
    /**
     * {@code base ** exponent} by squaring, each step checked. The exponent is
     * never negative here: lowering throws node's RangeError first. No square
     * is taken that no later bit uses, so a result that fits never stops on a
     * square that would not have.
     */
    public static NtsBigInt pow(NtsBigInt base, NtsBigInt exponent) {
        if (exponent.hi != 0L || Long.compareUnsigned(exponent.lo, 128L) >= 0) {
            // Only 0, 1 and -1 stay inside 128 bits past the 127th power.
            if ((base.hi | base.lo) == 0L) { return ZERO; }
            if (base.hi == 0L && base.lo == 1L) { return ONE; }
            if (base.hi == -1L && base.lo == -1L) { return (exponent.lo & 1L) == 0L ? ONE : MINUS_ONE; }
            throw pastBits();
        }
        int e = (int) exponent.lo;
        NtsBigInt result = ONE;
        NtsBigInt square = base;
        while (e != 0) {
            if ((e & 1) != 0) { result = mul(result, square); }
            e >>>= 1;
            if (e != 0) { square = mul(square, square); }
        }
        return result;
    }
    private static long unsignedMultiplyHigh(long x, long y) {
        long x0 = x & 0xffffffffL, x1 = x >>> 32;
        long y0 = y & 0xffffffffL, y1 = y >>> 32;
        long p00 = x0 * y0, p01 = x0 * y1, p10 = x1 * y0, p11 = x1 * y1;
        long middle = p10 + (p00 >>> 32) + (p01 & 0xffffffffL);
        return p11 + (middle >>> 32) + (p01 >>> 32);
    }
    public static NtsBigInt div(NtsBigInt a, NtsBigInt b) { return divide(a, b, false); }
    public static NtsBigInt rem(NtsBigInt a, NtsBigInt b) { return divide(a, b, true); }

    /** Unsigned magnitude division followed by the signed quotient/remainder rule. */
    private static NtsBigInt divide(NtsBigInt a, NtsBigInt b, boolean remainder) {
        if ((b.hi | b.lo) == 0L) { throw new ArithmeticException("BigInteger divide by zero"); }
        // -2^127 / -1 is 2^127, the one quotient past 128 bits; its remainder is 0.
        if (!remainder && a.hi == Long.MIN_VALUE && a.lo == 0L && b.hi == -1L && b.lo == -1L) {
            throw pastBits();
        }
        if (a.hi == (a.lo >> 63) && b.hi == (b.lo >> 63)) {
            if (a.lo == Long.MIN_VALUE && b.lo == -1L) {
                return remainder ? ZERO : of(0L, Long.MIN_VALUE);
            }
            return fromLong(remainder ? a.lo % b.lo : a.lo / b.lo);
        }
        long ah = a.hi, al = a.lo, bh = b.hi, bl = b.lo;
        boolean aneg = ah < 0, bneg = bh < 0;
        if (aneg) { al = -al; ah = ~ah + (al == 0 ? 1L : 0L); }
        if (bneg) { bl = -bl; bh = ~bh + (bl == 0 ? 1L : 0L); }
        int cmp = unsignedCompare(ah, al, bh, bl);
        if (cmp < 0) { return remainder ? a : ZERO; }
        long qh = 0, ql = 0;
        if (ah == 0L && bh == 0L) {
            ql = Long.divideUnsigned(al, bl);
            al = Long.remainderUnsigned(al, bl);
        } else if (bh == 0L && bl > 0L && bl <= 0x7fffffffL) {
            // Four base-2^32 limbs. Intermediate dividends stay below 2^63.
            long carry = ah >>> 32;
            long q3 = carry / bl;
            carry = ((carry % bl) << 32) | (ah & 0xffffffffL);
            long q2 = carry / bl;
            carry = ((carry % bl) << 32) | (al >>> 32);
            long q1 = carry / bl;
            carry = ((carry % bl) << 32) | (al & 0xffffffffL);
            long q0 = carry / bl;
            qh = (q3 << 32) | q2; ql = (q1 << 32) | q0;
            ah = 0; al = carry % bl;
        } else {
            int shift = bitLength(ah, al) - bitLength(bh, bl);
            long dh, dl;
            if (shift == 0) { dh = bh; dl = bl; }
            else if (shift >= 64) { dh = bl << (shift - 64); dl = 0; }
            else { dh = (bh << shift) | (bl >>> (64 - shift)); dl = bl << shift; }
            // At most 128 steps. This favors low allocation; benchmark wide division separately.
            for (int i = shift; i >= 0; --i) {
                if (unsignedCompare(ah, al, dh, dl) >= 0) {
                    long old = al;
                    al -= dl;
                    ah = ah - dh - (Long.compareUnsigned(old, dl) < 0 ? 1L : 0L);
                    if (i >= 64) { qh |= 1L << (i - 64); }
                    else { ql |= 1L << i; }
                }
                dl = (dl >>> 1) | (dh << 63);
                dh >>>= 1;
            }
        }
        long rh = remainder ? ah : qh, rl = remainder ? al : ql;
        if (remainder ? aneg : aneg != bneg) {
            rl = -rl; rh = ~rh + (rl == 0 ? 1L : 0L);
        }
        return of(rh, rl);
    }
    private static int unsignedCompare(long ah, long al, long bh, long bl) {
        int c = Long.compareUnsigned(ah, bh);
        return c == 0 ? Long.compareUnsigned(al, bl) : c;
    }
    private static int bitLength(long hi, long lo) {
        return hi != 0 ? 128 - Long.numberOfLeadingZeros(hi) : 64 - Long.numberOfLeadingZeros(lo);
    }

    public static NtsBigInt and(NtsBigInt a, NtsBigInt b) { return of(a.hi & b.hi, a.lo & b.lo); }
    public static NtsBigInt or(NtsBigInt a, NtsBigInt b) { return of(a.hi | b.hi, a.lo | b.lo); }
    public static NtsBigInt xor(NtsBigInt a, NtsBigInt b) { return of(a.hi ^ b.hi, a.lo ^ b.lo); }
    public static NtsBigInt shl(NtsBigInt a, NtsBigInt count) {
        if (count.hi < 0L) {
            return compare(count, MINUS_128) <= 0 ? (a.hi < 0 ? MINUS_ONE : ZERO) : down(a, (int) -count.lo);
        }
        return compare(count, ONE_TWENTY_EIGHT) >= 0 ? beyond(a) : checkedUp(a, (int) count.lo);
    }
    /** A negative count shifts left, and is checked as a left shift is. */
    public static NtsBigInt shr(NtsBigInt a, NtsBigInt count) {
        if (count.hi < 0L) {
            return compare(count, MINUS_128) <= 0 ? beyond(a) : checkedUp(a, (int) -count.lo);
        }
        return compare(count, ONE_TWENTY_EIGHT) >= 0 ? (a.hi < 0 ? MINUS_ONE : ZERO) : down(a, (int) count.lo);
    }
    /** A left shift by 128 or more: only zero still fits. */
    private static NtsBigInt beyond(NtsBigInt a) {
        if ((a.hi | a.lo) != 0L) { throw pastBits(); }
        return ZERO;
    }
    /** A left shift that fits exactly when shifting back gives the value again. */
    private static NtsBigInt checkedUp(NtsBigInt a, int n) {
        NtsBigInt shifted = up(a, n);
        NtsBigInt back = down(shifted, n);
        if (back.hi != a.hi || back.lo != a.lo) { throw pastBits(); }
        return shifted;
    }
    private static NtsBigInt up(NtsBigInt a, int n) {
        if (n == 0) { return a; }
        if (n >= 64) { return of(a.lo << (n - 64), 0L); }
        return of((a.hi << n) | (a.lo >>> (64 - n)), a.lo << n);
    }
    private static NtsBigInt down(NtsBigInt a, int n) {
        if (n == 0) { return a; }
        if (n >= 64) { return of(a.hi >> 63, a.hi >> (n - 64)); }
        return of(a.hi >> n, (a.lo >>> n) | (a.hi << (64 - n)));
    }
    public static int compare(NtsBigInt a, NtsBigInt b) {
        if (a.hi != b.hi) { return a.hi < b.hi ? -1 : 1; }
        return Long.compareUnsigned(a.lo, b.lo);
    }
    public static boolean eq(NtsBigInt a, NtsBigInt b) { return a.hi == b.hi && a.lo == b.lo; }

    /**
     * `nts_bigint_compare_string`: the ordering of `a` against the bigint a
     * string denotes -- -1, 0 or 1 -- or NaN where the string is not a
     * `StringIntegerLiteral`, which makes every relational comparison false.
     *
     * <p>ECMA-262 StringToBigInt: whitespace and line terminators trimmed from
     * both ends; empty is 0n; `0x`/`0o`/`0b` (either case) take one or more
     * digits of that radix and no sign; otherwise an optional `+` or `-` and
     * one or more decimal digits. No separators, no fraction, no exponent, no
     * `n` suffix. The string's magnitude is unbounded, so it is parsed exactly
     * (a `BigInteger`, allocated only on this path) rather than into 128 bits:
     * a 200-digit string still compares exactly against any operand.
     */
    public static double compareString(NtsBigInt a, String text) {
        int start = 0;
        int end = text.length();
        while (start < end && stringWhiteSpace(text.charAt(start))) { start++; }
        while (end > start && stringWhiteSpace(text.charAt(end - 1))) { end--; }
        if (start == end) { return Integer.signum(compare(a, ZERO)); }
        int radix = 10;
        boolean negative = false;
        if (end - start > 2 && text.charAt(start) == '0') {
            char marker = text.charAt(start + 1);
            if (marker == 'x' || marker == 'X') { radix = 16; } else if (marker == 'o' || marker == 'O') { radix = 8; } else if (marker == 'b' || marker == 'B') { radix = 2; }
            if (radix != 10) { start += 2; }
        }
        if (radix == 10 && (text.charAt(start) == '+' || text.charAt(start) == '-')) {
            negative = text.charAt(start) == '-';
            start++;
        }
        if (start == end) { return Double.NaN; }
        for (int at = start; at < end; at++) {
            if (Character.digit(text.charAt(at), radix) < 0 || text.charAt(at) > 0x7f) { return Double.NaN; }
        }
        BigInteger magnitude = new BigInteger(text.substring(start, end), radix);
        return Integer.signum(toBigInteger(a).compareTo(negative ? magnitude.negate() : magnitude));
    }

    /** ECMA-262 StrWhiteSpaceChar: WhiteSpace (incl. U+FEFF and every Zs) and LineTerminator. */
    private static boolean stringWhiteSpace(char c) {
        return c == '\t' || c == 0x0b || c == '\f' || c == ' ' || c == 0xa0 || c == 0xfeff
            || c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029
            || Character.getType(c) == Character.SPACE_SEPARATOR;
    }

    public static BigInteger toBigInteger(NtsBigInt a) {
        if (a.hi == (a.lo >> 63)) { return BigInteger.valueOf(a.lo); }
        byte[] bytes = new byte[16];
        for (int i = 0; i < 8; ++i) {
            int shift = (7 - i) << 3;
            bytes[i] = (byte) (a.hi >>> shift);
            bytes[8 + i] = (byte) (a.lo >>> shift);
        }
        return new BigInteger(bytes);
    }
    public static NtsBigInt fromBigInteger(BigInteger value) {
        if (value.bitLength() <= 63) { return fromLong(value.longValue()); }
        return of(value.shiftRight(64).longValue(), value.longValue());
    }

    /** Round the 128-bit magnitude once, to 53 bits, with ties to even. */
    public static double toNumber(NtsBigInt a) {
        if (a.hi == (a.lo >> 63)) { return (double) a.lo; }
        long hi = a.hi, lo = a.lo;
        boolean negative = hi < 0;
        if (negative) { lo = -lo; hi = ~hi + (lo == 0 ? 1L : 0L); }
        int shift = bitLength(hi, lo) - 53;
        if (shift <= 0) { return negative ? -(double) lo : (double) lo; }
        long top;
        boolean half, sticky;
        if (shift > 64) {
            int hs = shift - 64;
            top = hi >>> hs;
            half = ((hi >>> (hs - 1)) & 1L) != 0;
            sticky = lo != 0 || (hi & ((1L << (hs - 1)) - 1)) != 0;
        } else if (shift == 64) {
            top = hi;
            half = lo < 0;
            sticky = (lo & Long.MAX_VALUE) != 0;
        } else {
            top = (lo >>> shift) | (hi << (64 - shift));
            half = ((lo >>> (shift - 1)) & 1L) != 0;
            sticky = (lo & ((1L << (shift - 1)) - 1)) != 0;
        }
        if (half && (sticky || (top & 1L) != 0)) { ++top; }
        double answer = Math.scalb((double) top, shift);
        return negative ? -answer : answer;
    }

    public static NtsBigInt fromNumber(double value) {
        if (Double.isNaN(value) || Double.isInfinite(value) || value != Math.floor(value)) {
            throw new NtsRefusal(NtsRuntime.numberToString(value) + " is not an integer, so it has no bigint");
        }
        if (value < -0x1p127 || value >= 0x1p127) {
            throw new NtsRefusal(NtsRuntime.numberToString(value) + " is past the 128 bits this bigint has");
        }
        if (value >= -0x1p63 && value < 0x1p63) { return fromLong((long) value); }
        long bits = Double.doubleToRawLongBits(value);
        long significand = (bits & 0x000fffffffffffffL) | 0x0010000000000000L;
        int shift = (int) ((bits >>> 52) & 0x7ff) - 1023 - 52;
        long hi, lo;
        if (shift >= 64) { hi = significand << (shift - 64); lo = 0; }
        else { hi = significand >>> (64 - shift); lo = significand << shift; }
        if (value < 0) { lo = -lo; hi = ~hi + (lo == 0 ? 1L : 0L); }
        return of(hi, lo);
    }

    /** Base-1e9 decimal conversion, using four unsigned base-2^32 limbs. */
    public static String toText(NtsBigInt a) {
        if (a.hi == (a.lo >> 63)) { return Long.toString(a.lo); }
        long hi = a.hi, lo = a.lo;
        boolean negative = hi < 0;
        if (negative) { lo = -lo; hi = ~hi + (lo == 0 ? 1L : 0L); }
        char[] text = new char[40];
        int pos = text.length;
        do {
            long carry = hi >>> 32;
            long q3 = carry / 1000000000L;
            carry = ((carry % 1000000000L) << 32) | (hi & 0xffffffffL);
            long q2 = carry / 1000000000L;
            carry = ((carry % 1000000000L) << 32) | (lo >>> 32);
            long q1 = carry / 1000000000L;
            carry = ((carry % 1000000000L) << 32) | (lo & 0xffffffffL);
            long q0 = carry / 1000000000L;
            int part = (int) (carry % 1000000000L);
            hi = (q3 << 32) | q2; lo = (q1 << 32) | q0;
            int digits = (hi | lo) == 0 ? 0 : 9;
            do {
                text[--pos] = (char) ('0' + part % 10);
                part /= 10;
            } while (--digits > 0 || part != 0);
        } while ((hi | lo) != 0);
        if (negative) { text[--pos] = '-'; }
        return new String(text, pos, text.length - pos);
    }
    public static NtsBigInt asIntN(double bits, NtsBigInt a) {
        int n = (int) bits;
        if (n <= 0) { return ZERO; }
        if (n >= 128) { return a; }
        if (n < 64) { long low = (a.lo << (64 - n)) >> (64 - n); return fromLong(low); }
        if (n == 64) { return fromLong(a.lo); }
        return of((a.hi << (128 - n)) >> (128 - n), a.lo);
    }
    /**
     * {@code BigInt.asUintN}: the value modulo 2^n. That fits in 128 signed bits
     * for any n up to 127, and from 128 on only when the value is not negative:
     * a negative one is 2^n plus itself, at least 2^127, so it stops by name
     * rather than come back negative.
     */
    public static NtsBigInt asUintN(double bits, NtsBigInt a) {
        int n = (int) bits;
        if (n <= 0) { return ZERO; }
        if (n >= 128) {
            if (a.hi < 0L) { throw pastBits(); }
            return a;
        }
        if (n < 64) { return of(0L, a.lo & (-1L >>> (64 - n))); }
        if (n == 64) { return of(0L, a.lo); }
        return of(a.hi & (-1L >>> (128 - n)), a.lo);
    }
}
