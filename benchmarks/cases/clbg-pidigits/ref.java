/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * Contributed by Isaac Gouy.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/pidigits-graalvmaot-1.html
 */

import java.math.BigInteger;

// The Game's Java spigot and transformation objects, with stdout in memory.
// BigInteger remains arbitrary precision, including both digit extractions.
final class Ref extends Bench.Work {
    private static volatile double input = 500;
    private static final int L = 10;

    @Override public double run() {
        String output = render((int) input);
        int hash = 0;
        for (int i = 0; i < output.length(); ++i) {
            hash = hash * 31 + output.charAt(i);
        }
        return Integer.toUnsignedLong(hash);
    }

    static String render(int n) {
        StringBuilder output = new StringBuilder();
        int j = 0;
        PiDigitSpigot digits = new PiDigitSpigot();
        while (n > 0) {
            if (n >= L) {
                for (int i = 0; i < L; i++) output.append(digits.next());
                j += L;
            } else {
                for (int i = 0; i < n; i++) output.append(digits.next());
                for (int i = n; i < L; i++) output.append(' ');
                j += n;
            }
            output.append("\t:").append(j).append('\n');
            n -= L;
        }
        return output.toString();
    }

    static final class PiDigitSpigot {
        Transformation z, x, inverse;

        PiDigitSpigot() {
            z = new Transformation(1, 0, 0, 1);
            x = new Transformation(0, 0, 0, 0);
            inverse = new Transformation(0, 0, 0, 0);
        }

        int next() {
            int y = digit();
            if (isSafe(y)) {
                z = produce(y);
                return y;
            } else {
                z = consume(x.next());
                return next();
            }
        }

        int digit() {
            return z.extract(3);
        }

        boolean isSafe(int digit) {
            return digit == z.extract(4);
        }

        Transformation produce(int i) {
            return inverse.qrst(10, -10 * i, 0, 1).compose(z);
        }

        Transformation consume(Transformation a) {
            return z.compose(a);
        }
    }

    static final class Transformation {
        BigInteger q, r, s, t;
        int k;

        Transformation(int q, int r, int s, int t) {
            this.q = BigInteger.valueOf(q);
            this.r = BigInteger.valueOf(r);
            this.s = BigInteger.valueOf(s);
            this.t = BigInteger.valueOf(t);
            k = 0;
        }

        Transformation(BigInteger q, BigInteger r, BigInteger s, BigInteger t) {
            this.q = q;
            this.r = r;
            this.s = s;
            this.t = t;
            k = 0;
        }

        Transformation next() {
            k++;
            q = BigInteger.valueOf(k);
            r = BigInteger.valueOf(4 * k + 2);
            s = BigInteger.valueOf(0);
            t = BigInteger.valueOf(2 * k + 1);
            return this;
        }

        int extract(int j) {
            BigInteger bigj = BigInteger.valueOf(j);
            BigInteger numerator = q.multiply(bigj).add(r);
            BigInteger denominator = s.multiply(bigj).add(t);
            return numerator.divide(denominator).intValue();
        }

        Transformation qrst(int q, int r, int s, int t) {
            this.q = BigInteger.valueOf(q);
            this.r = BigInteger.valueOf(r);
            this.s = BigInteger.valueOf(s);
            this.t = BigInteger.valueOf(t);
            k = 0;
            return this;
        }

        Transformation compose(Transformation a) {
            return new Transformation(
                q.multiply(a.q),
                q.multiply(a.r).add(r.multiply(a.t)),
                s.multiply(a.q).add(t.multiply(a.s)),
                s.multiply(a.r).add(t.multiply(a.t))
            );
        }
    }
}
