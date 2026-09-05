// What a Java programmer writes for integer mixing: `int`, and every operator
// lands on the one the TypeScript meant.
//
// This case is written to be provably integral -- `| 0` and `>>>` are ToInt32
// proofs -- so the reference is a transliteration with the `| 0`s dropped,
// because in Java the type is already the proof. That is the honest comparison:
// both lanes are doing `int` arithmetic and the ratio is about codegen.
//
// `h >>> 7` is `>>>` in both languages and means the same thing on an `int`.
// `(h << 5) - h` is left as written rather than folded to `h * 31`, because the
// TypeScript says so and the two differ in nothing but what the compiler is
// being asked to notice.
final class Ref {
    // `volatile` so the whole loop is not a compile-time constant: `checksum`
    // is a pure function of its seed and 4096 is a literal trip count.
    private static volatile double seed = 12345;

    static int checksum(int seed) {
        int h = seed;
        for (int i = 0; i < 4096; i++) {
            h = h * 31 + i;
            h ^= h >>> 7;
            h = (h << 5) - h;
        }
        return h;
    }

    static double benchRun() {
        return checksum((int) seed);
    }
}
