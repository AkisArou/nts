// What a Java programmer writes for UTF-8 encode and decode:
// `String.getBytes(UTF_8)` and `new String(bytes, UTF_8)`.
//
// **Java's API has no non-allocating encode**, and that is a real difference
// rather than a translation choice. The TypeScript calls `utf8Write(buffer,
// text, 0, size)`, which fills a caller-owned `Uint8Array`; the JDK's answer is
// `getBytes`, which allocates a fresh array every time, and the buffer then has
// to be filled from it. `CharsetEncoder` into a wrapped `ByteBuffer` would avoid
// the copy and is not what anybody writes -- it is four lines of setup and a
// `CoderResult` to interpret.
//
// So this reference pays an allocation per round that we do not, and the row
// should be read with that in mind: a win here is partly the API and not only
// the codec. The copy is kept rather than dropped because dropping it would
// stop the reference from filling the buffer the case is about.
//
// The text covers every arm the decoder branches on -- ASCII, two-byte
// Latin-1, three-byte CJK, and astral code points that are four bytes in UTF-8
// and a surrogate pair in UTF-16 -- so `back.length()` counts UTF-16 units and
// differs from the byte count, which is what makes the checksum test both
// directions rather than one.
//
// `StandardCharsets.UTF_8` rather than the `String` overload, because the named
// constant cannot throw `UnsupportedEncodingException` and is what current Java
// uses.
import java.nio.charset.StandardCharsets;

final class Ref {
    private static final String TEXT =
        "the quick brown fox jumps over the lazy dog "
            + "éèêüñ précis café naïve "
            + "你好世界 こんにちは "
            + "😀🌍🚀";

    // `volatile` so the round count is not a compile-time constant.
    private static volatile double iterations = 1;

    static double work(int iterations) {
        byte[] encoded = TEXT.getBytes(StandardCharsets.UTF_8);
        int size = encoded.length;
        byte[] buffer = new byte[size];

        double total = 0;
        for (int round = 0; round < 64 * iterations; round++) {
            byte[] fresh = TEXT.getBytes(StandardCharsets.UTF_8);
            System.arraycopy(fresh, 0, buffer, 0, fresh.length);
            int written = fresh.length;
            String back = new String(buffer, 0, written, StandardCharsets.UTF_8);
            total = total + written + back.length();
        }
        return total;
    }

    static double benchRun() {
        return work((int) iterations);
    }
}
