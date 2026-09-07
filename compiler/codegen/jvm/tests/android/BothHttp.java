import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.zip.GZIPOutputStream;

import okhttp3.Call;
import okhttp3.OkHttpClient;

import org.nts.web.OkHttpNetworking;

import nts.rt.NtsEnv;
import nts.rt.NtsNumberCallback;
import nts.rt.NtsSocket;
import nts.rt.NtsTextPairCallback;

/**
 * One server, one request, two adapters, and the answers compared.
 *
 * <p>The plan requires the production OkHttp adapter and the deterministic
 * reference transport to run the same semantic corpus. Before this, they ran
 * different ones: `OkHttpHeadersTest` drove OkHttp alone and asserted what it
 * did, and `HttpGzipTest` drove the reference alone and asserted what it did --
 * ending, in its own words, with "this is the observable the production adapter
 * has to match". Nothing checked that it matched. Two suites agreeing with
 * their own expectations is not two adapters agreeing with each other, and the
 * failure that arrangement cannot see is exactly the one the plan names: OkHttp
 * quietly decompressing and stripping the headers that said it had.
 *
 * <p>So every case here builds one canned response, serves it twice, and
 * asserts the two adapters expose the same status, the same headers of the
 * names that carry policy, and the same body **bytes** -- undecoded, because a
 * body that arrives decoded on one path and encoded on the other is the bug.
 *
 * <p>The comparison is over named headers rather than all of them. `Connection`,
 * `Date` and the rest differ for reasons that are not policy, and a corpus that
 * compared everything would have to be taught to ignore things, which is a list
 * that grows until it hides something. The names here are the ones the plan
 * names.
 */
public final class BothHttp {
    static int checks;
    static int failures;

    static void check(boolean ok, String what) {
        checks++;
        if (!ok) {
            failures++;
            System.out.println("FAIL " + what);
        }
    }

    /** The headers whose values are policy, and so must agree. */
    static final String[] COMPARED = {
        "content-encoding", "content-length", "location", "set-cookie", "content-type",
    };

    // ---------------------------------------------------------------------
    // What an adapter answers, in the one shape both can fill.
    // ---------------------------------------------------------------------

    static final class Answer {
        String name;
        String message;
        int status = -1;
        String[] headers = new String[0];
        byte[] body = new byte[0];

        boolean ok() {
            return name == null;
        }

        String header(String wanted) {
            for (int i = 0; i + 1 < headers.length; i += 2) {
                if (headers[i].equalsIgnoreCase(wanted)) {
                    return headers[i + 1];
                }
            }
            return null;
        }

        @Override
        public String toString() {
            return ok()
                ? "status " + status + ", " + body.length + " bytes"
                : name + ": " + message;
        }
    }

    static void same(String what, Answer reference, Answer okhttp) {
        check(reference.ok() == okhttp.ok(),
            what + ": reference " + reference + " and OkHttp " + okhttp + " disagree on success");
        if (!reference.ok() || !okhttp.ok()) {
            return;
        }
        check(reference.status == okhttp.status,
            what + ": status " + reference.status + " against " + okhttp.status);
        for (String name : COMPARED) {
            String mine = reference.header(name);
            String theirs = okhttp.header(name);
            check(mine == null ? theirs == null : mine.equalsIgnoreCase(theirs),
                what + ": " + name + " is " + mine + " on the reference and " + theirs + " on OkHttp");
        }
        check(java.util.Arrays.equals(reference.body, okhttp.body),
            what + ": the bodies differ -- " + reference.body.length + " bytes against "
                + okhttp.body.length + ". A body decoded on one path and not the other is "
                + "exactly the transparent decompression this corpus exists to catch.");
    }

    // ---------------------------------------------------------------------
    // A server that serves one scripted response, and remembers what it was
    // asked. Two connections per case, one per adapter.
    // ---------------------------------------------------------------------

    static final class Scripted implements Runnable {
        final ServerSocket listener;
        final byte[] response;
        volatile String lastRequest = "";
        volatile int served;
        volatile boolean stop;

        Scripted(byte[] response) throws IOException {
            this.response = response;
            this.listener = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        }

        int port() {
            return listener.getLocalPort();
        }

