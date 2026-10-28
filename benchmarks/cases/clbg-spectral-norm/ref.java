/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * Contributed by Java novice Jarkko Miettinen; modified from Isaac Gouy's C# version.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/spectralnorm-graalvmaot-1.html
 */

import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.text.NumberFormat;
import java.util.Locale;

// The source's matrix functions, allocations and arithmetic are unchanged.
// Fix the formatter's locale so decimal output is independent of the host.
final class Ref extends Bench.Work {
    private static volatile double input = 128;
    private static final NumberFormat formatter =
        new DecimalFormat("#.000000000", DecimalFormatSymbols.getInstance(Locale.ROOT));

    @Override public double run() {
        String output = formatter.format(Approximate((int) input)) + "\n";
        int hash = 0;
        for (int i = 0; i < output.length(); ++i) {
            hash = hash * 31 + output.charAt(i);
        }
        return Integer.toUnsignedLong(hash);
    }

    private double Approximate(int n) {
        double[] u = new double[n];
        for (int i = 0; i < n; i++) u[i] = 1;

        double[] v = new double[n];
        for (int i = 0; i < n; i++) v[i] = 0;
        for (int i = 0; i < 10; i++) {
            MultiplyAtAv(n, u, v);
            MultiplyAtAv(n, v, u);
        }

        double vBv = 0, vv = 0;
        for (int i = 0; i < n; i++) {
            vBv += u[i] * v[i];
            vv += v[i] * v[i];
        }
        return Math.sqrt(vBv / vv);
    }

    private double A(int i, int j) {
        return 1.0 / ((i + j) * (i + j + 1) / 2 + i + 1);
    }

    private void MultiplyAv(int n, double[] v, double[] Av) {
        for (int i = 0; i < n; i++) {
            Av[i] = 0;
            for (int j = 0; j < n; j++) Av[i] += A(i, j) * v[j];
        }
    }

    private void MultiplyAtv(int n, double[] v, double[] Atv) {
        for (int i = 0; i < n; i++) {
            Atv[i] = 0;
            for (int j = 0; j < n; j++) Atv[i] += A(j, i) * v[j];
        }
    }

    private void MultiplyAtAv(int n, double[] v, double[] AtAv) {
        double[] u = new double[n];
        MultiplyAv(n, v, u);
        MultiplyAtv(n, u, AtAv);
    }
}
