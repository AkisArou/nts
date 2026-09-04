package nts.rt;

import java.io.BufferedWriter;
import java.io.OutputStreamWriter;
import java.util.Random;

/** Hex input bits, JS-style decimal spelling, and ToInt32 result for a Node oracle. */
public final class NumberCorpus {
    private static final BufferedWriter OUT = new BufferedWriter(new OutputStreamWriter(System.out));
    private static void emit(double x) throws java.io.IOException {
        OUT.write(Long.toHexString(Double.doubleToRawLongBits(x)));
        OUT.write('\t'); OUT.write(NtsRuntime.numberToString(x));
        OUT.write('\t'); OUT.write(Integer.toString(NtsRuntime.toInt32(x))); OUT.newLine();
    }
    public static void main(String[] args) throws Exception {
        int count = args.length == 0 ? 100000 : Integer.parseInt(args[0]);
        Random random = new Random(6723419);
        for (int i = 0; i < count; ++i) { emit(Double.longBitsToDouble(random.nextLong())); }
        for (int exp = -324; exp <= 308; ++exp) {
            double x = Math.pow(10.0, exp);
            for (int i = 0; i < 8; ++i) {
                emit(x); emit(-x); emit(Math.nextDown(x)); emit(-Math.nextDown(x));
                x = Math.nextUp(x);
            }
        }
        for (int i = 0; i < 4096; ++i) {
            emit(Double.longBitsToDouble(i)); emit(-Double.longBitsToDouble(i));
        }
        for (double x : new double[] {Double.MAX_VALUE, Double.MIN_NORMAL, Double.NaN,
                Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, 0.0, -0.0, 0.1,
                1e21, 1e-6, 1e-7, 1e23, 0x1p53, 0x1p63, 0x1p84}) { emit(x); }
        OUT.flush();
    }
}
