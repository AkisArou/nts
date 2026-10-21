package nts.rt;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Random;

/** Deterministic, dependency-free tests. Run with assertions enabled or disabled. */
public final class RuntimeRegression {
    private static long checks;
    private static final BigInteger TWO64 = BigInteger.ONE.shiftLeft(64);
    private static final BigInteger TWO128 = BigInteger.ONE.shiftLeft(128);
    private static final BigInteger MASK128 = TWO128.subtract(BigInteger.ONE);
    private static void check(boolean yes, String message) {
        ++checks;
        if (!yes) { throw new AssertionError(message); }
    }
    private static void equal(Object actual, Object expected, String message) {
        check(java.util.Objects.equals(actual, expected), message + ": " + actual + " != " + expected);
    }
    private static void number(double actual, double expected, String message) {
        check(Double.doubleToLongBits(actual) == Double.doubleToLongBits(expected),
            message + ": " + actual + " != " + expected);
    }
    private static BigInteger wide(NtsBigInt a) {
        BigInteger low = BigInteger.valueOf(a.lo);
        if (a.lo < 0) { low = low.add(TWO64); }
        return BigInteger.valueOf(a.hi).shiftLeft(64).add(low);
    }
    private static BigInteger wrap(BigInteger x) {
        x = x.and(MASK128);
        return x.testBit(127) ? x.subtract(TWO128) : x;
    }
    private static void bigint(NtsBigInt a, BigInteger expected, String operation) {
        equal(wide(a), wrap(expected), operation);
    }
    private static final BigInteger MIN128 = BigInteger.ONE.shiftLeft(127).negate();
    private static final BigInteger MAX128 = BigInteger.ONE.shiftLeft(127).subtract(BigInteger.ONE);
    /** A checked operation: the exact result where it fits in 128 bits, C's refusal by name where it does not. */
    private static void exact(java.util.function.Supplier<NtsBigInt> run, BigInteger expected, String operation) {
        boolean fits = expected.compareTo(MIN128) >= 0 && expected.compareTo(MAX128) <= 0;
        try {
            NtsBigInt got = run.get();
            check(fits, operation + ": " + wide(got) + " where " + expected + " should stop");
            equal(wide(got), expected, operation);
        } catch (NtsRefusal stopped) {
            check(!fits, operation + " stopped though " + expected + " fits");
            equal(stopped.getMessage(), "nts: refused at run time: a bigint past 128 bits, which this runtime does not hold",
                operation + " stops by name");
        }
    }
    /**
     * The two refusal lines are C's and tell a decline from a defect by prefix: `nts: refused: ` is the
     * program declining its input, `nts: refused at run time: ` the missing-feature abort.
     */
    private static void testRefusalLines() {
        equal(new NtsRefusal("index 1 is outside [0, 1)").getMessage(), "nts: refused: index 1 is outside [0, 1)",
            "a decline is C's NTS_REFUSED line");
        check(new NtsRefusal("x").status == 134, "a decline ends as C's abort()");
        String missing = null;
        int status = 0;
        try { NtsRuntime.refused("`f` was declined: reasons"); } catch (NtsRefusal e) { missing = e.getMessage(); status = e.status; }
        equal(missing, "nts: refused at run time: `f` was declined: reasons", "the missing-feature abort is C's nts_refused line");
        check(!missing.startsWith("nts: refused: "), "and does not read as a decline");
        check(status == 134, "and ends as C's abort()");
        equal(NtsRefusal.decline("y", 1).getMessage(), "nts: refused: y", "an exiting decline keeps the decline prefix");
        check(NtsRefusal.decline("y", 1).status == 1, "and its own status");
        String asserted = null;
        int assertedStatus = 0;
        try { NtsRuntime.assertionFailed("expected a number"); } catch (NtsRefusal e) { asserted = e.getMessage(); assertedStatus = e.status; }
        equal(asserted, "nts: refused: expected a number", "nts_assertion_failed is a decline line");
        check(assertedStatus == 1, "and exits 1, as C's helper does");
    }

    /** An erased bigint (tag 16): every reader names it, and it is a value, not a reference. */
    private static boolean lengthRefuses(Object storage) {
        try {
            NtsValue.arrayLength(storage == null ? null : NtsValue.ofObject(storage));
            return false;
        } catch (NtsRefusal expected) {
            return true;
        }
    }

    /** `Length` of an erased array: the live count of every actual representation, and named refusals. */
    private static void testArrayLength() {
        NtsArrayD grown = NtsArrayD.of(0);
        for (int i = 0; i < 5; i++) NtsArrayD.push(grown, i);
        check(grown.items.length > 5 && NtsValue.arrayLength(NtsValue.ofObject(grown)) == 5, "a wrapper's live count, not its capacity");
        NtsArrayL refs = NtsArrayL.of(0);
        NtsArrayL.push(refs, NtsValue.ofNumber(1));
        NtsArrayL.push(refs, NtsValue.ofNumber(2));
        check(NtsValue.arrayLength(NtsValue.ofObject(refs)) == 2, "NtsArrayL");
        check(NtsValue.arrayLength(NtsValue.ofObject(NtsArrayZ.of(3))) == 3, "NtsArrayZ");
        check(NtsValue.arrayLength(NtsValue.ofObject(NtsTemplate.of(new String[] {"a", "b"}))) == 2, "a template");
        Object[] bare = {new double[4], new int[3], new long[2], new boolean[1], new Object[6], new NtsValue[7], new String[0]};
        int[] want = {4, 3, 2, 1, 6, 7, 0};
        for (int i = 0; i < bare.length; i++) {
            check(NtsValue.arrayLength(NtsValue.ofObject(bare[i])) == want[i], "a bare " + bare[i].getClass().getSimpleName());
        }
        check(lengthRefuses(new NtsTuple() { }), "a tuple refuses by name: it carries no position count");
        check(lengthRefuses("not an array") && lengthRefuses(new Object()) && lengthRefuses(null), "a non-array refuses");
    }

    private static boolean setRefuses(Runnable store) {
        try {
            store.run();
            return false;
        } catch (NtsRefusal expected) {
            return true;
        }
    }

    /**
     * A checked store into a growable array is C's `nts_slot_or_grow`: a slot
     * it has, or exactly `length` (an append by one); anything else refuses as
     * a bounds refusal -- never a hole, never a truncated slot, never a bare
     * `ArrayIndexOutOfBoundsException`.
     */
    private static void testCheckedSet() {
        final NtsArrayD d = NtsArrayD.of(2);
        final NtsArrayL l = NtsArrayL.of(2);
        final NtsArrayZ z = NtsArrayZ.of(2);
        final NtsValue v = NtsValue.ofNumber(9);
        // `double` subscripts, spelled so: an `int` literal would bind to the
        // `int` overload below and leave this form untested.
        NtsArrayD.set(d, 1.0, 5);
        NtsArrayD.set(d, 2.0, 6);
        NtsArrayD.set(d, -0.0, 4);
        check(NtsArrayD.length(d) == 3 && NtsArrayD.get(d, 0) == 4 && NtsArrayD.get(d, 2) == 6, "in range, -0, and an append at length");
        NtsArrayL.set(l, 2.0, v);
        NtsArrayZ.set(z, 2.0, true);
        check(NtsArrayL.length(l) == 3 && NtsArrayZ.length(z) == 3, "each wrapper appends exactly at length");
        for (final double bad : new double[] {4, -1, 1.5, Double.NaN, Double.POSITIVE_INFINITY}) {
            check(setRefuses(() -> NtsArrayD.set(d, bad, 1)), "NtsArrayD refuses " + bad);
            check(setRefuses(() -> NtsArrayL.set(l, bad, v)), "NtsArrayL refuses " + bad);
            check(setRefuses(() -> NtsArrayZ.set(z, bad, true)), "NtsArrayZ refuses " + bad);
        }
        check(NtsArrayD.length(d) == 3 && NtsArrayL.length(l) == 3 && NtsArrayZ.length(z) == 3, "and a refused store changed nothing");

        // The `int` subscript a counter the compiler holds as one arrives as:
        // the same three answers -- a slot it has, an append at exactly
        // `length`, and a refusal for anything past it or below zero.
        NtsArrayD.set(d, 0, 7);
        NtsArrayD.set(d, 3, 8);
        check(NtsArrayD.length(d) == 4 && NtsArrayD.get(d, 0) == 7 && NtsArrayD.get(d, 3) == 8, "an int store in range, and an int append at length");
        NtsArrayL.set(l, 3, v);
        NtsArrayZ.set(z, 0, false);
        NtsArrayZ.set(z, 3, true);
        check(NtsArrayL.length(l) == 4 && NtsArrayZ.length(z) == 4 && !NtsArrayZ.get(z, 0) && NtsArrayZ.get(z, 3), "each wrapper's int store");
        for (final int bad : new int[] {5, -1, Integer.MIN_VALUE, Integer.MAX_VALUE}) {
            check(setRefuses(() -> NtsArrayD.set(d, bad, 1)), "NtsArrayD refuses int " + bad);
            check(setRefuses(() -> NtsArrayL.set(l, bad, v)), "NtsArrayL refuses int " + bad);
            check(setRefuses(() -> NtsArrayZ.set(z, bad, true)), "NtsArrayZ refuses int " + bad);
        }
        check(NtsArrayD.length(d) == 4 && NtsArrayL.length(l) == 4 && NtsArrayZ.length(z) == 4, "and a refused int store changed nothing");
    }

    private static void testErasedBigInt() {
        NtsBigInt five = NtsBigInt.fromLong(5);
        NtsValue a = NtsValue.ofBigInt(NtsBigInt.add(NtsBigInt.fromLong(2), NtsBigInt.fromLong(3)));
        NtsValue b = NtsValue.ofBigInt(five);
        NtsValue zero = NtsValue.ofBigInt(NtsBigInt.sub(five, five));
        check(a.tag == NtsValue.BIGINT && NtsValue.BIGINT == 16, "an erased bigint is tag 16");
        equal(NtsValue.tagName(a.tag), "bigint", "typeof 5n");
        equal(NtsValue.valueToString(a), "5", "String(5n)");
        equal(NtsValue.valueInspect(a), "5n", "console.log(5n)");
        check(NtsValue.truthy(a), "5n is truthy");
        check(!NtsValue.truthy(zero), "0n is falsy");
        check(a.ref != b.ref && NtsValue.strictEq(a, b), "two separately computed 5n are ===");
        check(!NtsValue.strictEq(a, zero), "5n !== 0n");
        check(!NtsValue.strictEq(a, NtsValue.ofNumber(5)), "5n !== 5");
        check(NtsValue.valueToNumberExplicit(a) == 5.0, "Number(5n) is 5");
        boolean refused = false;
        try { NtsValue.valueToNumber(a); } catch (NtsRefusal e) { refused = e.getMessage().startsWith("nts: refused at run time: "); }
        check(refused, "+5n is refused, not NaN");
        check(NtsValue.ofReference(five).tag == NtsValue.BIGINT, "a bare NtsBigInt tags 16");
        check(!NtsValue.isArray(a), "a bigint is not an array");
        NtsMap map = NtsMap.newMap(0);
        map = NtsMap.set(map, a, NtsValue.ofString("five"));
        equal(NtsTable.get(map, b).ref, "five", "a Map keyed by 5n finds a separately computed 5n");
        check(NtsTable.hasObject(map, NtsBigInt.fromLong(5)), "and so does a bare-reference lookup");
        check(!NtsTable.has(map, zero), "0n is a different key");
        NtsArrayL held = NtsArrayL.of(0);
        NtsArrayL.push(held, five);
        check(NtsValue.arrayElement(NtsValue.ofObject(held), 0, NtsValue.UNDEFINED).tag == NtsValue.BIGINT, "an NtsBigInt element reads back tag 16");
    }

    /** `compareString` against ECMA-262 StringToBigInt, and exact past 2^53 and past 128 bits. */
    private static void testBigIntCompareString() {
        NtsBigInt big = NtsBigInt.fromLong(9007199254740993L);
        check(NtsBigInt.compareString(big, "9007199254740992") == 1, "2^53+1 > \"2^53\" exactly");
        check(NtsBigInt.compareString(big, "9007199254740993") == 0, "2^53+1 == \"2^53+1\"");
        check(NtsBigInt.compareString(big, "9007199254740994") == -1, "2^53+1 < \"2^53+2\"");
        String huge = "1" + "0".repeat(60);
        NtsBigInt max = NtsBigInt.of(Long.MAX_VALUE, -1L);
        check(NtsBigInt.compareString(max, huge) == -1, "2^127-1 < 10^60");
        check(NtsBigInt.compareString(max, "-" + huge) == 1, "2^127-1 > -10^60");
        NtsBigInt five = NtsBigInt.fromLong(5);
        String[][] cases = {
            {"", "1"}, {"   ", "1"}, {" \t\n\u00a0\ufeff\u2028\u3000 5 \r", "0"}, {"+5", "0"}, {"-5", "1"},
            {"0x5", "0"}, {"0X05", "0"}, {"0o7", "-1"}, {"0b101", "0"}, {"0B110", "-1"}, {"6", "-1"}, {"4", "1"},
        };
        for (String[] c : cases) {
            check(NtsBigInt.compareString(five, c[0]) == Double.parseDouble(c[1]), "compareString(5n, " + c[0].replace("\n", "\\n") + ")");
        }
        String[] invalid = {"0.", "5.0", "1e3", "5n", "1_000", "-0x5", "+0x5", "0x", "0b2", "0o8", "+", "-", "abc", "5 5", "\u0665"};
        for (String bad : invalid) {
            check(Double.isNaN(NtsBigInt.compareString(five, bad)), "compareString(5n, " + bad + ") is NaN");
        }
        Random random = new Random(0x5EED5);
        for (int round = 0; round < 5000; ++round) {
            NtsBigInt a = NtsBigInt.of(random.nextLong(), random.nextLong());
            BigInteger b = new BigInteger(130, random).subtract(BigInteger.ONE.shiftLeft(129));
            int radix = new int[] {2, 8, 10, 16}[round % 4];
            String text = radix == 10 ? b.toString() : (b.signum() < 0 ? null : (radix == 16 ? "0x" : radix == 8 ? "0o" : "0b") + b.toString(radix));
            if (text == null) { continue; }
            check(NtsBigInt.compareString(a, text) == wide(a).compareTo(b), "compareString random " + radix);
        }
    }

