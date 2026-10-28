/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved.
 * See ../LICENSE-benchmarks-game for the licence notice and conditions.
 * Naive transliteration from bearophile's program;
 * contributed by Isaac Gouy.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/knucleotide-javavm-8.html
 *
 * The original single-threaded HashMap<String,Integer> and stream-based sort.
 * The line reader consumes in-memory FASTA; output is appended in memory.
 * Locale.ROOT makes decimal punctuation independent of the host locale.
 */

/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
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
    private static volatile double iterations = 1000;

    static java.util.ArrayList<String> seqLines(String input) {
        var lines = new java.util.ArrayList<String>();
        boolean started = false;
        for (String line : input.split("\n")) {
            if (started) {
                if (line.startsWith(">")) break;
                lines.add(line);
            } else {
                started = line.startsWith(">THREE");
            }
        }
        return lines;
    }

    static java.util.HashMap<String, Integer> baseCounts(int bases, String seq) {
        var counts = new java.util.HashMap<String, Integer>();
        final int size = seq.length() + 1 - bases;
        for (int i = 0; i < size; i++) {
            var nucleo = seq.substring(i, i + bases);
            Integer v;
            if ((v = counts.get(nucleo)) != null) {
                counts.put(nucleo, v + 1);
            } else {
                counts.put(nucleo, 1);
            }
        }
        return counts;
    }

    static java.util.List<String> sortedFreq(int bases, String seq) {
        final int size = seq.length() + 1 - bases;
        return baseCounts(bases, seq).entrySet()
            .stream()
            .sorted(java.util.Map.Entry.comparingByValue(java.util.Comparator.reverseOrder()))
            .map(e -> String.format(java.util.Locale.ROOT, "%s %.3f",
                e.getKey(), 100.0 * e.getValue() / size))
            .toList();
    }

    static int specificCount(String code, String seq) {
        return baseCounts(code.length(), seq).getOrDefault(code, 0);
    }

    static String render(int n) {
        final var seq = seqLines(ClbgFasta.render(n)).stream()
            .map(s -> s.toUpperCase(java.util.Locale.ROOT))
            .collect(java.util.stream.Collectors.joining(""));
        var output = new StringBuilder();
        for (int i : java.util.Arrays.asList(1, 2)) {
            for (String s : sortedFreq(i, seq)) {
                output.append(s).append('\n');
            }
            output.append('\n');
        }
        for (String code : java.util.Arrays.asList("GGT", "GGTA", "GGTATT",
                                                  "GGTATTTTAATT", "GGTATTTTAATTTATAGT")) {
            output.append(specificCount(code, seq)).append('\t').append(code).append('\n');
        }
        return output.toString();
    }

    @Override public double run() {
        String output = render((int) iterations);
        int hash = 0;
        for (int i = 0; i < output.length(); i++) {
            hash = hash * 31 + output.charAt(i);
        }
        return Integer.toUnsignedLong(hash);
    }
}