        @Override
        public void run() {
            while (!stop) {
                try {
                    Socket peer = listener.accept();
                    StringBuilder head = new StringBuilder();
                    InputStream in = peer.getInputStream();
                    int b;
                    while ((b = in.read()) != -1) {
                        head.append((char) b);
                        int n = head.length();
                        if (n >= 4 && head.charAt(n - 4) == '\r' && head.charAt(n - 3) == '\n'
                            && head.charAt(n - 2) == '\r' && head.charAt(n - 1) == '\n') {
                            break;
                        }
                    }
                    lastRequest = head.toString();
                    served++;
                    OutputStream out = peer.getOutputStream();
                    out.write(response);
                    out.flush();
                    peer.close();
                } catch (IOException stopping) {
                    return;
                }
            }
        }

        void close() {
            stop = true;
            try {
                listener.close();
            } catch (IOException ignored) {
                // stopping
            }
        }
    }

    /** The request line alone, for a message that is not the whole head. */
    static String firstLine(String request) {
        int end = request.indexOf('\r');
        return end < 0 ? request : request.substring(0, end);
    }

    /** A response, assembled so a case reads as the bytes on the wire. */
    static byte[] response(String status, String[] headers, byte[] body) throws IOException {
        StringBuilder head = new StringBuilder("HTTP/1.1 ").append(status).append("\r\n");
        for (int i = 0; i + 1 < headers.length; i += 2) {
            head.append(headers[i]).append(": ").append(headers[i + 1]).append("\r\n");
        }
        head.append("Connection: close\r\n\r\n");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(head.toString().getBytes("ISO-8859-1"));
        if (body != null) {
            out.write(body);
        }
        return out.toByteArray();
    }