    /**
     * The boundaries C's checked operations stop at, each beside one that fits:
     * the quotient and negation of -2^127, a left shift into the sign bit, and a
     * power on either side of 128 bits. A power never stops on a square that no
     * later bit uses.
     */
    private static void testBigIntPastBits() {
        BigInteger two = BigInteger.valueOf(2);
        NtsBigInt min = NtsBigInt.fromBigInteger(MIN128), max = NtsBigInt.fromBigInteger(MAX128);
        NtsBigInt one = NtsBigInt.fromLong(1), minusOne = NtsBigInt.fromLong(-1);
        exact(() -> NtsBigInt.div(min, minusOne), MIN128.negate(), "-2^127 / -1");
        exact(() -> NtsBigInt.rem(min, minusOne), BigInteger.ZERO, "-2^127 % -1");
        exact(() -> NtsBigInt.div(min, one), MIN128, "-2^127 / 1");
        exact(() -> NtsBigInt.neg(min), MIN128.negate(), "-(-2^127)");
        exact(() -> NtsBigInt.neg(max), MAX128.negate(), "-(2^127 - 1)");
        exact(() -> NtsBigInt.add(max, one), MAX128.add(BigInteger.ONE), "2^127 - 1 + 1");
        exact(() -> NtsBigInt.sub(min, one), MIN128.subtract(BigInteger.ONE), "-2^127 - 1");
        exact(() -> NtsBigInt.mul(NtsBigInt.fromBigInteger(two.pow(63)), NtsBigInt.fromBigInteger(two.pow(64).negate())),
            two.pow(127).negate(), "2^63 * -2^64");
        exact(() -> NtsBigInt.mul(NtsBigInt.fromBigInteger(two.pow(63)), NtsBigInt.fromBigInteger(two.pow(64))),
            two.pow(127), "2^63 * 2^64");
        exact(() -> NtsBigInt.shl(one, NtsBigInt.fromLong(126)), two.pow(126), "1 << 126");
        exact(() -> NtsBigInt.shl(one, NtsBigInt.fromLong(127)), two.pow(127), "1 << 127");
        exact(() -> NtsBigInt.shl(minusOne, NtsBigInt.fromLong(127)), MIN128, "-1 << 127");
        exact(() -> NtsBigInt.shl(NtsBigInt.ZERO, NtsBigInt.fromLong(500)), BigInteger.ZERO, "0 << 500");
        exact(() -> NtsBigInt.shr(one, NtsBigInt.fromLong(-127)), two.pow(127), "1 >> -127");
        exact(() -> NtsBigInt.shr(one, NtsBigInt.fromLong(-126)), two.pow(126), "1 >> -126");
        int[][] powers = {{2, 126}, {2, 127}, {-2, 127}, {-2, 128}, {3, 80}, {3, 81}, {0, 200}, {1, 999}, {-1, 201}, {-1, 200}, {7, 0}, {0, 0}};
        for (int[] p : powers) {
            exact(() -> NtsBigInt.pow(NtsBigInt.fromLong(p[0]), NtsBigInt.fromLong(p[1])), BigInteger.valueOf(p[0]).pow(p[1]),
                p[0] + " ** " + p[1]);
        }
        exact(() -> NtsBigInt.pow(NtsBigInt.fromLong(2), NtsBigInt.fromBigInteger(two.pow(100))), two.pow(200), "2 ** 2^100");
        exact(() -> NtsBigInt.pow(minusOne, NtsBigInt.fromBigInteger(two.pow(100).add(BigInteger.ONE))), BigInteger.ONE.negate(),
            "-1 ** (2^100 + 1)");
        // asUintN past signed 128 bits: a negative value at width 128 or more.
        BigInteger pow128 = two.pow(128);
        exact(() -> NtsBigInt.asUintN(127, minusOne), two.pow(127).subtract(BigInteger.ONE), "asUintN(127, -1)");
        exact(() -> NtsBigInt.asUintN(128, minusOne), pow128.subtract(BigInteger.ONE), "asUintN(128, -1)");
        exact(() -> NtsBigInt.asUintN(200, minusOne), two.pow(200).subtract(BigInteger.ONE), "asUintN(200, -1)");
        exact(() -> NtsBigInt.asUintN(128, max), MAX128, "asUintN(128, 2^127 - 1)");
        exact(() -> NtsBigInt.asUintN(200, max), MAX128, "asUintN(200, 2^127 - 1)");
        exact(() -> NtsBigInt.asUintN(127, min), BigInteger.ZERO, "asUintN(127, -2^127)");
        String said = null;
        try { NtsBigInt.overflow(); } catch (NtsRefusal stopped) { said = stopped.getMessage(); }
        equal(said, "nts: refused at run time: a bigint past 128 bits, which this runtime does not hold", "overflow() is C's nts_bigint_overflow");
    }

