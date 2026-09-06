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
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLServerSocketFactory;
import javax.net.ssl.SSLSocket;
import nts.rt.NtsEnv;
import nts.rt.NtsNumberCallback;
import nts.rt.NtsSocket;
import nts.rt.NtsTextPairCallback;
import org.nts.web.NetworkPrimitives;

/**
 * Two tunnels, one proxy, and the requirement that they answer the same.
 *
 * <p>`nts.rt.NtsSocket` and `org.nts.web.NetworkPrimitives` each speak HTTP
 * `CONNECT`, and neither can call the other: the Android library depends on no
 * NTS runtime, which is exactly what lets it be built into an Android library
 * on its own. So there are two implementations of something subtle -- reading
 * to the blank line and not one byte further, carrying the proxy's status into
 * the failure, verifying TLS against the target rather than the proxy -- and
 * two copies of something subtle is how drift starts.
 *
 * <p>They are held together by this rather than by care. Every case runs
 * through both against the same server and the answers are compared, which is
 * the rule this repository already keeps: where two things must agree and only
 * one of them can be deleted, make the second one **assert** rather than
 * compute.
 */
public final class BothTunnels {
    static int failures;
    static void check(boolean ok, String what) {
        if (!ok) { failures++; if (failures < 12) { System.out.println("FAILED: " + what); } }
    }

    /** What either transport says, in the shape they can be compared in. */
    static final class Outcome {
        final boolean ok;
        final String name;
        final String message;
        Outcome(boolean ok, String name, String message) {
            this.ok = ok; this.name = name; this.message = message;
        }
        @Override public String toString() { return ok ? "ok" : name + ": " + message; }
    }

    static void same(String what, Outcome runtime, Outcome android) {
        check(runtime.ok == android.ok,
            what + ": nts.rt says " + runtime + " and org.nts.web says " + android);
    }

    // --- the servers, shared by both drivers --------------------------------

    static final class Echo implements Runnable {
        final ServerSocket listener;
        volatile boolean stop;
        Echo() throws IOException {
            listener = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        }
        int port() { return listener.getLocalPort(); }
        @Override public void run() {
            while (!stop) {
                try (Socket peer = listener.accept()) {
                    InputStream in = peer.getInputStream();
                    OutputStream out = peer.getOutputStream();
                    byte[] buffer = new byte[4096];
                    int n;
                    while ((n = in.read(buffer)) > 0) { out.write(buffer, 0, n); out.flush(); }
                } catch (IOException closing) { if (stop) { return; } }
            }
        }
        void close() { stop = true; try { listener.close(); } catch (IOException ignored) { /* stopping */ } }
    }

    static final class Secure implements Runnable {
        final SSLServerSocket listener;
        volatile boolean stop;
        Secure() throws IOException {
            SSLServerSocketFactory factory = (SSLServerSocketFactory) SSLServerSocketFactory.getDefault();
            listener = (SSLServerSocket) factory.createServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
        }
        int port() { return listener.getLocalPort(); }
        @Override public void run() {
            while (!stop) {
                try (SSLSocket peer = (SSLSocket) listener.accept()) {
                    peer.startHandshake();
                    peer.getOutputStream().write('k');
                    peer.getOutputStream().flush();
                } catch (IOException expected) { if (stop) { return; } }
            }
        }
        void close() { stop = true; try { listener.close(); } catch (IOException ignored) { /* stopping */ } }
    }

    static final class Proxy implements Runnable {
        final ServerSocket listener;
        final String refuseWith;
        volatile boolean stop;
        volatile String lastAuthority;
        Proxy(String refuseWith) throws IOException {
            listener = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
            this.refuseWith = refuseWith;
        }
        int port() { return listener.getLocalPort(); }
        @Override public void run() {
            while (!stop) {
                try {
                    final Socket client = listener.accept();
                    Thread worker = new Thread(new Runnable() {
                        @Override public void run() { serve(client); }
                    }, "proxy-worker");
                    worker.setDaemon(true);
                    worker.start();
                } catch (IOException closing) { if (stop) { return; } }
            }
        }
        void serve(Socket client) {
            try {
                StringBuilder head = new StringBuilder();
                int consecutive = 0;
                InputStream in = client.getInputStream();
                while (consecutive < 2) {
                    int b = in.read();
                    if (b < 0) { client.close(); return; }
                    if (b == '\n') { consecutive++; } else if (b != '\r') { consecutive = 0; }
                    head.append((char) b);
                }
                int end = head.indexOf("\r\n");
                String[] parts = head.substring(0, end < 0 ? head.length() : end).split(" ");
                if (parts.length < 2 || !"CONNECT".equals(parts[0])) {
                    client.getOutputStream().write("HTTP/1.1 400 Bad Request\r\n\r\n".getBytes("ISO-8859-1"));
                    client.close();
                    return;
                }
                lastAuthority = parts[1];
                if (refuseWith != null) {
                    client.getOutputStream().write((refuseWith + "\r\n\r\n").getBytes("ISO-8859-1"));
                    client.getOutputStream().flush();
                    client.close();
                    return;
                }
                int colon = parts[1].lastIndexOf(':');
                Socket upstream = new Socket(parts[1].substring(0, colon),
                    Integer.parseInt(parts[1].substring(colon + 1)));
                client.getOutputStream().write(
                    "HTTP/1.1 200 Connection Established\r\n\r\n".getBytes("ISO-8859-1"));
                client.getOutputStream().flush();
                splice(client, upstream);
                splice(upstream, client);
            } catch (IOException | RuntimeException dropped) {
                try { client.close(); } catch (IOException ignored) { /* dropping */ }
            }
        }
        void close() { stop = true; try { listener.close(); } catch (IOException ignored) { /* stopping */ } }
    }

