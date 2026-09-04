package nts.rt;

/**
 * A 128-bit signed integer, because the JVM has no primitive for one.
 *
 * <p><b>Not {@code BigInteger}, and that is a correctness decision before it is
 * a performance one.</b> This compiler's {@code bigint} is exactly 128 bits and
 * refuses a literal that does not fit -- record 0036 -- so the C lane wraps
 * where the language would grow. {@code BigInteger} would be *more* correct
 * than the C backend, which sounds like an improvement and is not: the two
 * lanes would then disagree on precisely the inputs that matter, and
 * `agrees_with_c` is the oracle here because node's `BigInt` is arbitrary
 * precision and is not.
 *
 * <p>So: two's complement in two {@code long}s, wrapping at 128 bits, matching
 * `__int128` operation for operation.
 *
 * <p>It is also the shape that should win. What a Java programmer writes for
 * this is {@code BigInteger}, which allocates per operation and carries an
 * arbitrary-precision magnitude; this is two words and, wherever it does not
 * escape, no allocation at all once C2 has looked at it -- which record 0083
 * measured at zero bytes per operation for the analogous erased value.
 *
 * <p>Division and {@code toString} go through {@code BigInteger} deliberately.
 * 128-bit division is a hundred lines of shift-and-subtract to save a call on
 * an operation that is rare in the programs this compiler sees, and even C
 * calls `__divti3` rather than emitting it inline. Correct first, and the
 * measurement decides whether it is ever worth more.
 */
public final class NtsBigInt {
    /** The high and low 64 bits of a two's-complement 128-bit value. */
    public final long hi;
    public final long lo;

    private NtsBigInt(long hi, long lo) {
        this.hi = hi;
        this.lo = lo;
    }

    public static final NtsBigInt ZERO = new NtsBigInt(0L, 0L);

    public static NtsBigInt of(long hi, long lo) {
        return hi == 0L && lo == 0L ? ZERO : new NtsBigInt(hi, lo);
    }

    // ----- arithmetic -----------------------------------------------------

    public static NtsBigInt add(NtsBigInt a, NtsBigInt b) {
        long lo = a.lo + b.lo;
        // The carry, without a wider type to detect it in: the sum wrapped
        // exactly when it came out below an unsigned operand.
        long carry = Long.compareUnsigned(lo, a.lo) < 0 ? 1L : 0L;
        return of(a.hi + b.hi + carry, lo);
    }

    public static NtsBigInt sub(NtsBigInt a, NtsBigInt b) {
        long lo = a.lo - b.lo;
        long borrow = Long.compareUnsigned(a.lo, b.lo) < 0 ? 1L : 0L;
        return of(a.hi - b.hi - borrow, lo);
    }

    public static NtsBigInt neg(NtsBigInt a) {
        return sub(ZERO, a);
    }

    /**
     * The full 128-bit product, keeping the low 128 bits.
     *
     * <p>{@code Math.multiplyHigh} would give the top half in one intrinsic and
     * arrived in Java 9; this runtime targets 8, which is the floor that keeps
     * the Android path open. So the high half is four 32-bit partial products,
     * which is what the intrinsic compiles to anywhere it is not a single
     * instruction.
     */
    public static NtsBigInt mul(NtsBigInt a, NtsBigInt b) {
        long lo = a.lo * b.lo;
        long high = unsignedMultiplyHigh(a.lo, b.lo) + a.hi * b.lo + a.lo * b.hi;
        return of(high, lo);
    }

    private static long unsignedMultiplyHigh(long x, long y) {
        long x0 = x & 0xFFFFFFFFL, x1 = x >>> 32;
        long y0 = y & 0xFFFFFFFFL, y1 = y >>> 32;
        long p00 = x0 * y0;
        long p01 = x0 * y1;
        long p10 = x1 * y0;
        long p11 = x1 * y1;
        long middle = p10 + (p00 >>> 32) + (p01 & 0xFFFFFFFFL);
        return p11 + (middle >>> 32) + (p01 >>> 32);
    }