    private static void testBigInt() {
        Random random = new Random(0x1234ABCD);
        long[] edges = {0, 1, -1, Long.MIN_VALUE, Long.MAX_VALUE, 0xffffffffL, 0x100000000L};
        for (int round = 0; round < 30000; ++round) {
            NtsBigInt a = round < edges.length * edges.length
                ? NtsBigInt.of(edges[round / edges.length], edges[round % edges.length])
                : NtsBigInt.of(random.nextLong(), random.nextLong());
            NtsBigInt b = round % 5 == 0 ? NtsBigInt.fromLong(random.nextInt())
                : NtsBigInt.of(random.nextLong(), random.nextLong());
            BigInteger aa = wide(a), bb = wide(b);
            exact(() -> NtsBigInt.add(a, b), aa.add(bb), "add");
            exact(() -> NtsBigInt.sub(a, b), aa.subtract(bb), "sub");
            exact(() -> NtsBigInt.neg(a), aa.negate(), "neg");
            exact(() -> NtsBigInt.mul(a, b), aa.multiply(bb), "mul");
            bigint(NtsBigInt.and(a, b), aa.and(bb), "and");
            bigint(NtsBigInt.or(a, b), aa.or(bb), "or");
            bigint(NtsBigInt.xor(a, b), aa.xor(bb), "xor");
            check(Integer.signum(NtsBigInt.compare(a, b)) == aa.compareTo(bb), "compare");
            check(NtsBigInt.eq(a, b) == aa.equals(bb), "eq");
            if (bb.signum() != 0) {
                exact(() -> NtsBigInt.div(a, b), aa.divide(bb), "div");
                exact(() -> NtsBigInt.rem(a, b), aa.remainder(bb), "rem");
            }
            equal(NtsBigInt.toText(a), aa.toString(), "decimal bigint");
            equal(NtsBigInt.toBigInteger(a), aa, "BigInteger adapter");
            bigint(NtsBigInt.fromBigInteger(aa.shiftLeft(75).add(bb)), aa.shiftLeft(75).add(bb), "truncate adapter");
            number(NtsBigInt.toNumber(a), aa.doubleValue(), "bigint -> double");
            double converted = aa.doubleValue();
            if (converted >= -0x1p127 && converted < 0x1p127) {
                bigint(NtsBigInt.fromNumber(converted), new BigDecimal(converted).toBigInteger(), "double -> bigint");
            }
            int shift = random.nextInt(401) - 200;
            exact(() -> NtsBigInt.shl(a, NtsBigInt.fromLong(shift)), aa.shiftLeft(shift), "shl");
            exact(() -> NtsBigInt.shr(a, NtsBigInt.fromLong(shift)), aa.shiftRight(shift), "shr");
            int first = round < 150 ? 0 : random.nextInt(129);
            int last = round < 150 ? 128 : first;
            for (int n = first; n <= last; ++n) {
                BigInteger low = aa.and(BigInteger.ONE.shiftLeft(n).subtract(BigInteger.ONE));
                final int width = n;
                exact(() -> NtsBigInt.asUintN(width, a), low, "asUintN " + n);
                BigInteger signed = n > 0 && low.testBit(n - 1) ? low.subtract(BigInteger.ONE.shiftLeft(n)) : low;
                bigint(NtsBigInt.asIntN(n, a), signed, "asIntN " + n);
            }
        }
        // Denominators spanning 32..96 bits exercise long quotient loops, not
        // just the common random-128/random-128 quotient of zero or one.
        for (int i = 0; i < 12000; ++i) {
            BigInteger aa = new BigInteger(128, random);
            if (random.nextBoolean()) { aa = aa.negate(); }
            aa = wrap(aa);
            BigInteger bb = new BigInteger(32 + random.nextInt(65), random).add(BigInteger.ONE);
            if (random.nextBoolean()) { bb = bb.negate(); }
            NtsBigInt a = NtsBigInt.fromBigInteger(aa), b = NtsBigInt.fromBigInteger(bb);
            bigint(NtsBigInt.div(a, b), aa.divide(bb), "narrow denominator quotient");
            bigint(NtsBigInt.rem(a, b), aa.remainder(bb), "narrow denominator remainder");
            a = NtsBigInt.of(0, random.nextLong());
            b = NtsBigInt.of(0, random.nextLong() | 1L);
            bigint(NtsBigInt.div(a, b), wide(a).divide(wide(b)), "unsigned 64 quotient");
            bigint(NtsBigInt.rem(a, b), wide(a).remainder(wide(b)), "unsigned 64 remainder");
        }
        for (int shift = 1; shift <= 75; ++shift) {
            for (long top : new long[] {0x10000000000000L, 0x10000000000001L, 0x1fffffffffffffL}) {
                BigInteger center = BigInteger.valueOf(top).shiftLeft(shift)
                    .add(BigInteger.ONE.shiftLeft(shift - 1));
                for (int delta = -1; delta <= 1; ++delta) {
                    BigInteger exact = wrap(center.add(BigInteger.valueOf(delta)));
                    number(NtsBigInt.toNumber(NtsBigInt.fromBigInteger(exact)), exact.doubleValue(), "round-to-even boundary");
                    exact = wrap(exact.negate());
                    number(NtsBigInt.toNumber(NtsBigInt.fromBigInteger(exact)), exact.doubleValue(), "negative round-to-even boundary");
                }
            }
        }
        exact(() -> NtsBigInt.div(NtsBigInt.fromLong(Long.MIN_VALUE), NtsBigInt.fromLong(-1)), TWO64.shiftRight(1), "long overflow divide");
        exact(() -> NtsBigInt.div(NtsBigInt.of(Long.MIN_VALUE, 0), NtsBigInt.fromLong(-1)), TWO128.shiftRight(1), "128 overflow divide stops");
        bigint(NtsBigInt.fromNumber(-0x1p127), BigInteger.ONE.shiftLeft(127).negate(), "minimum fromNumber");
        for (double bad : new double[] {Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, 0.5, 0x1p127, -0x1.0000000000001p127}) {
            boolean refused = false;
            try { NtsBigInt.fromNumber(bad); } catch (NtsRefusal expected) { refused = true; }
            check(refused, "invalid bigint conversion");
        }
        try { NtsBigInt.div(NtsBigInt.ZERO, NtsBigInt.ZERO); throw new AssertionError("division by zero"); }
        catch (ArithmeticException expected) { ++checks; }
    }
    private static boolean svz(NtsValue a, NtsValue b) {
        if (a.tag != b.tag) { return false; }
        switch (a.tag) {
            case NtsValue.UNDEFINED: case NtsValue.NULL: return true;
            case NtsValue.NUMBER: return a.num == b.num || (Double.isNaN(a.num) && Double.isNaN(b.num));
            case NtsValue.BOOLEAN: return (a.num != 0) == (b.num != 0);
            case NtsValue.STRING: return a.ref.equals(b.ref);
            default: return a.ref == b.ref;
        }
    }
    private static final class Deceptive {
        @Override public int hashCode() { return 1; }
        @Override public boolean equals(Object other) { return other instanceof Deceptive; }
    }
    private static final class Entry {
        final NtsValue key;
        NtsValue value;
        final int cursor;
        Entry(NtsValue key, NtsValue value, int cursor) { this.key = key; this.value = value; this.cursor = cursor; }
    }
    private static void testMap() throws Exception {
        Random random = new Random(456789);
        List<NtsValue> keys = new ArrayList<NtsValue>();
        for (int i = 0; i < 256; ++i) {
            keys.add(NtsValue.ofNumber(i));
            StringBuilder collision = new StringBuilder();
            for (int bit = 0; bit < 8; ++bit) { collision.append((i & (1 << bit)) == 0 ? "Aa" : "BB"); }
            keys.add(NtsValue.ofString(collision.toString()));
            keys.add(NtsValue.ofObject(new Deceptive()));
        }
        keys.add(NtsValue.ofNumber(-0.0)); keys.add(NtsValue.ofNumber(Double.NaN));
        keys.add(NtsValue.ofNumber(Double.longBitsToDouble(0xfff80000000000ffL)));
        keys.add(NtsValue.ofNumber(Double.NEGATIVE_INFINITY)); keys.add(NtsValue.ofNumber(Double.POSITIVE_INFINITY));
        keys.add(NtsValue.UNDEFINED_VALUE); keys.add(NtsValue.ABSENT_NUMBER); keys.add(NtsValue.NULL_VALUE);
        keys.add(NtsValue.ofBoolean(true)); keys.add(NtsValue.ofBoolean(false));
        keys.add(NtsValue.ofString(new String("AaAaAaAaAaAaAaAa")));
        keys.add(NtsValue.ofObject(new String("AaAaAaAaAaAaAaAa")));
        NtsMap map = NtsMap.newMap(0);
        List<Entry> entries = new ArrayList<Entry>();
        int used = 0;
        for (int round = 0; round < 60000; ++round) {
            NtsValue key = keys.get(random.nextInt(keys.size()));
            int hit = -1;
            for (int i = 0; i < entries.size(); ++i) { if (svz(entries.get(i).key, key)) { hit = i; break; } }
            int action = random.nextInt(100);
            if (action < 47) {
                NtsValue value = keys.get(random.nextInt(keys.size()));
                check(NtsMap.set(map, key, value) == map, "set returns map");
                if (hit >= 0) { entries.get(hit).value = value; }
                else { entries.add(new Entry(key, value, used++)); }
            } else if (action < 70) {
                check(NtsMap.delete(map, key) == (hit >= 0), "delete result");
                if (hit >= 0) {
                    Entry removed = entries.remove(hit);
                    check(NtsMap.keyAtI(map, removed.cursor) == NtsValue.UNDEFINED_VALUE, "dead cursor");
                }
            } else if (action == 99) { NtsMap.clear(map); entries.clear(); }
            else {
                check(NtsMap.has(map, key) == (hit >= 0), "has");
                check(NtsMap.get(map, key) == (hit < 0 ? NtsValue.UNDEFINED_VALUE : entries.get(hit).value), "get");
            }
            check(NtsMap.size(map) == entries.size(), "map size");
            if (round % 23 == 0) {
                int cursor = 0;
                for (Entry entry : entries) {
                    cursor = NtsMap.nextI(map, cursor);
                    check(cursor == entry.cursor, "stable cursor position");
                    NtsValue got = NtsMap.keyAtI(map, cursor);
                    check(svz(got, entry.key), "iteration key");
                    if (got.tag == NtsValue.NUMBER && got.num == 0) { number(got.num, 0.0, "canonical zero"); }
                    check(NtsMap.valueAtI(map, cursor) == entry.value, "iteration value");
                    ++cursor;
                }
                check(NtsMap.nextI(map, cursor) == -1, "iteration exhausted");
            }
        }
        // Clear and prefix recycling must preserve cursors without growing historical storage.
        map = NtsMap.newMap(0);
        for (int i = 0; i < 100000; ++i) {
            NtsMap.set(map, keys.get(0), keys.get(1));
            check(NtsMap.nextI(map, i) == i, "clear cursor");
            NtsMap.clear(map);
        }
        // `NtsTable`, not `NtsMap`: the storage moved to the shared base when
        // `Set` became its own class. `getDeclaredField` does not search
        // superclasses, so this threw rather than silently reading something
        // else -- the failure mode worth having.
        java.lang.reflect.Field storage = NtsTable.class.getDeclaredField("keys"); storage.setAccessible(true);
        check(((Object[]) storage.get(map)).length <= 8, "clear storage bounded");
        map = NtsMap.newMap(0);
        for (int i = 0; i < 80; ++i) { NtsMap.set(map, keys.get(i), keys.get(i)); }
        for (int i = 0; i < 2000; ++i) {
            NtsMap.delete(map, keys.get(i % 80));
            NtsMap.set(map, keys.get(i % 80), keys.get(i % 80));
        }
        check(((Object[]) storage.get(map)).length <= 256, "prefix storage bounded");
        int cursor = NtsMap.nextI(map, 0);
        NtsMap.clear(map);
        NtsMap.set(map, keys.get(300), keys.get(301));
        check(NtsMap.nextI(map, cursor + 1) > cursor, "append after clear visible");
        NtsSet set = NtsSet.newSet(0);
        NtsSet.add(set, NtsValue.ofNumber(-0.0));
        number(NtsTable.keyAtI(set, 0).num, 0.0, "set key +0");
        number(NtsTable.valueAtI(set, 0).num, 0.0, "set value +0");
        // The split is the point of these four: a Set is a `java.util.Set` and
        // is not a `java.util.Map`, which is what a Java caller sees.
        check(set instanceof java.util.Set, "a Set is a java.util.Set");
        // Through `Object`, because `set instanceof java.util.Map` does not
        // compile: javac proves an `NtsSet` can never be one. That refusal is
        // better evidence than this assertion and cannot be written down, so
        // the assertion stands in for it.
        Object asObject = set;
        check(!(asObject instanceof java.util.Map), "a Set is not a java.util.Map");
        check(NtsValue.isSet(NtsValue.ofObject(set)), "isSet");
        check(!NtsValue.isMap(NtsValue.ofObject(set)), "a Set is not a Map");
    }
    /** Cursor sentinels and the absolute insertion bound, without allocating a huge table. */
    private static void testMapCursorDomain() throws Exception {
        java.lang.reflect.Field base = NtsTable.class.getDeclaredField("base");
        base.setAccessible(true);
        java.lang.reflect.Field limit = NtsTable.class.getDeclaredField("MAX_ARRAY");
        limit.setAccessible(true);
        int maximum = limit.getInt(null);
        check(maximum > 4 && maximum <= Integer.MAX_VALUE - 1, "cursor cap fits core MAX_LENGTH");
        for (NtsTable table : new NtsTable[] {NtsMap.newMap(0), NtsSet.newSet(0)}) {
            NtsValue[] keys = {
                NtsValue.ofNumber(10), NtsValue.ofNumber(11),
                NtsValue.ofNumber(12), NtsValue.ofNumber(13)
            };
            for (NtsValue key : keys) { NtsTable.insert(table, key, key); }
            check(NtsTable.nextI(table, -1) == -1, "negative cursor does not restart a live walk");
            check(NtsTable.nextI(table, Integer.MIN_VALUE) == -1, "minimum cursor is exhausted");
            check(NtsTable.keyAtI(table, -1) == NtsValue.UNDEFINED_VALUE, "negative key cursor");
            check(NtsTable.valueAtI(table, -1) == NtsValue.UNDEFINED_VALUE, "negative value cursor");
            check(NtsTable.nextI(table, Integer.MAX_VALUE) == -1, "cursor past the table");
            check(NtsTable.keyAtI(table, Integer.MAX_VALUE) == NtsValue.UNDEFINED_VALUE, "key past the table");
            check(NtsTable.valueAtI(table, Integer.MAX_VALUE) == NtsValue.UNDEFINED_VALUE, "value past the table");

            // Model the last four insertion positions; the same storage can
            // reach this base through repeated clear and prefix reclamation.
            base.setInt(table, maximum - 4);
            check(NtsTable.delete(table, keys[0]), "retire first cursor at cap");
            check(NtsTable.delete(table, keys[1]), "retire second cursor at cap");
            int cursor = NtsTable.nextI(table, 0);
            check(cursor == maximum - 2, "walk returns an absolute cursor after retired prefix");
            check(NtsTable.keyAtI(table, cursor) == keys[2], "absolute key at cap");
            check(NtsTable.valueAtI(table, cursor) == keys[2], "absolute value at cap");
            check(NtsTable.nextI(table, cursor + 1) == maximum - 1, "last cursor stays below cap");
            check(NtsTable.nextI(table, maximum) == -1, "last cursor successor is exhausted");
            check(NtsTable.keyAtI(table, maximum - 4) == NtsValue.UNDEFINED_VALUE, "retired absolute key");
            check(NtsTable.valueAtI(table, maximum - 4) == NtsValue.UNDEFINED_VALUE, "retired absolute value");
            NtsTable.insert(table, keys[3], keys[3]);
            check(NtsTable.size(table) == 2, "replacement at cap needs no new cursor");
            for (int cleared = 0; cleared < 2; ++cleared) {
                try {
                    NtsTable.insert(table, NtsValue.ofNumber(99), NtsValue.NULL_VALUE);
                    throw new AssertionError("absolute cursor exhaustion must fail allocation");
                } catch (OutOfMemoryError expected) {
                    equal(expected.getMessage(), "map insertion cursor space exhausted", "cursor allocation failure path");
                }
                check(NtsRuntime.raising() == 0, "cursor exhaustion creates no language raise");
                if (cleared == 0) {
                    check(NtsTable.nextI(table, 0) == maximum - 2, "failed insert preserves live cursors");
                    check(NtsTable.valueAtI(table, maximum - 1) == keys[3], "failed insert preserves last value");
                    NtsTable.clear(table);
                    check(base.getInt(table) == maximum, "clear advances absolute base to cap");
                    check(NtsTable.nextI(table, 0) == -1, "cleared table has no cursor");
                    check(NtsTable.keyAtI(table, maximum - 1) == NtsValue.UNDEFINED_VALUE, "clear retires old key");
                    check(NtsTable.valueAtI(table, maximum - 1) == NtsValue.UNDEFINED_VALUE, "clear retires old value");
                }
            }
        }
    }
    private static int oldClamp(double x, int length) {
        double at = Double.isNaN(x) ? 0 : x < 0 ? Math.ceil(x) : Math.floor(x);
        if (at < 0) { at += length; }
        return at < 0 ? 0 : at >= length ? length : (int) at;
    }
    private static int oldOffset(double x, int length) {
        double at = Double.isNaN(x) ? 0 : x < 0 ? Math.ceil(x) : Math.floor(x);
        if (at < 0) { at += length; }
        return at < 0 || at >= length ? -1 : (int) at;
    }
    private static int oldInt32(double x) {
        if (Double.isNaN(x) || Double.isInfinite(x)) { return 0; }
        double whole = x < 0 ? Math.ceil(x) : Math.floor(x);
        double wrapped = whole % 4294967296.0;
        if (wrapped < 0) { wrapped += 4294967296.0; }
        return (int) (long) wrapped;
    }
    private static void testNumbersAndIndices() {
        Random random = new Random(834926);
        for (int i = 0; i < 1000000; ++i) {
            double x = Double.longBitsToDouble(random.nextLong());
            check(NtsRuntime.toInt32(x) == oldInt32(x), "ToInt32");
            int length = random.nextInt(Integer.MAX_VALUE);
            check(NtsArrays.clamp(x, length) == oldClamp(x, length), "clamp");
            check(NtsArrays.offset(x, length) == oldOffset(x, length), "offset");
        }
        for (double x : new double[] {Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, -0.5, -1.5, 2147483648.0, -2147483649.0}) {
            for (int length : new int[] {0, 1, 10, Integer.MAX_VALUE}) {
                check(NtsArrays.clamp(x, length) == oldClamp(x, length), "edge clamp");
                check(NtsArrays.offset(x, length) == oldOffset(x, length), "edge offset");
            }
        }
        number(NtsRuntime.round(-0.4), -0.0, "round negative zero");
        number(NtsRuntime.round(0.49999999999999994), 0.0, "round near half");
        number(NtsRuntime.trunc(-0.4), -0.0, "trunc negative zero");
        check(!NtsValue.strictEq(NtsValue.ofNumber(Double.NaN), NtsValue.ofNumber(Double.NaN)), "NaN strict equality");
        check(NtsValue.strictEq(NtsValue.ofNumber(-0.0), NtsValue.ofNumber(0.0)), "zero strict equality");
    }
    /**
     * `Number.prototype.toString(radix)` truncates the radix toward zero before using it, so a
     * fractional radix answers what its integer does. Each fractional case beside its integer, both
     * as node prints them: 10.9 is ten (`ToString`), 2.5 and 3.7 run the digit loop at 2 and 3.
     */
    private static void testRadixTruncates() {
        Object[][] cases = {
            {15.0, 2.5, "1111"}, {15.0, 2.0, "1111"},
            {255.5, 10.9, "255.5"}, {255.5, 10.0, "255.5"},
            {35.0, 36.5, "z"}, {35.0, 36.0, "z"},
            {0.1, 2.5, "0.0001100110011001100110011001100110011001100110011001101"},
            {0.1, 2.0, "0.0001100110011001100110011001100110011001100110011001101"},
            {-7.25, 2.5, "-111.01"},
            {1e21, 3.7, "100010202110111202020110202012022200000000000"},
            {123.456, 16.9, "7b.74bc6a7ef9dc"}, {123.456, 16.0, "7b.74bc6a7ef9dc"},
        };
        for (Object[] c : cases) {
            equal(NtsRuntime.numberToStringRadix((Double) c[0], (Double) c[1]), c[2],
                "(" + c[0] + ").toString(" + c[1] + ")");
        }
    }
    private static void testArraysAndStrings() {
        Random random = new Random(725389);
        NtsArrayD a = NtsArrayD.empty();
        List<Double> model = new ArrayList<Double>();
        for (int round = 0; round < 15000; ++round) {
            double value = random.nextInt(1000);
            int operation = random.nextInt(8);
            if (operation == 0) { NtsArrayD.push(a, value); model.add(value); }
            else if (operation == 1) { NtsArrayD.unshift(a, value); model.add(0, value); }
            else if (operation == 2 && !model.isEmpty()) { number(NtsArrayD.pop(a), model.remove(model.size() - 1), "pop"); }
            else if (operation == 3 && !model.isEmpty()) { number(NtsArrayD.shift(a), model.remove(0), "shift"); }
            else if (operation == 4) { NtsArrayD.reverse(a); Collections.reverse(model); }
            else if (operation == 5) {
                // A checked store writes a slot it has or appends exactly at
                // `length`; past the end it refuses and changes nothing. The
                // model used to zero-fill the gap, which pinned the silent
                // wrong answer `set` gave (a hole read 0 where node says
                // undefined); `nts_append_slot` aborts there.
                int at = random.nextInt(60);
                if (at <= model.size()) {
                    NtsArrayD.set(a, at, value);
                    if (at == model.size()) { model.add(value); } else { model.set(at, value); }
                } else {
                    boolean refused = false;
                    try { NtsArrayD.set(a, at, value); } catch (NtsRefusal expected) { refused = true; }
                    check(refused && a.length == model.size(), "a store past the end refuses and changes nothing");
                }
            } else if (operation == 6) {
                int at = random.nextInt(80) - 40, count = random.nextInt(30);
                int start = oldClamp(at, model.size()), n = Math.min(count, model.size() - start);
                NtsArrayD removed = NtsArrayD.splice(a, at, count);
                check(removed.length == n, "splice length");
                for (int i = 0; i < n; ++i) { number(removed.items[i], model.remove(start), "splice element"); }
            } else if (operation == 7) {
                int keep = random.nextInt(50);
                NtsArrayD.keepFirst(a, keep);
                while (model.size() > keep) { model.remove(model.size() - 1); }
            }
            check(a.length == model.size(), "array length");
            for (int i = 0; i < a.length; ++i) { number(a.items[i], model.get(i), "array content"); }
        }
        a = NtsArrayD.empty(); NtsArrayD.push(a, Double.NaN); NtsArrayD.push(a, -0.0);
        check(NtsArrayD.includes(a, Double.NaN), "includes NaN");
        check(NtsArrayD.indexOf(a, Double.NaN) == -1, "indexOf excludes NaN");
        check(NtsRuntime.arrayIncludes(new double[] {Double.NaN}, Double.NaN), "bare includes NaN");
        check(NtsArrayD.atValue(a, 200) == NtsValue.ABSENT_NUMBER, "numeric absence payload");
        check(Double.isNaN(NtsArrayD.at(a, 200)), "narrow numeric absence");
        NtsArrayD.extend(a, a);
        check(a.length == 4 && Double.isNaN(a.items[2]), "self extend");
        Object[] empty = new Object[0];
        check(NtsRuntime.arraySlice(empty, 0, 0) != NtsRuntime.arraySlice(empty, 0, 0), "empty bare array identity");
        check(NtsArrayD.empty() != NtsArrayD.empty(), "empty wrapper identity");
        NtsArrayL refs = NtsArrayL.empty();
        Object object = new Object(); NtsArrayL.push(refs, object); NtsArrayL.pop(refs);
        check(refs.items[0] == null, "popped reference cleared");
        NtsArrayL.push(refs, new String("test"));
        check(NtsArrayL.indexOfStr(refs, new String("test")) == 0, "string search value");
        check(NtsArrayL.indexOf(refs, new String("test")) == -1, "reference search identity");
        Object[] joined = {NtsValue.NULL_VALUE, NtsValue.UNDEFINED_VALUE, NtsValue.ofNumber(-0.0), "x", null};
        equal(NtsRuntime.arrayJoinStr(joined, ","), ",,0,x,", "boxed absent join");
        NtsArrayZ bools = NtsArrayZ.empty(); NtsArrayZ.push(bools, true); NtsArrayZ.unshift(bools, false);
        equal(NtsArrayZ.joinStr(bools, ","), "false,true", "boolean join");
        check(NtsArrayZ.popValue(bools) == NtsValue.ofBoolean(true), "boolean interning");
        String pair = "x\uD83D\uDE00y";
        check(NtsRuntime.strToWellFormed(pair) == pair, "valid surrogate pair unchanged");
        equal(NtsRuntime.strToWellFormed("\uD800" + pair + "\uDC00"), "\uFFFD" + pair + "\uFFFD", "repair lone surrogates");
        check(NtsRuntime.strIsWellFormed(pair), "isWellFormed");
        equal(Arrays.toString(NtsRuntime.strSplit("a..b.", ".")), "[a, , b, ]", "literal split");
        check(NtsRuntime.strSplit("\uD83D\uDE00", "").length == 2, "UTF16 split");
        equal(NtsRuntime.strPadStart("x", 4, "abcde"), "abcx", "padStart truncation");
        equal(NtsRuntime.strPadEnd("x", 4, "abcde"), "xabc", "padEnd truncation");
        equal(NtsRuntime.strReplace("abc", "b", "$`-$&-$'"), "aa-b-cc", "replacement substitution");
        equal(NtsRuntime.strReplaceAll("ab", "", "-"), "-a-b-", "empty replacement pattern");
        String unchanged = new String("no match");
        check(NtsRuntime.strReplaceAll(unchanged, "xyz", "a") == unchanged, "no-match replacement allocation");
        equal(NtsRuntime.strTrim("\uFEFF\u00A0x\u2000"), "x", "JS whitespace");
    }
    private static NtsResumable record(final StringBuilder out, final String text) {
        return new NtsResumable() { public void resume() { out.append(text); } };
    }
    private static NtsPromise handledPromise() {
        NtsPromise promise = NtsPromise.newPromise();
        NtsPromise.subscribe(promise, new NtsResumable() { public void resume() {} });
        return promise;
    }
    private static void testRejectedValues() {
        NtsValue[] reasons = {
            NtsValue.ofNumber(42.5), NtsValue.ofNumber(-0.0), NtsValue.ofNumber(Double.NaN),
            NtsValue.ofNumber(Double.POSITIVE_INFINITY), NtsValue.ofBoolean(true), NtsValue.ofBoolean(false),
            NtsValue.NULL_VALUE, NtsValue.UNDEFINED_VALUE, NtsValue.ofString(new String("reason")),
            NtsValue.ofReference(new Object()), NtsValue.ofTagged(NtsValue.FUNCTION, new Object()),
            NtsValue.ofReference(NtsSymbol.newSymbol(null)), NtsValue.ofBigInt(NtsBigInt.fromLong(9007199254740993L))
        };
        for (NtsValue reason : reasons) {
            NtsPromise source = handledPromise(), copy = handledPromise(), adopted = handledPromise();
            NtsPromise race = NtsPromise.race(new NtsPromise[] { source });
            NtsPromise all = NtsPromise.all(new NtsPromise[] { source }, new Object[1]);
            NtsPromise.subscribe(race, new NtsResumable() { public void resume() {} });
            NtsPromise.subscribe(all, new NtsResumable() { public void resume() {} });
            NtsPromise.adopt(adopted, source);
            NtsPromise.rejectValue(source, reason);
            NtsPromise.rejectWith(copy, source);
            NtsPromise.fulfillNumber(source, 999);
            NtsPromise.rejectValue(source, NtsValue.UNDEFINED_VALUE);
            NtsEnv.drain(NtsEnv.current());
            for (NtsPromise owner : new NtsPromise[] { source, copy, adopted, race, all }) {
                check(NtsPromise.isRejected(owner), "forwarded rejection state");
                check(NtsPromise.reason(owner) == reason, "forwarded rejection retains exact tag, value and identity");
            }
        }
        NtsPromise missing = handledPromise();
        NtsPromise.reject(missing, null);
        check(NtsPromise.reason(missing) == NtsValue.UNDEFINED_VALUE, "bare null rejection retains undefined meaning");
        NtsPromise fulfilled = NtsPromise.newPromise();
        NtsPromise.fulfillNumber(fulfilled, 17);
        NtsPromise.rejectValue(fulfilled, NtsValue.ofBoolean(false));
        number(NtsPromise.number(fulfilled), 17, "rejection cannot overwrite fulfillment");
        NtsEnv.drain(NtsEnv.current());
    }
    /**
     * `Promise.all` stores each settled value by its values array's kind, bare
     * and in a growable program's wrappers, at its input's index whatever the
     * settlement order. Booleans had no entry (NoSuchMethodError), an erased
     * array stored only the payload (ArrayStoreException on a string), and a
     * growable program had no entry for any kind.
     */
    private static NtsPromise[] pending(int n) {
        NtsPromise[] out = new NtsPromise[n];
        for (int i = 0; i < n; i++) { out[i] = NtsPromise.newPromise(); }
        return out;
    }
    private static NtsArrayL wrapped(NtsPromise[] promises) {
        NtsArrayL out = NtsArrayL.of(promises.length);
        System.arraycopy(promises, 0, out.items, 0, promises.length);
        return out;
    }
    private static void settleKinds(NtsPromise[] numbers, NtsPromise[] booleans, NtsPromise[] references,
                                    NtsPromise[] values, NtsValue text) {
        // Last input first, so an index taken from settlement order would show.
        NtsPromise.fulfillNumber(numbers[1], 2);
        NtsPromise.fulfillNumber(numbers[0], 1);
        NtsPromise.fulfillValue(booleans[1], NtsValue.ofBoolean(false));
        NtsPromise.fulfillNumber(booleans[0], 1);
        NtsPromise.fulfillValue(booleans[2], NtsValue.ofBoolean(true));
        NtsPromise.fulfillReference(references[1], "b");
        NtsPromise.fulfillReference(references[0], "a");
        NtsPromise.fulfillValue(values[2], NtsValue.ofBoolean(true));
        NtsPromise.fulfillValue(values[1], text);
        NtsPromise.fulfillNumber(values[0], 7);
        NtsEnv.drain(NtsEnv.current());
    }
    private static void testPromiseAllKinds() {
        NtsValue text = NtsValue.ofString("s");
        NtsPromise[] numbers = pending(2), booleans = pending(3), references = pending(2), values = pending(3);
        double[] numbered = new double[2];
        boolean[] truths = new boolean[3];
        String[] texts = new String[2];
        NtsValue[] tagged = new NtsValue[3];
        NtsPromise[] all = {
            NtsPromise.all(numbers, numbered), NtsPromise.all(booleans, truths),
            NtsPromise.all(references, texts), NtsPromise.allValues(values, tagged),
        };
        settleKinds(numbers, booleans, references, values, text);
        check(NtsPromise.reference(all[0]) == numbered && numbered[0] == 1 && numbered[1] == 2, "all: numbers by index");
        check(NtsPromise.reference(all[1]) == truths && truths[0] && !truths[1] && truths[2], "all: booleans by truth");
        check(NtsPromise.reference(all[2]) == texts && "a".equals(texts[0]) && "b".equals(texts[1]), "all: references");
        check(NtsPromise.reference(all[3]) == tagged && tagged[0].tag == NtsValue.NUMBER && tagged[0].num == 7
              && tagged[1] == text && tagged[2].tag == NtsValue.BOOLEAN, "allValues: the whole tagged value");

        numbers = pending(2); booleans = pending(3); references = pending(2); values = pending(3);
        NtsArrayD grownNumbers = NtsArrayD.of(2);
        NtsArrayZ grownTruths = NtsArrayZ.of(3);
        NtsArrayL grownTexts = NtsArrayL.of(2), grownTagged = NtsArrayL.ofValues(3);
        all = new NtsPromise[] {
            NtsPromise.all(wrapped(numbers), grownNumbers), NtsPromise.all(wrapped(booleans), grownTruths),
            NtsPromise.all(wrapped(references), grownTexts), NtsPromise.allValues(wrapped(values), grownTagged),
        };
        settleKinds(numbers, booleans, references, values, text);
        check(NtsPromise.reference(all[0]) == grownNumbers && grownNumbers.items[0] == 1 && grownNumbers.items[1] == 2,
              "all: growable numbers resolve with the wrapper");
        check(NtsPromise.reference(all[1]) == grownTruths && grownTruths.items[0] && !grownTruths.items[1]
              && grownTruths.items[2], "all: growable booleans");
        check(NtsPromise.reference(all[2]) == grownTexts && "a".equals(grownTexts.items[0])
              && "b".equals(grownTexts.items[1]), "all: growable references");
        check(NtsPromise.reference(all[3]) == grownTagged && grownTagged.items[1] == text
              && ((NtsValue) grownTagged.items[0]).num == 7, "allValues: growable tagged values");

        NtsArrayD none = NtsArrayD.of(0);
        NtsPromise empty = NtsPromise.all(wrapped(new NtsPromise[0]), none);
        NtsEnv.drain(NtsEnv.current());
        check(NtsPromise.reference(empty) == none, "all: an empty growable group resolves with its wrapper");
    }
    private static void testPromises() {
        testRejectedValues();
        testPromiseAllKinds();
        final StringBuilder out = new StringBuilder();
        NtsPromise p = NtsPromise.newPromise();
        for (int i = 0; i < 100; ++i) { NtsPromise.subscribe(p, record(out, i + ",")); }
        NtsPromise.fulfillNumber(p, 42);
        check(out.length() == 0, "settlement never resumes inline");
        NtsPromise.fulfillNumber(p, 99);
        number(NtsPromise.number(p), 42, "first settlement wins");
        NtsEnv.drain(NtsEnv.current());
        StringBuilder expected = new StringBuilder();
        for (int i = 0; i < 100; ++i) { expected.append(i).append(','); }
        equal(out.toString(), expected.toString(), "waiter FIFO including growth");
        out.setLength(0); NtsPromise.subscribe(p, record(out, "later"));
        check(out.length() == 0, "settled subscribe remains async");
        NtsEnv.drain(NtsEnv.current()); equal(out.toString(), "later", "settled resume");
        NtsPromise a = NtsPromise.newPromise(), b = NtsPromise.newPromise(), c = NtsPromise.newPromise();
        double[] values = new double[4];
        NtsPromise all = NtsPromise.all(new NtsPromise[] {a, b, c, a}, values);
        NtsPromise.fulfillNumber(c, 30); NtsPromise.fulfillNumber(b, 20); NtsEnv.drain(NtsEnv.current());
        check(!NtsPromise.isSettled(all), "all waits for remaining input");
        NtsPromise.fulfillNumber(a, 10); NtsEnv.drain(NtsEnv.current());
        check(NtsPromise.isSettled(all), "all fulfilled");
        equal(Arrays.toString(values), "[10.0, 20.0, 30.0, 10.0]", "all input order and duplicate inputs");
        a = NtsPromise.newPromise(); b = NtsPromise.newPromise();
        Object[] refs = new Object[2];
        all = NtsPromise.all(new NtsPromise[] {a, b}, refs);
        NtsPromise.fulfillTagged(b, "b", NtsValue.STRING); NtsPromise.fulfillTagged(a, "a", NtsValue.STRING); NtsEnv.drain(NtsEnv.current());
        equal(Arrays.toString(refs), "[a, b]", "all references input order");
        a = NtsPromise.newPromise(); b = NtsPromise.newPromise();
        NtsPromise race = NtsPromise.race(new NtsPromise[] {a, b});
        // Handled, as `race(...).catch(() => {})` would be: a rejected race
        // nothing subscribes to is an unhandled rejection, which the
        // checkpoint now reports and ends the process for, as node does.
        NtsPromise.subscribe(race, new NtsResumable() { public void resume() {} });
        NtsPromise.reject(b, "failure"); NtsPromise.fulfillVoid(a); NtsEnv.drain(NtsEnv.current());
        check(NtsPromise.isRejected(race), "race first rejection");
        check(NtsPromise.isSettled(NtsPromise.all(new NtsPromise[0], new double[0])), "empty all fulfilled");
        check(!NtsPromise.isSettled(NtsPromise.race(new NtsPromise[0])), "empty race pending");
        out.setLength(0);
        NtsEnv.tick(NtsEnv.current(), record(out, "T"));
        NtsEnv.microtask(NtsEnv.current(), new NtsResumable() { public void resume() { out.append('M'); NtsEnv.tick(NtsEnv.current(), record(out, "t")); } });
        NtsEnv.microtask(NtsEnv.current(), record(out, "m")); NtsEnv.drain(NtsEnv.current());
        equal(out.toString(), "TMmt", "tick/microtask checkpoint ordering");
    }
    private static void testTimers() {
        Random random = new Random(18374);
        final List<Integer> actual = new ArrayList<Integer>();
        List<int[]> expected = new ArrayList<int[]>();
        double[] ids = new double[5000];
        for (int i = 0; i < ids.length; ++i) {
            final int id = i;
            int delay = random.nextInt(300);
            expected.add(new int[] {delay, i});
            ids[i] = NtsEnv.postDelayed(NtsEnv.current(), new NtsCallback() { public void call() { actual.add(id); } }, delay, false);
        }
        boolean[] cancelled = new boolean[ids.length];
        for (int i = 0; i < 3000; ++i) { int at = random.nextInt(ids.length); NtsEnv.cancelDelayed(NtsEnv.current(), ids[at]); cancelled[at] = true; }
        NtsEnv.cancelDelayed(NtsEnv.current(), Double.NaN); NtsEnv.cancelDelayed(NtsEnv.current(), -1); NtsEnv.cancelDelayed(NtsEnv.current(), 0.5);
        Collections.sort(expected, new Comparator<int[]>() {
            public int compare(int[] a, int[] b) { return a[0] != b[0] ? Integer.compare(a[0], b[0]) : Integer.compare(a[1], b[1]); }
        });
        NtsEnv.drain(NtsEnv.current());
        int position = 0;
        for (int[] entry : expected) { if (!cancelled[entry[1]]) { check(actual.get(position++) == entry[1], "heap timer order"); } }
        check(position == actual.size(), "timer cancellation count");
        final double[] repeatId = new double[1];
        final int[] fired = new int[1];
        repeatId[0] = NtsEnv.postDelayed(NtsEnv.current(), new NtsCallback() {
            public void call() { if (++fired[0] == 10000) { NtsEnv.cancelDelayed(NtsEnv.current(), repeatId[0]); } }
        }, 0, true);
        NtsEnv.drain(NtsEnv.current()); check(fired[0] == 10000, "interval self-cancellation");
        final StringBuilder out = new StringBuilder();
        NtsEnv.postDelayed(NtsEnv.current(), new NtsCallback() { public void call() {
            out.append('A'); NtsEnv.microtask(NtsEnv.current(), record(out, "m"));
            NtsEnv.postDelayed(NtsEnv.current(), new NtsCallback() { public void call() { out.append('C'); } }, 0, false);
        } }, 0, false);
        NtsEnv.postDelayed(NtsEnv.current(), new NtsCallback() { public void call() { out.append('B'); } }, 0, false);
        NtsEnv.drain(NtsEnv.current()); equal(out.toString(), "AmBC", "timer reentrancy and checkpoints");
        check(!NtsEnv.step(NtsEnv.current()), "empty loop");
    }
    /** A generated class whose `toString` is its own; see `NtsPrintable`. */
    private static final class Labelled implements NtsPrintable {
        private final int n;
        Labelled(int n) { this.n = n; }
        @Override public String nts$print() { return "L" + n; }
    }

