package nts.rt;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.SNIHostName;
import javax.net.ssl.SNIServerName;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * The deterministic reference transport: raw {@link Socket} and
 * {@link SSLSocket} behind a byte-stream interface.
 *
 * <h2>Why raw, when a platform HTTP client exists</h2>
 *
 * Node is this repository's oracle **by bit pattern**, and that only works
 * while every lane computes the same function. A platform client diverges
 * observably -- header casing and order, redirect policy, transparent
 * decompression, connection reuse, a silent HTTP/2 upgrade -- and on Android
 * `HttpURLConnection` is OkHttp-backed with behaviour that has changed across
 * API levels, so the divergence is a moving target. This path exists so the
 * production one has something to be checked against.
 *
 * <h2>The thing a raw `SSLSocket` does not do, and it is the important one</h2>
 *
 * **An `SSLSocket` validates the certificate chain and does not check that the
 * certificate belongs to the host you asked for.** Endpoint identification is
 * off by default: without
 * {@link SSLParameters#setEndpointIdentificationAlgorithm}, a valid certificate
 * for *any* host any trusted CA ever signed is accepted for *every* host. That
 * is the single most common TLS mistake in Java, it produces a connection that
 * works perfectly against an honest server, and only an active attacker or a
 * deliberate test ever notices.
 *
 * <p>So it is set here, always, with no option to turn it off, and
 * `TlsSabotage` removes it to prove the suite goes red.
 *
 * <h2>Threads</h2>
 *
 * Blocking I/O runs on a bounded pool; **no worker ever touches an environment
 * or calls TypeScript**. A worker's only interaction with the owner lane is
 * {@link NtsInbox#post} into a slot reserved before the work was submitted,
 * which is also the publication edge that makes the bytes it read visible.
 */
public final class NtsSocket {
    // A completion used to be one two-method interface, `ok` and `failed`,
    // and that interface was **structurally impossible for generated code to
    // implement**: a TypeScript closure lowers to a class with exactly one
    // `call`, so a Java interface with two methods can only ever be written by
    // hand. The transport was reachable from Java and from nothing else, which
    // is not what a reference transport is for.
    //
    // So a completion is two closures -- `NtsNumberCallback` for the count or
    // handle, `NtsTextPairCallback` for a code and a message -- each of which
    // is one `call` and is attached to a matching closure by descriptor. The
    // shape is now the shape TypeScript can hand over, and the split was
    // forced by the ABI rather than chosen for taste.

    private static final class Connection {
        final Socket socket;
        final InputStream in;
        final OutputStream out;
        volatile boolean closed;
        Connection(Socket socket, InputStream in, OutputStream out) {
            this.socket = socket;
            this.in = in;
            this.out = out;
        }
    }

    /**
     * Bounded, and the bound is the point.
     *
     * <p>An unbounded pool answers a burst of connects by making a thread per
     * connect, which on a phone is how an application dies. The queue is
     * bounded too: work that cannot be queued is refused at submission, where
     * the caller still holds its completion credit and can return it, rather
     * than after the platform work exists.
     */
    private static final int MAX_WORKERS = 8;
    private static final int MAX_QUEUED = 256;

    private static final AtomicInteger NEXT_WORKER = new AtomicInteger();
    private static ThreadPoolExecutor workers;
    private static final List<Connection> OPEN = new ArrayList<Connection>();
    private static final Object TABLE = new Object();

    private NtsSocket() {}

    private static synchronized ThreadPoolExecutor pool() {
        if (workers == null || workers.isShutdown()) {
            workers = new ThreadPoolExecutor(
                1, MAX_WORKERS, 30, TimeUnit.SECONDS,
                new ArrayBlockingQueue<Runnable>(MAX_QUEUED),
                new ThreadFactory() {
                    @Override public Thread newThread(Runnable body) {
                        Thread t = new Thread(body, "nts-io-" + NEXT_WORKER.incrementAndGet());
                        // Daemon: an I/O thread must never be the reason a
                        // process refuses to exit.
                        t.setDaemon(true);
                        return t;
                    }
                });
            workers.allowCoreThreadTimeOut(true);
        }
        return workers;
    }

    /** Stop accepting work and let the pool go. Idempotent. */
    public static synchronized void shutdown() {
        if (workers != null) {
            workers.shutdownNow();
            workers = null;
        }
        synchronized (TABLE) {
            // A freed handle leaves a null behind so the index stays stable;
            // shutdown walks the same table and must expect them.
            for (Connection c : OPEN) { if (c != null) { closeQuietly(c); } }
            OPEN.clear();
        }
    }

    private static void closeQuietly(Connection c) {
        c.closed = true;
        try { c.socket.close(); } catch (IOException ignored) { /* closing */ }
    }

    private static double register(Connection c) {
        synchronized (TABLE) {
            for (int i = 0; i < OPEN.size(); i++) {
                if (OPEN.get(i) == null) { OPEN.set(i, c); return i + 1; }
            }
            OPEN.add(c);
            return OPEN.size();
        }
    }

    /**
     * A connect in flight, and the only thing cancelling one can reach.
     *
     * <p>Cancellation of a blocking connect is `Socket.close` from another
     * thread, which is why the socket has to be published here the moment it
     * exists rather than kept in the worker's local. The two fields are guarded
     * by this object's monitor because the race is the ordinary one and it is
     * not benign: the canceller sets the flag and reads a socket the worker has
     * not stored yet, while the worker stores the socket and reads a flag the
     * canceller has not set yet, and the connection stays open for the rest of
     * the process.
     *
     * <p>What cancellation cannot reach is name resolution. `InetSocketAddress`
     * resolves before any socket exists, on the worker, and nothing interrupts
     * a resolver -- so an abort during DNS is a completion that arrives anyway
     * and is discarded, which is why the bounded pool is load-bearing rather
     * than tidy.
     */
    private static final class Request {
        boolean cancelled;
        Socket socket;
    }

    private static final ArrayList<Request> PENDING = new ArrayList<Request>();

    private static double reserve(Request request) {
        synchronized (PENDING) {
            for (int i = 0; i < PENDING.size(); i++) {
                if (PENDING.get(i) == null) { PENDING.set(i, request); return i + 1; }
            }
            PENDING.add(request);
            return PENDING.size();
        }
    }

    private static void retire(double id) {
        int at = (int) id - 1;
        synchronized (PENDING) {
            if (at >= 0 && at < PENDING.size()) { PENDING.set(at, null); }
        }
    }

    /**
     * Cancel a connect. Idempotent, and safe from any lane.
     *
     * <p>A late success is still a success as far as the operating system is
     * concerned, so this closes the socket if there is one and the completion
     * reports `Cancelled` -- the credit comes back either way. An adapter that
     * has already rejected its promise ignores the completion; what it must not
     * do is leak the connection, and that is this method's job rather than the
     * adapter's.
     */
    public static void cancelConnect(double id) {
        int at = (int) id - 1;
        Request request;
        synchronized (PENDING) {
            if (at < 0 || at >= PENDING.size()) { return; }
            request = PENDING.get(at);
        }
        if (request == null) { return; }
        Socket socket;
        synchronized (request) {
            if (request.cancelled) { return; }
            request.cancelled = true;
            socket = request.socket;
        }
        if (socket != null) { try { socket.close(); } catch (IOException ignored) { /* cancelling */ } }
    }

    /**
     * Report a synchronous failure the way an asynchronous one arrives.
     *
     * <p>Backpressure, a full queue and a closed handle are all known before
     * this returns, and calling the callback here would deliver them **inline,
     * before the caller has its handle back**. That is not just untidy: a
     * program would observe `Backpressure` in a different position in the task
     * order than `ECONNREFUSED`, so its output would depend on which failure
     * occurred rather than only on the fact that one did. Node never does this
     * and node is the oracle, so neither does this.
     */
    private static void later(NtsEnv env, final NtsTextPairCallback failed,
                              final String name, final String message) {
        NtsEnv.tick(env, new NtsResumable() {
            @Override public void resume() { failed.call(name, message); }
        });
    }

    /**
     * Hand the socket to the canceller, or report that it is already too late.
     *
     * <p>Returns false when the cancel landed first, which is the case the
     * check after the handshake cannot cover: a cancel before the socket
     * existed has nothing to close, so the worker has to be the one that
     * notices.
     */
    private static boolean publish(Request request, Socket socket) {
        synchronized (request) {
            if (request.cancelled) { return false; }
            request.socket = socket;
            return true;
        }
    }

    private static Connection lookup(double handle) {
        int at = (int) handle - 1;
        synchronized (TABLE) {
            if (at < 0 || at >= OPEN.size()) { return null; }
            return OPEN.get(at);
        }
    }

    /**
     * Close a connection. Safe from any lane, and it is what makes a blocked
     * read or write return: `Socket.close` unblocks the thread inside it,
     * which is the only cancellation a blocking socket has.
     */
    public static void close(double handle) {
        int at = (int) handle - 1;
        Connection c;
        synchronized (TABLE) {
            if (at < 0 || at >= OPEN.size()) { return; }
            c = OPEN.get(at);
            OPEN.set(at, null);
        }
        if (c != null) { closeQuietly(c); }
    }

    private static void submit(NtsEnv env, NtsInbox.Slot slot, Runnable body,
                               NtsTextPairCallback failed) {
        try {
            pool().execute(body);
        } catch (RejectedExecutionException full) {
            // The queue is bounded, so this is reachable, and the credit is
            // still ours to return -- no platform work was ever created.
            NtsEnv.cancel(env, slot);
            later(env, failed, "QueueFull", "the I/O queue is full");
        }
    }

    /** Post a result to the owner lane through the slot reserved for it. */
    private static void finish(NtsInbox.Slot slot,
                               final NtsNumberCallback ok, final NtsTextPairCallback failed,
                               final double value, final String name, final String message) {
        NtsInbox.post(slot, new NtsResumable() {
            @Override public void resume() {
                if (name == null) { ok.call(value); } else { failed.call(name, message); }
            }
        });
    }

    /**
     * Connect, optionally over TLS, and report the handle to the owner lane.
     *
     * <p>The caller reserves the completion credit before calling; a `null`
     * slot means the environment refused the launch and no socket is created.
     */
    public static double connect(
        final NtsEnv env, final NtsInbox.Slot slot,
        final String host, final double port, final boolean secure,
        final double timeoutMs, final NtsNumberCallback ok, final NtsTextPairCallback failed
    ) {
        if (slot == null) {
            later(env, failed, "Backpressure", "no completion credit was available");
            return 0;
        }
        final Request request = new Request();
        final double id = reserve(request);
        submit(env, slot, new Runnable() {
            @Override public void run() {
                Socket socket = null;
                try {
                    int millis = (int) Math.max(0.0, Math.min(timeoutMs, Integer.MAX_VALUE));
                    if (secure) {
                        SSLSocket ssl = (SSLSocket) SSLSocketFactory.getDefault().createSocket();
                        SSLParameters params = ssl.getSSLParameters();
                        // Without this the chain is validated and the *name* is
                        // not. See the class note; this is the whole reason the
                        // TLS sabotage test exists.
                        params.setEndpointIdentificationAlgorithm("HTTPS");
                        List<SNIServerName> names =
                            Collections.<SNIServerName>singletonList(new SNIHostName(host));
                        params.setServerNames(names);
                        ssl.setSSLParameters(params);
                        socket = ssl;
                        if (!publish(request, ssl)) {
                            retire(id);
                            finish(slot, ok, failed, 0, "Cancelled", "the connect was cancelled");
                            return;
                        }
                        ssl.connect(new InetSocketAddress(host, (int) port), millis);
                        // The handshake is deferred until the first I/O, so a
                        // name mismatch would surface inside a later read
                        // rather than here. Forcing it now puts the failure
                        // where the caller asked for a connection.
                        ssl.startHandshake();
                    } else {
                        socket = new Socket();
                        if (!publish(request, socket)) {
                            retire(id);
                            finish(slot, ok, failed, 0, "Cancelled", "the connect was cancelled");
                            return;
                        }
                        socket.connect(new InetSocketAddress(host, (int) port), millis);
                    }
                    socket.setTcpNoDelay(true);
                    // A cancel that arrived while the handshake was running has
                    // already closed this socket, or is about to. Either way
                    // the connection is not handed to the program: registering
                    // it first and closing it after would put a live handle in
                    // the table for as long as the two threads disagree.
                    boolean cancelled;
                    synchronized (request) { cancelled = request.cancelled; }
                    if (cancelled) {
                        try { socket.close(); } catch (IOException ignored) { /* cancelled */ }
                        retire(id);
                        finish(slot, ok, failed, 0, "Cancelled", "the connect was cancelled");
                        return;
                    }
                    Connection c = new Connection(socket, socket.getInputStream(), socket.getOutputStream());
                    double handle = register(c);
                    retire(id);
                    finish(slot, ok, failed, handle, null, null);
                } catch (IOException problem) {
                    fail(request, id, socket, slot, ok, failed, problem);
                } catch (RuntimeException problem) {
                    fail(request, id, socket, slot, ok, failed, problem);
                }
            }
        }, failed);
        return id;
    }

    /**
     * The one failure path both catch clauses need, and the one place a
     * cancellation is told apart from a fault.
     *
     * <p>Cancelling a blocking connect closes the socket under the worker, so
     * the worker's own view of it is `SocketException: Socket closed` -- a
     * message that names the mechanism and not the cause. Reporting that would
     * make a deliberate abort indistinguishable from a connection the peer
     * dropped, in the one situation where the program already knows the answer.
     */
    private static void fail(Request request, double id, Socket socket, NtsInbox.Slot slot,
                             NtsNumberCallback ok, NtsTextPairCallback failed, Exception problem) {
        if (socket != null) { try { socket.close(); } catch (IOException ignored) { /* failing */ } }
        boolean cancelled;
        synchronized (request) { cancelled = request.cancelled; }
        retire(id);
        if (cancelled) {
            finish(slot, ok, failed, 0, "Cancelled", "the connect was cancelled");
        } else {
            finish(slot, ok, failed, 0, problem.getClass().getSimpleName(),
                String.valueOf(problem.getMessage()));
        }
    }

    /**
     * Read into `into`, reporting the count or `-1` at end of stream.
     *
     * <p>`into` is borrowed for the operation's lifetime and is written by a
     * worker thread; the owner lane may not touch it until the completion is
     * delivered, and the inbox's publication edge is what makes those writes
     * visible when it is.
     */
    public static void read(
        final NtsEnv env, final NtsInbox.Slot slot, final double handle,
        final byte[] into, final double offset, final double length,
        final NtsNumberCallback ok, final NtsTextPairCallback failed
    ) {
        if (slot == null) {
            later(env, failed, "Backpressure", "no completion credit was available");
            return;
        }
        final Connection c = lookup(handle);
        if (c == null || c.closed) {
            NtsEnv.cancel(env, slot);
            later(env, failed, "Closed", "the connection is closed");
            return;
        }
        submit(env, slot, new Runnable() {
            @Override public void run() {
                try {
                    int n = c.in.read(into, (int) offset, (int) length);
                    finish(slot, ok, failed, n, null, null);
                } catch (IOException problem) {
                    if (c.closed) {
                        finish(slot, ok, failed, 0, "Aborted", "the connection was closed");
                    } else {
                        finish(slot, ok, failed, 0, problem.getClass().getSimpleName(),
                            String.valueOf(problem.getMessage()));
                    }
                }
            }
        }, failed);
    }

    /** Write `length` bytes, reporting how many went out. */
    public static void write(
        final NtsEnv env, final NtsInbox.Slot slot, final double handle,
        final byte[] from, final double offset, final double length,
        final NtsNumberCallback ok, final NtsTextPairCallback failed
    ) {
        if (slot == null) {
            later(env, failed, "Backpressure", "no completion credit was available");
            return;
        }
        final Connection c = lookup(handle);
        if (c == null || c.closed) {
            NtsEnv.cancel(env, slot);
            later(env, failed, "Closed", "the connection is closed");
            return;
        }
        submit(env, slot, new Runnable() {
            @Override public void run() {
                try {
                    c.out.write(from, (int) offset, (int) length);
                    c.out.flush();
                    finish(slot, ok, failed, length, null, null);
                } catch (IOException problem) {
                    if (c.closed) {
                        finish(slot, ok, failed, 0, "Aborted", "the connection was closed");
                    } else {
                        finish(slot, ok, failed, 0, problem.getClass().getSimpleName(),
                            String.valueOf(problem.getMessage()));
                    }
                }
            }
        }, failed);
    }

    /** Open connections, for a close-race test to assert against. */
    public static double openCount() {
        synchronized (TABLE) {
            int live = 0;
            for (Connection c : OPEN) { if (c != null && !c.closed) { live++; } }
            return live;
        }
    }
}
