import java.io.BufferedReader;
import java.io.FileReader;
import nts.rt.NtsGzip;

/** Decode every vector at every chunk size, and prove the split never matters. */
public final class Drive {
    static byte[] hex(String s) {
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }
    /** Feed `gz` in fixed-size chunks; return everything the decoder produced. */
    static byte[] run(byte[] gz, int chunk, int outChunk) {
        NtsGzip d = NtsGzip.newDecoder();
        byte[] out = new byte[Math.max(1, outChunk)];
        java.io.ByteArrayOutputStream all = new java.io.ByteArrayOutputStream();
        int at = 0;
        try {
            while (at < gz.length && !NtsGzip.finished(d)) {
                int len = Math.min(chunk, gz.length - at);
                int written;
                do {
                    written = NtsGzip.decode(d, gz, at, len, out, 0, out.length);
                    all.write(out, 0, written);
                    int used = NtsGzip.consumed(d);
                    at += used;
                    len -= used;
                    if (used == 0 && written == 0) { break; }
                } while (len > 0 || written == out.length);
            }
            if (!NtsGzip.finished(d)) { return null; }
            return all.toByteArray();
        } finally {
            NtsGzip.end(d);
        }
    }
    public static void main(String[] args) throws Exception {
        int cases = 0, checks = 0, bad = 0;
        try (BufferedReader in = new BufferedReader(new FileReader(args[0]))) {
            String line;
            while ((line = in.readLine()) != null) {
                String[] f = line.split(" ");
                byte[] gz = hex(f[1]);
                byte[] want = hex(f.length > 2 ? f[2] : "");
                cases++;
                for (int chunk : new int[] { 1, 2, 3, 7, 13, 64, 1024, 1 << 20 }) {
                    for (int outChunk : new int[] { 1, 5, 97, 4096, 1 << 20 }) {
                        checks++;
                        byte[] got = run(gz, chunk, outChunk);
                        if (got == null || !java.util.Arrays.equals(got, want)) {
                            bad++;
                            if (bad < 4) {
                                System.out.printf("MISMATCH %s chunk=%d out=%d got=%s want=%d bytes%n",
                                    f[0], chunk, outChunk, got == null ? "unfinished" : got.length + " bytes",
                                    want.length);
                            }
                        }
                    }
                }
            }
        }
        System.out.printf("%d vectors, %d chunk/output combinations, %d mismatches%n", cases, checks, bad);
        if (bad != 0) { System.exit(1); }
    }
}