    /** A generated class that declares none: `String()` of one is `[object Object]`. */
    private static final class Plain implements NtsPrintable {
        @SuppressWarnings("unused") private final int n;
        Plain(int n) { this.n = n; }
        @Override public String nts$print() { return "[object Object]"; }
    }

    /** A generated closure, which prints as a function with no source. */
    private static final class Closure implements NtsPrintable {
        @Override public String nts$print() { return "function () { [native code] }"; }
    }

    /** A tuple: laid out as a struct, called an Array by the language. */
    private static final class Pair implements NtsTuple {
    }

    /**
     * `String(v)` over every tag, and over every array storage the element
     * analysis can choose.
     *
     * <p>**This suite is why the object arm may stay while nothing reaches it.**
     * `spells_itself` refuses `Unknown` again as of `81c5200e`, so no compiled
     * program erases an object into `String()` today -- and an arm that nothing
     * exercises is an arm that rots without anybody hearing, which is the defect
     * `docs/records/0295` is about. These call the runtime directly, so the
     * behaviour is pinned whether or not a lowering can reach it.
     *
     * <p>Every expectation here was taken from node rather than from reasoning:
     * `["L7","[object Object]","1,2,3","a,b","true,false"]` and the rest were
     * printed by `node` and copied.
     */
    private static void testValueToString() {
        equal(NtsValue.valueToString(NtsValue.UNDEFINED_VALUE), "undefined", "undefined");
        equal(NtsValue.valueToString(NtsValue.NULL_VALUE), "null", "null");
        equal(NtsValue.valueToString(NtsValue.ofBoolean(true)), "true", "true");
        equal(NtsValue.valueToString(NtsValue.ofBoolean(false)), "false", "false");
        equal(NtsValue.valueToString(NtsValue.ofString("hi")), "hi", "string");

        // The number goes through the same converter the typed path uses. `%g`
        // spelled the first of these `1.50000` until 2026-09-12.
        equal(NtsValue.valueToString(NtsValue.ofNumber(1.5)), "1.5", "1.5");
        equal(NtsValue.valueToString(NtsValue.ofNumber(2)), "2", "2");
        equal(NtsValue.valueToString(NtsValue.ofNumber(0.1)), "0.1", "0.1");
        equal(NtsValue.valueToString(NtsValue.ofNumber(1e21)), "1e+21", "1e21");
        equal(NtsValue.valueToString(NtsValue.ofNumber(-0.0)), "0", "negative zero");
        equal(NtsValue.valueToString(NtsValue.ofNumber(1.0 / 3)), "0.3333333333333333", "third");
        equal(NtsValue.valueToString(NtsValue.ofNumber(Double.NaN)), "NaN", "NaN");

        // An object that declares `toString`, and one that does not. The second
        // is the case a JVM class cannot answer for itself: `Object.toString`
        // would give an identity hash where node gives `[object Object]`.
        equal(NtsValue.valueToString(NtsValue.ofObject(new Labelled(7))), "L7", "declared toString");
        equal(NtsValue.valueToString(NtsValue.ofObject(new Plain(7))), "[object Object]", "no toString");

        // Every array storage the element analysis can pick, because a chain
        // that covers the ones existing today goes stale on the first new one.
        equal(NtsValue.valueToString(NtsValue.ofObject(new double[] {1, 2, 3})), "1,2,3", "double[]");
        equal(NtsValue.valueToString(NtsValue.ofObject(new int[] {1, 2, 3})), "1,2,3", "int[]");
        equal(NtsValue.valueToString(NtsValue.ofObject(new long[] {1, 2, 3})), "1,2,3", "long[]");
        equal(NtsValue.valueToString(NtsValue.ofObject(new boolean[] {true, false})),
            "true,false", "boolean[]");
        equal(NtsValue.valueToString(NtsValue.ofObject(new Object[] {"a", "b"})), "a,b", "Object[]");
        equal(NtsValue.valueToString(NtsValue.ofObject(new double[] {})), "", "empty array");
        equal(NtsValue.valueToString(NtsValue.ofObject(new double[] {1.5})), "1.5", "fractional element");

        // `join` renders an absent element as the empty string, which is the one
        // place it differs from `String()` of the same value.
        equal(NtsValue.valueToString(NtsValue.ofObject(
            new Object[] {NtsValue.NULL_VALUE, "x", NtsValue.UNDEFINED_VALUE})), ",x,", "absences join empty");
        equal(NtsValue.valueToString(NtsValue.ofObject(
            new Object[] {new double[] {2, 3}, "z"})), "2,3,z", "nested array recurses");

        // A tuple answers true to `Array.isArray` and has named fields rather
        // than a run of elements, so it refuses rather than being joined.
        boolean refusedTuple = false;
        try { NtsValue.valueToString(NtsValue.ofObject(new Pair())); }
        catch (NtsRefusal expected) { refusedTuple = true; }
        check(refusedTuple, "a tuple refuses rather than answering");

        // A function prints as its class says, whichever tag it carries.
        equal(NtsValue.valueToString(NtsValue.ofTagged(NtsValue.FUNCTION, new Closure())),
            "function () { [native code] }", "a function's text");

        // The runtime's own objects, and a dictionary that is not a `Map`.
        equal(NtsValue.valueToString(NtsValue.ofObject(NtsMap.newMap(0))), "[object Map]", "Map");
        equal(NtsValue.valueToString(NtsValue.ofObject(NtsMap.newTable(0))), "[object Object]",
            "a dictionary");
        check(!NtsValue.isMap(NtsValue.ofObject(NtsMap.newTable(0))), "a dictionary is not a Map");
        equal(NtsValue.valueToString(NtsValue.ofObject(NtsSet.newSet(0))), "[object Set]", "Set");

        // An array holding itself prints the inner occurrence as empty, as node's join does.
        Object[] self = new Object[2];
        self[0] = "a";
        self[1] = self;
        equal(NtsValue.valueToString(NtsValue.ofObject(self)), "a,", "an array holding itself");
    }