    static byte[] gzip(byte[] plain) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        GZIPOutputStream gz = new GZIPOutputStream(out);
        gz.write(plain);
        gz.finish();
        gz.close();
        return out.toByteArray();
    }

    // ---------------------------------------------------------------------
    // The two drivers.
    // ---------------------------------------------------------------------

    static final class Completion implements NtsNumberCallback, NtsTextPairCallback {
        double value = Double.NaN;
        String name;
        String message;

        @Override public void call(double one) { value = one; }
        @Override public void call(String code, String text) { name = code; message = text; }
    }

    /**
     * The deterministic reference: a socket, a request, and bytes read until
     * the peer closes. It does not decompress, follow anything, or store
     * anything -- which is what makes it the thing the production adapter is
     * compared against rather than a second implementation of the same policy.
     */
    static Answer viaReference(int port, String method, String path, String[] headers)
            throws IOException {
        Answer answer = new Answer();
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 64);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            Completion connected = new Completion();
            NtsSocket.connect(env, NtsEnv.launch(env), "127.0.0.1", port, false, 4000,
                connected, connected);
            NtsEnv.drain(env);
            if (connected.name != null) {
                answer.name = connected.name;
                answer.message = connected.message;
                return answer;
            }
            double handle = connected.value;

            StringBuilder request = new StringBuilder(method).append(' ').append(path)
                .append(" HTTP/1.1\r\nHost: 127.0.0.1:").append(port).append("\r\n");
            for (int i = 0; i + 1 < headers.length; i += 2) {
                request.append(headers[i]).append(": ").append(headers[i + 1]).append("\r\n");
            }
            request.append("Connection: close\r\n\r\n");
            byte[] wire = request.toString().getBytes("ISO-8859-1");
            Completion sent = new Completion();
            NtsSocket.write(env, NtsEnv.launch(env), handle, wire, 0, wire.length, sent, sent);
            NtsEnv.drain(env);
            if (sent.name != null) {
                answer.name = sent.name;
                answer.message = sent.message;
                NtsSocket.close(handle);
                return answer;
            }

            ByteArrayOutputStream received = new ByteArrayOutputStream();
            byte[] chunk = new byte[512];
            for (;;) {
                Completion read = new Completion();
                NtsSocket.read(env, NtsEnv.launch(env), handle, chunk, 0, chunk.length, read, read);
                NtsEnv.drain(env);
                if (read.name != null || read.value <= 0) {
                    break;
                }
                received.write(chunk, 0, (int) read.value);
            }
            NtsSocket.close(handle);
            parse(answer, received.toByteArray());
            return answer;
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
        }
    }

    /** Split a raw response into status, headers and the body exactly as sent. */
    static void parse(Answer answer, byte[] whole) {
        int at = -1;
        for (int i = 0; i + 3 < whole.length; i++) {
            if (whole[i] == '\r' && whole[i + 1] == '\n'
                && whole[i + 2] == '\r' && whole[i + 3] == '\n') {
                at = i;
                break;
            }
        }
        if (at < 0) {
            answer.name = "Malformed";
            answer.message = "no header terminator in " + whole.length + " bytes";
            return;
        }
        String head = new String(whole, 0, at, java.nio.charset.Charset.forName("ISO-8859-1"));
        String[] lines = head.split("\r\n");
        String[] status = lines[0].split(" ");
        answer.status = status.length > 1 ? Integer.parseInt(status[1]) : -1;
        String[] flat = new String[(lines.length - 1) * 2];
        int n = 0;
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon < 0) {
                continue;
            }
            flat[n++] = lines[i].substring(0, colon).trim();
            flat[n++] = lines[i].substring(colon + 1).trim();
        }
        answer.headers = java.util.Arrays.copyOf(flat, n);
        answer.body = java.util.Arrays.copyOfRange(whole, at + 4, whole.length);
    }

    /** The production adapter, driven through the same shape. */
    static Answer viaOkHttp(OkHttpClient client, ExecutorService lane, int port,
                            String method, String path, String[] headers) throws Exception {
        final Answer answer = new Answer();
        final CountDownLatch done = new CountDownLatch(1);
        Call call = OkHttpNetworking.send(client, lane, method,
            "http://127.0.0.1:" + port + path, headers, null,
            new OkHttpNetworking.ResponseCallback() {
                @Override
                public void success(int status, String[] received, byte[] body) {
                    answer.status = status;
                    answer.headers = received;
                    answer.body = body;
                    done.countDown();
                }

                @Override
                public void failure(String name, String message) {
                    answer.name = name;
                    answer.message = message;
                    done.countDown();
                }
            });
        if (!done.await(10, TimeUnit.SECONDS)) {
            call.cancel();
            answer.name = "Timeout";
            answer.message = "the production adapter did not answer in ten seconds";
        }
        return answer;
    }

    // ---------------------------------------------------------------------
    // The cases.
    // ---------------------------------------------------------------------

    /** Both adapters, one canned response, and the answers compared. */
    static void both(String what, ExecutorService lane, OkHttpClient client,
                     byte[] canned, String method, String path, String[] request) throws Exception {
        Scripted server = new Scripted(canned);
        Thread thread = new Thread(server, "both-http");
        thread.setDaemon(true);
        thread.start();
        try {
            Answer reference = viaReference(server.port(), method, path, request);
            Answer okhttp = viaOkHttp(client, lane, server.port(), method, path, request);
            same(what, reference, okhttp);
            check(server.served == 2,
                what + ": the server was asked " + server.served + " times for two requests -- "
                    + "a redirect followed or a request retried is an extra one");
            // **The protocol the provider actually spoke**, not the one it was
            // configured with. `OkHttpNetworking.client()` pins the list to
            // HTTP/1.1 and `OkHttpHeadersTest` asserts that configuration; this
            // asserts the wire. They are different claims, and the plan's rule
            // is about the second one: platform facilities are exposed only
            // through capabilities the provider actually negotiates.
            //
            // An h2 client with prior knowledge opens with the connection
            // preface `PRI * HTTP/2.0`, which is a request line this server
            // records like any other -- so no ALPN inspection is needed, and
            // none is available under `--release 8` anyway.
            String spoke = server.lastRequest;
            check(spoke.contains("HTTP/1.1"),
                what + ": the request line was not HTTP/1.1 -- " + firstLine(spoke));
            check(!spoke.startsWith("PRI *"),
                what + ": the provider opened with the HTTP/2 connection preface, which is a "
                    + "protocol it was not configured to offer and the reference cannot match");
        } finally {
            server.close();
        }
    }

    public static void main(String[] args) throws Exception {
        ExecutorService lane = Executors.newSingleThreadExecutor();
        OkHttpClient client = OkHttpNetworking.client();
        byte[] plain = "the body, sent exactly once and read exactly as sent".getBytes("UTF-8");
        String[] askForGzip = { "Accept-Encoding", "gzip" };
        String[] askForNothing = { "Accept-Encoding", "identity" };

        try {
            // Identity. The floor case: if the two disagree here, nothing below
            // means anything.
            both("identity", lane, client,
                response("200 OK", new String[] {
                    "Content-Type", "text/plain",
                    "Content-Length", String.valueOf(plain.length),
                }, plain), "GET", "/plain", askForNothing);

            // gzip, and the whole reason this file exists. Both must expose
            // `Content-Encoding: gzip`, both must report the **encoded**
            // length, and both must hand back the compressed bytes. OkHttp
            // decompresses transparently and strips both headers whenever it
            // added `Accept-Encoding` itself, so this case is green only
            // because the adapter always sets it explicitly.
            byte[] squeezed = gzip(plain);
            both("gzip", lane, client,
                response("200 OK", new String[] {
                    "Content-Type", "text/plain",
                    "Content-Encoding", "gzip",
                    "Content-Length", String.valueOf(squeezed.length),
                }, squeezed), "GET", "/gzip", askForGzip);

            // The same gzip response with **no** `Accept-Encoding` from the
            // caller, which is the case the plan names and the only one that
            // can see the transparent path.
            //
            // OkHttp decompresses and strips `Content-Encoding` and
            // `Content-Length` exactly when *it* added the request header, not
            // when the caller did. So every case that asks for gzip explicitly
            // is green whether or not the adapter sets it -- which is what the
            // first attempt at this sabotage proved, by not failing. The
            // adapter's `if (!acceptEncoding)` line only runs when the caller
            // sent none, and this is the only case that reaches it.
            //
            // Removing that line makes this case fail on the body, on
            // `Content-Encoding` and on `Content-Length` at once. Nothing else
            // in the corpus moves.
            both("gzip with no request header", lane, client,
                response("200 OK", new String[] {
                    "Content-Type", "text/plain",
                    "Content-Encoding", "gzip",
                    "Content-Length", String.valueOf(squeezed.length),
                }, squeezed), "GET", "/gzip-implicit", new String[0]);

            // An encoding neither side decodes. The right behaviour is to hand
            // it over untouched rather than to fail: the shared layer decides
            // what it can read, and a provider that refused here would be
            // deciding for it.
            both("unsupported encoding", lane, client,
                response("200 OK", new String[] {
                    "Content-Encoding", "br",
                    "Content-Length", String.valueOf(plain.length),
                }, plain), "GET", "/br", askForNothing);

            // A redirect neither follows. `Location` is exposed and the status
            // is the redirect's, not the target's -- and `served == 2` inside
            // `both` is what proves neither adapter went and fetched it.
            both("redirect not followed", lane, client,
                response("302 Found", new String[] {
                    "Location", "http://example.invalid/next",
                    "Content-Length", "0",
                }, new byte[0]), "GET", "/redirect", askForNothing);

            // A cookie exposed and not stored. The second half -- that neither
            // sends it back -- is checked below, where two requests to one
            // server can see it.
            both("set-cookie exposed", lane, client,
                response("200 OK", new String[] {
                    "Set-Cookie", "session=abc; Path=/",
                    "Content-Length", String.valueOf(plain.length),
                }, plain), "GET", "/cookie", askForNothing);

            // No body, and a status that must not become 200.
            both("no content", lane, client,
                response("204 No Content", new String[0], new byte[0]),
                "GET", "/empty", askForNothing);

            // A status neither adapter may turn into a failure. A 500 is a
            // response, and a provider that reported it as an error would move
            // a decision the shared layer owns.
            both("server error is a response", lane, client,
                response("500 Internal Server Error", new String[] {
                    "Content-Length", String.valueOf(plain.length),
                }, plain), "GET", "/error", askForNothing);

            // Neither adapter stores the cookie it was just handed.
            cookiesAreNotStored(lane, client, plain);

            // The pool holds a connection, and shutdown empties it.
            pooling(lane, client, plain);
        } finally {
            // The adapter's own shutdown, before the lane it delivers on. This
            // is not tidiness: without it this corpus took sixty seconds of
            // wall time on half a second of CPU, waiting for OkHttp's
            // non-daemon dispatcher threads to idle out. The order is the
            // plan's -- platform first, lane last -- and reversing it turns
            // every cancelled call's completion into a rejection.
            OkHttpNetworking.shutdown(client);
            lane.shutdown();
            NtsSocket.shutdown();
        }

        System.out.printf("both-http: %d checks, %d failures%n", checks, failures);
        if (failures != 0) {
            System.exit(1);
        }
    }

    /** A server that answers more than once on one socket, so a pool has something to hold. */
    static final class KeepAlive implements Runnable {
        final ServerSocket listener;
        final byte[] response;
        volatile int served;
        volatile boolean stop;

        KeepAlive(byte[] response) throws IOException {
            this.response = response;
            this.listener = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        }

        int port() {
            return listener.getLocalPort();
        }

        @Override
        public void run() {
            while (!stop) {
                try {
                    final Socket peer = listener.accept();
                    Thread worker = new Thread(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                InputStream in = peer.getInputStream();
                                OutputStream out = peer.getOutputStream();
                                StringBuilder head = new StringBuilder();
                                int b;
                                while ((b = in.read()) != -1) {
                                    head.append((char) b);
                                    int n = head.length();
                                    if (n >= 4 && head.charAt(n - 4) == '\r'
                                        && head.charAt(n - 3) == '\n'
                                        && head.charAt(n - 2) == '\r'
                                        && head.charAt(n - 1) == '\n') {
                                        served++;
                                        out.write(response);
                                        out.flush();
                                        head.setLength(0);
                                    }
                                }
                            } catch (IOException closing) {
                                // the peer went away, which is the end of this connection
                            }
                        }
                    }, "keep-alive-peer");
                    worker.setDaemon(true);
                    worker.start();
                } catch (IOException stopping) {
                    return;
                }
            }
        }

        void close() {
            stop = true;
            try {
                listener.close();
            } catch (IOException ignored) {
                // stopping
            }
        }
    }

    /**
     * The pool holds a connection between requests, and shutdown empties it.
     *
     * <p>Every other case here answers with `Connection: close`, so nothing is
     * ever pooled and the eviction in `OkHttpNetworking.shutdown` would be
     * unobserved -- present in the source, doing nothing any test could see.
     * That is the state the sixty-second hang was in before it was measured:
     * true of the code, invisible to the suite.
     *
     * <p>So this one keeps the socket open. Two requests, one connection, and
     * then the count before and after shutdown. A pool that is empty *because
     * nothing was pooled* proves nothing, which is why the before is asserted
     * too.
     */
    static void pooling(ExecutorService lane, OkHttpClient client, byte[] plain) throws Exception {
        byte[] canned = ("HTTP/1.1 200 OK\r\nContent-Length: " + plain.length + "\r\n\r\n")
            .getBytes("ISO-8859-1");
        ByteArrayOutputStream whole = new ByteArrayOutputStream();
        whole.write(canned);
        whole.write(plain);

        KeepAlive server = new KeepAlive(whole.toByteArray());
        Thread thread = new Thread(server, "both-http-pool");
        thread.setDaemon(true);
        thread.start();
        OkHttpClient own = OkHttpNetworking.client();
        try {
            Answer first = viaOkHttp(own, lane, server.port(), "GET", "/one", new String[0]);
            Answer second = viaOkHttp(own, lane, server.port(), "GET", "/two", new String[0]);
            check(first.ok() && second.ok(),
                "the keep-alive exchange failed: " + first + " / " + second);
            check(server.served == 2, "the server answered " + server.served + " of two requests");
            check(own.connectionPool().connectionCount() > 0,
                "nothing was pooled, so evicting the pool would prove nothing");

            OkHttpNetworking.shutdown(own);
            check(own.connectionPool().connectionCount() == 0,
                "shutdown left " + own.connectionPool().connectionCount()
                    + " connections in the pool -- on Android those are sockets held on a "
                    + "network the device may already have left");
        } finally {
            OkHttpNetworking.shutdown(own);
            server.close();
        }
    }

    /**
     * Two requests each, to one server, and neither adapter may send back what
     * the first response set.
     *
     * <p>Not part of `both` because it needs the *second* request's text, which
     * is a different observable from the response comparison every other case
     * makes.
     */
    static void cookiesAreNotStored(ExecutorService lane, OkHttpClient client, byte[] plain)
            throws Exception {
        byte[] canned = response("200 OK", new String[] {
            "Set-Cookie", "session=abc; Path=/",
            "Content-Length", String.valueOf(plain.length),
        }, plain);
        String[] none = new String[0];

        Scripted server = new Scripted(canned);
        Thread thread = new Thread(server, "both-http-cookies");
        thread.setDaemon(true);
        thread.start();
        try {
            viaReference(server.port(), "GET", "/first", none);
            viaReference(server.port(), "GET", "/second", none);
            check(!server.lastRequest.toLowerCase(Locale.ROOT).contains("cookie:"),
                "the reference adapter sent a cookie back: " + server.lastRequest);

            viaOkHttp(client, lane, server.port(), "GET", "/first", none);
            viaOkHttp(client, lane, server.port(), "GET", "/second", none);
            check(!server.lastRequest.toLowerCase(Locale.ROOT).contains("cookie:"),
                "the production adapter sent a cookie back: " + server.lastRequest);
        } finally {
            server.close();
        }
    }
}
