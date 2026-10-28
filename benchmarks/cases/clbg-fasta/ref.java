/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved.
 * See ../LICENSE-benchmarks-game for the licence notice and conditions.
 * Naive transliteration from Drake Diedrich's C program;
 * contributed by Isaac Gouy.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/fasta-javavm-8.html
 *
 * The original single-threaded generator, with println redirected to a string
 * and the random seed reset for each complete output. Its per-line
 * StringBuilder, subtractive probability lookup and arithmetic are unchanged.
 */
final class ClbgFasta {
    static final int IM = 139968;
    static final int IA = 3877;
    static final int IC = 29573;
    static final int SEED = 42;
    static int randomSeed = SEED;

    static double fastaRand(double max) {
        randomSeed = (randomSeed * IA + IC) % IM;
        return max * randomSeed / IM;
    }

    static final String ALU =
        "GGCCGGGCGCGGTGGCTCACGCCTGTAATCCCAGCACTTTGG" +
        "GAGGCCGAGGCGGGCGGATCACCTGAGGTCAGGAGTTCGAGA" +
        "CCAGCCTGGCCAACATGGTGAAACCCCGTCTCTACTAAAAAT" +
        "ACAAAAATTAGCCGGGCGTGGTGGCGCGCGCCTGTAATCCCA" +
        "GCTACTCGGGAGGCTGAGGCAGGAGAATCGCTTGAACCCGGG" +
        "AGGCGGAGGTTGCAGTGAGCCGAGATCGCGCCACTGCACTCC" +
        "AGCCTGGGCGACAGAGCGAGACTCCGTCTCAAAAA";
    static final String iub = "acgtBDHKMNRSVWY";
    static final double[] iubP = {
        0.27, 0.12, 0.12, 0.27,
        0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02
    };
    static final String homosapiens = "acgt";
    static final double[] homosapiensP = {
        0.3029549426680,
        0.1979883004921,
        0.1975473066391,
        0.3015094502008
    };
    static final int LINELEN = 60;

    static void repeatFasta(StringBuilder output, String seq, int n) {
        int len = seq.length();
        int i;
        var b = new StringBuilder();
        for (i = 0; i < n; i++) {
            b.append(seq.charAt(i % len));
            if (i % LINELEN == LINELEN - 1) {
                output.append(b.toString()).append('\n');
                b.setLength(0);
            }
        }
        if (i % LINELEN != 0) output.append(b.toString()).append('\n');
    }

    static void randomFasta(StringBuilder output, String seq,
                            double[] probability, int n) {
        int len = seq.length();
        int i, j;
        var b = new StringBuilder();
        for (i = 0; i < n; i++) {
            double v = fastaRand(1.0);
            for (j = 0; j < len - 1; j++) {
                v -= probability[j];
                if (v < 0) break;
            }
            b.append(seq.charAt(j));
            if (i % LINELEN == LINELEN - 1) {
                output.append(b.toString()).append('\n');
                b.setLength(0);
            }
        }
        if (i % LINELEN != 0) output.append(b.toString()).append('\n');
    }

    static String render(int n) {
        randomSeed = SEED;
        var output = new StringBuilder();
        output.append(">ONE Homo sapiens alu\n");
        repeatFasta(output, ALU, n * 2);
        output.append(">TWO IUB ambiguity codes\n");
        randomFasta(output, iub, iubP, n * 3);
        output.append(">THREE Homo sapiens frequency\n");
        randomFasta(output, homosapiens, homosapiensP, n * 5);
        return output.toString();
    }
}

final class Ref extends Bench.Work {
    // The size must remain opaque, just as it is in the other lanes.
    private static volatile double iterations = 10000;

    @Override public double run() {
        String output = ClbgFasta.render((int) iterations);
        int hash = 0;
        for (int i = 0; i < output.length(); i++) {
            hash = hash * 31 + output.charAt(i);
        }
        return Integer.toUnsignedLong(hash);
    }
}