    /** A compiled printer uses the pending-value protocol, not a Java throw. */
    private static final class PrinterProbe implements NtsPrintable {
        private final String text;
        private final StringBuilder calls;
        private final NtsValue payload;
        boolean fails;

        PrinterProbe(String text, StringBuilder calls, NtsValue payload) {
            this.text = text;
            this.calls = calls;
            this.payload = payload;
        }

        @Override public String nts$print() {
            check(NtsRuntime.raising() == 0, "no printer runs over a pending payload");
            calls.append(text);
            if (fails) {
                NtsRuntime.raise(payload);
                return null;
            }
            return text;
        }
    }

    /** The compiled conversion boundary, after every runtime forwarder returns. */
    private static void takePrinterRaise(String result, NtsValue payload) {
        check(result == null, "a raising printer returns the Java null placeholder");
        check(NtsRuntime.raising() == 1, "runtime forwarders preserve the pending flag");
        check(NtsRuntime.raiseTake() == payload, "the caller takes the original erased value by identity");
        check(NtsRuntime.raising() == 0, "the caller's take clears the pending flag");
    }

    /** Reference and erased elements, each in bare and growable storage. */
    private static Object printerArray(Object[] elements, int storage) {
        if (storage == 0) { return elements; }
        if (storage == 1) {
            NtsValue[] values = new NtsValue[elements.length];
            for (int i = 0; i < elements.length; i++) { values[i] = NtsValue.ofObject(elements[i]); }
            return values;
        }
        NtsArrayL values = storage == 2 ? NtsArrayL.of(elements.length) : NtsArrayL.ofValues(elements.length);
        for (int i = 0; i < elements.length; i++) {
            values.items[i] = storage == 2 ? elements[i] : NtsValue.ofObject(elements[i]);
        }
        return values;
    }

    /** A pending null payload is distinct from the null string placeholder. */
    private static void testPrinterRaises() {
        NtsValue[] payloads = {
            NtsValue.NULL_VALUE, NtsValue.UNDEFINED_VALUE, NtsValue.ofNumber(17),
            NtsValue.ofString("printer payload"), NtsValue.ofObject(new Object())
        };
        for (NtsValue payload : payloads) {
            check(NtsRuntime.raising() == 0, "no raise is pending before a conversion");
            StringBuilder calls = new StringBuilder();
            PrinterProbe direct = new PrinterProbe("t", calls, payload);
            direct.fails = true;
            takePrinterRaise(NtsValue.valueToString(NtsValue.ofObject(direct)), payload);
            equal(calls.toString(), "t", "the object forwarder calls the printer once");

            for (int storage = 0; storage < 4; storage++) {
                for (int nested = 0; nested < 2; nested++) {
                    calls.setLength(0);
                    PrinterProbe prefix = new PrinterProbe("p", calls, payload);
                    PrinterProbe failing = new PrinterProbe("t", calls, payload);
                    PrinterProbe later = new PrinterProbe("l", calls, payload);
                    failing.fails = true;
                    Object array = printerArray(new Object[] {prefix, failing, later}, storage);
                    if (nested != 0) {
                        array = printerArray(new Object[] {
                            new PrinterProbe("o", calls, payload), array,
                            new PrinterProbe("z", calls, payload)
                        }, (storage + 1) % 4);
                    }
                    NtsValue value = NtsValue.ofObject(array);
                    String result = NtsValue.valueToString(value);
                    equal(calls.toString(), nested == 0 ? "pt" : "opt",
                        "a throwing middle printer stops both its array and outer arrays");
                    takePrinterRaise(result, payload);

                    // Reuse exactly the same array identities: an unpopped
                    // JOINING frame would make this conversion return empty.
                    failing.fails = false;
                    calls.setLength(0);
                    equal(NtsValue.valueToString(value), nested == 0 ? "p,t,l" : "o,p,t,l,z",
                        "every join frame is removed before the caller catches");
                    equal(calls.toString(), nested == 0 ? "ptl" : "optlz",
                        "recovery invokes every printer once and in order");
                    check(NtsRuntime.raising() == 0, "a successful recovery leaves no pending raise");
                }
            }
        }
    }

    /**
     * A map key held by reference is the same key whichever reference tag it
     * carries.
     *
     * <p>The fast path tested `tag == OBJECT` where `sameKey`'s own default arm
     * covers `OBJECT`, `FUNCTION` and `SYMBOL` alike, so a `SYMBOL`-tagged key
     * stopped being found by a lookup that had stored it. That became reachable
     * when `hir::tags::of_reference` gained its `Symbol` arm; before it, only
     * one of the three tags could occur.
     */
    private static void testReferenceKeyedTags() {
        for (int tag : new int[] {NtsValue.OBJECT, NtsValue.SYMBOL, NtsValue.FUNCTION}) {
            NtsMap map = NtsMap.newMap(0);
            Object first = new Plain(1);
            Object second = new Plain(2);
            NtsMap.set(map, NtsValue.ofTagged(tag, first), NtsValue.ofNumber(10));
            NtsMap.set(map, NtsValue.ofTagged(tag, second), NtsValue.ofNumber(20));
            check(NtsMap.size(map) == 2, "two references are two keys, tag " + tag);
            // Boxed, and unboxed: the same key found by both routes.
            number(NtsMap.get(map, NtsValue.ofTagged(tag, first)).num, 10, "boxed get, tag " + tag);
            number(NtsMap.getObject(map, first).num, 10, "unboxed get, tag " + tag);
            check(NtsMap.hasObject(map, second), "unboxed has, tag " + tag);
            check(!NtsMap.hasObject(map, new Plain(3)), "a third reference is absent, tag " + tag);
        }
    }

    /**
     * The key in `Cannot read properties of null (reading 'k')`, over every tag.
     *
     * <p>Every expectation was printed by node v24.20.0 from `null[k]` and
     * copied. The two that reasoning gets wrong are `-0`, which is `'0'`, and
     * a long symbol description, which V8 cuts by UTF-16 units and so can
     * split a surrogate pair. An object or a function answers null: the
     * message omits the key rather than run its `toString`.
     */
    private static void testAccessKeyDescription() {
        equal(NtsValue.accessKeyDescription(NtsValue.ofString("abc")), "abc", "string");
        equal(NtsValue.accessKeyDescription(NtsValue.ofString("")), "", "empty string");
        equal(NtsValue.accessKeyDescription(NtsValue.ofNumber(1.5)), "1.5", "1.5");
        equal(NtsValue.accessKeyDescription(NtsValue.ofNumber(-0.0)), "0", "negative zero");
        equal(NtsValue.accessKeyDescription(NtsValue.ofNumber(Double.NaN)), "NaN", "NaN");
        equal(NtsValue.accessKeyDescription(NtsValue.ofNumber(Double.POSITIVE_INFINITY)),
            "Infinity", "Infinity");
        equal(NtsValue.accessKeyDescription(NtsValue.ofNumber(Double.NEGATIVE_INFINITY)),
            "-Infinity", "-Infinity");
        equal(NtsValue.accessKeyDescription(NtsValue.ofNumber(1e21)), "1e+21", "1e21");
        equal(NtsValue.accessKeyDescription(NtsValue.ofNumber(1e-7)), "1e-7", "1e-7");
        equal(NtsValue.accessKeyDescription(NtsValue.ofBigInt(NtsBigInt.fromLong(9007199254740993L))),
            "9007199254740993", "bigint, without its n");
        equal(NtsValue.accessKeyDescription(NtsValue.ofBoolean(true)), "true", "true");
        equal(NtsValue.accessKeyDescription(NtsValue.NULL_VALUE), "null", "null");
        equal(NtsValue.accessKeyDescription(NtsValue.UNDEFINED_VALUE), "undefined", "undefined");

        equal(NtsValue.accessKeyDescription(NtsValue.ofReference(NtsSymbol.newSymbol("desc"))),
            "Symbol(desc)", "symbol");
        equal(NtsValue.accessKeyDescription(NtsValue.ofReference(NtsSymbol.newSymbol(null))),
            "Symbol()", "symbol without a description");
        equal(NtsValue.accessKeyDescription(NtsValue.ofReference(NtsSymbol.newSymbol(""))),
            "Symbol()", "symbol with an empty description");
        String exactly128 = "x".repeat(128);
        equal(NtsValue.accessKeyDescription(NtsValue.ofReference(NtsSymbol.newSymbol(exactly128))),
            "Symbol(" + exactly128 + ")", "128 units is not abbreviated");
        String past128 = "a".repeat(56) + "M".repeat(17) + "z".repeat(56);
        equal(NtsValue.accessKeyDescription(NtsValue.ofReference(NtsSymbol.newSymbol(past128))),
            "Symbol(" + "a".repeat(56) + "...<omitted>..." + "z".repeat(56) + ")",
            "129 units keeps the first and last 56");
        String face = "😀";
        String splitHead = "a".repeat(55) + face + "b".repeat(80);
        equal(NtsValue.accessKeyDescription(NtsValue.ofReference(NtsSymbol.newSymbol(splitHead))),
            "Symbol(" + "a".repeat(55) + "\uD83D...<omitted>..." + "b".repeat(56) + ")",
            "the first cut splits a surrogate pair");
        String splitTail = "b".repeat(80) + face + "z".repeat(55);
        equal(NtsValue.accessKeyDescription(NtsValue.ofReference(NtsSymbol.newSymbol(splitTail))),
            "Symbol(" + "b".repeat(56) + "...<omitted>...\uDE00" + "z".repeat(55) + ")",
            "the last cut splits a surrogate pair");

        equal(NtsValue.accessKeyDescription(NtsValue.ofObject(new Labelled(7))), null,
            "an object with its own toString is not asked");
        equal(NtsValue.accessKeyDescription(NtsValue.ofObject(new Plain(7))), null, "a plain object");
        equal(NtsValue.accessKeyDescription(NtsValue.ofObject(new double[] {1, 2})), null, "an array");
        equal(NtsValue.accessKeyDescription(NtsValue.ofTagged(NtsValue.FUNCTION, new Closure())), null,
            "a function");
    }

    /**
     * `Number(v)` over every tag, against node's answers.
     *
     * <p>The helper is five arms and four of them are one line, which is
     * exactly the shape that gets written from the specification in someone's
     * head. Every expectation below was printed by `node` and copied:
     * `Number("0x10")` is 16 and `Number("")` is 0 are the two that a reading
     * of the rules gets wrong most often.
     */
    private static void testValueToNumber() {
        number(NtsValue.valueToNumber(NtsValue.ofNumber(1.5)), 1.5, "number passes through");
        number(NtsValue.valueToNumber(NtsValue.ofNumber(-0.0)), -0.0, "negative zero is preserved");
        check(Double.isNaN(NtsValue.valueToNumber(NtsValue.ofNumber(Double.NaN))), "NaN passes through");
        number(NtsValue.valueToNumber(NtsValue.ofBoolean(true)), 1.0, "true");
        number(NtsValue.valueToNumber(NtsValue.ofBoolean(false)), 0.0, "false");
        number(NtsValue.valueToNumber(NtsValue.NULL_VALUE), 0.0, "null");
        check(Double.isNaN(NtsValue.valueToNumber(NtsValue.UNDEFINED_VALUE)), "undefined is NaN");
        number(NtsValue.valueToNumber(NtsValue.ofString("17")), 17.0, "decimal string");
        number(NtsValue.valueToNumber(NtsValue.ofString("")), 0.0, "empty string is zero");
        number(NtsValue.valueToNumber(NtsValue.ofString("  12  ")), 12.0, "surrounding space");
        number(NtsValue.valueToNumber(NtsValue.ofString("0x10")), 16.0, "hexadecimal");
        number(NtsValue.valueToNumber(NtsValue.ofString("1e3")), 1000.0, "exponent");
        check(Double.isNaN(NtsValue.valueToNumber(NtsValue.ofString("abc"))), "unparsable string is NaN");
        // Unreachable by construction -- the lowering emits the call only where
        // the checker's type admits no object -- and pinned so the hole stays
        // an answer rather than becoming one.
        check(Double.isNaN(NtsValue.valueToNumber(NtsValue.ofObject(new Plain(1)))), "an object is NaN");
    }


