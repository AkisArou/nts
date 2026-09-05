package nts.rt;

/**
 * Grisu2 with the shortness proof, transcribed from {@code runtime/c/nts_grisu.h}.
 *
 * <p>One algorithm, two languages, the same digits by construction. The
 * alternative was {@code Double.toString}, and it is wrong here for a reason
 * that outlives any particular JDK: its digits were not shortest-round-trip
 * before 19, so the same class file would print differently depending on the
 * JVM it landed on. A compiler cannot ship a number format that varies with the
 * host.
 *
 * <p>What it replaces is worse than slow. {@code numberToString} searched
 * precisions 1 through 17 with {@code BigDecimal}, allocating at every step and
 * round-tripping through {@code doubleValue()} to test each candidate.
 * This is integer arithmetic and one 128-bit multiply.
 *
 * <p>Every value here is an <em>unsigned</em> 64-bit quantity held in a
 * {@code long}, and the scaled significands really do have their top bit set,
 * so every comparison goes through {@link Long#compareUnsigned}. A signed
 * {@code <} would be right for most inputs and wrong for exactly the large
 * ones, which is the shape of bug that survives a corpus.
 */
final class NtsGrisu {
    private NtsGrisu() {}

    /** Answered when the interval does not close and an exact algorithm is needed. */
    static final long UNPROVEN = Long.MIN_VALUE;

    private static final int MIN_K = -348;
    private static final int STEP = 8;
    /** 1 / log2(10), for turning a binary exponent into a decimal one. */
    private static final double ONE_OVER_LOG2_10 = 0.30102999566398114;

    private static final int[] POW10 = {
        1, 10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000
    };

    /**
     * The top 64 bits of the 128-bit product, rounded to nearest.
     *
     * <p>Four 32-bit partials rather than {@code Math.multiplyHigh}, which
     * arrived in Java 9: this jar is built {@code --release 8} for the same
     * reason it contains no {@code invokedynamic}.
     */
    private static long timesHigh(long af, long bf) {
        long a0 = af & 0xFFFFFFFFL, a1 = af >>> 32;
        long b0 = bf & 0xFFFFFFFFL, b1 = bf >>> 32;
        long p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
        long mid = (p00 >>> 32) + (p01 & 0xFFFFFFFFL) + (p10 & 0xFFFFFFFFL);
        long hi = p11 + (p01 >>> 32) + (p10 >>> 32) + (mid >>> 32);
        long lo = (mid << 32) | (p00 & 0xFFFFFFFFL);
        return hi + (lo >>> 63);
    }

    private static int digitsOf(long n) {
        if (n < 10L) { return 1; }
        if (n < 100L) { return 2; }
        if (n < 1000L) { return 3; }
        if (n < 10000L) { return 4; }
        if (n < 100000L) { return 5; }
        if (n < 1000000L) { return 6; }
        if (n < 10000000L) { return 7; }
        if (n < 100000000L) { return 8; }
        if (n < 1000000000L) { return 9; }
        return 10;
    }

    /**
     * Shorten the last digit while the result still lands inside the interval.
     *
     * <p>This is what makes a wrong answer impossible: it accepts only a digit
     * string it can prove reads back, and answers false when the proof does not
     * close.
     */
    private static boolean weed(byte[] buffer, int length, long tooHigh,
                                long unsafe, long rest, long tenKappa, long unit) {
        long small = tooHigh - unit;
        long big = tooHigh + unit;
        while (Long.compareUnsigned(rest, small) < 0
                && Long.compareUnsigned(unsafe - rest, tenKappa) >= 0
                && (Long.compareUnsigned(rest + tenKappa, small) < 0
                    || Long.compareUnsigned(small - rest, rest + tenKappa - small) >= 0)) {
            buffer[length - 1]--;
            rest += tenKappa;
        }
        if (Long.compareUnsigned(rest, big) < 0
                && Long.compareUnsigned(unsafe - rest, tenKappa) >= 0
                && (Long.compareUnsigned(rest + tenKappa, big) < 0
                    || Long.compareUnsigned(big - rest, rest + tenKappa - big) > 0)) {
            return false;
        }
        return Long.compareUnsigned(2 * unit, rest) <= 0
            && Long.compareUnsigned(rest, unsafe - 4 * unit) <= 0;
    }

