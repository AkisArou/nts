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
            bigint(NtsBigInt.add(a, b), aa.add(bb), "add");
            bigint(NtsBigInt.sub(a, b), aa.subtract(bb), "sub");
            bigint(NtsBigInt.neg(a), aa.negate(), "neg");
            bigint(NtsBigInt.mul(a, b), aa.multiply(bb), "mul");
            bigint(NtsBigInt.and(a, b), aa.and(bb), "and");
            bigint(NtsBigInt.or(a, b), aa.or(bb), "or");
            bigint(NtsBigInt.xor(a, b), aa.xor(bb), "xor");
            check(Integer.signum(NtsBigInt.compare(a, b)) == aa.compareTo(bb), "compare");
            check(NtsBigInt.eq(a, b) == aa.equals(bb), "eq");
            if (bb.signum() != 0) {
                bigint(NtsBigInt.div(a, b), aa.divide(bb), "div");
                bigint(NtsBigInt.rem(a, b), aa.remainder(bb), "rem");
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
            bigint(NtsBigInt.shl(a, NtsBigInt.fromLong(shift)), aa.shiftLeft(shift), "shl");
            bigint(NtsBigInt.shr(a, NtsBigInt.fromLong(shift)), aa.shiftRight(shift), "shr");
            int first = round < 150 ? 0 : random.nextInt(129);
            int last = round < 150 ? 128 : first;
            for (int n = first; n <= last; ++n) {
                BigInteger low = aa.and(BigInteger.ONE.shiftLeft(n).subtract(BigInteger.ONE));
                bigint(NtsBigInt.asUintN(n, a), low, "asUintN " + n);
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
        bigint(NtsBigInt.div(NtsBigInt.fromLong(Long.MIN_VALUE), NtsBigInt.fromLong(-1)), TWO64.shiftRight(1), "long overflow divide");
        bigint(NtsBigInt.div(NtsBigInt.of(Long.MIN_VALUE, 0), NtsBigInt.fromLong(-1)), TWO128.shiftRight(1), "128 overflow divide");
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
                    check(NtsMap.keyAt(map, removed.cursor) == NtsValue.UNDEFINED_VALUE, "dead cursor");
                }
            } else if (action == 99) { NtsMap.clear(map); entries.clear(); }
            else {
                check(NtsMap.has(map, key) == (hit >= 0), "has");
                check(NtsMap.get(map, key) == (hit < 0 ? NtsValue.UNDEFINED_VALUE : entries.get(hit).value), "get");
            }
            check(NtsMap.size(map) == entries.size(), "map size");
            if (round % 23 == 0) {
                double cursor = 0;
                for (Entry entry : entries) {
                    cursor = NtsMap.next(map, cursor);
                    check(cursor == entry.cursor, "stable cursor position");
                    NtsValue got = NtsMap.keyAt(map, cursor);
                    check(svz(got, entry.key), "iteration key");
                    if (got.tag == NtsValue.NUMBER && got.num == 0) { number(got.num, 0.0, "canonical zero"); }
                    check(NtsMap.valueAt(map, cursor) == entry.value, "iteration value");
                    ++cursor;
                }
                check(NtsMap.next(map, cursor) == -1, "iteration exhausted");
            }
        }
        // Clear and prefix recycling must preserve cursors without growing historical storage.
        map = NtsMap.newMap(0);
        for (int i = 0; i < 100000; ++i) {
            NtsMap.set(map, keys.get(0), keys.get(1));
            check(NtsMap.next(map, i) == i, "clear cursor");
            NtsMap.clear(map);
        }
        java.lang.reflect.Field storage = NtsMap.class.getDeclaredField("keys"); storage.setAccessible(true);
        check(((Object[]) storage.get(map)).length <= 8, "clear storage bounded");
        map = NtsMap.newMap(0);
        for (int i = 0; i < 80; ++i) { NtsMap.set(map, keys.get(i), keys.get(i)); }
        for (int i = 0; i < 2000; ++i) {
            NtsMap.delete(map, keys.get(i % 80));
            NtsMap.set(map, keys.get(i % 80), keys.get(i % 80));
        }
        check(((Object[]) storage.get(map)).length <= 256, "prefix storage bounded");
        double cursor = NtsMap.next(map, 0);
        NtsMap.clear(map);
        NtsMap.set(map, keys.get(300), keys.get(301));
        check(NtsMap.next(map, cursor + 1) > cursor, "append after clear visible");
        NtsMap set = NtsMap.newSet(0);
        NtsMap.add(set, NtsValue.ofNumber(-0.0));
        number(NtsMap.keyAt(set, 0).num, 0.0, "set key +0");
        number(NtsMap.valueAt(set, 0).num, 0.0, "set value +0");
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
                int at = random.nextInt(60);
                NtsArrayD.set(a, at, value);
                while (model.size() <= at) { model.add(0.0); }
                model.set(at, value);
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
    private static void testPromises() {
        final StringBuilder out = new StringBuilder();
        NtsPromise p = NtsPromise.newPromise();
        for (int i = 0; i < 100; ++i) { NtsPromise.subscribe(p, record(out, i + ",")); }
        NtsPromise.fulfillNumber(p, 42);
        check(out.length() == 0, "settlement never resumes inline");
        NtsPromise.fulfillNumber(p, 99);
        number(NtsPromise.number(p), 42, "first settlement wins");
        NtsLoop.drain();
        StringBuilder expected = new StringBuilder();
        for (int i = 0; i < 100; ++i) { expected.append(i).append(','); }
        equal(out.toString(), expected.toString(), "waiter FIFO including growth");
        out.setLength(0); NtsPromise.subscribe(p, record(out, "later"));
        check(out.length() == 0, "settled subscribe remains async");
        NtsLoop.drain(); equal(out.toString(), "later", "settled resume");
        NtsPromise a = NtsPromise.newPromise(), b = NtsPromise.newPromise(), c = NtsPromise.newPromise();
        double[] values = new double[4];
        NtsPromise all = NtsPromise.all(new NtsPromise[] {a, b, c, a}, values);
        NtsPromise.fulfillNumber(c, 30); NtsPromise.fulfillNumber(b, 20); NtsLoop.drain();
        check(!NtsPromise.isSettled(all), "all waits for remaining input");
        NtsPromise.fulfillNumber(a, 10); NtsLoop.drain();
        check(NtsPromise.isSettled(all), "all fulfilled");
        equal(Arrays.toString(values), "[10.0, 20.0, 30.0, 10.0]", "all input order and duplicate inputs");
        a = NtsPromise.newPromise(); b = NtsPromise.newPromise();
        Object[] refs = new Object[2];
        all = NtsPromise.all(new NtsPromise[] {a, b}, refs);
        NtsPromise.fulfillTagged(b, "b", NtsValue.STRING); NtsPromise.fulfillTagged(a, "a", NtsValue.STRING); NtsLoop.drain();
        equal(Arrays.toString(refs), "[a, b]", "all references input order");
        a = NtsPromise.newPromise(); b = NtsPromise.newPromise();
        NtsPromise race = NtsPromise.race(new NtsPromise[] {a, b});
        NtsPromise.reject(b, "failure"); NtsPromise.fulfillVoid(a); NtsLoop.drain();
        check(NtsPromise.isRejected(race), "race first rejection");
        check(NtsPromise.isSettled(NtsPromise.all(new NtsPromise[0], new double[0])), "empty all fulfilled");
        check(!NtsPromise.isSettled(NtsPromise.race(new NtsPromise[0])), "empty race pending");
        out.setLength(0);
        NtsLoop.tick(record(out, "T"));
        NtsLoop.microtask(new NtsResumable() { public void resume() { out.append('M'); NtsLoop.tick(record(out, "t")); } });
        NtsLoop.microtask(record(out, "m")); NtsLoop.drain();
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
            ids[i] = NtsLoop.postDelayed(new NtsCallback() { public void call() { actual.add(id); } }, delay, false);
        }
        boolean[] cancelled = new boolean[ids.length];
        for (int i = 0; i < 3000; ++i) { int at = random.nextInt(ids.length); NtsLoop.cancelDelayed(ids[at]); cancelled[at] = true; }
        NtsLoop.cancelDelayed(Double.NaN); NtsLoop.cancelDelayed(-1); NtsLoop.cancelDelayed(0.5);
        Collections.sort(expected, new Comparator<int[]>() {
            public int compare(int[] a, int[] b) { return a[0] != b[0] ? Integer.compare(a[0], b[0]) : Integer.compare(a[1], b[1]); }
        });
        NtsLoop.drain();
        int position = 0;
        for (int[] entry : expected) { if (!cancelled[entry[1]]) { check(actual.get(position++) == entry[1], "heap timer order"); } }
        check(position == actual.size(), "timer cancellation count");
        final double[] repeatId = new double[1];
        final int[] fired = new int[1];
        repeatId[0] = NtsLoop.postDelayed(new NtsCallback() {
            public void call() { if (++fired[0] == 10000) { NtsLoop.cancelDelayed(repeatId[0]); } }
        }, 0, true);
        NtsLoop.drain(); check(fired[0] == 10000, "interval self-cancellation");
        final StringBuilder out = new StringBuilder();
        NtsLoop.postDelayed(new NtsCallback() { public void call() {
            out.append('A'); NtsLoop.microtask(record(out, "m"));
            NtsLoop.postDelayed(new NtsCallback() { public void call() { out.append('C'); } }, 0, false);
        } }, 0, false);
        NtsLoop.postDelayed(new NtsCallback() { public void call() { out.append('B'); } }, 0, false);
        NtsLoop.drain(); equal(out.toString(), "AmBC", "timer reentrancy and checkpoints");
        check(!NtsLoop.step(), "empty loop");
    }
    public static void main(String[] args) throws Exception {
        testBigInt(); System.out.println("bigint randomized tests passed");
        testMap(); System.out.println("map randomized and cursor tests passed");
        testNumbersAndIndices(); System.out.println("numeric and index tests passed");
        testArraysAndStrings(); System.out.println("array and string tests passed");
        testPromises(); System.out.println("promise and queue tests passed");
        testTimers(); System.out.println("timer heap tests passed");
        System.out.println("PASS " + checks + " assertions");
    }
}