    /**
     * `NtsMap implements java.util.Map`, which is what lets a Java method take
     * one of our maps without a copy.
     *
     * <p>Two things are being checked and only one of them is the interface.
     *
     * <p>**The interesting one is that SameValueZero and Java's `equals` agree
     * on every input.** JS keys by SameValueZero: `NaN` matches `NaN`, and `+0`
     * matches `-0`. `Double.equals(NaN, NaN)` is *true*, which lines up, and
     * `Double.equals(+0.0, -0.0)` is *false*, which does not. The table already
     * normalises `-0` to `+0` at insert so that iteration exposes `+0`, and the
     * consequence -- not obvious until you look for it -- is that the two rules
     * coincide exactly. A Java caller looking up `-0.0` finds what a JS caller
     * stored as `0`.
     *
     * <p>**The other is that the view is a view.** Writing through the static
     * ABI has to be visible through the `Map`, and writing through the `Map`
     * has to be visible to the static ABI, because there is only one table. A
     * copy would pass every other assertion here and fail these two.
     */
    private static void testMapAsJavaMap() {
        NtsMap map = NtsMap.newMap(0);
        java.util.Map<Object, Object> view = map;

        // Written through the compiled-code ABI...
        NtsMap.set(map, NtsValue.ofString("a"), NtsValue.ofNumber(1));
        NtsMap.set(map, NtsValue.ofNumber(0.0), NtsValue.ofString("zero"));
        NtsMap.set(map, NtsValue.ofNumber(Double.NaN), NtsValue.ofString("nan"));

        // ...and read through the Java interface, with no copy in between.
        check(view.size() == 3, "size through the interface");
        equal(view.get("a"), Double.valueOf(1), "string key through the interface");

        // SameValueZero: -0 finds what was stored as +0.
        equal(view.get(Double.valueOf(-0.0)), "zero", "-0 finds the +0 entry");
        check(view.containsKey(Double.valueOf(-0.0)), "containsKey(-0)");
        // And the key it hands back is +0, not the -0 that was asked for.
        boolean sawPositiveZero = false;
        for (Object key : view.keySet()) {
            if (key instanceof Double && ((Double) key).doubleValue() == 0.0) {
                check(Double.doubleToLongBits(((Double) key).doubleValue()) == 0L,
                    "iteration exposes +0, not -0");
                sawPositiveZero = true;
            }
        }
        check(sawPositiveZero, "the zero key was iterated");

        // SameValueZero: NaN matches NaN, where `==` would not.
        equal(view.get(Double.valueOf(Double.NaN)), "nan", "NaN finds the NaN entry");

        // The view is live in both directions.
        view.put("b", Double.valueOf(2));
        check(NtsMap.has(map, NtsValue.ofString("b")), "a Map put is visible to the static ABI");
        NtsMap.set(map, NtsValue.ofString("c"), NtsValue.ofNumber(3));
        equal(view.get("c"), Double.valueOf(3), "a static set is visible through the Map");

        // Insertion order survives, which `HashMap` would not give.
        StringBuilder order = new StringBuilder();
        for (Object key : view.keySet()) {
            if (key instanceof String) { order.append((String) key); }
        }
        equal(order.toString(), "abc", "insertion order through keySet");

        // removal, and entrySet
        equal(view.remove("a"), Double.valueOf(1), "remove returns the previous value");
        check(!view.containsKey("a"), "removed key is gone");
        int entries = 0;
        for (java.util.Map.Entry<Object, Object> entry : view.entrySet()) {
            check(entry.getKey() != null || entry.getValue() != null, "an entry is readable");
            entries++;
        }
        check(entries == view.size(), "entrySet agrees with size");

        // `equals` against a plain HashMap, both ways, without AbstractMap.
        java.util.Map<Object, Object> plain = new java.util.HashMap<Object, Object>();
        for (java.util.Map.Entry<Object, Object> entry : view.entrySet()) {
            plain.put(entry.getKey(), entry.getValue());
        }
        check(view.equals(plain), "equals a HashMap with the same entries");
        check(view.hashCode() == plain.hashCode(), "hashCode matches the Map contract");

        view.clear();
        check(view.isEmpty() && NtsMap.size(map) == 0, "clear through the interface");
    }


    /**
     * A Java callback arriving on a thread we do not own runs on the lane that
     * does.
     *
     * <p>This is the assertion a wrong implementation fails in the one way that
     * matters. Calling the closure directly from the foreign thread would pass
     * every "did the callback happen" check and mutate the lane's heap from
     * outside it -- everything in this runtime except the inbox is confined to
     * one lane, because the inbox is atomic *so that* the rest need not be.
     *
     * <p>So the test records which thread the body ran on and compares it to the
     * thread that posted. They must differ, and the body's thread must be the
     * one that drained.
     */
    private static void testForeignCallbacks() throws Exception {
        final NtsInbox inbox = NtsInbox.withCapacity(4);
        final String lane = Thread.currentThread().getName();
        final String[] ranOn = new String[1];
        final String[] postedFrom = new String[1];
        final double[] got = new double[1];

        Thread foreign = new Thread(new Runnable() {
            @Override
            public void run() {
                postedFrom[0] = Thread.currentThread().getName();
                boolean accepted = NtsForeign.postNumber(inbox, new NtsNumberCallback() {
                    @Override
                    public void call(double value) {
                        ranOn[0] = Thread.currentThread().getName();
                        got[0] = value;
                    }
                }, 42.0);
                check(accepted, "a post below the ceiling is accepted");
            }
        }, "foreign-lane");
        foreign.start();
        foreign.join();

        // Nothing has run yet: posting is not calling.
        check(ranOn[0] == null, "the callback does not run on the posting thread");

        int drained = NtsInbox.drain(inbox);
        check(drained == 1, "one completion drained, got " + drained);
        number(got[0], 42.0, "the captured argument arrives");
        equal(ranOn[0], lane, "the body runs on the draining lane");
        check(!lane.equals(postedFrom[0]), "and the posting thread was a different one");

        // Backpressure: `reserve` answers null at the ceiling, which is the only
        // place it can be applied "before the OS work exists". A post that
        // cannot be accepted says so rather than dropping silently or blocking
        // the foreign thread.
        final NtsInbox tiny = NtsInbox.withCapacity(1);
        NtsCallback nothing = new NtsCallback() {
            @Override
            public void call() { }
        };
        check(NtsForeign.post(tiny, nothing), "the first post fits");
        check(!NtsForeign.post(tiny, nothing), "the second is refused at the ceiling");
        check(NtsInbox.drain(tiny) == 1, "and draining frees the credit");
        check(NtsForeign.post(tiny, nothing), "so a post fits again");
        NtsInbox.drain(tiny);
    }


    /**
     * `arr.length = n`, the in-place truncation the corpus does 62 times.
     *
     * <p>The reference case is the one that matters and is not a length store:
     * dropping an element has to clear its slot, or the platform collector
     * keeps the object alive for as long as the array does. A version that only
     * assigned `length` would pass every other assertion here.
     */
    private static void testSetLength() {
        NtsArrayD numbers = NtsArrayD.of(4);
        for (int i = 0; i < 4; i++) { NtsArrayD.set(numbers, i, i + 1); }
        NtsArrayD.setLength(numbers, 2);
        check(NtsArrayD.length(numbers) == 2, "truncated");
        number(NtsArrayD.get(numbers, 1), 2.0, "survivor kept");

        NtsArrayD.setLength(numbers, 2);
        check(NtsArrayD.length(numbers) == 2, "setting the same length does nothing");

        // **The assertion a length-store-only version fails.** The dropped slot
        // must be cleared, or the array pins an object nobody can reach.
        NtsArrayL refs = NtsArrayL.of(2);
        NtsArrayL.set(refs, 0, "keep");
        NtsArrayL.set(refs, 1, "drop");
        NtsArrayL.setLength(refs, 1);
        check(NtsArrayL.length(refs) == 1, "reference array truncated");
        check(refs.items[1] == null, "the dropped slot is cleared, or the collector cannot free it");
        equal(refs.items[0], "keep", "and the survivor is untouched");

        NtsArrayZ flags = NtsArrayZ.of(3);
        NtsArrayZ.setLength(flags, 1);
        check(NtsArrayZ.length(flags) == 1, "boolean array truncated");

        // Growing is refused by name rather than producing holes.
        boolean refusedGrow = false;
        try { NtsArrayD.setLength(numbers, 9); } catch (NtsRefusal e) { refusedGrow = true; }
        check(refusedGrow, "growing is refused");

        boolean refusedFraction = false;
        try { NtsArrayD.setLength(numbers, 1.5); } catch (NtsRefusal e) { refusedFraction = true; }
        check(refusedFraction, "a non-integral length is refused");

        boolean refusedNegative = false;
        try { NtsArrayD.setLength(numbers, -1); } catch (NtsRefusal e) { refusedNegative = true; }
        check(refusedNegative, "a negative length is refused");

        boolean refusedNaN = false;
        try { NtsArrayD.setLength(numbers, Double.NaN); } catch (NtsRefusal e) { refusedNaN = true; }
        check(refusedNaN, "NaN is refused -- node throws RangeError for it too");

        // **The two refusals must not be reachable by each other's rule.** Both
        // of these decline, so a test that only asked "did it throw" would pass
        // on an implementation that classified them backwards. Checked against
        // node: 2^32-1 is a length it accepts and grows to, 2^32 is one it
        // rejects, and the boundary between them is not Integer.MAX_VALUE --
        // which is where a plain `(int)` cast puts it.
        String tooBig = refusalFrom(() -> NtsArrayD.setLength(numbers, 4294967296.0));
        check(tooBig.contains("RangeError"), "2^32 is the language's objection, got: " + tooBig);
        String holes = refusalFrom(() -> NtsArrayD.setLength(numbers, 4294967295.0));
        check(holes.contains("holes"), "2^32-1 is a valid length we decline, got: " + holes);
        check(!holes.contains("RangeError"), "and it must not claim the language refused it");
    }

    public static void main(String[] args) throws Exception {
        testBigInt();
        testBigIntPastBits(); System.out.println("bigint past 128 bits stops passed");
        testBigIntCompareString();
        testRefusalLines();
        testArrayLength(); System.out.println("erased array length passed");
        testErasedBigInt(); System.out.println("bigint randomized tests passed");
        testMap(); System.out.println("map randomized and cursor tests passed");
        testMapCursorDomain(); System.out.println("map cursor domain and exhaustion passed");
        testMapAsJavaMap(); System.out.println("NtsMap as java.util.Map passed");
        testForeignCallbacks(); System.out.println("foreign-thread callbacks passed");
        testSetLength(); System.out.println("array setLength passed");
        testCheckedSet(); System.out.println("checked growable store passed");
        testNumbersAndIndices(); System.out.println("numeric and index tests passed");
        testRadixTruncates(); System.out.println("a fractional radix truncates passed");
        testArraysAndStrings(); System.out.println("array and string tests passed");
        testPromises(); System.out.println("promise and queue tests passed");
        testTimers(); System.out.println("timer heap tests passed");
        testValueToString(); System.out.println("String() of every tag passed");
        testPrinterRaises(); System.out.println("printer raise identity and join recovery passed");
        testAccessKeyDescription(); System.out.println("access error keys passed");
        testValueToNumber(); System.out.println("Number() of every tag passed");
        testReferenceKeyedTags(); System.out.println("reference-keyed map tags passed");
        testPresenceHas(); System.out.println("presenceHas passed");
        testIntegerViewStores(); System.out.println("integer view stores passed");
        testFractionalWrapperReads(); System.out.println("wrapper reads at a double index passed");
        testProvedViewAccess(); System.out.println("proven view accesses passed");
        testStringKeyDoors(); System.out.println("unboxed string keys passed");
        testTableFills(); System.out.println("table fills passed");
        testNumberColumns(); System.out.println("number columns passed");
        testNumberValues(); System.out.println("number values beside boxed keys passed");
        System.out.println("PASS " + checks + " assertions");
    }

    /**
     * `keysInto` and `valuesInto` copy what a walk of the table reads: the live
     * entries in entry order, holes skipped. Checked against a `LinkedHashMap`
     * mirror, which keeps JavaScript's `Map` order -- an update in place, a
     * re-add at the end -- over the shapes deletion makes: empty, dense, holes
     * between, a prefix deleted (`head` advances), emptied and refilled, and
     * past the linear limit. Each width, bare and in its growable wrapper.
     */
    private static void testTableFills() {
        for (int n : new int[] {0, 1, 7, 8, 9, 5000}) {
            for (int pattern = 0; pattern < 4; pattern++) {
                NtsMap map = NtsMap.newMap(0);
                java.util.LinkedHashMap<Double, Double> mirror = new java.util.LinkedHashMap<>();
                for (int i = 0; i < n; i++) {
                    NtsMap.set(map, NtsValue.ofNumber(i * 1.5), NtsValue.ofNumber(i * 10.0));
                    mirror.put(i * 1.5, i * 10.0);
                }
                for (int i = 0; i < n; i++) {
                    boolean drop = pattern == 1 ? i % 2 == 0 : pattern == 2 ? i < n / 2 : pattern == 3;
                    if (drop) {
                        NtsTable.delete(map, NtsValue.ofNumber(i * 1.5));
                        mirror.remove(i * 1.5);
                    }
                }
                if (pattern == 3) {
                    for (int i = 0; i < n / 3; i++) {
                        NtsMap.set(map, NtsValue.ofNumber(i * 1.5), NtsValue.ofNumber(-i));
                        mirror.put(i * 1.5, (double) -i);
                    }
                }
                if (n > 2) {
                    // An update keeps its place and a key deleted and set again
                    // moves to the end, in the table as in the mirror's `put`.
                    NtsMap.set(map, NtsValue.ofNumber(1.5), NtsValue.ofNumber(99));
                    mirror.put(1.5, 99.0);
                }
                String shape = n + " entries, pattern " + pattern;
                double[] keys = new double[map.size()];
                double[] values = new double[map.size()];
                NtsTable.keysInto(map, keys);
                NtsTable.valuesInto(map, values);
                NtsArrayD wrapped = NtsArrayD.of(map.size());
                NtsTable.valuesInto(map, wrapped);
                int at = 0;
                for (java.util.Map.Entry<Double, Double> entry : mirror.entrySet()) {
                    number(keys[at], entry.getKey(), "key " + at + ", " + shape);
                    number(values[at], entry.getValue(), "value " + at + ", " + shape);
                    number(wrapped.items[at], entry.getValue(), "wrapped value " + at + ", " + shape);
                    at++;
                }
                equal(at, keys.length, "every slot written, " + shape);
            }
        }
        NtsMap flags = NtsMap.newMap(0);
        NtsMap.set(flags, NtsValue.ofString("a"), NtsValue.ofBoolean(true));
        NtsMap.set(flags, NtsValue.ofString("b"), NtsValue.ofBoolean(false));
        NtsMap.set(flags, NtsValue.ofString("c"), NtsValue.ofBoolean(true));
        NtsTable.delete(flags, NtsValue.ofString("a"));
        boolean[] bare = new boolean[flags.size()];
        NtsTable.valuesInto(flags, bare);
        NtsArrayZ wrappedFlags = NtsArrayZ.of(flags.size());
        NtsTable.valuesInto(flags, wrappedFlags);
        check(!bare[0] && bare[1] && !wrappedFlags.items[0] && wrappedFlags.items[1], "boolean values, a hole first");
        String[] names = new String[flags.size()];
        NtsTable.keysInto(flags, names);
        NtsArrayL wrappedNames = NtsArrayL.of(flags.size());
        NtsTable.keysInto(flags, wrappedNames);
        check("b".equals(names[0]) && "c".equals(names[1]) && "c".equals(wrappedNames.items[1]),
            "string keys into a String[] and a wrapper");
        NtsSet members = NtsSet.newSet(0);
        NtsSet.add(members, NtsValue.ofNumber(-0.0));
        NtsSet.add(members, NtsValue.ofString("s"));
        NtsSet.add(members, NtsValue.NULL_VALUE);
        NtsValue[] boxes = new NtsValue[members.size()];
        NtsTable.keysIntoErased(members, boxes);
        check(boxes[0].tag == NtsValue.NUMBER && Double.doubleToRawLongBits(boxes[0].num) == 0L,
            "-0 is held as +0");
        check(boxes[1].tag == NtsValue.STRING && boxes[2] == NtsValue.NULL_VALUE, "erased boxes as stored");
        check(refuses(() -> NtsTable.keysInto(flags, new double[2])), "a number read of string keys refuses");
        check(refuses(() -> NtsTable.valuesInto(map(), new boolean[1])), "a boolean read of number values refuses");
    }

