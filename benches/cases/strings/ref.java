// What a Java programmer writes for a scan by code unit and two searches, which
// is very nearly what a JavaScript programmer writes -- and that is this row's
// whole point.
//
// `java.lang.String` *is* the JS string model: UTF-16 code units, compact
// one-byte storage when they fit, and `charAt`, `indexOf`, `contains` and
// `startsWith` all mean what `charCodeAt`, `indexOf`, `includes` and
// `startsWith` mean. So the reference is a rename, not a reimplementation, and
// this lane compiles to calls on the same class the reference calls -- these
// are JIT intrinsics on both sides.
//
// That makes the row a narrow and useful question: **with the same data
// structure and the same intrinsics under both, what does the surrounding
// codegen cost?** The C column answers a different one, because `runtime/c`
// implements all of this by hand.
//
// `charAt` rather than `codePointAt`, because `charCodeAt` is a code *unit* and
// `codePointAt` would combine a surrogate pair. This text is ASCII so the two
// agree, and the one that agrees for the right reason is written.
final class Ref extends Bench.Work {
    // `volatile` so the loop is not a compile-time constant: `text` is a
    // literal and everything else derives from the seed.
    private static volatile double seed = 3;

    static int scan(int seed) {
        String text = "the quick brown fox jumps over the lazy dog";
        int step = seed;
        int total = 0;
        for (int round = 0; round < 128; round++) {
            for (int i = 0; i < text.length(); i++) {
                total = total + text.charAt(i) * step;
            }
            total = total + text.indexOf("brown");
            if (text.contains("jumps")) {
                total = total + 1;
            }
            if (text.startsWith("the")) {
                total = total + 2;
            }
        }
        return total;
    }

    @Override public double run() {
        return scan((int) seed);
    }
}
