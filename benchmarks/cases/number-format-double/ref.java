// What a Java programmer writes to format a `double`, plus the one fix-up JS
// compatibility needs -- and the fix-up is the reason this file has a long
// comment.
//
// **`Double.toString` is not `String(x)`.** Measured on this case's 192 values:
// 37 of 64 lines differ, every one of them the same rule -- Java writes `6.0`
// where JavaScript writes `6`. The *digits* agree, because JDK 19 replaced the
// old algorithm with a shortest-round-trip one, which is what JS has always
// specified. So the disagreement here is entirely about whether an integral
// double keeps a decimal point.
//
// A reference calling `Double.toString` bare would therefore be measuring a
// different program, and the harness would catch it on the checksum. Stripping
// a trailing `.0` is what a Java programmer writes when they need JS-shaped
// output, it is one comparison per value, and it makes the two lanes compute
// the same function.
//
// **It is exact for this case and is not a JS number formatter.** The two
// languages also disagree about when to switch to exponential -- Java at 1e7
// and 1e-3, JavaScript at 1e21 and 1e-6 -- and this case's values run from
// 0.0029296875 to 99, so neither side reaches either threshold and the
// disagreement cannot appear. On a case that spanned them this reference would
// be wrong, and the checksum would say so.
//
// That gap is also why `runtime/jvm` ports `nts_grisu.h` instead of wrapping
// `Double.toString`: the fix-up that suffices for a benchmark does not suffice
// for a language, and the row prices our formatter against the platform's plus
// the cheapest correction that makes them comparable.
final class Ref extends Bench.Work {
    // `volatile` so the digits are not compile-time constants.
    private static volatile double seed = 3;

    // `Double.toString` with JavaScript's rule for an integral value. Exact for
    // the range this case covers; see the note above.
    private static String jsString(double value) {
        String text = Double.toString(value);
        if (text.endsWith(".0")) {
            return text.substring(0, text.length() - 2);
        }
        return text;
    }

    static int format(double seed) {
        int total = 0;
        for (int round = 0; round < 64; round++) {
            double base = round + seed;
            double a = base / 7;
            double b = base * 1.5;
            double c = base / 1024;
            String sa = jsString(a);
            String sb = jsString(b);
            String sc = jsString(c);
            for (int k = 0; k < sa.length(); k++) {
                total = total + sa.charAt(k);
            }
            for (int k = 0; k < sb.length(); k++) {
                total = total + sb.charAt(k);
            }
            for (int k = 0; k < sc.length(); k++) {
                total = total + sc.charAt(k);
            }
        }
        return total;
    }

    @Override public double run() {
        return format(seed);
    }
}
