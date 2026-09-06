import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.zip.GZIPOutputStream;
import nts.rt.NtsEnv;
import nts.rt.NtsNumberCallback;
import nts.rt.NtsTextPairCallback;
import nts.rt.NtsGzip;
import nts.rt.NtsSocket;

/**
 * The pieces composed: socket, HTTP/1 framing, gzip, and the owner lane.
 *
 * <p>Each part is tested alone elsewhere. What this proves is that they hold
 * together — a body arriving in whatever chunks the socket produces, decoded
 * incrementally by a state machine that never sees a whole frame, with every
 * completion crossing the inbox — and that the **observable headers survive**.
 *
 * <p>That last point is the one that matters for the production provider. A
 * platform HTTP client that decompresses transparently strips `Content-Encoding`
 * and `Content-Length` while doing it, so the same response yields different
 * observable headers depending on which adapter fetched it. This test records
 * what the reference adapter exposes; the OkHttp adapter must expose the same,
 * and the cross-adapter assertion the plan requires is the pair.
 */
public final class HttpGzipTest {
    static int failures;
    /**
     * How many checks ran, printed beside the failures.
     *
     * Zero failures is satisfied by a suite that stopped running. A count is
     * what makes that visible, and it is the same assertion `android.rs` makes
     * about `PASS: 11` -- which I wrote and then did not apply here.
     */
    static int checks;

    static void check(boolean ok, String what) {
        checks++;
        if (!ok) { failures++; System.out.println("FAILED: " + what); }
    }

    /** Serves one fixed gzip-encoded response, then closes. */
    static final class Server implements Runnable {
        final ServerSocket listener;
        final byte[] response;
        volatile boolean stop;
        Server(byte[] body) throws IOException {
            listener = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
            ByteArrayOutputStream compressed = new ByteArrayOutputStream();
            try (GZIPOutputStream gz = new GZIPOutputStream(compressed)) { gz.write(body); }
            byte[] encoded = compressed.toByteArray();
            String head = "HTTP/1.1 200 OK\r\n"
                + "Content-Type: text/plain\r\n"
                + "Content-Encoding: gzip\r\n"
                + "Content-Length: " + encoded.length + "\r\n"
                + "Connection: close\r\n\r\n";
            byte[] headBytes = head.getBytes("ISO-8859-1");
            response = new byte[headBytes.length + encoded.length];
            System.arraycopy(headBytes, 0, response, 0, headBytes.length);
            System.arraycopy(encoded, 0, response, headBytes.length, encoded.length);
        }
        int port() { return listener.getLocalPort(); }
        @Override public void run() {
            while (!stop) {
                try (Socket peer = listener.accept()) {
                    InputStream in = peer.getInputStream();
                    // Read the request line and headers, no more.
                    int state = 0;
                    int b;
                    while (state < 4 && (b = in.read()) >= 0) {
                        state = (b == '\r' && (state == 0 || state == 2)) || (b == '\n' && (state == 1 || state == 3))
                            ? state + 1 : 0;
                    }
                    OutputStream out = peer.getOutputStream();
                    // Deliberately dribbled: the decoder must survive a split
                    // anywhere, including inside the gzip header and trailer.
                    for (int at = 0; at < response.length; at += 7) {
                        out.write(response, at, Math.min(7, response.length - at));
                        out.flush();
                    }
                } catch (IOException closing) {
                    if (stop) { return; }
                }
            }
        }
        void close() { stop = true; try { listener.close(); } catch (IOException ignored) { /* stopping */ } }
    }

    /**
     * The two closures a completion is now, held together for the test's
     * convenience -- which is exactly what generated code does *not* do: two
     * separate closures arrive, and this class exists only so a test can
     * assert on both halves at once.
     */
    static final class Result implements NtsNumberCallback, NtsTextPairCallback {
        double value = Double.NaN;
        String name;
        String message;
        @Override public void call(double v) { value = v; }
        @Override public void call(String n, String m) { name = n; message = m; }
    }