    public static NtsBigInt div(NtsBigInt a, NtsBigInt b) {
        return fromBigInteger(toBigInteger(a).divide(toBigInteger(b)));
    }

    public static NtsBigInt rem(NtsBigInt a, NtsBigInt b) {
        return fromBigInteger(toBigInteger(a).remainder(toBigInteger(b)));
    }

    // ----- bits -----------------------------------------------------------

    public static NtsBigInt and(NtsBigInt a, NtsBigInt b) {
        return of(a.hi & b.hi, a.lo & b.lo);
    }

    public static NtsBigInt or(NtsBigInt a, NtsBigInt b) {
        return of(a.hi | b.hi, a.lo | b.lo);
    }

    public static NtsBigInt xor(NtsBigInt a, NtsBigInt b) {
        return of(a.hi ^ b.hi, a.lo ^ b.lo);
    }

    /**
     * A shift, by a count that is itself a bigint.
     *
     * <p>A **negative count reverses the direction** -- `x << -3n` is `x >> 3n`
     * -- which is the language's rule and is the whole reason these are runtime
     * calls rather than instructions. A transliteration of `nts_bigint_shl` and
     * `nts_bigint_shr`, including that shifting a negative value all the way
     * out leaves -1 rather than 0.
     *
     * <p>The count is itself 128 bits, so "is it at least 128" is a 128-bit
     * comparison and not a look at the low half: `1n << (2n ** 64n)` must
     * saturate rather than shift by zero.
     */
    public static NtsBigInt shl(NtsBigInt a, NtsBigInt count) {
        if (count.hi < 0L) {
            return compare(count, MINUS_128) <= 0
                ? (a.hi < 0L ? MINUS_ONE : ZERO)
                : down(a, (int) -count.lo);
        }
        return compare(count, ONE_TWENTY_EIGHT) >= 0 ? ZERO : up(a, (int) count.lo);
    }

    public static NtsBigInt shr(NtsBigInt a, NtsBigInt count) {
        if (count.hi < 0L) {
            return compare(count, MINUS_128) <= 0 ? ZERO : up(a, (int) -count.lo);
        }
        return compare(count, ONE_TWENTY_EIGHT) >= 0
            ? (a.hi < 0L ? MINUS_ONE : ZERO)
            : down(a, (int) count.lo);
    }

    private static final NtsBigInt MINUS_ONE = new NtsBigInt(-1L, -1L);
    private static final NtsBigInt MINUS_128 = new NtsBigInt(-1L, -128L);
    private static final NtsBigInt ONE_TWENTY_EIGHT = new NtsBigInt(0L, 128L);

    /**
     * Left by `n`, where `0 <= n < 128`.
     *
     * <p>The JVM masks a shift count to 6 bits for a `long`, which is right for
     * a 64-bit shift and wrong for a 128-bit one: shifting by exactly 64 must
     * move the low half into the high half rather than doing nothing. So the
     * cases are spelled out instead of relying on the mask.
     */
    private static NtsBigInt up(NtsBigInt a, int n) {
        if (n == 0) {
            return a;
        }
        if (n >= 64) {
            return of(a.lo << (n - 64), 0L);
        }
        return of((a.hi << n) | (a.lo >>> (64 - n)), a.lo << n);
    }

    /** Arithmetic right by `n`, where `0 <= n < 128`: the sign extends. */
    private static NtsBigInt down(NtsBigInt a, int n) {
        long sign = a.hi < 0L ? -1L : 0L;
        if (n == 0) {
            return a;
        }
        if (n >= 64) {
            return of(sign, a.hi >> (n - 64));
        }
        return of(a.hi >> n, (a.lo >>> n) | (a.hi << (64 - n)));
    }

    // ----- comparison -----------------------------------------------------

    /**
     * Signed 128-bit comparison, as -1, 0 or 1.
     *
     * <p>The high half is signed and the low half is not, which is the one
     * thing that makes this different from comparing two pairs of longs.
     */
    public static int compare(NtsBigInt a, NtsBigInt b) {
        if (a.hi != b.hi) {
            return a.hi < b.hi ? -1 : 1;
        }
        return Long.compareUnsigned(a.lo, b.lo) < 0 ? -1 : (a.lo == b.lo ? 0 : 1);
    }