    /**
     * A table whose keys or values are a number column answers what the boxed
     * table answers, through its unboxed doors and its boxed entry points
     * alike.
     *
     * <p>Each layout -- number keys and values, number keys, a number Set --
     * runs one random sequence beside a boxed control and a model, so a wrong
     * answer says which of the three disagrees. The keys are where the column
     * differs from a box: `-0` beside `+0`, `NaN` with two bit patterns,
     * infinities and fractions, past the linear limit and under it, with
     * deletions making holes, a cleared table refilled, and walks by cursor
     * between. A value of `-0` keeps its sign: only a key is SameValueZero.
     *
     * <p>Then the one-way turns: a key or value the column cannot hold makes
     * it boxes, keeping every entry, its order and its holes, and the doors
     * still find what the boxes hold.
     */
    private static void testNumberColumns() {
        double[] pool = {
            0.0, -0.0, 1.0, -1.0, 0.5, 2.5, 1e300, -1e-300, Double.NaN,
            Double.longBitsToDouble(0x7ff80000000000ffL), Double.POSITIVE_INFINITY,
            Double.NEGATIVE_INFINITY, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0
        };
        String[] layouts = {"numbers", "number keys", "number set"};
        for (String layout : layouts) {
            for (int span : new int[] {6, pool.length}) {
                Random random = new Random(layout.hashCode() * 31 + span);
                boolean set = layout.equals("number set");
                NtsTable table = set ? NtsSet.newSetOfNumbers(0)
                    : layout.equals("numbers") ? NtsMap.newMapOfNumbers(0) : NtsMap.newMapOfNumberKeys(0);
                NtsTable control = set ? NtsSet.newSet(0) : NtsMap.newMap(0);
                List<double[]> model = new ArrayList<double[]>();
                for (int round = 0; round < 20000; ++round) {
                    double key = pool[random.nextInt(span)];
                    double value = random.nextBoolean() ? -0.0 : random.nextInt(50) - 25;
                    boolean door = random.nextBoolean();
                    int hit = -1;
                    for (int i = 0; i < model.size(); ++i) {
                        double held = model.get(i)[0];
                        if (held == key || (held != held && key != key)) { hit = i; break; }
                    }
                    int action = random.nextInt(100);
                    String at = layout + ", " + span + " keys, round " + round;
                    if (action < 45) {
                        if (set) {
                            if (door) { NtsSet.addNumber((NtsSet) table, key); } else { NtsSet.add((NtsSet) table, NtsValue.ofNumber(key)); }
                            NtsSet.add((NtsSet) control, NtsValue.ofNumber(key));
                        } else {
                            if (door) { NtsMap.setNumber((NtsMap) table, key, value); }
                            else if (random.nextBoolean()) { NtsMap.setNumber((NtsMap) table, key, NtsValue.ofNumber(value)); }
                            else { NtsMap.set((NtsMap) table, NtsValue.ofNumber(key), NtsValue.ofNumber(value)); }
                            NtsMap.set((NtsMap) control, NtsValue.ofNumber(key), NtsValue.ofNumber(value));
                        }
                        if (hit >= 0) { model.get(hit)[1] = value; } else { model.add(new double[] {key == 0.0 ? 0.0 : key, value}); }
                    } else if (action < 70) {
                        boolean gone = door ? NtsTable.deleteNumber(table, key) : NtsTable.delete(table, NtsValue.ofNumber(key));
                        check(gone == (hit >= 0) && NtsTable.delete(control, NtsValue.ofNumber(key)) == gone, "delete, " + at);
                        if (hit >= 0) { model.remove(hit); }
                    } else if (action == 99) {
                        NtsTable.clear(table); NtsTable.clear(control); model.clear();
                    } else {
                        boolean has = door ? NtsTable.hasNumber(table, key) : NtsTable.has(table, NtsValue.ofNumber(key));
                        check(has == (hit >= 0) && NtsTable.has(control, NtsValue.ofNumber(key)) == has, "has, " + at);
                        if (!set) {
                            NtsValue got = door ? NtsTable.getNumber(table, key) : NtsTable.get(table, NtsValue.ofNumber(key));
                            if (hit < 0) { check(got.tag == NtsValue.UNDEFINED && got.num == 0.0, "a miss is undefined, " + at); }
                            else { check(got.tag == NtsValue.NUMBER, "a hit is a number, " + at); number(got.num, model.get(hit)[1], "get, " + at); }
                        }
                    }
                    check(NtsTable.size(table) == model.size() && NtsTable.size(control) == model.size(), "size, " + at);
                    if (round % 97 == 0) { walks(table, control, model, set, at); }
                }
                walks(table, control, model, set, layout + ", " + span + " keys, at the end");
            }
        }

        // -0 is a key once and a value as itself; NaN is one key.
        NtsMap numbers = NtsMap.newMapOfNumbers(0);
        NtsMap.setNumber(numbers, -0.0, -0.0);
        NtsMap.setNumber(numbers, Double.NaN, 1.0);
        number(NtsTable.getNumber(numbers, 0.0).num, -0.0, "a -0 value keeps its sign");
        number(NtsTable.keyAtI(numbers, 0).num, 0.0, "a -0 key is held as +0");
        number(NtsTable.getNumber(numbers, Double.longBitsToDouble(0xfff8000000000001L)).num, 1.0, "every NaN is one key");
        check(Double.isNaN(NtsTable.keyAtI(numbers, 1).num), "a NaN key reads back as NaN");
        equal(numbers.size(), 2, "two keys");

        // A string key turns the key column into boxes; a string value, the values.
        NtsMap turned = NtsMap.newMapOfNumbers(0);
        for (int i = 0; i < 12; i++) { NtsMap.setNumber(turned, i, i * 2.0); }
        NtsTable.deleteNumber(turned, 3);
        NtsMap.set(turned, NtsValue.ofString("s"), NtsValue.ofNumber(-1));
        NtsMap.setNumber(turned, 5, NtsValue.ofString("v"));
        equal(turned.size(), 12, "a turn keeps every entry");
        number(NtsTable.getNumber(turned, 4).num, 8.0, "a door on a boxed key column");
        equal(NtsTable.getNumber(turned, 5).ref, "v", "a boxed value through the number door");
        check(!NtsTable.hasNumber(turned, 3), "a hole stays a hole through a turn");
        check(NtsTable.get(turned, NtsValue.ofString("s")).num == -1.0, "the key that turned it");
        int cursor = NtsTable.nextI(turned, 0);
        for (int i = 0; i < 12; i++) {
            if (i == 3) { continue; }
            number(NtsTable.keyAtI(turned, cursor).num, i, "order through a turn, " + i);
            cursor = NtsTable.nextI(turned, cursor + 1);
        }
        equal(NtsTable.keyAtI(turned, cursor).ref, "s", "the turning key is last");
        NtsSet members = NtsSet.newSetOfNumbers(0);
        NtsSet.addNumber(members, 1);
        NtsSet.add(members, NtsValue.ofString("one"));
        check(NtsTable.hasNumber(members, 1) && NtsTable.hasString(members, "one"), "a Set's turn");
        check(!NtsTable.hasString(NtsSet.newSetOfNumbers(0), "1"), "a number column holds no string");

        // A copy keeps its source's columns; an extend reads any into any.
        NtsMap copied = NtsMap.copy(numbers);
        number(NtsTable.getNumber(copied, 0.0).num, -0.0, "a copy of number columns");
        NtsMap boxed = NtsMap.newMap(0);
        NtsMap.set(boxed, NtsValue.ofString("k"), NtsValue.ofNumber(9));
        NtsMap.extend(boxed, numbers);
        check(boxed.size() == 3 && NtsTable.getNumber(boxed, Double.NaN).num == 1.0, "an extend from number columns");
        NtsMap.extend(copied, boxed);
        check(copied.size() == 3 && NtsTable.getString(copied, "k").num == 9.0, "an extend into number columns turns them");
        NtsSet copiedSet = NtsSet.copy(members);
        check(copiedSet.size() == 2 && NtsTable.hasNumber(copiedSet, 1), "a copy of a turned Set");

        // A Java caller reads the columns through the same map.
        java.util.Map<Object, Object> java = numbers;
        check(java.containsKey(-0.0) && java.get(Double.NaN).equals(1.0), "java.util.Map over number columns");
        java.put(2.0, 3.0);
        number(NtsTable.getNumber(numbers, 2).num, 3.0, "a Java put into number columns");

        // A fill reads a column with holes and without, each as one copy or a walk.
        NtsSet dense = NtsSet.newSetOfNumbers(0);
        for (int i = 0; i < 40; i++) { NtsSet.addNumber(dense, i * 3); }
        double[] all = new double[dense.size()];
        NtsTable.keysInto(dense, all);
        double[] asValues = new double[dense.size()];
        NtsTable.valuesInto(dense, asValues);
        for (int i = 0; i < 40; i++) {
            number(all[i], i * 3, "a dense fill, " + i);
            number(asValues[i], i * 3, "a Set's values are its keys, " + i);
        }
        NtsTable.deleteNumber(dense, 0);
        NtsTable.deleteNumber(dense, 30);
        double[] holed = new double[dense.size()];
        NtsTable.keysInto(dense, holed);
        NtsValue[] boxes = new NtsValue[dense.size()];
        NtsTable.keysIntoErased(dense, boxes);
        int at = 0;
        for (int i = 1; i < 40; i++) {
            if (i == 10) { continue; }
            number(holed[at], i * 3, "a fill past holes, " + i);
            number(boxes[at].num, i * 3, "an erased fill past holes, " + i);
            at++;
        }
        check(refuses(() -> NtsTable.keysInto(dense, new boolean[dense.size()])), "a boolean read of a number column refuses");
    }

    /**
     * A `Map<string, number>` or a `Record<string, number>` keeps its values in
     * a number column beside its boxed keys, and answers what a boxed table
     * answers: through `setString` with a `double` and with a box, the boxed
     * `set`, `getString` and the boxed `get`, against a boxed control and a
     * `LinkedHashMap` model. The keys are under the linear limit and past it,
     * with holes, a clear, and values that are `-0` and `NaN`, which a number
     * column must keep as they are. Then a string value turns the column into
     * boxes, keeping every entry; and a Record's `Object.keys` order -- array
     * indices first -- reads the boxed key column as before.
     */
    private static void testNumberValues() {
        for (boolean record : new boolean[] {false, true}) {
            for (int span : new int[] {6, 40}) {
                Random random = new Random(span * 7 + (record ? 1 : 0));
                NtsMap table = record ? NtsMap.newTableOfNumberValues(0) : NtsMap.newMapOfNumberValues(0);
                NtsMap control = record ? NtsMap.newTable(0) : NtsMap.newMap(0);
                java.util.LinkedHashMap<String, Double> model = new java.util.LinkedHashMap<>();
                for (int round = 0; round < 20000; ++round) {
                    String key = "k" + random.nextInt(span);
                    double value = random.nextInt(9) == 0 ? -0.0 : random.nextInt(9) == 0 ? Double.NaN : random.nextInt(50) - 25;
                    int action = random.nextInt(100);
                    String at = (record ? "record" : "map") + ", " + span + " keys, round " + round;
                    if (action < 45) {
                        int how = random.nextInt(3);
                        if (how == 0) { NtsMap.setString(table, key, value); }
                        else if (how == 1) { NtsMap.setString(table, new String(key), NtsValue.ofNumber(value)); }
                        else { NtsMap.set(table, NtsValue.ofString(key), NtsValue.ofNumber(value)); }
                        NtsMap.set(control, NtsValue.ofString(key), NtsValue.ofNumber(value));
                        model.put(key, value);
                    } else if (action < 70) {
                        boolean gone = NtsTable.delete(table, NtsValue.ofString(key));
                        check(gone == model.containsKey(key) && NtsTable.delete(control, NtsValue.ofString(key)) == gone, "delete, " + at);
                        model.remove(key);
                    } else if (action == 99) {
                        NtsTable.clear(table); NtsTable.clear(control); model.clear();
                    } else {
                        NtsValue got = random.nextBoolean() ? NtsTable.getString(table, new String(key)) : NtsTable.get(table, NtsValue.ofString(key));
                        Double held = model.get(key);
                        if (held == null) { check(got.tag == NtsValue.UNDEFINED && got.num == 0.0, "a miss is undefined, " + at); }
                        else { check(got.tag == NtsValue.NUMBER, "a hit is a number, " + at); number(got.num, held, "get, " + at); }
                        check(NtsTable.hasString(table, key) == (held != null), "has, " + at);
                    }
                    check(table.size() == model.size() && control.size() == model.size(), "size, " + at);
                    if (round % 97 == 0) {
                        int cursor = NtsTable.nextI(table, 0);
                        for (java.util.Map.Entry<String, Double> entry : model.entrySet()) {
                            equal(NtsTable.keyAtI(table, cursor).ref, entry.getKey(), "key order, " + at);
                            number(NtsTable.valueAtI(table, cursor).num, entry.getValue(), "value by cursor, " + at);
                            cursor = NtsTable.nextI(table, cursor + 1);
                        }
                        check(cursor == -1, "the walk ends with the model, " + at);
                        double[] values = new double[table.size()];
                        NtsTable.valuesInto(table, values);
                        int i = 0;
                        for (double held : model.values()) { number(values[i++], held, "a values fill, " + at); }
                    }
                }
            }
        }
        NtsMap turned = NtsMap.newTableOfNumberValues(0);
        for (int i = 0; i < 12; i++) { NtsMap.setString(turned, "w" + i, i * 2.0); }
        NtsTable.delete(turned, NtsValue.ofString("w3"));
        NtsMap.setString(turned, "w5", NtsValue.ofString("v"));
        equal(turned.size(), 11, "a value turn keeps every entry");
        number(NtsTable.getString(turned, "w4").num, 8.0, "a number beside a turned value");
        equal(NtsTable.getString(turned, "w5").ref, "v", "the value that turned it");
        check(!NtsTable.hasString(turned, "w3"), "a hole stays a hole through a value turn");
        NtsMap indexed = NtsMap.newTableOfNumberValues(0);
        NtsMap.setString(indexed, "b", 1);
        NtsMap.setString(indexed, "2", 2);
        NtsMap.setString(indexed, "a", 3);
        NtsMap.setString(indexed, "1", 4);
        Object[] names = NtsTable.keysStr(indexed);
        check(names.length == 4 && "1".equals(names[0]) && "2".equals(names[1]) && "b".equals(names[2]) && "a".equals(names[3]),
            "a Record's keys put array indices first, ascending");
        check(NtsMap.copy(indexed).numberValues != null, "a copy keeps the number value column");
    }

    /** One walk of each table by cursor, against the model's order and values. */
    private static void walks(NtsTable table, NtsTable control, List<double[]> model, boolean set, String at) {
        int cursor = NtsTable.nextI(table, 0);
        int boxed = NtsTable.nextI(control, 0);
        for (double[] entry : model) {
            check(cursor >= 0 && boxed >= 0, "a cursor per entry, " + at);
            number(NtsTable.keyAtI(table, cursor).num, entry[0], "key order, " + at);
            number(NtsTable.keyAtI(control, boxed).num, entry[0], "control key order, " + at);
            number(NtsTable.valueAtI(table, cursor).num, set ? entry[0] : entry[1], "value by cursor, " + at);
            cursor = NtsTable.nextI(table, cursor + 1);
            boxed = NtsTable.nextI(control, boxed + 1);
        }
        check(cursor == -1 && boxed == -1, "the walk ends with the model, " + at);
        check(NtsTable.keyAtI(table, -1).tag == NtsValue.UNDEFINED, "a dead cursor, " + at);
    }

    private static NtsMap map() {
        NtsMap one = NtsMap.newMap(0);
        NtsMap.set(one, NtsValue.ofNumber(1), NtsValue.ofNumber(2));
        return one;
    }

