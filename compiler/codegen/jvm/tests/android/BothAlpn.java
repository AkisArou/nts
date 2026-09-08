import java.io.IOException;
import java.io.FileInputStream;
import java.net.InetAddress;
import java.security.KeyStore;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManagerFactory;
import nts.rt.NtsEnv;
import nts.rt.NtsNumberCallback;
import nts.rt.NtsSocket;
import nts.rt.NtsTextPairCallback;
import org.nts.web.NetworkPrimitives;

/**
 * ALPN through both adapters, and the one role neither of them may take.
 *
 * <p>`nts.rt.NtsSocket` and `org.nts.web.NetworkPrimitives` each offer
 * application protocols to TLS, neither can call the other, and both normalise
 * the absent case from what their platform returns. That is two copies of
 * something subtle, which is how drift starts, so they are held together here
 * by assertion rather than by care -- the same arrangement `BothTunnels` makes
 * for `CONNECT`.
 *
 * <h2>Three facts, each measured before it was written down</h2>
 *
 * <p>Every one of them is invisible until a handshake fails against one
 * particular server, which is the worst possible time to learn any of it:
 *
 * <ul>
 *   <li>The <b>server's</b> order decides. A client offering `http/1.1,h2` to a
 *       server offering `h2,http/1.1` is given `h2` -- so the offer is the set
 *       a caller can speak, not a ranking.
 *   <li>An unmatched offer <b>fails the connect</b>, as a fatal
 *       `no_application_protocol` alert rather than as a connection with no
 *       protocol.
 *   <li>Absence is `""` from both, though the platforms disagree underneath:
 *       JSSE answers `""` and Conscrypt answers `null`.
 * </ul>
 *
 * <h2>Why the server here is not one of ours</h2>
 *
 * <p>Both adapters are clients and neither accepts TLS, which is not an
 * omission to fix later: Conscrypt **drops** application protocols set on a
 * server socket at API 29 -- `getApplicationProtocols()` reads back empty
 * immediately after being set. A server built on this seam would negotiate
 * nothing, on the floor this library declares, silently. The server below is
 * JSSE's, and it stays on the desktop for that reason.
 */
public final class BothAlpn {
    static int failures;
    /** Printed beside the failures: zero failures is satisfied by a suite that stopped. */
    static int checks;

    static void check(boolean ok, String what) {
        checks++;
        if (!ok) { failures++; System.out.println("FAILED: " + what); }
    }

    static SSLContext context(String store, String password) throws Exception {
        KeyStore keys = KeyStore.getInstance("PKCS12");
        FileInputStream input = new FileInputStream(store);
        try { keys.load(input, password.toCharArray()); } finally { input.close(); }
        KeyManagerFactory managers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        managers.init(keys, password.toCharArray());
        TrustManagerFactory trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        trust.init(keys);
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(managers.getKeyManagers(), trust.getTrustManagers(), null);
        return context;
    }

    /** A JSSE server offering a fixed set, for as long as it is not closed. */
    static final class Server implements Runnable {
        final SSLServerSocket listener;
        volatile boolean stop;
        Server(SSLContext context, String[] offers) throws IOException {
            listener = (SSLServerSocket) context.getServerSocketFactory()
                .createServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
            SSLParameters parameters = listener.getSSLParameters();
            if (offers.length > 0) { parameters.setApplicationProtocols(offers); }
            listener.setSSLParameters(parameters);
        }
        int port() { return listener.getLocalPort(); }
        @Override public void run() {
            while (!stop) {
                try (SSLSocket peer = (SSLSocket) listener.accept()) {
                    peer.startHandshake();
                    peer.getOutputStream().write('k');
                    peer.getOutputStream().flush();
                } catch (IOException expected) {
                    // A disjoint offer closes this side mid-handshake too.
                    if (stop) { return; }
                }
            }
        }
        void close() { stop = true; try { listener.close(); } catch (IOException ignored) { /* stopping */ } }
    }

    /** What one adapter answered: the protocol, or the error that stopped it. */
    static final class Answer {
        final String protocol;
        final String error;
        Answer(String protocol, String error) { this.protocol = protocol; this.error = error; }
        @Override public String toString() { return error != null ? "error " + error : "\"" + protocol + "\""; }
        boolean agrees(Answer other) {
            if (error != null || other.error != null) { return (error != null) == (other.error != null); }
            return protocol.equals(other.protocol);
        }
    }