    public static boolean eq(NtsBigInt a, NtsBigInt b) {
        return a.hi == b.hi && a.lo == b.lo;
    }

    // ----- conversion -----------------------------------------------------

    public static java.math.BigInteger toBigInteger(NtsBigInt a) {
        return java.math.BigInteger.valueOf(a.hi).shiftLeft(64)
            .or(java.math.BigInteger.valueOf(a.lo).and(UNSIGNED_64));
    }

    private static final java.math.BigInteger UNSIGNED_64 =
        java.math.BigInteger.ONE.shiftLeft(64).subtract(java.math.BigInteger.ONE);

    public static NtsBigInt fromBigInteger(java.math.BigInteger value) {
        java.math.BigInteger low = value.and(UNSIGNED_64);
        java.math.BigInteger high = value.shiftRight(64).and(UNSIGNED_64);
        return of(high.longValue(), low.longValue());
    }

    /**
     * A 64-bit integer widened to 128 bits, sign-extended.
     *
     * <p>What `BigInt(true)` reaches, and what any narrower integer reaches:
     * the language says a boolean converts to `1n` or `0n`, and on this backend
     * a boolean is already an `int`. Sign-extending rather than zero-extending
     * because that is what `(__int128)x` does for a signed `x`, and the C lane
     * is the oracle for this type.
     */
    public static NtsBigInt fromLong(long value) {
        return of(value < 0L ? -1L : 0L, value);
    }

    /** `Number(x)` on a bigint: the nearest double, as `(double)__int128` is. */
    public static double toNumber(NtsBigInt a) {
        return toBigInteger(a).doubleValue();
    }

    /**
     * `BigInt(x)` on a number, which is a conversion with a precondition.
     *
     * <p>The specification throws a `RangeError` when the value is not an
     * integer -- `BigInt(1.5)` is not `1n` -- so a plain cast would be a wrong
     * answer rather than a lossy one. There is no `throw` to raise here, so
     * this refuses the way an out-of-range index does, and with the same
     * `nts:` prefix the differential reads.
     */
    public static NtsBigInt fromNumber(double value) {
        if (Double.isNaN(value) || Double.isInfinite(value) || value != Math.floor(value)) {
            throw new NtsRefusal(NtsRuntime.numberToString(value)
                + " is not an integer, so it has no bigint");
        }
        java.math.BigInteger exact = new java.math.BigDecimal(value).toBigInteger();
        if (exact.bitLength() > 127) {
            throw new NtsRefusal(NtsRuntime.numberToString(value)
                + " is past the 128 bits this bigint has");
        }
        return fromBigInteger(exact);
    }

    public static String toText(NtsBigInt a) {
        return toBigInteger(a).toString();
    }

    /** `BigInt.asIntN(bits, x)`. */
    public static NtsBigInt asIntN(double bits, NtsBigInt a) {
        int n = (int) bits;
        if (n <= 0) {
            return ZERO;
        }
        if (n >= 128) {
            return a;
        }
        java.math.BigInteger mask = java.math.BigInteger.ONE.shiftLeft(n).subtract(java.math.BigInteger.ONE);
        java.math.BigInteger low = toBigInteger(a).and(mask);
        if (low.testBit(n - 1)) {
            low = low.subtract(java.math.BigInteger.ONE.shiftLeft(n));
        }
        return fromBigInteger(low);
    }

    /** `BigInt.asUintN(bits, x)`. */
    public static NtsBigInt asUintN(double bits, NtsBigInt a) {
        int n = (int) bits;
        if (n <= 0) {
            return ZERO;
        }
        if (n >= 128) {
            return a;
        }
        java.math.BigInteger mask = java.math.BigInteger.ONE.shiftLeft(n).subtract(java.math.BigInteger.ONE);
        return fromBigInteger(toBigInteger(a).and(mask));
    }
}
