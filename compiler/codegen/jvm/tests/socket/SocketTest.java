import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import nts.rt.NtsEnv;
import nts.rt.NtsNumberCallback;
import nts.rt.NtsTextPairCallback;
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
        Thread lane;
        int settled;
        @Override public void call(double v) { value = v; lane = Thread.currentThread(); settled++; }
        @Override public void call(String n, String m) {
            name = n; message = m; lane = Thread.currentThread(); settled++;
        }
    }

    static void roundTrip(Echo echo, Thread owner) throws Exception {
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 16);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            Result connected = new Result();
            NtsSocket.connect(env, NtsEnv.launch(env), "127.0.0.1", echo.port(), false, 2000, connected, connected);
            NtsEnv.drain(env);
            check(connected.settled == 1, "connect settled " + connected.settled + " times");
            check(connected.name == null, "connect failed: " + connected.name + " " + connected.message);
            check(connected.lane == owner,
                "a completion was delivered on " + connected.lane + " rather than the owner lane");
            double handle = connected.value;

            byte[] sent = "the quick brown fox".getBytes("UTF-8");
            Result written = new Result();
            NtsSocket.write(env, NtsEnv.launch(env), handle, sent, 0, sent.length, written, written);
            NtsEnv.drain(env);
            check(written.name == null, "write failed: " + written.name + " " + written.message);
            check(written.value == sent.length, "wrote " + written.value + " of " + sent.length);

            byte[] back = new byte[64];
            Result read = new Result();
            NtsSocket.read(env, NtsEnv.launch(env), handle, back, 0, back.length, read, read);
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
            NtsSocket.connect(env, NtsEnv.launch(env), "127.0.0.1", echo.port(), false, 2000, connected, connected);
            NtsEnv.drain(env);
            final double handle = connected.value;

            byte[] into = new byte[16];
            Result read = new Result();
            // Nothing was written, so the peer says nothing and this blocks.
            NtsSocket.read(env, NtsEnv.launch(env), handle, into, 0, into.length, read, read);
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

    /**
     * No credit means no socket -- and the failure still arrives as a task.
     *
     * <p>The middle assertion is the point and it used to be the opposite one.
     * A refused launch is known before `connect` returns, so reporting it there
     * was the obvious thing and it is wrong: a program would see `Backpressure`
     * at one position in the task order and `ECONNREFUSED` at another, so its
     * output would depend on **which** failure happened rather than on the fact
     * that one did. Node never calls a completion inline and node is the
     * oracle.
     */
    static void backpressure(Echo echo) throws Exception {
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 1);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            double before = NtsSocket.openCount();
            NtsInbox.Slot only = NtsEnv.launch(env);
            check(only != null, "the first credit was refused");
            Result refused = new Result();
            NtsSocket.connect(env, NtsEnv.launch(env), "127.0.0.1", echo.port(), false, 2000, refused, refused);
            check(refused.settled == 0,
                "a refused launch reported inline, before connect returned");
            // The held credit goes back *before* the drain, and it has to: an
            // environment with one outstanding completion and no timer is not
            // idle, so `drain` parks waiting for work that in this test is
            // never coming. That is the monotonic liveness rule doing its job
            // -- the environment cannot tell a credit a test is sitting on from
            // a socket read in flight, and it must not exit on either.
            NtsEnv.cancel(env, only);
            NtsEnv.drain(env);
            check(refused.settled == 1, "a refused launch settled " + refused.settled + " times");
            check("Backpressure".equals(refused.name),
                "a refused launch reported " + refused.name);
            check(NtsSocket.openCount() == before, "a refused launch opened a socket anyway");
            check(NtsEnv.outstanding(env) == 0.0, "backpressure leaked liveness");
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
        }
    }

    /**
     * A listener that never accepts, so its backlog fills and the next connect
     * hangs.
     *
     * <p>Cancelling a connect needs a connect that is still running, and on
     * loopback a real one finishes faster than a test can react. A full accept
     * queue is the way to get one deterministically without depending on a
     * routable blackhole address or on the machine having a network at all:
     * once the queue is full the kernel stops completing handshakes, and the
     * client sits in `connect` until its timeout.
     */
    /**
     * Accepts everything and counts it. The peer's view of whether a cancelled
     * connect happened.
     */
    static final class Counting implements Runnable {
        final ServerSocket listener;
        volatile int accepted;
        volatile boolean stop;
        Counting() throws IOException {
            listener = new ServerSocket(0, 16, java.net.InetAddress.getByName("127.0.0.1"));
        }
        int port() { return listener.getLocalPort(); }
        @Override public void run() {
            while (!stop) {
                try (Socket peer = listener.accept()) { accepted++; }
                catch (IOException closing) { if (stop) { return; } }
            }
        }
        void close() { stop = true; try { listener.close(); } catch (IOException ignored) { /* stopping */ } }
    }

    static final class Deaf {
        final ServerSocket listener;
        Deaf() throws IOException {
            listener = new ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"));
        }
        int port() { return listener.getLocalPort(); }
        void close() { try { listener.close(); } catch (IOException ignored) { /* stopping */ } }
    }

    /**
     * A cancelled connect settles once, as a cancellation, and leaves nothing
     * open.
     *
     * <p>`Cancelled` rather than `SocketException: Socket closed`: cancelling a
     * blocking connect *is* closing the socket under the worker, so the
     * worker's own view of the failure names the mechanism and not the cause,
     * and a deliberate abort would be indistinguishable from a peer that
     * dropped the connection.
     */
    static void connectCancel() throws Exception {
        Deaf deaf = new Deaf();
        Counting counting = new Counting();
        Thread counter = new Thread(counting, "counting");
        counter.setDaemon(true);
        counter.start();
        java.util.List<Socket> filling = new java.util.ArrayList<Socket>();
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 8);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            // Fill the accept queue. The count is deliberately generous: what
            // matters is that the *next* connect hangs, and the exact depth at
            // which a kernel stops completing handshakes is not a contract.
            for (int i = 0; i < 8; i++) {
                Socket filler = new Socket();
                try {
                    filler.connect(new java.net.InetSocketAddress("127.0.0.1", deaf.port()), 200);
                    filling.add(filler);
                } catch (IOException full) { break; }
            }
            double before = NtsSocket.openCount();

            // **Cancelled while it is running.** The worker has to be *inside*
            // `Socket.connect` for this to test what it says, and it very
            // nearly did not: cancelling immediately after `connect` returns
            // wins the scheduling race almost every time, the worker sees the
            // flag before it has a socket, and the `Cancelled` that comes back
            // was never routed through the close-under-the-worker path at all.
            // The sabotage caught it -- removing that path left the suite green
            // -- so the wait is here, and the assertion after it is what makes
            // the wait honest rather than decorative.
            Result running = new Result();
            double first = NtsSocket.connect(
                env, NtsEnv.launch(env), "127.0.0.1", deaf.port(), false, 20000, running, running);
            check(first > 0, "connect did not return a cancellable request");
            Thread.sleep(200);
            check(running.settled == 0,
                "the deaf listener did not hold the connect open -- its accept queue was "
                + "not full, so this cancels nothing that is running");

            // **Cancelled before the worker reaches it**, which is a different
            // path: there is no socket to close, so the worker has to notice
            // the flag itself when it starts.
            //
            // Submitted *while the first is still blocked*, and that is what
            // makes it deterministic rather than a race. The pool has one core
            // thread and a queue of 256, so a `ThreadPoolExecutor` puts the
            // second task in the queue rather than starting a thread for it --
            // it cannot begin until the first completes. Cancelling it after
            // the drain, as this first did, gives it a free thread and it runs
            // immediately; the sabotage caught that too.
            //
            // **The assertion is that the peer never saw it**, and that is the
            // second thing the sabotage taught. Checking the error name proves
            // nothing here: `fail` reports `Cancelled` for anything that was
            // cancelled, so a connect that ran anyway, reached the server and
            // then timed out still comes back saying `Cancelled`. The
            // pre-start check is not about the message. It is about a request
            // the program withdrew not arriving at the far end -- which a
            // counting listener can see and the completion cannot.
            Result early = new Result();
            double second = NtsSocket.connect(
                env, NtsEnv.launch(env), "127.0.0.1", counting.port(), false, 1500, early, early);
            NtsSocket.cancelConnect(second);
            check(early.settled == 0, "a queued connect settled before anything ran");

            NtsSocket.cancelConnect(first);
            NtsSocket.cancelConnect(first);
            NtsEnv.drain(env);
            check(running.settled == 1, "a cancelled connect settled " + running.settled + " times");
            check("Cancelled".equals(running.name),
                "a connect cancelled in flight reported " + running.name + ": " + running.message);
            check(early.settled == 1, "an early-cancelled connect settled " + early.settled + " times");
            check("Cancelled".equals(early.name),
                "a connect cancelled before it started reported " + early.name + ": " + early.message);
            check(counting.accepted == 0,
                "a connect cancelled before it started still reached the peer "
                + counting.accepted + " time(s)");

            check(NtsSocket.openCount() == before,
                "a cancelled connect left " + (NtsSocket.openCount() - before) + " connection(s) open");
            check(NtsEnv.outstanding(env) == 0.0, "a cancelled connect leaked liveness");
            // An id nobody issued, and ones already retired. Both are ordinary
            // for an adapter that cancels on a signal it does not own.
            NtsSocket.cancelConnect(first);
            NtsSocket.cancelConnect(second);
            NtsSocket.cancelConnect(9999);
            NtsSocket.cancelConnect(0);
            NtsSocket.cancelConnect(-1);
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
            for (Socket filler : filling) { try { filler.close(); } catch (IOException ignored) { /* done */ } }
            deaf.close();
            counting.close();
        }
    }

    /**
     * A network transition closes what was open and loses no completion.
     *
     * <p>The second half is the one that can go wrong invisibly. Closing the
     * sockets is easy; closing them and dropping the in-flight completions
     * strands the lane, because the connections are gone and the environment
     * waits forever for answers that are never coming. So this puts a read in
     * flight, transitions under it, and asserts both that the read *settles*
     * and that liveness reaches zero.
     */
    static void networkTransition(Echo echo) throws Exception {
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 16);
        NtsEnv previous = NtsEnv.enterEnv(env);
        try {
            double[] handles = new double[3];
            for (int i = 0; i < handles.length; i++) {
                Result connected = new Result();
                NtsSocket.connect(env, NtsEnv.launch(env), "127.0.0.1", echo.port(), false, 2000,
                    connected, connected);
                NtsEnv.drain(env);
                check(connected.name == null, "connect " + i + " failed: " + connected.name);
                handles[i] = connected.value;
            }
            check(NtsSocket.openCount() == 3.0,
                "three connections registered as " + NtsSocket.openCount());

            // A read that will never be answered -- the echo server says
            // nothing until it is spoken to -- so it is in flight across the
            // transition, which is the case that matters.
            byte[] into = new byte[16];
            Result blocked = new Result();
            NtsSocket.read(env, NtsEnv.launch(env), handles[0], into, 0, into.length,
                blocked, blocked);
            Thread.sleep(120);
            check(blocked.settled == 0, "the read settled before the transition");

            double closed = NtsSocket.networkChanged();
            check(closed >= 3.0, "the transition closed " + closed + " of at least 3");
            check(NtsSocket.openCount() == 0.0,
                NtsSocket.openCount() + " connections survived the transition");

            // A bounded pump rather than `drain`. If the transition failed to
            // unblock the worker, `drain` waits for a completion that is never
            // coming and the suite **hangs** instead of failing -- which is
            // what the sabotage did. Two seconds is far longer than a loopback
            // read needs and far shorter than the tens of seconds a socket on
            // a replaced network takes to give up on its own.
            for (int i = 0; i < 200 && blocked.settled == 0; i++) {
                NtsEnv.step(env);
                Thread.sleep(10);
            }
            check(blocked.settled == 1,
                "the in-flight read settled " + blocked.settled + " times across a transition "
                + "-- a completion dropped here strands the lane, because the connection is gone "
                + "and nothing will ever answer");
            NtsEnv.drain(env);
            check(NtsEnv.outstanding(env) == 0.0,
                "a transition left " + NtsEnv.outstanding(env) + " completion(s) outstanding");

            // Every handle is now closed, and a use of one says so rather than
            // reaching into a table entry something else may have taken.
            Result after = new Result();
            NtsSocket.read(env, NtsEnv.launch(env), handles[1], into, 0, into.length, after, after);
            NtsEnv.drain(env);
            check("Closed".equals(after.name),
                "a read after a transition reported " + after.name);

            // The table entries have to be *freed*, not merely closed. A
            // transition that closed the sockets and left the rows behind
            // reports zero open -- `openCount` skips closed rows -- while the
            // table grows by three on every handover, forever. The observable
            // is that the next connection reuses a slot rather than appending.
            Result again = new Result();
            NtsSocket.connect(env, NtsEnv.launch(env), "127.0.0.1", echo.port(), false, 2000,
                again, again);
            NtsEnv.drain(env);
            check(again.name == null, "a connect after a transition failed: " + again.name);
            check(again.value <= handles.length,
                "the connection after a transition took handle " + again.value
                + ", past the " + handles.length + " the transition should have freed");
            NtsSocket.close(again.value);
        } finally {
            NtsEnv.close(env);
            NtsEnv.leaveEnv(env, previous);
        }
    }

    /**
     * A write that reports less than it was asked, and a caller that loops.
     *
     * <p>`OutputStream.write` writes everything or throws, so this primitive
     * naturally always reports the full count -- and the shared `writeAll` loop
     * above it, which exists to handle a short write, would have its body run
     * **once, ever, on every platform**. A partial-write path no provider can
     * produce is a path nothing has run, and a real `send(2)` on a full send
     * buffer returns short.
     *
     * <p>So the reference transport can be told to fragment, deterministically,
     * and this is the loop a shared `writeAll` is: keep writing from where the
     * last call stopped until the whole slice is gone. What it proves is that
     * short writes make progress and that the bytes arrive in order and intact
     * -- an off-by-one in the offset would deliver the right *number* of bytes
     * and the wrong ones.
     */
    static void partialWrites(Echo echo) throws Exception {
        NtsEnv env = NtsEnv.create(NtsEnv.MONOTONIC, 32);
        NtsEnv previous = NtsEnv.enterEnv(env);
        NtsSocket.fragmentWritesAt(7);
        try {
            Result connected = new Result();
            NtsSocket.connect(env, NtsEnv.launch(env), "127.0.0.1", echo.port(), false, 2000,
                connected, connected);
            NtsEnv.drain(env);
            check(connected.name == null, "connect failed: " + connected.name);
            double handle = connected.value;

            byte[] sent = new byte[60];
            for (int i = 0; i < sent.length; i++) { sent[i] = (byte) ('a' + (i % 26)); }
            int at = 0;
            int calls = 0;
            while (at < sent.length) {
                Result wrote = new Result();
                NtsSocket.write(env, NtsEnv.launch(env), handle, sent, at, sent.length - at,
                    wrote, wrote);
                NtsEnv.drain(env);
                if (wrote.name != null) { check(false, "write failed: " + wrote.message); break; }
                check(wrote.value >= 1 && wrote.value <= sent.length - at,
                    "a write reported " + wrote.value + " of " + (sent.length - at)
                    + ", outside the 1..length the contract allows");
                at += (int) wrote.value;
                calls++;
            }
            check(at == sent.length, "the loop wrote " + at + " of " + sent.length);
            check(calls > 1,
                "the whole slice went in one call, so the fragment setting did nothing and "
                + "this exercises the same path as an ordinary write");

            byte[] back = new byte[sent.length];
            int filled = 0;
            while (filled < back.length) {
                Result read = new Result();
                NtsSocket.read(env, NtsEnv.launch(env), handle, back, filled,
                    back.length - filled, read, read);
                NtsEnv.drain(env);
                if (read.name != null || read.value <= 0) { break; }
                filled += (int) read.value;
            }
            check(filled == back.length, "read back " + filled + " of " + back.length);
            check(java.util.Arrays.equals(back, sent),
                "the bytes came back different -- a fragmented write that delivered the right "
                + "count from the wrong offset would look exactly like this");
            NtsSocket.close(handle);
        } finally {
            NtsSocket.fragmentWritesAt(0);
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
            NtsSocket.connect(env, NtsEnv.launch(env), "127.0.0.1", echo.port(), false, 2000, connected, connected);
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
            connectCancel();
            partialWrites(echo);
            networkTransition(echo);
            shutdownCloses(echo);
        } finally {
            echo.close();
            NtsSocket.shutdown();
        }
        System.out.printf("socket: round trip, lanes, cancellation, backpressure, connect cancel, partial writes, transition, shutdown -- %d checks, %d failures%n",
            checks, failures);
        if (failures != 0) { System.exit(1); }
    }
}