    static final class Result implements NtsNumberCallback, NtsTextPairCallback {
        double value = Double.NaN;
        String name;
        @Override public void call(double v) { value = v; }
        @Override public void call(String n, String m) { name = n; }
    }

    /** Through `nts.rt.NtsSocket`. */
    static Answer viaRuntime(int port, String offer) {
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 4);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            Result result = new Result();
            NtsSocket.connectVia(env, NtsEnv.launch(env), "localhost", port, true, 4000,
                null, 0, NtsSocket.DIRECT, offer, result, result);
            NtsEnv.drain(env);
            if (result.name != null) { return new Answer(null, result.name); }
            String protocol = NtsSocket.protocolOf(result.value);
            NtsSocket.close(result.value);
            return new Answer(protocol, null);
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
        }
    }

    /** Through `org.nts.web.NetworkPrimitives`, with the same private root. */
    static Answer viaPrimitives(Executor lane, SSLContext context, int port, String offer) throws Exception {
        final BlockingQueue<Object[]> done = new ArrayBlockingQueue<Object[]>(1);
        NetworkPrimitives api = new NetworkPrimitives(
            lane, host -> true, (name, message) -> { }, 4, context.getSocketFactory());
        try {
            api.connect("localhost", port, true, 4000, null, 0, NetworkPrimitives.DIRECT, offer,
                new NetworkPrimitives.ConnectCallback() {
                    @Override public void success(int handle) { done.offer(new Object[] { Integer.valueOf(handle), null }); }
                    @Override public void failure(String name, String message) { done.offer(new Object[] { null, name }); }
                });
            Object[] answered = done.poll(10, TimeUnit.SECONDS);
            if (answered == null) { return new Answer(null, "Timeout"); }
            if (answered[1] != null) { return new Answer(null, (String) answered[1]); }
            int handle = ((Integer) answered[0]).intValue();
            String protocol = api.protocolOf(handle);
            api.closeSocket(handle);
            return new Answer(protocol, null);
        } finally {
            api.close();
        }
    }

    /** One case, run through both, compared, and checked against what was expected. */
    static void both(Executor lane, SSLContext context, String[] serverOffers, String clientOffer,
                     String expected, String what) throws Exception {
        Server server = new Server(context, serverOffers);
        Thread thread = new Thread(server, "alpn-server");
        thread.setDaemon(true);
        thread.start();
        try {
            Answer runtime = viaRuntime(server.port(), clientOffer);
            Answer primitives = viaPrimitives(lane, context, server.port(), clientOffer);
            check(runtime.agrees(primitives),
                what + ": the two adapters disagree -- NtsSocket said " + runtime
                    + " and NetworkPrimitives said " + primitives);
            if (expected == null) {
                check(runtime.error != null, what + ": expected the connect to fail, got " + runtime);
            } else {
                check(expected.equals(runtime.protocol),
                    what + ": expected \"" + expected + "\", got " + runtime);
            }
        } finally {
            server.close();
        }
    }

    static final String[] BOTH_PROTOCOLS = { "h2", "http/1.1" };
    static final String[] ONLY_H2 = { "h2" };
    static final String[] NOTHING = {};

    public static void main(String[] args) throws Exception {
        SSLContext context = context(args[0], args.length > 1 ? args[1] : "changeit");
        ExecutorService lane = Executors.newSingleThreadExecutor();
        try {
            both(lane, context, BOTH_PROTOCOLS, "h2,http/1.1", "h2", "an ordinary offer");
            both(lane, context, BOTH_PROTOCOLS, "http/1.1,h2", "h2", "the client's order reversed");
            both(lane, context, ONLY_H2, "http/1.1", null, "a disjoint offer");
            both(lane, context, BOTH_PROTOCOLS, "", "", "offering nothing");
            both(lane, context, NOTHING, "h2,http/1.1", "", "a server offering nothing");
        } finally {
            lane.shutdownNow();
            NtsSocket.shutdown();
        }
        System.out.printf("both alpn: the server's order decides, an unmatched offer fails, absence is empty -- %d checks, %d failures%n",
            checks, failures);
        if (failures != 0) { System.exit(1); }
    }
}
