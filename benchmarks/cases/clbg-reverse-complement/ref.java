/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * Contributed by Anthony Donnefort; modified to read 82 bytes at a time by Razii.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/revcomp-javavm-4.html
 */

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

// The source's 82-byte reads and in-place reverse over its growable byte buffer
// are unchanged. Both stream endpoints are in memory; FASTA is generated here.
final class Ref extends Bench.Work {
    private static volatile double input = 10000;
    static final byte[] cmp = new byte[128];
    static {
        for (int i = 0; i < cmp.length; i++) cmp[i] = (byte) i;
        cmp['t'] = cmp['T'] = 'A';
        cmp['a'] = cmp['A'] = 'T';
        cmp['g'] = cmp['G'] = 'C';
        cmp['c'] = cmp['C'] = 'G';
        cmp['v'] = cmp['V'] = 'B';
        cmp['h'] = cmp['H'] = 'D';
        cmp['r'] = cmp['R'] = 'Y';
        cmp['m'] = cmp['M'] = 'K';
        cmp['y'] = cmp['Y'] = 'R';
        cmp['k'] = cmp['K'] = 'M';
        cmp['b'] = cmp['B'] = 'V';
        cmp['d'] = cmp['D'] = 'H';
        cmp['u'] = cmp['U'] = 'A';
    }

    @Override public double run() {
        String output = render((int) input);
        int hash = 0;
        for (int i = 0; i < output.length(); ++i) {
            hash = hash * 31 + output.charAt(i);
        }
        return Integer.toUnsignedLong(hash);
    }

    static final class ReversibleByteArray extends ByteArrayOutputStream {
        void reverse(ByteArrayOutputStream output) {
            if (count > 0) {
                int begin = 0, end = count - 1;
                while (buf[begin++] != '\n');
                while (begin <= end) {
                    if (buf[begin] == '\n') begin++;
                    if (buf[end] == '\n') end--;
                    if (begin <= end) {
                        byte tmp = buf[begin];
                        buf[begin++] = cmp[buf[end]];
                        buf[end--] = cmp[tmp];
                    }
                }
                output.write(buf, 0, count);
            }
        }
    }

    static String render(int n) {
        ByteArrayInputStream input = new ByteArrayInputStream(
            ClbgFasta.render(n).getBytes(StandardCharsets.US_ASCII));
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] line = new byte[82];
        int read;
        ReversibleByteArray buf = new ReversibleByteArray();
        while ((read = input.read(line, 0, line.length)) != -1) {
            int i = 0, last = 0;
            while (i < read) {
                if (line[i] == '>') {
                    buf.write(line, last, i - last);
                    buf.reverse(output);
                    buf.reset();
                    last = i;
                }
                i++;
            }
            buf.write(line, last, read - last);
        }
        buf.reverse(output);
        return output.toString(StandardCharsets.US_ASCII);
    }
}

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