    /**
     * The shortest digits of {@code d}, ASCII, most significant first.
     *
     * <p>{@code d} must be finite and strictly positive: the caller has already
     * dealt with zero, the sign, NaN and the infinities. Answers
     * {@link #UNPROVEN} when it cannot prove the result, which is the caller's
     * cue to fall back on an exact algorithm -- the same contract the C keeps,
     * not a hedge added for the port.
     *
     * <p>The result packs the decimal point above the digit count:
     * {@code (point << 32) | length}.
     */
    static long shortest(double d, byte[] buffer) {
        long bits = Double.doubleToRawLongBits(d);
        long frac = bits & ((1L << 52) - 1);
        int biased = (int) ((bits >>> 52) & 0x7FF);

        long vf;
        int ve;
        if (biased != 0) { vf = frac + (1L << 52); ve = biased - 1075; }
        else { vf = frac; ve = -1074; }

        long wf = vf;
        int we = ve;
        while ((wf & (1L << 63)) == 0) { wf <<= 1; we--; }

        // The two values halfway to the neighbouring doubles, normalised
        // together. Anything strictly inside reads back as `d`. The lower gap is
        // half as wide when `d` is a power of two -- an all-zero significand --
        // and that is not true of a denormal, which has no implicit leading bit
        // to have stepped down from.
        long plusF = (vf << 1) + 1;
        int plusE = ve - 1;
        while ((plusF & (1L << 63)) == 0) { plusF <<= 1; plusE--; }
        long minusF;
        int minusE;
        if (frac == 0 && biased != 0) { minusF = (vf << 2) - 1; minusE = ve - 2; }
        else { minusF = (vf << 1) - 1; minusE = ve - 1; }
        minusF <<= minusE - plusE;

        // A power of ten bringing the product's exponent into [-60, -32], where
        // the integral part fits 32 bits and the fraction fits the rest.
        int minExponent = -60 - (we + 64);
        double approx = Math.ceil((double) (minExponent + 64 - 1) * ONE_OVER_LOG2_10);
        int index = (-MIN_K + (int) approx - 1) / STEP + 1;
        if (index < 0) { index = 0; }
        if (index >= POWER_F.length) { return UNPROVEN; }
        long tenF = POWER_F[index];
        int tenE = POWER_E[index];
        int tenK = POWER_K[index];

        long swF = timesHigh(wf, tenF);
        int swE = we + tenE + 64;
        long slF = timesHigh(minusF, tenF);
        long shF = timesHigh(plusF, tenF);

        long unit = 1;
        long tooLow = slF - unit;
        long tooHigh = shF + unit;
        long unsafe = tooHigh - tooLow;

        int shift = -swE;
        long oneF = 1L << shift;
        long integral = tooHigh >>> shift;
        long fractional = tooHigh & (oneF - 1);
        long distance = tooHigh - swF;

        int digits = digitsOf(integral);
        long divisor = POW10[digits - 1];
        int kappa = digits;
        int length = 0;
        while (kappa > 0) {
            long digit = integral / divisor;
            buffer[length++] = (byte) ('0' + digit);
            integral -= digit * divisor;
            kappa--;
            long rest = (integral << shift) + fractional;
            if (Long.compareUnsigned(rest, unsafe) < 0) {
                return weed(buffer, length, distance, unsafe, rest, divisor << shift, unit)
                    ? (((long) (length + kappa - tenK)) << 32) | length
                    : UNPROVEN;
            }
            divisor /= 10;
        }
        for (;;) {
            fractional *= 10;
            unit *= 10;
            unsafe *= 10;
            distance *= 10;
            long digit = fractional >>> shift;
            buffer[length++] = (byte) ('0' + digit);
            fractional &= oneF - 1;
            kappa--;
            if (Long.compareUnsigned(fractional, unsafe) < 0) {
                return weed(buffer, length, distance, unsafe, fractional, oneF, unit)
                    ? (((long) (length + kappa - tenK)) << 32) | length
                    : UNPROVEN;
            }
        }
    }

