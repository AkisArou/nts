import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;
import okhttp3.OkHttpClient;
import org.nts.web.OkHttpNetworking;

/**
 * The production provider must not rewrite the response.
 *
 * <p>Four of OkHttp's defaults change *what happens* -- redirects, cookies,
 * caching, retries -- and turning those off is checkable by seeing the thing
 * not happen. Transparent decompression is different: it changes what the
 * response **says**. OkHttp adds `Accept-Encoding: gzip` when the caller has
 * not, decompresses the body it then gets, and strips `Content-Encoding` and
 * `Content-Length` because leaving them would describe bytes it has replaced.
 *
 * <p>That is correct of OkHttp and wrong here. Shared TypeScript that reads
 * `Content-Encoding` to decide whether to inflate would see the header gone --
 * on Android only, with the identical program on the raw transport seeing it
 * present. A difference in observable Fetch behaviour that depends on the
 * provider is the thing this whole boundary exists to prevent.
 *
 * <p>So the assertion is on the bytes *and* on both headers. Checking only the
 * headers would pass for a provider that stripped them and left the body
 * compressed; checking only the bytes would pass for one that decompressed and
 * left the headers lying about it. Neither half is the property.
 */
public final class OkHttpHeadersTest {
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
        if (!ok) { failures++; if (failures < 12) { System.out.println("FAILED: " + what); } }
    }

    /** Serves one canned response per connection, and records what it was asked. */
    static final class Server implements Runnable {
        final ServerSocket listener;
        final byte[] body;
        final String extraHeaders;
        final int status;
        volatile boolean stop;
        volatile String lastRequest = "";
        volatile int served;
        Server(int status, byte[] body, String extraHeaders) throws IOException {
            listener = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
            this.status = status;
            this.body = body;
            this.extraHeaders = extraHeaders;
        }
        int port() { return listener.getLocalPort(); }
        @Override public void run() {
            while (!stop) {
                try (Socket peer = listener.accept()) {
                    InputStream in = peer.getInputStream();
                    StringBuilder head = new StringBuilder();
                    int consecutive = 0;
                    while (consecutive < 2) {
                        int b = in.read();
                        if (b < 0) { break; }
                        if (b == '\n') { consecutive++; } else if (b != '\r') { consecutive = 0; }
                        head.append((char) b);
                    }
                    lastRequest = head.toString();
                    served++;
                    OutputStream out = peer.getOutputStream();
                    StringBuilder response = new StringBuilder();
                    response.append("HTTP/1.1 ").append(status).append(" X\r\n");
                    response.append("Content-Length: ").append(body.length).append("\r\n");
                    response.append(extraHeaders);
                    response.append("Connection: close\r\n\r\n");
                    out.write(response.toString().getBytes("ISO-8859-1"));
                    out.write(body);
                    out.flush();
                } catch (IOException closing) { if (stop) { return; } }
            }
        }
        void close() { stop = true; try { listener.close(); } catch (IOException ignored) { /* stopping */ } }
    }

    static final class Answer {
        int status;
        String[] headers;
        byte[] body;
        String name;
        String message;
        String header(String want) {
            if (headers == null) { return null; }
            for (int i = 0; i + 1 < headers.length; i += 2) {
                if (headers[i].equalsIgnoreCase(want)) { return headers[i + 1]; }
            }
            return null;
        }
    }

    static Answer get(OkHttpClient client, ExecutorService lane, String url, String[] headers)
            throws Exception {
        final CompletableFuture<Answer> done = new CompletableFuture<Answer>();
        OkHttpNetworking.send(client, lane, "GET", url, headers, null,
            new OkHttpNetworking.ResponseCallback() {
                @Override public void success(int status, String[] received, byte[] body) {
                    Answer answer = new Answer();
                    answer.status = status; answer.headers = received; answer.body = body;
                    done.complete(answer);
                }
                @Override public void failure(String name, String message) {
                    Answer answer = new Answer();
                    answer.name = name; answer.message = message;
                    done.complete(answer);
                }
            });
        return done.get(20, TimeUnit.SECONDS);
    }

    static byte[] gzip(byte[] plain) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        GZIPOutputStream zip = new GZIPOutputStream(out);
        zip.write(plain);
        zip.close();
        return out.toByteArray();
    }

    static byte[] gunzip(byte[] compressed) throws IOException {
        GZIPInputStream in = new GZIPInputStream(new java.io.ByteArrayInputStream(compressed));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int n;
        while ((n = in.read(buffer)) > 0) { out.write(buffer, 0, n); }
        in.close();
        return out.toByteArray();
    }

    static void decompression(ExecutorService lane) throws Exception {
        byte[] plain = new byte[40000];
        for (int i = 0; i < plain.length; i++) { plain[i] = (byte) ('a' + (i % 26)); }
        byte[] compressed = gzip(plain);
        Server server = new Server(200, compressed, "Content-Encoding: gzip\r\n");
        start(server, "gzip-server");
        OkHttpClient client = OkHttpNetworking.client();
        try {
            Answer answer = get(client, lane, "http://127.0.0.1:" + server.port() + "/", new String[0]);
            check(answer.name == null, "the request failed: " + answer.name + ": " + answer.message);
            check(answer.status == 200, "status was " + answer.status);

            check("gzip".equalsIgnoreCase(String.valueOf(answer.header("Content-Encoding"))),
                "Content-Encoding came back as " + answer.header("Content-Encoding")
                + " -- OkHttp decompressed the body and removed the header that said it was "
                + "compressed, so shared code that reads it sees a different response on this "
                + "provider than on the raw one");
            check(answer.header("Content-Length") != null
                    && Integer.parseInt(answer.header("Content-Length")) == compressed.length,
                "Content-Length came back as " + answer.header("Content-Length")
                + " rather than the " + compressed.length + " bytes the server sent");
            check(answer.body != null && answer.body.length == compressed.length,
                "the body was " + (answer.body == null ? -1 : answer.body.length)
                + " bytes rather than the " + compressed.length + " the server sent");
            // And it really is the gzip stream, not merely the right length.
            if (answer.body != null && answer.body.length == compressed.length) {
                check(java.util.Arrays.equals(gunzip(answer.body), plain),
                    "the body did not inflate to what the server compressed");
            }
            // The request still asks for gzip, so the wire is unchanged; only
            // who inflates it has moved.
            check(server.lastRequest.toLowerCase().contains("accept-encoding: gzip"),
                "the provider stopped asking for gzip, which changes the request rather "
                + "than the handling: " + server.lastRequest.replace("\r\n", " | "));
        } finally {
            client.dispatcher().executorService().shutdown();
            server.close();
        }
    }

    /** A redirect is a response, not a thing that happens. */
    static void redirects(ExecutorService lane) throws Exception {
        Server server = new Server(302, new byte[0], "Location: http://example.invalid/next\r\n");
        start(server, "redirect-server");
        OkHttpClient client = OkHttpNetworking.client();
        try {
            Answer answer = get(client, lane, "http://127.0.0.1:" + server.port() + "/", new String[0]);
            check(answer.name == null, "the request failed: " + answer.name + ": " + answer.message);
            check(answer.status == 302,
                "a redirect came back as " + answer.status + " -- it was followed here, so the "
                + "shared implementation never saw it and cannot apply its redirect mode");
            check("http://example.invalid/next".equals(answer.header("Location")),
                "Location came back as " + answer.header("Location"));
            check(server.served == 1, "the provider made " + server.served + " requests for one");
        } finally {
            client.dispatcher().executorService().shutdown();
            server.close();
        }
    }

    /** A cookie the provider stored is a cookie the shared jar does not own. */
    static void cookies(ExecutorService lane) throws Exception {
        Server server = new Server(200, new byte[0], "Set-Cookie: session=abc; Path=/\r\n");
        start(server, "cookie-server");
        OkHttpClient client = OkHttpNetworking.client();
        try {
            Answer first = get(client, lane, "http://127.0.0.1:" + server.port() + "/", new String[0]);
            // The offer has to be real for the refusal to mean anything. A
            // server that never sent `Set-Cookie` would make the assertion
            // below pass for a provider that stores every cookie it is given.
            check("session=abc; Path=/".equals(first.header("Set-Cookie")),
                "the server did not offer a cookie, so the check below proves nothing: "
                + first.header("Set-Cookie"));
            get(client, lane, "http://127.0.0.1:" + server.port() + "/", new String[0]);
            check(!server.lastRequest.toLowerCase().contains("cookie:"),
                "the provider sent a cookie it had stored itself: "
                + server.lastRequest.replace("\r\n", " | "));
        } finally {
            client.dispatcher().executorService().shutdown();
            server.close();
        }
    }

    /**
     * The switches, asserted on the client rather than on the source.
     *
     * <p>Three of the five have behavioural tests above. `retryOnConnectionFailure`
     * does not, and it is worth saying why rather than shipping a test that
     * cannot fail: OkHttp retries a **pooled** connection that turns out to be
     * dead, not a fresh one that hangs up, so the obvious server -- accept and
     * close -- never triggers it. Turning the flag on left the suite green,
     * which is how that was found.
     *
     * <p>So it is checked where it is unambiguous. These are OkHttp's own
     * accessors on the built client, so a switch removed from the builder fails
     * here immediately, and the check cannot drift from the thing it describes
     * the way a source-text assertion would.
     */
    static void configuration() {
        OkHttpClient client = OkHttpNetworking.client();
        try {
            check(!client.followRedirects(), "the client follows redirects");
            check(!client.followSslRedirects(), "the client follows SSL redirects");
            check(!client.retryOnConnectionFailure(), "the client retries on connection failure");
            check(client.cache() == null, "the client has an HTTP cache");
            check(client.cookieJar() == okhttp3.CookieJar.NO_COOKIES,
                "the client has a cookie jar of its own");
            // The explicit protocol list. Unset, OkHttp offers h2 in ALPN and
            // takes it over TLS with any peer that accepts -- while the
            // deterministic reference speaks HTTP/1.1, so the two-adapter
            // corpus would be comparing two protocols and calling the framing
            // difference a defect.
            check(client.protocols().size() == 1
                    && client.protocols().get(0) == okhttp3.Protocol.HTTP_1_1,
                "the client offers " + client.protocols() + " rather than HTTP/1.1 alone");
        } finally {
            // The adapter's own teardown rather than half of it. This line used
            // to stop the executor and leave the connection pool running, which
            // is the shape of the defect record 0187 is about.
            OkHttpNetworking.shutdown(client);
        }
    }

    static void start(Runnable server, String name) {
        Thread thread = new Thread(server, name);
        thread.setDaemon(true);
        thread.start();
    }

    public static void main(String[] args) throws Exception {
        ExecutorService lane = Executors.newSingleThreadExecutor();
        try {
            decompression(lane);
            redirects(lane);
            cookies(lane);
            configuration();
        } finally {
            lane.shutdownNow();
        }
        System.out.printf("okhttp: decompression, redirects, cookies, configuration -- %d checks, %d failures%n", checks, failures);
        if (failures != 0) { System.exit(1); }
    }
}
