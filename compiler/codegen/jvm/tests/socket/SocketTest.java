import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import nts.rt.NtsEnv;
import nts.rt.NtsInbox;
import nts.rt.NtsSocket;

/**
 * The reference transport against a loopback server: bytes, lanes,
 * cancellation, close races and backpressure.
 *
 * <p>Real I/O, so this is a **liveness** test on a monotonic environment, not
 * an oracle test. Nothing here compares against node; what it proves is that
 * completions reach the owner lane, that a cancelled operation settles once,
 * and that a refused launch creates no socket.
 */
public final class SocketTest {
    static int failures;
    static void check(boolean ok, String what) {
        if (!ok) { failures++; if (failures < 10) { System.out.println("FAILED: " + what); } }
    }

    /** Echoes until the peer closes. Deliberately trivial. */
    static final class Echo implements Runnable {
        final ServerSocket listener;
        volatile boolean stop;
        Echo() throws IOException { listener = new ServerSocket(0, 16, java.net.InetAddress.getByName("127.0.0.1")); }
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
                    if (!stop) { continue; }
                }
            }
        }
        void close() { stop = true; try { listener.close(); } catch (IOException ignored) { /* stopping */ } }
    }

    /** One completion, recorded with the thread that delivered it. */
    static final class Result implements NtsSocket.Completion {
        double value = Double.NaN;
        String name;
        String message;
        Thread lane;
        int settled;
        @Override public void ok(double v) { value = v; lane = Thread.currentThread(); settled++; }
        @Override public void failed(String n, String m) {
            name = n; message = m; lane = Thread.currentThread(); settled++;
        }
    }

    static void roundTrip(Echo echo, Thread owner) throws Exception {
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 16);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            Result connected = new Result();
            NtsSocket.connect(env, NtsEnv.launch(env), "127.0.0.1", echo.port(), false, 2000, connected);
            NtsEnv.drain(env);
            check(connected.settled == 1, "connect settled " + connected.settled + " times");
            check(connected.name == null, "connect failed: " + connected.name + " " + connected.message);
            check(connected.lane == owner,
                "a completion was delivered on " + connected.lane + " rather than the owner lane");
            double handle = connected.value;

            byte[] sent = "the quick brown fox".getBytes("UTF-8");
            Result written = new Result();
            NtsSocket.write(env, NtsEnv.launch(env), handle, sent, 0, sent.length, written);
            NtsEnv.drain(env);
            check(written.name == null, "write failed: " + written.name + " " + written.message);
            check(written.value == sent.length, "wrote " + written.value + " of " + sent.length);

            byte[] back = new byte[64];
            Result read = new Result();
            NtsSocket.read(env, NtsEnv.launch(env), handle, back, 0, back.length, read);
            NtsEnv.drain(env);
            check(read.name == null, "read failed: " + read.name + " " + read.message);
            check(read.value == sent.length, "read " + read.value + " of " + sent.length);
            check(read.lane == owner, "a read completed off the owner lane");
            // The publication edge: bytes a worker wrote are visible here.
            for (int i = 0; i < sent.length; i++) {
                if (back[i] != sent[i]) { check(false, "byte " + i + " did not survive the handoff"); break; }
            }
            check(NtsEnv.outstanding(env) == 0.0, NtsEnv.outstanding(env) + " outstanding after three completions");
            NtsSocket.close(handle);
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
        }
    }

    /** A read blocked on a quiet peer, cancelled by closing under it. */
    static void cancellation(Echo echo) throws Exception {
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 16);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            Result connected = new Result();
            NtsSocket.connect(env, NtsEnv.launch(env), "127.0.0.1", echo.port(), false, 2000, connected);
            NtsEnv.drain(env);
            final double handle = connected.value;

            byte[] into = new byte[16];
            Result read = new Result();
            // Nothing was written, so the peer says nothing and this blocks.
            NtsSocket.read(env, NtsEnv.launch(env), handle, into, 0, into.length, read);
            Thread closer = new Thread(new Runnable() {
                @Override public void run() {
                    try { Thread.sleep(50); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                    NtsSocket.close(handle);
                }
            });
            closer.start();
            NtsEnv.drain(env);
            closer.join();
            check(read.settled == 1, "a cancelled read settled " + read.settled + " times");
            check("Aborted".equals(read.name),
                "a cancelled read reported " + read.name + " rather than Aborted");
            check(NtsEnv.outstanding(env) == 0.0,
                "a cancelled read left " + NtsEnv.outstanding(env) + " outstanding");
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
        }
    }

    /** No credit means no socket, and the failure arrives before any exists. */
    static void backpressure(Echo echo) throws Exception {
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 1);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            double before = NtsSocket.openCount();
            NtsInbox.Slot only = NtsEnv.launch(env);
            check(only != null, "the first credit was refused");
            Result refused = new Result();
            NtsSocket.connect(env, NtsEnv.launch(env), "127.0.0.1", echo.port(), false, 2000, refused);
            check(refused.settled == 1, "a refused launch settled " + refused.settled + " times");
            check("Backpressure".equals(refused.name),
                "a refused launch reported " + refused.name);
            check(NtsSocket.openCount() == before, "a refused launch opened a socket anyway");
            NtsEnv.cancel(env, only);
            check(NtsEnv.outstanding(env) == 0.0, "backpressure leaked liveness");
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
        }
    }

    /** Closing the environment leaves no socket behind. */
    static void shutdownCloses(Echo echo) throws Exception {
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 8);
        NtsEnv previous = NtsEnv.enterEnv(env);
        double handle;
        try {
            Result connected = new Result();
            NtsSocket.connect(env, NtsEnv.launch(env), "127.0.0.1", echo.port(), false, 2000, connected);
            NtsEnv.drain(env);
            handle = connected.value;
            check(NtsSocket.openCount() >= 1, "the connection was not registered");
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
        }
        NtsSocket.close(handle);
        check(NtsSocket.openCount() == 0.0, NtsSocket.openCount() + " connections outlived their environment");
    }

    public static void main(String[] args) throws Exception {
        Thread owner = Thread.currentThread();
        Echo echo = new Echo();
        Thread server = new Thread(echo, "echo");
        server.setDaemon(true);
        server.start();
        try {
            roundTrip(echo, owner);
            cancellation(echo);
            backpressure(echo);
            shutdownCloses(echo);
        } finally {
            echo.close();
            NtsSocket.shutdown();
        }
        System.out.printf("socket: round trip, lanes, cancellation, backpressure, shutdown -- %d failures%n",
            failures);
        if (failures != 0) { System.exit(1); }
    }
}
