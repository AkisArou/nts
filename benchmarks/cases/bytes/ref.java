// What a Java programmer writes for a `Uint8Array`: `byte[]`, and `& 0xff` at
// every read.
//
// **Java's `byte` is signed and JavaScript's `Uint8Array` element is not.**
// There is no unsigned byte in the language, so the mask is not a stylistic
// choice -- without it every value above 127 reads negative and the checksum
// says so immediately. It is one `iand` per read, which is the standing cost of
// unsigned arithmetic on this platform and is named in the plan as a place this
// lane structurally cannot win.
//
// That makes the row honest in a specific way: our `Uint8Array` and this
// `byte[]` are the same memory, and the difference is that one of them has to
// re-prove the range on every load. If this row loses by about the cost of a
// mask, that is the answer rather than a mystery.
//
// The inner loop is Adler-32 and `a` and `b` stay under 65521, so `int`
// arithmetic is exact and the `%` never sees a negative dividend -- which is
// the one input where Java's `%` and a modulus would part company.
final class Ref extends Bench.Work {
    // `volatile` so the buffer's contents are not compile-time constants.
    private static volatile double seed = 7;

    static int run(int seed) {
        final int length = 4096;
        byte[] data = new byte[length];

        int state = seed;
        for (int i = 0; i < length; i++) {
            state = (state * 1309 + 13849) & 65535;
            data[i] = (byte) (state & 255);
        }

        int total = 0;
        for (int pass = 0; pass < 64; pass++) {
            int a = 1;
            int b = 0;
            for (int i = 0; i < length; i++) {
                a = (a + (data[i] & 0xff)) % 65521;
                b = (b + a) % 65521;
            }
            total = total + ((b << 16) | a);
        }
        return total;
    }

    @Override public double run() {
        return run((int) seed);
    }
}
