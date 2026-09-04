package nts.rt;

import java.io.BufferedWriter;
import java.io.OutputStreamWriter;
import java.util.Random;

/** Legal string-helper inputs, serialized as UTF-16 hex for a Node oracle. */
public final class StringCorpus {
    private static String hex(String s) {
        if (s == null) { return "~"; }
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); ++i) {
            if (i != 0) { b.append(','); }
            b.append(Integer.toHexString(s.charAt(i)));
        }
        return b.toString();
    }
    public static void main(String[] args) throws Exception {
        String[] pool = {"", "abc", "a.b.a.", "$$&$`$'", "a\uD83D\uDE00b", "\uD800x\uDC00", "\uFEFF\u00A0 x \u2000", "\u0000a\n", "ΣΣ", "İß", "aaa"};
        double[] positions = {0, -0.5, -1.5, 1.5, -999, 999, Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY};
        Random random = new Random(375814);
        BufferedWriter out = new BufferedWriter(new OutputStreamWriter(System.out));
        for (int i = 0; i < 20000; ++i) {
            String s = pool[random.nextInt(pool.length)], p = pool[random.nextInt(pool.length)], r = pool[random.nextInt(pool.length)];
            double a = positions[random.nextInt(positions.length)], b = positions[random.nextInt(positions.length)];
            int op = random.nextInt(14);
            String result;
            switch (op) {
                case 0: result = hex(NtsRuntime.strReplace(s, p, r)); break;
                case 1: result = hex(NtsRuntime.strReplaceAll(s, p, r)); break;
                case 2: result = hex(NtsRuntime.strSlice(s, a, b)); break;
                case 3: result = hex(NtsRuntime.strSubstring(s, a, b)); break;
                case 4: result = hex(NtsRuntime.strAt(s, a)); break;
                case 5: result = hex(NtsRuntime.strCharAt(s, a)); break;
                case 6: result = hex(NtsRuntime.strTrim(s)); break;
                case 7: result = hex(NtsRuntime.strTrimStart(s)); break;
                case 8: result = hex(NtsRuntime.strTrimEnd(s)); break;
                case 9: result = hex(NtsRuntime.strToWellFormed(s)); break;
                case 10: result = Boolean.toString(NtsRuntime.strIsWellFormed(s)); break;
                case 11: {
                    String[] parts = NtsRuntime.strSplit(s, p);
                    StringBuilder joined = new StringBuilder().append(parts.length).append(':');
                    for (String part : parts) { joined.append(hex(part)).append(';'); }
                    result = joined.toString(); break;
                }
                case 12: result = hex(NtsRuntime.strToUpperCase(s)); break;
                default: result = hex(NtsRuntime.strToLowerCase(s));
            }
            out.write(op + "\t" + hex(s) + "\t" + hex(p) + "\t" + hex(r) + "\t" + a + "\t" + b + "\t" + result);
            out.newLine();
        }
        out.flush();
    }
}