    public static void main(String[] args) throws Exception {
        StringBuilder made = new StringBuilder();
        for (int i = 0; i < 20000; i++) { made.append("line ").append(i).append('\n'); }
        byte[] expected = made.toString().getBytes("UTF-8");

        Server server = new Server(expected);
        Thread thread = new Thread(server, "http-gzip");
        thread.setDaemon(true);
        thread.start();

        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 64);
        NtsEnv previous = NtsEnv.enterEnv(env);
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        String contentEncoding = null;
        String contentLength = null;
        try {
            Result connected = new Result();
            NtsSocket.connect(env, NtsEnv.launch(env), "127.0.0.1", server.port(), false, 4000, connected, connected);
            NtsEnv.drain(env);
            check(connected.name == null, "connect failed: " + connected.name + " " + connected.message);
            double handle = connected.value;

            byte[] request = ("GET / HTTP/1.1\r\nHost: localhost\r\n"
                + "Accept-Encoding: gzip\r\nConnection: close\r\n\r\n").getBytes("ISO-8859-1");
            Result sent = new Result();
            NtsSocket.write(env, NtsEnv.launch(env), handle, request, 0, request.length, sent, sent);
            NtsEnv.drain(env);
            check(sent.name == null, "request write failed: " + sent.name);

            // Read until the peer closes, feeding the decoder as bytes arrive.
            NtsGzip decoder = NtsGzip.newDecoder();
            byte[] chunk = new byte[64];
            byte[] out = new byte[1024];
            StringBuilder head = new StringBuilder();
            boolean inHead = true;
            for (;;) {
                Result read = new Result();
                NtsSocket.read(env, NtsEnv.launch(env), handle, chunk, 0, chunk.length, read, read);
                NtsEnv.drain(env);
                if (read.name != null || read.value <= 0) { break; }
                int at = 0;
                int have = (int) read.value;
                if (inHead) {
                    while (at < have && inHead) {
                        head.append((char) (chunk[at] & 0xff));
                        at++;
                        int n = head.length();
                        if (n >= 4 && head.charAt(n - 4) == '\r' && head.charAt(n - 3) == '\n'
                            && head.charAt(n - 2) == '\r' && head.charAt(n - 1) == '\n') {
                            inHead = false;
                        }
                    }
                }
                while (at < have) {
                    int written = NtsGzip.decode(decoder, chunk, at, have - at, out, 0, out.length);
                    body.write(out, 0, written);
                    int used = NtsGzip.consumed(decoder);
                    if (used == 0 && written == 0) { break; }
                    at += used;
                }
            }
            NtsGzip.end(decoder);
            NtsSocket.close(handle);

            for (String line : head.toString().split("\r\n")) {
                String lower = line.toLowerCase(java.util.Locale.ROOT);
                if (lower.startsWith("content-encoding:")) { contentEncoding = line.substring(17).trim(); }
                if (lower.startsWith("content-length:")) { contentLength = line.substring(15).trim(); }
            }
            check(NtsEnv.outstanding(env) == 0.0, NtsEnv.outstanding(env) + " outstanding after the exchange");
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
            server.close();
            NtsSocket.shutdown();
        }

        byte[] got = body.toByteArray();
        check(got.length == expected.length, "decoded " + got.length + " bytes of " + expected.length);
        if (got.length == expected.length) {
            for (int i = 0; i < got.length; i++) {
                if (got[i] != expected[i]) { check(false, "byte " + i + " differs"); break; }
            }
        }
        // The reference adapter does not decompress on the caller's behalf, so
        // the wire headers are exactly what the response carried. This is the
        // observable the production adapter has to match.
        check("gzip".equals(contentEncoding),
            "the reference adapter exposed Content-Encoding: " + contentEncoding);
        check(contentLength != null && !contentLength.equals(String.valueOf(expected.length)),
            "Content-Length was the decoded size (" + contentLength + "), not the encoded size");

        System.out.printf("http+gzip: %d bytes decoded from a dribbled response, "
            + "Content-Encoding=%s Content-Length=%s -- %d checks, %d failures%n",
            got.length, contentEncoding, contentLength, checks, failures);
        if (failures != 0) { System.exit(1); }
    }
}
