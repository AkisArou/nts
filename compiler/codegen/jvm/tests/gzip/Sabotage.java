import nts.rt.NtsGzip;
import nts.rt.NtsRefusal;

/** Every corruption a gzip stream can carry must be refused, not absorbed. */
public final class Sabotage {
    static byte[] hex(String s) {
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }
    /** Decode to completion; null if it refused, the bytes otherwise. */
    static byte[] decode(byte[] gz) {
        NtsGzip d = NtsGzip.newDecoder();
        byte[] out = new byte[8192];
        java.io.ByteArrayOutputStream all = new java.io.ByteArrayOutputStream();
        try {
            int at = 0;
            while (at < gz.length && !NtsGzip.finished(d)) {
                int written = NtsGzip.decode(d, gz, at, gz.length - at, out, 0, out.length);
                all.write(out, 0, written);
                int used = NtsGzip.consumed(d);
                if (used == 0 && written == 0) { break; }
                at += used;
            }
            return NtsGzip.finished(d) ? all.toByteArray() : null;
        } catch (NtsRefusal refused) {
            return null;
        } finally {
            NtsGzip.end(d);
        }
    }
    static int failures;
    static void mustRefuse(String what, byte[] gz) {
        byte[] got = decode(gz);
        if (got != null) {
            failures++;
            System.out.printf("ACCEPTED corruption: %s (%d bytes out)%n", what, got.length);
        }
    }
    public static void main(String[] args) throws Exception {
        String line = new java.io.BufferedReader(new java.io.FileReader(args[0])).readLine();
        // `plain-2`: a real stream long enough that a body flip lands in DEFLATE data.
        String[] vectors = new String(java.nio.file.Files.readAllBytes(
            java.nio.file.Paths.get(args[0])), "UTF-8").split("\n");
        byte[] good = null;
        for (String v : vectors) { if (v.startsWith("plain-2 ")) { good = hex(v.split(" ")[1]); } }
        if (good == null) { throw new IllegalStateException("no plain-2 vector"); }

        // The stream itself must still decode, or every check below is vacuous.
        if (decode(good) == null) { throw new IllegalStateException("the honest stream did not decode"); }

        byte[] c;
        c = good.clone(); c[0] ^= 1;                 mustRefuse("magic byte 1", c);
        c = good.clone(); c[1] ^= 1;                 mustRefuse("magic byte 2", c);
        c = good.clone(); c[2] = 9;                  mustRefuse("compression method", c);
        c = good.clone(); c[good.length - 5] ^= 1;   mustRefuse("trailer CRC32", c);
        c = good.clone(); c[good.length - 1] ^= 1;   mustRefuse("trailer ISIZE", c);
        c = java.util.Arrays.copyOf(good, good.length - 1);      mustRefuse("truncated trailer", c);
        c = java.util.Arrays.copyOf(good, good.length - 8);      mustRefuse("trailer absent", c);
        c = good.clone(); c[30] ^= 0xff;             mustRefuse("body byte", c);

        // A header CRC that does not cover the header it precedes.
        byte[] withHcrc = null;
        for (String v : vectors) { if (v.startsWith("hcrc ")) { withHcrc = hex(v.split(" ")[1]); } }
        if (withHcrc == null) { throw new IllegalStateException("no hcrc vector"); }
        if (decode(withHcrc) == null) { throw new IllegalStateException("the honest FHCRC stream did not decode"); }
        c = withHcrc.clone(); c[10] ^= 1;            mustRefuse("FHCRC over a corrupted header", c);

        System.out.printf("%d corruptions, %d accepted%n", 9, failures);
        if (failures != 0) { System.exit(1); }
    }
}
