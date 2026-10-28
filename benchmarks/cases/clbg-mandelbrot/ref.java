/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * Contributed by Stefan Krause; slightly modified by Chad Whipkey.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/mandelbrot-graalvmaot-1.html
 */

// The Game's single-threaded Java program. Only its output destination changes:
// retain its 8192-byte buffer and flush it into an in-memory byte string.
final class Ref extends Bench.Work {
    private static volatile double input = 256;

    @Override public double run() {
        String output = new Mandelbrot((int) input).compute();
        int hash = 0;
        for (int i = 0; i < output.length(); ++i) {
            hash = hash * 31 + output.charAt(i);
        }
        return Integer.toUnsignedLong(hash);
    }

    static final class Mandelbrot {
        private static final int BUFFER_SIZE = 8192;
        final int size;
        final StringBuilder out = new StringBuilder();
        final byte[] buf = new byte[BUFFER_SIZE];
        int bufLen = 0;
        final double fac;
        final int shift;

        Mandelbrot(int size) {
            this.size = size;
            fac = 2.0 / size;
            shift = size % 8 == 0 ? 0 : (8 - size % 8);
        }

        private void write(byte[] bytes, int length) {
            for (int i = 0; i < length; ++i) {
                out.append((char) (bytes[i] & 0xff));
            }
        }

        String compute() {
            out.append("P4\n").append(size).append(' ').append(size).append('\n');
            for (int y = 0; y < size; y++) {
                computeRow(y);
            }
            write(buf, bufLen);
            return out.toString();
        }

        private void computeRow(int y) {
            int bits = 0;
            final double Ci = (y * fac - 1.0);
            final byte[] bufLocal = buf;
            for (int x = 0; x < size; x++) {
                double Zr = 0.0;
                double Zi = 0.0;
                double Cr = (x * fac - 1.5);
                int i = 50;
                double ZrN = 0;
                double ZiN = 0;
                do {
                    Zi = 2.0 * Zr * Zi + Ci;
                    Zr = ZrN - ZiN + Cr;
                    ZiN = Zi * Zi;
                    ZrN = Zr * Zr;
                } while (!(ZiN + ZrN > 4.0) && --i > 0);

                bits = bits << 1;
                if (i == 0) bits++;

                if (x % 8 == 7) {
                    bufLocal[bufLen++] = (byte) bits;
                    if (bufLen == BUFFER_SIZE) {
                        write(bufLocal, BUFFER_SIZE);
                        bufLen = 0;
                    }
                    bits = 0;
                }
            }
            if (shift != 0) {
                bits = bits << shift;
                bufLocal[bufLen++] = (byte) bits;
                if (bufLen == BUFFER_SIZE) {
                    write(bufLocal, BUFFER_SIZE);
                    bufLen = 0;
                }
            }
        }
    }
}
