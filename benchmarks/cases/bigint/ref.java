// What a Java programmer writes for arbitrary-precision integer arithmetic:
// `java.math.BigInteger`. There is no other answer in the standard library, and
// that is the whole point of this row.
//
// This lane represents a `bigint` as two `long`s -- 128 bits, wrapping, no
// allocation -- which is a deliberate trade of precision for representation,
// argued in `typescript.md` on the grounds that every `bigint` in the node
// profile is really a 64-bit quantity. `BigInteger` makes the opposite trade
// and allocates an object per operation. So this reference is not a
// transliteration of our design into Java; it is the design a Java programmer
// is given, and the ratio prices ours against it.
//
// **The two agree here, and that is checked rather than assumed.** Every value
// stays far inside 128 bits -- `b` is masked to 48, `a` is bounded by a
// billion-ish modulus plus `b >> 5`, so the widest intermediate is `a * b` at
// about 2^78 -- so exact arithmetic and 128-bit wrapping compute the same
// number, and the harness compares by bit pattern. On a case that did overflow,
// this reference would be *more* correct than the program it measures and the
// checksum would say so, which is the right failure.
//
// `.mod` rather than `.remainder`, which is what a person writes for a modulus.
// They differ only on a negative dividend and nothing here is ever negative;
// `%` in the TypeScript is `.remainder`'s truncating rule, so the two are the
// same function on this input and the note is here so the next reader does not
// have to re-derive it.
import java.math.BigInteger;

final class Ref extends Bench.Work {
    private static final BigInteger MODULUS = BigInteger.valueOf(1000000007L);
    private static final BigInteger ADDEND = BigInteger.valueOf(12345L);
    private static final BigInteger MASK48 = new BigInteger("ffffffffffff", 16);
    private static final BigInteger MASK16 = BigInteger.valueOf(0xffffL);

    // `volatile` so the trip count is unknown, which is what the TypeScript
    // uses the seed for: the arithmetic is otherwise a constant.
    private static volatile double seed = 3;

    static double mix(int seed) {
        BigInteger a = BigInteger.ONE;
        BigInteger b = BigInteger.valueOf(998244353L);
        int rounds = 61 + seed;
        for (int round = 0; round < rounds; round++) {
            a = a.multiply(b).add(ADDEND).mod(MODULUS);
            b = b.xor(a.shiftLeft(3)).and(MASK48);
            a = a.add(b.shiftRight(5));
        }
        return a.xor(b).and(MASK16).doubleValue();
    }

    @Override public double run() {
        return mix((int) seed);
    }
}