    private static final long[] POWER_F = {
        0xfa8fd5a0081c0288L, 0xbaaee17fa23ebf76L, 0x8b16fb203055ac76L, 0xcf42894a5dce35eaL,
        0x9a6bb0aa55653b2dL, 0xe61acf033d1a45dfL, 0xab70fe17c79ac6caL, 0xff77b1fcbebcdc4fL,
        0xbe5691ef416bd60cL, 0x8dd01fad907ffc3cL, 0xd3515c2831559a83L, 0x9d71ac8fada6c9b5L,
        0xea9c227723ee8bcbL, 0xaecc49914078536dL, 0x823c12795db6ce57L, 0xc21094364dfb5637L,
        0x9096ea6f3848984fL, 0xd77485cb25823ac7L, 0xa086cfcd97bf97f4L, 0xef340a98172aace5L,
        0xb23867fb2a35b28eL, 0x84c8d4dfd2c63f3bL, 0xc5dd44271ad3cdbaL, 0x936b9fcebb25c996L,
        0xdbac6c247d62a584L, 0xa3ab66580d5fdaf6L, 0xf3e2f893dec3f126L, 0xb5b5ada8aaff80b8L,
        0x87625f056c7c4a8bL, 0xc9bcff6034c13053L, 0x964e858c91ba2655L, 0xdff9772470297ebdL,
        0xa6dfbd9fb8e5b88fL, 0xf8a95fcf88747d94L, 0xb94470938fa89bcfL, 0x8a08f0f8bf0f156bL,
        0xcdb02555653131b6L, 0x993fe2c6d07b7facL, 0xe45c10c42a2b3b06L, 0xaa242499697392d3L,
        0xfd87b5f28300ca0eL, 0xbce5086492111aebL, 0x8cbccc096f5088ccL, 0xd1b71758e219652cL,
        0x9c40000000000000L, 0xe8d4a51000000000L, 0xad78ebc5ac620000L, 0x813f3978f8940984L,
        0xc097ce7bc90715b3L, 0x8f7e32ce7bea5c70L, 0xd5d238a4abe98068L, 0x9f4f2726179a2245L,
        0xed63a231d4c4fb27L, 0xb0de65388cc8ada8L, 0x83c7088e1aab65dbL, 0xc45d1df942711d9aL,
        0x924d692ca61be758L, 0xda01ee641a708deaL, 0xa26da3999aef774aL, 0xf209787bb47d6b85L,
        0xb454e4a179dd1877L, 0x865b86925b9bc5c2L, 0xc83553c5c8965d3dL, 0x952ab45cfa97a0b3L,
        0xde469fbd99a05fe3L, 0xa59bc234db398c25L, 0xf6c69a72a3989f5cL, 0xb7dcbf5354e9beceL,
        0x88fcf317f22241e2L, 0xcc20ce9bd35c78a5L, 0x98165af37b2153dfL, 0xe2a0b5dc971f303aL,
        0xa8d9d1535ce3b396L, 0xfb9b7cd9a4a7443cL, 0xbb764c4ca7a44410L, 0x8bab8eefb6409c1aL,
        0xd01fef10a657842cL, 0x9b10a4e5e9913129L, 0xe7109bfba19c0c9dL, 0xac2820d9623bf429L,
        0x80444b5e7aa7cf85L, 0xbf21e44003acdd2dL, 0x8e679c2f5e44ff8fL, 0xd433179d9c8cb841L,
        0x9e19db92b4e31ba9L, 0xeb96bf6ebadf77d9L, 0xaf87023b9bf0ee6bL, 0x82c730bec1cac961L
    };
    private static final int[] POWER_E = {
        -1220, -1193, -1166, -1140, -1113, -1087, -1060, -1034, -1007, -980, -954, -927, -901,
        -874, -847, -821, -794, -768, -741, -715, -688, -661, -635, -608, -582, -555, -529,
        -502, -475, -449, -422, -396, -369, -343, -316, -289, -263, -236, -210, -183, -157,
        -130, -103, -77, -50, -24, 3, 30, 56, 83, 109, 136, 162, 189, 216, 242, 269, 295, 322,
        348, 375, 402, 428, 455, 481, 508, 534, 561, 588, 614, 641, 667, 694, 720, 747, 774,
        800, 827, 853, 880, 907, 933, 960, 986, 1013, 1039, 1066, 1093
    };
    private static final int[] POWER_K = {
        -348, -340, -332, -324, -316, -308, -300, -292, -284, -276, -268, -260, -252, -244,
        -236, -228, -220, -212, -204, -196, -188, -180, -172, -164, -156, -148, -140, -132,
        -124, -116, -108, -100, -92, -84, -76, -68, -60, -52, -44, -36, -28, -20, -12, -4, 4,
        12, 20, 28, 36, 44, 52, 60, 68, 76, 84, 92, 100, 108, 116, 124, 132, 140, 148, 156,
        164, 172, 180, 188, 196, 204, 212, 220, 228, 236, 244, 252, 260, 268, 276, 284, 292,
        300, 308, 316, 324, 332, 340, 348
    };
}
