import java.io.IOException;
import java.net.InetAddress;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLServerSocketFactory;
import javax.net.ssl.SSLSocket;
import nts.rt.NtsEnv;
import nts.rt.NtsNumberCallback;
import nts.rt.NtsTextPairCallback;
import nts.rt.NtsSocket;

/**
 * ALPN, as the four things a caller can get wrong about it.
 *
 * <p>Each case here was a measurement before it was a test, run against both
 * JSSE and Conscrypt, because every one of them is invisible until a handshake
 * fails against one particular server -- which is the worst time to learn any
 * of it.
 *
 * <ul>
 *   <li><b>The server's order decides.</b> A client offering `http/1.1,h2` to a
 *       server offering `h2,http/1.1` is given `h2`. The offer is a set of
 *       protocols the caller can speak, not a ranking, and the second case
 *       below is the one that would catch someone re-reading it as a
 *       preference.
 *   <li><b>An unmatched offer fails the connect</b>, as a fatal
 *       `no_application_protocol` alert rather than as a connection with no
 *       protocol. Naming a protocol you cannot speak costs a connection.
 *   <li><b>Absence is `""`.</b> JSSE answers `""` and Conscrypt answers `null`;
 *       the runtime normalises, so this asserts the normalised answer and would
 *       fail on either platform if that stopped happening.
 *   <li><b>An empty name is refused</b> rather than offered. ALPN names are
 *       opaque bytes and a comma is legal in one, so a split on commas has to
 *       say what it does with a name that contains the separator.
 * </ul>
 *
 * <p>Client-side only, which is all this seam does. Offering protocols on a
 * *server* socket is silently dropped by Conscrypt at API 29 -- the parameters
 * read back empty immediately after being set -- so the server half of this
 * test runs on the desktop JSSE and would not work if it were pushed to a
 * device.
 */
public final class AlpnTest {
    static int failures;
    static int checks;

    static void check(boolean ok, String what) {
        checks++;
        if (!ok) { failures++; System.out.println("FAILED: " + what); }
    }

    static final class Server implements Runnable {
        final SSLServerSocket listener;
        volatile boolean stop;
        Server(String[] offers) throws IOException {
            SSLServerSocketFactory factory = (SSLServerSocketFactory) SSLServerSocketFactory.getDefault();
            listener = (SSLServerSocket) factory.createServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
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

    static final class Result implements NtsNumberCallback, NtsTextPairCallback {
        double value = Double.NaN;
        String name;
        String message;
        String protocol;
        @Override public void call(double v) { value = v; }
        @Override public void call(String n, String m) { name = n; message = m; }
    }

    /** Connects once with `offer`, reads the negotiated protocol, and closes. */
    static Result connect(int port, String offer) {
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 4);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            Result result = new Result();
            NtsSocket.connectVia(env, NtsEnv.launch(env), "localhost", port, true, 4000,
                null, 0, NtsSocket.DIRECT, offer, result, result);
            NtsEnv.drain(env);
            if (!Double.isNaN(result.value) && result.name == null) {
                // Read before the close: a handle that is not open answers `""`
                // for a different reason, and asking after would pass whatever
                // the negotiation did.
                result.protocol = NtsSocket.protocolOf(result.value);
                NtsSocket.close(result.value);
            }
            return result;
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
        }
    }

    /** One server, for one case, torn down before the next. */
    static Result against(String[] serverOffers, String clientOffer) throws Exception {
        Server server = new Server(serverOffers);
        Thread thread = new Thread(server, "alpn-echo");
        thread.setDaemon(true);
        thread.start();
        try {
            return connect(server.port(), clientOffer);
        } finally {
            server.close();
        }
    }

    static final String[] BOTH = { "h2", "http/1.1" };
    static final String[] ONLY_H2 = { "h2" };
    static final String[] NONE = {};

    public static void main(String[] args) throws Exception {
        try {
            Result agreed = against(BOTH, "h2,http/1.1");
            check(agreed.name == null, "an ordinary ALPN connect failed: " + agreed.name + " " + agreed.message);
            check("h2".equals(agreed.protocol), "expected h2, got \"" + agreed.protocol + "\"");

            // The one that catches reading the offer as a preference.
            Result reversed = against(BOTH, "http/1.1,h2");
            check(reversed.name == null, "the reversed offer failed to connect: " + reversed.message);
            check("h2".equals(reversed.protocol),
                "the client's order changed the answer, so the offer is being read as a "
                    + "preference; expected h2 from the server's order, got \"" + reversed.protocol + "\"");

            Result disjoint = against(ONLY_H2, "http/1.1");
            check(disjoint.name != null,
                "a client offering only http/1.1 to a server offering only h2 connected anyway, "
                    + "so an unmatched offer is not failing the handshake");

            Result silent = against(BOTH, "");
            check(silent.name == null, "a connect offering nothing failed: " + silent.message);
            check("".equals(silent.protocol),
                "no offer should negotiate nothing and read back \"\", got \"" + silent.protocol + "\"");

            Result unoffered = against(NONE, "h2,http/1.1");
            check(unoffered.name == null, "a server offering nothing refused the connection: " + unoffered.message);
            check("".equals(unoffered.protocol),
                "a server that offers nothing should leave \"\", got \"" + unoffered.protocol + "\"");

            Result empty = against(BOTH, "h2,,http/1.1");
            check("IllegalArgumentException".equals(empty.name),
                "an empty protocol name should be refused rather than offered; got " + empty.name);

            check("".equals(NtsSocket.protocolOf(0)), "a handle that is not open should answer \"\"");
        } finally {
            NtsSocket.shutdown();
        }
        System.out.printf("alpn: the server's order decides, an unmatched offer fails, absence is empty -- %d checks, %d failures%n",
            checks, failures);
        if (failures != 0) { System.exit(1); }
    }
}