    /**
     * A string key passed unboxed finds what the same key boxed finds.
     *
     * <p>`getString`, `hasString` and `setString` hash through `hashString`,
     * which `hash` also uses, and compare by `equals`, as `sameKey` compares two
     * `STRING` keys. So every lookup here uses a copy equal to, and not the same
     * string as, the one stored, both ways round: stored boxed and found unboxed,
     * stored unboxed and found boxed. Under the linear limit and past it, since
     * the two paths search differently. A number key is not the string that
     * prints it, and a null key is what `ofString(null)` makes of it.
     */
    private static void testStringKeyDoors() {
        for (int size : new int[] {4, 100}) {
            NtsMap boxed = NtsMap.newTable(0);
            NtsMap unboxed = NtsMap.newTable(0);
            for (int i = 0; i < size; i++) {
                NtsMap.set(boxed, NtsValue.ofString("w" + i), NtsValue.ofNumber(i));
                NtsMap.setString(unboxed, "w" + i, NtsValue.ofNumber(i));
            }
            for (int i = 0; i < size; i++) {
                String copy = new String("w" + i);
                number(NtsTable.getString(boxed, copy).num, i, "stored boxed, read unboxed, " + size + " keys, w" + i);
                number(NtsTable.get(unboxed, NtsValue.ofString(copy)).num, i, "stored unboxed, read boxed, " + size + " keys, w" + i);
                check(NtsTable.hasString(boxed, copy) && NtsTable.has(unboxed, NtsValue.ofString(copy)), "has, " + size + " keys, w" + i);
            }
            check(NtsTable.getString(boxed, "w" + size) == NtsValue.UNDEFINED_VALUE, "a missing key, " + size + " keys");
            check(!NtsTable.hasString(unboxed, "w" + size), "a missing key, has, " + size + " keys");
            NtsMap.setString(boxed, new String("w1"), NtsValue.ofNumber(-1));
            number(NtsTable.get(boxed, NtsValue.ofString("w1")).num, -1, "an update in place, " + size + " keys");
            equal(boxed.size(), size, "an update in place adds no entry, " + size + " keys");
            NtsMap.setString(unboxed, "w" + size, NtsValue.ofNumber(size));
            number(NtsTable.get(unboxed, NtsValue.ofString("w" + size)).num, size, "an insert, " + size + " keys");
            equal(unboxed.size(), size + 1, "an insert adds one entry, " + size + " keys");
        }
        NtsMap mixed = NtsMap.newMap(0);
        NtsMap.set(mixed, NtsValue.ofNumber(1), NtsValue.ofNumber(10));
        NtsMap.set(mixed, NtsValue.NULL_VALUE, NtsValue.ofNumber(20));
        NtsMap.set(mixed, NtsValue.UNDEFINED_VALUE, NtsValue.ofNumber(30));
        check(!NtsTable.hasString(mixed, "1"), "the number 1 is not the string \"1\"");
        check(!NtsTable.hasString(mixed, "undefined") && !NtsTable.hasString(mixed, "null"),
            "undefined and null are not their names");
        number(NtsTable.getString(mixed, null).num, 20, "a null key is ofString(null), NULL_VALUE");
        NtsMap.setString(mixed, "1", NtsValue.ofNumber(40));
        number(NtsTable.get(mixed, NtsValue.ofNumber(1)).num, 10, "the string \"1\" leaves the number 1");
        number(NtsTable.getString(mixed, "1").num, 40, "and is a key of its own");
    }

    /**
     * A proven access touches the bytes the checked one does.
     *
     * <p>`getProved` and `setProved` compute the byte index with no test, so all
     * they share with `getInt` and `setInt` is the layout, and the offset and
     * the element width are where a position computed a second way goes wrong.
     * Every class is used through a window that starts past its buffer's first
     * element: stored proven into one buffer and checked into another, the two
     * buffers compared whole, then read back both ways.
     */
    private static void testProvedViewAccess() {
        int[] ints = {0, 1, -1, 127, -128, 255, 256, 300, 65535, -32769, 0x12345678,
            Integer.MAX_VALUE, Integer.MIN_VALUE};
        double[] numbers = {0.0, -0.0, 1.5, -2.25, 3.4028234663852886e38, 1e-45, Math.PI,
            Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY};
        NtsBuffer checked = NtsBuffer.allocate(64);
        NtsBuffer proved = NtsBuffer.allocate(64);
        NtsViewI8 i8 = NtsViewI8.part(checked, 8, 4), i8p = NtsViewI8.part(proved, 8, 4);
        NtsViewU8 u8 = NtsViewU8.part(checked, 8, 4), u8p = NtsViewU8.part(proved, 8, 4);
        NtsViewU8C u8c = NtsViewU8C.part(checked, 8, 4), u8cp = NtsViewU8C.part(proved, 8, 4);
        NtsViewI16 i16 = NtsViewI16.part(checked, 8, 4), i16p = NtsViewI16.part(proved, 8, 4);
        NtsViewU16 u16 = NtsViewU16.part(checked, 8, 4), u16p = NtsViewU16.part(proved, 8, 4);
        NtsViewI32 i32 = NtsViewI32.part(checked, 8, 4), i32p = NtsViewI32.part(proved, 8, 4);
        NtsViewU32 u32 = NtsViewU32.part(checked, 8, 4), u32p = NtsViewU32.part(proved, 8, 4);
        NtsViewF32 f32 = NtsViewF32.part(checked, 8, 4), f32p = NtsViewF32.part(proved, 8, 4);
        NtsViewF64 f64 = NtsViewF64.part(checked, 8, 4), f64p = NtsViewF64.part(proved, 8, 4);
        for (int v : ints) {
            for (int i = 0; i < 4; i++) {
                int x = v + i * 0x01010101;
                String at = x + " at " + i;
                NtsViewI8.setInt(i8, i, x); NtsViewI8.setProved(i8p, i, x);
                check(Arrays.equals(checked.bytes, proved.bytes), "Int8Array, stored " + at);
                equal(NtsViewI8.getProved(i8p, i), NtsViewI8.getInt(i8, i), "Int8Array, read " + at);
                NtsViewU8.setInt(u8, i, x); NtsViewU8.setProved(u8p, i, x);
                check(Arrays.equals(checked.bytes, proved.bytes), "Uint8Array, stored " + at);
                equal(NtsViewU8.getProved(u8p, i), NtsViewU8.getInt(u8, i), "Uint8Array, read " + at);
                NtsViewU8C.setInt(u8c, i, x); NtsViewU8C.setProved(u8cp, i, x);
                check(Arrays.equals(checked.bytes, proved.bytes), "Uint8ClampedArray, stored " + at);
                equal(NtsViewU8C.getProved(u8cp, i), NtsViewU8C.getInt(u8c, i), "Uint8ClampedArray, read " + at);
                NtsViewI16.setInt(i16, i, x); NtsViewI16.setProved(i16p, i, x);
                check(Arrays.equals(checked.bytes, proved.bytes), "Int16Array, stored " + at);
                equal(NtsViewI16.getProved(i16p, i), NtsViewI16.getInt(i16, i), "Int16Array, read " + at);
                NtsViewU16.setInt(u16, i, x); NtsViewU16.setProved(u16p, i, x);
                check(Arrays.equals(checked.bytes, proved.bytes), "Uint16Array, stored " + at);
                equal(NtsViewU16.getProved(u16p, i), NtsViewU16.getInt(u16, i), "Uint16Array, read " + at);
                NtsViewI32.setInt(i32, i, x); NtsViewI32.setProved(i32p, i, x);
                check(Arrays.equals(checked.bytes, proved.bytes), "Int32Array, stored " + at);
                equal(NtsViewI32.getProved(i32p, i), NtsViewI32.getInt(i32, i), "Int32Array, read " + at);
                NtsViewU32.setInt(u32, i, x); NtsViewU32.setProved(u32p, i, x);
                check(Arrays.equals(checked.bytes, proved.bytes), "Uint32Array, stored " + at);
                equal(NtsViewU32.getProved(u32p, i), NtsViewU32.getInt(u32, i), "Uint32Array, read " + at);
            }
        }
        for (double v : numbers) {
            for (int i = 0; i < 4; i++) {
                String at = v + " at " + i;
                NtsViewF32.setFloat(f32, i, (float) v); NtsViewF32.setProved(f32p, i, (float) v);
                check(Arrays.equals(checked.bytes, proved.bytes), "Float32Array, stored " + at);
                number(NtsViewF32.getProved(f32p, i), NtsViewF32.getFloat(f32, i), "Float32Array, read " + at);
                NtsViewF64.setAt(f64, i, v); NtsViewF64.setProved(f64p, i, v);
                check(Arrays.equals(checked.bytes, proved.bytes), "Float64Array, stored " + at);
                number(NtsViewF64.getProved(f64p, i), NtsViewF64.getAt(f64, i), "Float64Array, read " + at);
            }
        }
    }

    /** ToInt32 from its definition, by exact arithmetic rather than the runtime's. */
    private static int specToInt32(double x) {
        if (Double.isNaN(x) || Double.isInfinite(x)) { return 0; }
        return new BigDecimal(x).toBigInteger().mod(BigInteger.ONE.shiftLeft(32)).intValue();
    }

    /**
     * Both of an integer view's store doors keep the specification's rule:
     * `setInt` for a value already an `int`, and `setAt` for a `double`, which
     * converts it (ToInt32, or the clamp) and stores through `setInt`. Checked
     * against the rule written out here rather than one door against the other,
     * because one now goes through the other.
     */
    private static void testIntegerViewStores() {
        int[] ints = {0, 1, 127, 128, 255, 256, 300, -1, -128, -129, 0x1ff, 32767, 32768,
            65535, 65536, -0x8001, Integer.MAX_VALUE, Integer.MIN_VALUE};
        double[] numbers = {Double.NaN, 0.5, 1.5, 2.5, -1.5, 254.5, 300.7, -0.0,
            4294967296.0 * 3 + 300, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY,
            1e21, -2147483649.0, 2147483648.0};
        NtsViewI8 i8 = NtsViewI8.of(1);
        NtsViewU8 u8 = NtsViewU8.of(1);
        NtsViewU8C u8c = NtsViewU8C.of(1);
        NtsViewI16 i16 = NtsViewI16.of(1);
        NtsViewU16 u16 = NtsViewU16.of(1);
        NtsViewI32 i32 = NtsViewI32.of(1);
        NtsViewU32 u32 = NtsViewU32.of(1);
        for (int v : ints) {
            NtsViewI8.setInt(i8, 0, v);
            number(NtsViewI8.getAt(i8, 0), (byte) v, "Int8Array, int " + v);
            NtsViewU8.setInt(u8, 0, v);
            number(NtsViewU8.getAt(u8, 0), v & 0xff, "Uint8Array, int " + v);
            NtsViewU8C.setInt(u8c, 0, v);
            number(NtsViewU8C.getAt(u8c, 0), v < 0 ? 0 : Math.min(v, 255), "Uint8ClampedArray, int " + v);
            NtsViewI16.setInt(i16, 0, v);
            number(NtsViewI16.getAt(i16, 0), (short) v, "Int16Array, int " + v);
            NtsViewU16.setInt(u16, 0, v);
            number(NtsViewU16.getAt(u16, 0), v & 0xffff, "Uint16Array, int " + v);
            NtsViewI32.setInt(i32, 0, v);
            number(NtsViewI32.getAt(i32, 0), v, "Int32Array, int " + v);
            NtsViewU32.setInt(u32, 0, v);
            number(NtsViewU32.getAt(u32, 0), v & 0xffffffffL, "Uint32Array, int " + v);
        }
        for (double x : numbers) {
            int bits = specToInt32(x);
            NtsViewI8.setAt(i8, 0, x);
            number(NtsViewI8.getAt(i8, 0), (byte) bits, "Int8Array, double " + x);
            NtsViewU8.setAt(u8, 0, x);
            number(NtsViewU8.getAt(u8, 0), bits & 0xff, "Uint8Array, double " + x);
            NtsViewU8C.setAt(u8c, 0, x);
            double clamped = Double.isNaN(x) || x <= 0 ? 0 : x >= 255 ? 255 : Math.rint(x);
            number(NtsViewU8C.getAt(u8c, 0), clamped, "Uint8ClampedArray, double " + x);
            NtsViewI16.setAt(i16, 0, x);
            number(NtsViewI16.getAt(i16, 0), (short) bits, "Int16Array, double " + x);
            NtsViewU16.setAt(u16, 0, x);
            number(NtsViewU16.getAt(u16, 0), bits & 0xffff, "Uint16Array, double " + x);
            NtsViewI32.setAt(i32, 0, x);
            number(NtsViewI32.getAt(i32, 0), bits, "Int32Array, double " + x);
            NtsViewU32.setAt(u32, 0, x);
            number(NtsViewU32.getAt(u32, 0), bits & 0xffffffffL, "Uint32Array, double " + x);
        }
    }

    /** Whether a read refuses, by name, rather than answering. */
    private static boolean refuses(Runnable read) {
        try {
            read.run();
            return false;
        } catch (NtsRefusal refused) {
            return true;
        }
    }

    /**
     * A growable array's read at a `double` index is a *checked* read, so it
     * has to test integrality as well as range: `xs[1.5]` is no element, and
     * reading `xs[1]` for it was a silent wrong answer
     * (tests/outcomes/a-pushed-string-array-read-at-a-fractional-index-on-the-jvm).
     * An integral `double`, `-0` included, still reads its element.
     */
    private static void testFractionalWrapperReads() {
        NtsArrayL words = NtsArrayL.of(0);
        NtsArrayD numbers = NtsArrayD.of(0);
        NtsArrayZ flags = NtsArrayZ.of(0);
        for (int i = 0; i < 4; i++) {
            NtsArrayL.push(words, "w" + i);
            NtsArrayD.push(numbers, i * 10.0);
            NtsArrayZ.push(flags, i % 2 == 1);
        }
        equal(NtsArrayL.get(words, 1.0), "w1", "an integral double reads its element");
        equal(NtsArrayL.get(words, -0.0), "w0", "-0 is index 0");
        number(NtsArrayD.get(numbers, 3.0), 30.0, "an integral double reads its element");
        check(NtsArrayZ.get(flags, 1.0), "an integral double reads its element");
        for (double at : new double[] {1.5, 0.25, -0.5, 3.999, Double.NaN, 4.0, -1.0,
                Double.POSITIVE_INFINITY, 4294967297.0}) {
            check(refuses(() -> NtsArrayL.get(words, at)), "NtsArrayL refuses " + at);
            check(refuses(() -> NtsArrayD.get(numbers, at)), "NtsArrayD refuses " + at);
            check(refuses(() -> NtsArrayZ.get(flags, at)), "NtsArrayZ refuses " + at);
        }
    }

    /**
     * `presenceHas` answers about a value whose class arrives at run time.
     *
     * The three arms that are not "read the bit" are the point. A primitive and
     * a `null` must answer **false** rather than fault, because the lowering
     * pairs this with a class test and emits a plain `and` -- a value failing
     * the first half still evaluates the second. And a reference that is not a
     * presence-carrying root must answer false too: `instanceof` covers all
     * three with one test, which is why the fact lives on an interface rather
     * than in a field every object would have to have.
     */
    private static void testPresenceHas() {
        Carrier carrier = new Carrier();
        carrier.bits = 0b1010;
        expect("bit 1 set", NtsRuntime.presenceHas(carrier, 1), true);
        expect("bit 3 set", NtsRuntime.presenceHas(carrier, 3), true);
        expect("bit 0 clear", NtsRuntime.presenceHas(carrier, 0), false);
        expect("bit 2 clear", NtsRuntime.presenceHas(carrier, 2), false);
        expect("bit 31 clear", NtsRuntime.presenceHas(carrier, 31), false);

        carrier.bits = 0x80000000;
        expect("the top bit is readable", NtsRuntime.presenceHas(carrier, 31), true);

        expect("null is false", NtsRuntime.presenceHas(null, 0), false);
        expect("a boxed number is false", NtsRuntime.presenceHas(Double.valueOf(1), 0), false);
        expect("a string is false", NtsRuntime.presenceHas("port", 0), false);
        expect("a plain object is false", NtsRuntime.presenceHas(new Plain(7), 0), false);
    }

    /** The message of the refusal a body throws, or "" if it did not throw. */
    private static String refusalFrom(Runnable body) {
        try {
            body.run();
            return "";
        } catch (NtsRefusal e) {
            return e.getMessage();
        }
    }

    private static void expect(String what, boolean got, boolean want) {
        if (got != want) {
            throw new AssertionError(what + ": got " + got + ", wanted " + want);
        }
    }

    /** Stands in for a generated hierarchy root that carries presence bits. */
    private static final class Carrier implements NtsPresence {
        int bits;
        @Override public int ntsPresence() { return bits; }
    }
}
