import java.io.IOException;
import java.net.InetAddress;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLServerSocketFactory;
import javax.net.ssl.SSLSocket;
import nts.rt.NtsEnv;
import nts.rt.NtsNumberCallback;
import nts.rt.NtsTextPairCallback;
import nts.rt.NtsSocket;

/**
 * Hostname verification, proven live by a pair rather than present by one.
 *
 * <p>The certificate is self-signed with `SAN=dns:localhost` and the client
 * trusts it explicitly, so chain validation cannot be what refuses. The two
 * connections differ **only in the name asked for**: `localhost` matches the
 * SAN and must succeed; `127.0.0.1` does not appear in the certificate at all
 * and must fail. One failing connection would prove nothing -- it could fail
 * for any reason. A matched pair proves the check is the thing discriminating.
 *
 * <p>This is what stands behind {@link NtsSocket}'s
 * `setEndpointIdentificationAlgorithm("HTTPS")`. Remove that line and the
 * second connection succeeds: a valid certificate for *any* host becomes
 * acceptable for *every* host, against an honest server, silently.
 */
public final class TlsTest {
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

    static final class Server implements Runnable {
        final SSLServerSocket listener;
        volatile boolean stop;
        Server() throws IOException {
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
                } catch (IOException expected) {
                    // A client that refuses the name closes mid-handshake.
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

    static Result connect(String host, int port) {
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 4);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            Result result = new Result();
            NtsSocket.connect(env, NtsEnv.launch(env), host, port, true, 4000, result, result);
            NtsEnv.drain(env);
            if (!Double.isNaN(result.value) && result.name == null) { NtsSocket.close(result.value); }
            return result;
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
        }
    }

    public static void main(String[] args) throws Exception {
        Server server = new Server();
        Thread thread = new Thread(server, "tls-echo");
        thread.setDaemon(true);
        thread.start();
        try {
            Result matching = connect("localhost", server.port());
            check(matching.name == null,
                "the name in the certificate was refused: " + matching.name + " " + matching.message);

            Result mismatched = connect("127.0.0.1", server.port());
            check(mismatched.name != null,
                "a certificate naming only `localhost` was accepted for 127.0.0.1 -- "
                    + "endpoint identification is not doing anything");
        } finally {
            server.close();
            NtsSocket.shutdown();
        }
        System.out.printf("tls: the certificate's name is accepted and any other is refused -- %d checks, %d failures%n",
            checks, failures);
        if (failures != 0) { System.exit(1); }
    }
}