    static void splice(final Socket from, final Socket to) {
        Thread pump = new Thread(new Runnable() {
            @Override public void run() {
                try {
                    InputStream in = from.getInputStream();
                    OutputStream out = to.getOutputStream();
                    byte[] buffer = new byte[8192];
                    int n;
                    while ((n = in.read(buffer)) > 0) { out.write(buffer, 0, n); out.flush(); }
                } catch (IOException closing) {
                    // The far end went away, which is how a tunnel ends.
                } finally {
                    try { from.close(); } catch (IOException ignored) { /* done */ }
                    try { to.close(); } catch (IOException ignored) { /* done */ }
                }
            }
        }, "splice");
        pump.setDaemon(true);
        pump.start();
    }

    // --- the two drivers ----------------------------------------------------

    static final class Result implements NtsNumberCallback, NtsTextPairCallback {
        double value = Double.NaN;
        String name;
        String message;
        @Override public void call(double v) { value = v; }
        @Override public void call(String n, String m) { name = n; message = m; }
    }

    static Outcome viaRuntime(String host, int port, boolean secure, Proxy proxy, double kind) {
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 8);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            Result result = new Result();
            NtsSocket.connectVia(env, NtsEnv.launch(env), host, port, secure, 8000,
                "127.0.0.1", proxy.port(), kind, result, result);
            NtsEnv.drain(env);
            if (result.name == null) { NtsSocket.close(result.value); }
            return new Outcome(result.name == null, result.name, result.message);
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
        }
    }

    static Outcome viaAndroid(ExecutorService lane, String host, int port, boolean secure,
                              Proxy proxy, int kind) throws Exception {
        try (NetworkPrimitives api = new NetworkPrimitives(lane, new NetworkPrimitives.CleartextPolicy() {
                @Override public boolean permits(String hostname) { return true; }
            }, new NetworkPrimitives.ErrorReporter() {
                @Override public void report(String name, String message) { }
            }, 8)) {
            final CompletableFuture<Outcome> answer = new CompletableFuture<Outcome>();
            api.connect(host, port, secure, 8000, "127.0.0.1", proxy.port(), kind,
                new NetworkPrimitives.ConnectCallback() {
                    @Override public void success(int handle) {
                        answer.complete(new Outcome(true, null, null));
                    }
                    @Override public void failure(String name, String message) {
                        answer.complete(new Outcome(false, name, message));
                    }
                });
            return answer.get(20, TimeUnit.SECONDS);
        }
    }

    // --- the cases ----------------------------------------------------------

    static void tunnelled(ExecutorService lane, Echo echo) throws Exception {
        Proxy proxy = new Proxy(null);
        start(proxy, "proxy-plain");
        try {
            Outcome runtime = viaRuntime("127.0.0.1", echo.port(), false, proxy, NtsSocket.HTTP_PROXY);
            String askedByRuntime = proxy.lastAuthority;
            Outcome android = viaAndroid(lane, "127.0.0.1", echo.port(), false, proxy,
                NetworkPrimitives.HTTP_PROXY);
            check(runtime.ok, "nts.rt could not tunnel: " + runtime);
            check(android.ok, "org.nts.web could not tunnel: " + android);
            same("a plain tunnel", runtime, android);
            // The authority is the request line, and the two must write the
            // same one -- a tunnel that asked for the proxy's own address, or
            // omitted the port, would still connect and would be wrong.
            check(("127.0.0.1:" + echo.port()).equals(askedByRuntime),
                "nts.rt asked the proxy for " + askedByRuntime);
            check(("127.0.0.1:" + echo.port()).equals(proxy.lastAuthority),
                "org.nts.web asked the proxy for " + proxy.lastAuthority);
        } finally {
            proxy.close();
        }
    }

    static void refused(ExecutorService lane, Echo echo, String status, String expected) throws Exception {
        Proxy proxy = new Proxy(status);
        start(proxy, "proxy-refusing");
        try {
            Outcome runtime = viaRuntime("127.0.0.1", echo.port(), false, proxy, NtsSocket.HTTP_PROXY);
            Outcome android = viaAndroid(lane, "127.0.0.1", echo.port(), false, proxy,
                NetworkPrimitives.HTTP_PROXY);
            same("a proxy answering " + expected, runtime, android);
            check(!runtime.ok && runtime.message != null && runtime.message.contains(expected),
                "nts.rt lost the proxy's status: " + runtime);
            check(!android.ok && android.message != null && android.message.contains(expected),
                "org.nts.web lost the proxy's status: " + android);
        } finally {
            proxy.close();
        }
    }

    /**
     * The pair, on both. The proxy is on `127.0.0.1` and the certificate names
     * `localhost`, so verification against the proxy inverts the first case.
     *
     * <p>Every connect is preceded by {@link #forgetSessions}; see there for
     * why, and for the sabotage that found it.
     */
    static void verified(ExecutorService lane, Secure secure) throws Exception {
        Proxy proxy = new Proxy(null);
        start(proxy, "proxy-tls");
        try {
            Outcome runtimeNamed = named(lane, secure, proxy, "localhost", true);
            Outcome androidNamed = named(lane, secure, proxy, "localhost", false);
            check(runtimeNamed.ok, "nts.rt refused a tunnel to the name in the certificate: "
                + runtimeNamed + " -- verification is against the proxy, not the target");
            check(androidNamed.ok, "org.nts.web refused a tunnel to the name in the certificate: "
                + androidNamed + " -- verification is against the proxy, not the target");
            same("a tunnel to the certificate's name", runtimeNamed, androidNamed);

            Outcome runtimeOther = named(lane, secure, proxy, "127.0.0.1", true);
            Outcome androidOther = named(lane, secure, proxy, "127.0.0.1", false);
            check(!runtimeOther.ok, "nts.rt accepted a tunnel to a name the certificate does not have");
            check(!androidOther.ok, "org.nts.web accepted a tunnel to a name the certificate does not have");
            same("a tunnel to another name", runtimeOther, androidOther);
        } finally {
            proxy.close();
        }
    }

    static Outcome named(ExecutorService lane, Secure secure, Proxy proxy, String asking,
                         boolean runtime) throws Exception {
        forgetSessions();
        return runtime
            ? viaRuntime(asking, secure.port(), true, proxy, NtsSocket.HTTP_PROXY)
            : viaAndroid(lane, asking, secure.port(), true, proxy, NetworkPrimitives.HTTP_PROXY);
    }

    /**
     * Forget every cached TLS session.
     *
     * <p>JSSE caches client sessions and resumes them, and **a resumed session
     * does not repeat the identification the full handshake did**. Without
     * this, sabotaging only the Android tunnel made *both* implementations
     * accept a certificate neither should have: the sabotaged connection
     * established a session, an ephemeral port was recycled, and the untouched
     * implementation resumed it and skipped the check.
     *
     * <p>Which is worse than a failing test. Two implementations that are
     * supposed to be independent evidence for each other were sharing the one
     * piece of state that decides the answer, so a bug in either could be
     * concealed by the other having already been wrong.
     */
    static void forgetSessions() throws Exception {
        javax.net.ssl.SSLSessionContext context =
            javax.net.ssl.SSLContext.getDefault().getClientSessionContext();
        java.util.Enumeration<byte[]> ids = context.getIds();
        while (ids.hasMoreElements()) {
            javax.net.ssl.SSLSession session = context.getSession(ids.nextElement());
            if (session != null) { session.invalidate(); }
        }
    }

    static void start(Runnable server, String name) {
        Thread thread = new Thread(server, name);
        thread.setDaemon(true);
        thread.start();
    }

    public static void main(String[] args) throws Exception {
        Echo echo = new Echo();
        start(echo, "echo");
        Secure secure = new Secure();
        start(secure, "secure");
        ExecutorService lane = Executors.newSingleThreadExecutor();
        try {
            tunnelled(lane, echo);
            refused(lane, echo, "HTTP/1.1 407 Proxy Authentication Required", "407");
            refused(lane, echo, "HTTP/1.1 502 Bad Gateway", "502");
            verified(lane, secure);
        } finally {
            lane.shutdownNow();
            echo.close();
            secure.close();
            NtsSocket.shutdown();
        }
        System.out.printf("both tunnels: plain, 407, 502, verification -- %d failures%n", failures);
        if (failures != 0) { System.exit(1); }
    }
}
