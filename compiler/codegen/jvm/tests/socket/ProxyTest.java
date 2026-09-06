import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLServerSocketFactory;
import javax.net.ssl.SSLSocket;
import nts.rt.NtsEnv;
import nts.rt.NtsNumberCallback;
import nts.rt.NtsTextPairCallback;
import nts.rt.NtsSocket;

/**
 * Proxies: an HTTP `CONNECT` tunnel, a SOCKS5 hop, and the thing a tunnel is
 * most likely to lose.
 *
 * <h2>The pair that matters</h2>
 *
 * A TLS connection through a `CONNECT` tunnel must verify the certificate
 * against the **target**, not the proxy. The wrong version works perfectly:
 * open a socket to the proxy, tunnel, wrap in TLS, and the wrapping is told
 * whatever host it was given -- and the host the socket connected to is the
 * proxy. Every certificate the proxy can present is then accepted for every
 * site it forwards to.
 *
 * <p>The proxy is on `127.0.0.1` and the certificate names `localhost`, so the
 * two are distinguishable: asking for `localhost` through the proxy must
 * succeed, and asking for `127.0.0.1` must fail. A version that verified
 * against the proxy's name inverts the first of those, which is why the pair is
 * the test rather than either half.
 */
public final class ProxyTest {
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

    /** Echoes until the peer closes. */
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
                } catch (IOException closing) {
                    if (stop) { return; }
                }
            }
        }
        void close() { stop = true; try { listener.close(); } catch (IOException ignored) { /* stopping */ } }
    }

    /** A TLS server that says one byte and hangs up. */
    static final class Secure implements Runnable {
        final SSLServerSocket listener;
        volatile boolean stop;
        Secure() throws IOException {
            SSLServerSocketFactory factory =
                (SSLServerSocketFactory) SSLServerSocketFactory.getDefault();
            listener = (SSLServerSocket) factory.createServerSocket(
                0, 8, InetAddress.getByName("127.0.0.1"));
        }
        int port() { return listener.getLocalPort(); }
        @Override public void run() {
            while (!stop) {
                try (SSLSocket peer = (SSLSocket) listener.accept()) {
                    peer.startHandshake();
                    peer.getOutputStream().write('k');
                    peer.getOutputStream().flush();
                } catch (IOException expected) {
                    if (stop) { return; }
                }
            }
        }
        void close() { stop = true; try { listener.close(); } catch (IOException ignored) { /* stopping */ } }
    }

    /**
     * An HTTP proxy that speaks `CONNECT`, or refuses it.
     *
     * <p>Reads the request head a byte at a time for the same reason the
     * client does: stopping exactly at the blank line. A buffered read would
     * swallow the first bytes of the tunnelled stream, and on a TLS tunnel that
     * is the ClientHello -- which fails as a handshake error with no sign that
     * the proxy ate it.
     */
    static final class Proxy implements Runnable {
        final ServerSocket listener;
        final String refuseWith;
        /**
         * Bytes written in the **same call** as the `200`, which is what makes
         * "stop exactly at the blank line" testable.
         *
         * <p>Without this the sabotage is invisible: a tunnel is
         * client-speaks-first, so nothing follows the response header and a
         * buffered read has nothing to swallow. A proxy that splices eagerly
         * coalesces the upstream's greeting into the same segment, and then a
         * client that read ahead has eaten bytes the `SSLSocket` wrapping the
         * socket will never look for.
         */
        volatile byte[] coalesce;
        volatile boolean stop;
        volatile String lastAuthority;
        volatile int accepted;
        Proxy(String refuseWith) throws IOException {
            listener = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
            this.refuseWith = refuseWith;
        }
        int port() { return listener.getLocalPort(); }

        @Override public void run() {
            while (!stop) {
                try {
                    final Socket client = listener.accept();
                    accepted++;
                    Thread worker = new Thread(new Runnable() {
                        @Override public void run() { serve(client); }
                    }, "proxy-worker");
                    worker.setDaemon(true);
                    worker.start();
                } catch (IOException closing) {
                    if (stop) { return; }
                }
            }
        }

        void serve(Socket client) {
            try {
                String head = readHead(client.getInputStream());
                int end = head.indexOf("\r\n");
                String line = head.substring(0, end < 0 ? head.length() : end);
                String[] parts = line.split(" ");
                if (parts.length < 2 || !"CONNECT".equals(parts[0])) {
                    reply(client, "HTTP/1.1 400 Bad Request");
                    client.close();
                    return;
                }
                lastAuthority = parts[1];
                if (refuseWith != null) {
                    reply(client, refuseWith);
                    client.close();
                    return;
                }
                int colon = parts[1].lastIndexOf(':');
                if (coalesce != null) {
                    // The response and the payload in one call, which is what
                    // a proxy that splices eagerly does and what makes reading
                    // past the blank line detectable. Closing after is what
                    // turns a swallowed payload into an end of stream rather
                    // than a hang.
                    byte[] head200 = "HTTP/1.1 200 Connection Established\r\n\r\n"
                        .getBytes("ISO-8859-1");
                    byte[] both = new byte[head200.length + coalesce.length];
                    System.arraycopy(head200, 0, both, 0, head200.length);
                    System.arraycopy(coalesce, 0, both, head200.length, coalesce.length);
                    client.getOutputStream().write(both);
                    client.getOutputStream().flush();
                    // Closing is not tidiness: it is what turns a swallowed
                    // payload into an end of stream. Left open, a client that
                    // read past the blank line blocks forever waiting for
                    // bytes it already has, and the suite hangs instead of
                    // failing -- which the sabotage demonstrated before this
                    // line existed.
                    client.close();
                    return;
                }
                Socket upstream = new Socket(
                    parts[1].substring(0, colon),
                    Integer.parseInt(parts[1].substring(colon + 1)));
                reply(client, "HTTP/1.1 200 Connection Established");
                splice(client, upstream);
                splice(upstream, client);
            } catch (IOException | RuntimeException dropped) {
                try { client.close(); } catch (IOException ignored) { /* dropping */ }
            }
        }

        void reply(Socket client, String status) throws IOException {
            client.getOutputStream().write((status + "\r\n\r\n").getBytes("ISO-8859-1"));
            client.getOutputStream().flush();
        }

        void close() { stop = true; try { listener.close(); } catch (IOException ignored) { /* stopping */ } }
    }

    /**
     * A SOCKS5 server, no authentication, `CONNECT` only.
     *
     * <p>Included because the platform's `Socket` speaks SOCKS itself and this
     * lane therefore writes *no* SOCKS code -- which is exactly the situation
     * where a test is worth having, since "we did nothing" and "we did nothing
     * and it works" are different claims and only one of them is checkable.
     */
    static final class Socks implements Runnable {
        final ServerSocket listener;
        volatile boolean stop;
        volatile int accepted;
        Socks() throws IOException {
            listener = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        }
        int port() { return listener.getLocalPort(); }
        @Override public void run() {
            while (!stop) {
                try {
                    final Socket client = listener.accept();
                    accepted++;
                    Thread worker = new Thread(new Runnable() {
                        @Override public void run() { serve(client); }
                    }, "socks-worker");
                    worker.setDaemon(true);
                    worker.start();
                } catch (IOException closing) {
                    if (stop) { return; }
                }
            }
        }
        void serve(Socket client) {
            try {
                InputStream in = client.getInputStream();
                OutputStream out = client.getOutputStream();
                int version = in.read();
                int methods = in.read();
                for (int i = 0; i < methods; i++) { in.read(); }
                if (version != 5) { client.close(); return; }
                out.write(new byte[] { 5, 0 });          // version 5, no authentication
                out.flush();
                in.read();                                // version
                int command = in.read();
                in.read();                                // reserved
                int kind = in.read();
                String host;
                if (kind == 1) {
                    byte[] quad = new byte[4];
                    readFully(in, quad);
                    host = (quad[0] & 0xFF) + "." + (quad[1] & 0xFF) + "."
                        + (quad[2] & 0xFF) + "." + (quad[3] & 0xFF);
                } else if (kind == 3) {
                    byte[] name = new byte[in.read()];
                    readFully(in, name);
                    host = new String(name, "ISO-8859-1");
                } else {
                    client.close();
                    return;
                }
                int port = (in.read() << 8) | in.read();
                if (command != 1) { client.close(); return; }
                Socket upstream = new Socket(host, port);
                // Success, bound to 0.0.0.0:0 -- which the client is not
                // required to use for anything and this one does not.
                out.write(new byte[] { 5, 0, 0, 1, 0, 0, 0, 0, 0, 0 });
                out.flush();
                splice(client, upstream);
                splice(upstream, client);
            } catch (IOException | RuntimeException dropped) {
                try { client.close(); } catch (IOException ignored) { /* dropping */ }
            }
        }
        void close() { stop = true; try { listener.close(); } catch (IOException ignored) { /* stopping */ } }
    }

    static void readFully(InputStream in, byte[] into) throws IOException {
        int at = 0;
        while (at < into.length) {
            int n = in.read(into, at, into.length - at);
            if (n < 0) { throw new IOException("short read"); }
            at += n;
        }
    }

    static String readHead(InputStream in) throws IOException {
        StringBuilder head = new StringBuilder();
        int consecutive = 0;
        while (consecutive < 2) {
            int b = in.read();
            if (b < 0) { throw new IOException("closed before the head ended"); }
            if (b == '\n') { consecutive++; } else if (b != '\r') { consecutive = 0; }
            head.append((char) b);
            if (head.length() > 16384) { throw new IOException("head too long"); }
        }
        return head.toString();
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

    static final class Result implements NtsNumberCallback, NtsTextPairCallback {
        double value = Double.NaN;
        String name;
        String message;
        int settled;
        @Override public void call(double v) { value = v; settled++; }
        @Override public void call(String n, String m) { name = n; message = m; settled++; }
    }

    /** Bytes through a `CONNECT` tunnel, and the authority the proxy was asked for. */
    static void tunnelled(Echo echo) throws Exception {
        Proxy proxy = new Proxy(null);
        Thread thread = new Thread(proxy, "proxy");
        thread.setDaemon(true);
        thread.start();
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 16);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            Result connected = new Result();
            NtsSocket.connectVia(env, NtsEnv.launch(env), "127.0.0.1", echo.port(), false, 4000,
                "127.0.0.1", proxy.port(), NtsSocket.HTTP_PROXY, connected, connected);
            NtsEnv.drain(env);
            check(connected.settled == 1, "the tunnel settled " + connected.settled + " times");
            check(connected.name == null,
                "a tunnelled connect failed: " + connected.name + ": " + connected.message);
            check(("127.0.0.1:" + echo.port()).equals(proxy.lastAuthority),
                "the proxy was asked for " + proxy.lastAuthority);
            double handle = connected.value;

            byte[] sent = "through the tunnel".getBytes("UTF-8");
            Result written = new Result();
            NtsSocket.write(env, NtsEnv.launch(env), handle, sent, 0, sent.length, written, written);
            NtsEnv.drain(env);
            check(written.value == sent.length, "the tunnel wrote " + written.value);

            byte[] back = new byte[sent.length];
            int filled = 0;
            while (filled < back.length) {
                Result read = new Result();
                NtsSocket.read(env, NtsEnv.launch(env), handle, back, filled, back.length - filled,
                    read, read);
                NtsEnv.drain(env);
                if (read.name != null || read.value <= 0) { break; }
                filled += (int) read.value;
            }
            check(filled == back.length, "the tunnel read back " + filled + " of " + back.length);
            check(new String(back, "UTF-8").equals(new String(sent, "UTF-8")),
                "the tunnel returned different bytes");
            NtsSocket.close(handle);
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
            proxy.close();
        }
    }

    /**
     * The tunnel must not consume a byte past the blank line.
     *
     * <p>The proxy writes the `200` and five bytes of payload in one call, then
     * closes. A client that read the response with a buffer has those five
     * bytes in a buffer nothing will ever look in, so the first read sees end
     * of stream instead -- which is why the assertion is on the bytes and the
     * count rather than on the connection succeeding. It succeeds either way.
     */
    static void nothingPastTheBlankLine(Echo echo) throws Exception {
        Proxy proxy = new Proxy(null);
        proxy.coalesce = "HELLO".getBytes("UTF-8");
        Thread thread = new Thread(proxy, "proxy-coalescing");
        thread.setDaemon(true);
        thread.start();
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 8);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            Result connected = new Result();
            NtsSocket.connectVia(env, NtsEnv.launch(env), "127.0.0.1", echo.port(), false, 4000,
                "127.0.0.1", proxy.port(), NtsSocket.HTTP_PROXY, connected, connected);
            NtsEnv.drain(env);
            check(connected.name == null,
                "a coalescing tunnel failed to connect: " + connected.name + ": " + connected.message);
            byte[] into = new byte[5];
            Result read = new Result();
            NtsSocket.read(env, NtsEnv.launch(env), connected.value, into, 0, into.length, read, read);
            NtsEnv.drain(env);
            check(read.value == 5,
                "the first read after a coalescing tunnel returned " + read.value
                + " -- the CONNECT response was read with a buffer, and the payload that "
                + "arrived with it went into that buffer instead of to the caller");
            check(new String(into, "UTF-8").equals("HELLO"),
                "the tunnel delivered `" + new String(into, "UTF-8") + "`");
            NtsSocket.close(connected.value);
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
            proxy.close();
        }
    }

    /** A proxy that refuses reports its own status, not a generic failure. */
    static void refused(Echo echo, String status, String expected) throws Exception {
        Proxy proxy = new Proxy(status);
        Thread thread = new Thread(proxy, "proxy-refusing");
        thread.setDaemon(true);
        thread.start();
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 8);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            Result result = new Result();
            NtsSocket.connectVia(env, NtsEnv.launch(env), "127.0.0.1", echo.port(), false, 4000,
                "127.0.0.1", proxy.port(), NtsSocket.HTTP_PROXY, result, result);
            NtsEnv.drain(env);
            check(result.settled == 1, "a refused tunnel settled " + result.settled + " times");
            check(result.name != null, "a refused tunnel reported success");
            check(result.message != null && result.message.contains(expected),
                "a refused tunnel said `" + result.message + "`, without `" + expected + "`");
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
            proxy.close();
        }
    }

    /** Bytes through a SOCKS5 hop. */
    static void socks(Echo echo) throws Exception {
        Socks server = new Socks();
        Thread thread = new Thread(server, "socks");
        thread.setDaemon(true);
        thread.start();
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 16);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            Result connected = new Result();
            NtsSocket.connectVia(env, NtsEnv.launch(env), "127.0.0.1", echo.port(), false, 4000,
                "127.0.0.1", server.port(), NtsSocket.SOCKS_PROXY, connected, connected);
            NtsEnv.drain(env);
            check(connected.name == null,
                "a SOCKS connect failed: " + connected.name + ": " + connected.message);
            check(server.accepted == 1, "the SOCKS server saw " + server.accepted + " connections");
            double handle = connected.value;
            byte[] sent = "socks".getBytes("UTF-8");
            Result written = new Result();
            NtsSocket.write(env, NtsEnv.launch(env), handle, sent, 0, sent.length, written, written);
            NtsEnv.drain(env);
            byte[] back = new byte[sent.length];
            Result read = new Result();
            NtsSocket.read(env, NtsEnv.launch(env), handle, back, 0, back.length, read, read);
            NtsEnv.drain(env);
            check(read.value == back.length, "SOCKS read back " + read.value);
            check(new String(back, "UTF-8").equals("socks"), "SOCKS returned different bytes");
            NtsSocket.close(handle);
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
            server.close();
        }
    }

    /**
     * The pair. Same tunnel, same certificate, same proxy -- only the name
     * asked for differs, and only one of them is in the certificate.
     */
    static void verifiedThroughTunnel(Secure secure) throws Exception {
        Proxy proxy = new Proxy(null);
        Thread thread = new Thread(proxy, "proxy-tls");
        thread.setDaemon(true);
        thread.start();
        try {
            Result named = through(proxy, secure, "localhost");
            check(named.settled == 1, "the named tunnel settled " + named.settled + " times");
            check(named.name == null,
                "a tunnel to `localhost`, which the certificate names, was refused: "
                + named.name + ": " + named.message
                + " -- if this is the only failure, the verification is being done against the "
                + "proxy's name rather than the target's");
            Result other = through(proxy, secure, "127.0.0.1");
            check(other.settled == 1, "the mismatched tunnel settled " + other.settled + " times");
            check(other.name != null,
                "a tunnel to `127.0.0.1`, which the certificate does not name, was accepted");
        } finally {
            proxy.close();
        }
    }

    static Result through(Proxy proxy, Secure secure, String asking) throws Exception {
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 8);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            Result result = new Result();
            NtsSocket.connectVia(env, NtsEnv.launch(env), asking, secure.port(), true, 8000,
                "127.0.0.1", proxy.port(), NtsSocket.HTTP_PROXY, result, result);
            NtsEnv.drain(env);
            if (result.name == null) { NtsSocket.close(result.value); }
            return result;
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
        }
    }

    public static void main(String[] args) throws Exception {
        Echo echo = new Echo();
        Thread echoThread = new Thread(echo, "echo");
        echoThread.setDaemon(true);
        echoThread.start();
        Secure secure = new Secure();
        Thread secureThread = new Thread(secure, "secure");
        secureThread.setDaemon(true);
        secureThread.start();
        try {
            tunnelled(echo);
            nothingPastTheBlankLine(echo);
            refused(echo, "HTTP/1.1 407 Proxy Authentication Required", "407");
            refused(echo, "HTTP/1.1 502 Bad Gateway", "502");
            socks(echo);
            verifiedThroughTunnel(secure);
        } finally {
            echo.close();
            secure.close();
            NtsSocket.shutdown();
        }
        System.out.printf("proxy: tunnel, no read-ahead, refusal, socks, verification through a tunnel -- %d checks, %d failures%n",
            checks, failures);
        if (failures != 0) { System.exit(1); }
    }
}
