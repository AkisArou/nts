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

    /**
     * The default network changed; every connection that existed on the old one
     * is gone. Returns how many were closed.
     *
     * <h2>Why this is not a no-op that waits for the reads to fail</h2>
     *
     * A socket on a network that has been replaced does not report anything. It
     * sits there: a read blocks until the connect timeout the kernel is willing
     * to give it, which on a mobile handover is tens of seconds, and a write
     * succeeds into a buffer that will never drain. The failure the program
     * eventually sees is a timeout, arriving long after the cause, describing
     * the wrong thing. So the transition is the event and closing is what makes
     * it observable.
     *
     * <p>**Every completion still arrives.** Closing a socket under a blocked
     * worker is what unblocks it, and the worker then reports through the slot
     * it reserved, so no credit is lost and the environment's liveness still
     * reaches zero. A transition that closed the sockets and dropped the
     * completions would strand the lane instead -- the connections would be
     * gone and the environment would wait forever for the answers.
     *
     * <p>Pending connects go too: a connect in progress is a connect on the old
     * network, and letting it complete would hand the program a connection that
     * is already dead.
     */
    public static double networkChanged() {
        int closed = 0;
        java.util.List<Connection> gone = new ArrayList<Connection>();
        synchronized (TABLE) {
            for (int i = 0; i < OPEN.size(); i++) {
                Connection c = OPEN.get(i);
                if (c != null) { gone.add(c); OPEN.set(i, null); }
            }
        }
        for (Connection c : gone) { closeQuietly(c); closed++; }
        java.util.List<Request> pending = new ArrayList<Request>();
        synchronized (PENDING) {
            for (int i = 0; i < PENDING.size(); i++) {
                Request request = PENDING.get(i);
                if (request != null) { pending.add(request); }
            }
        }
        for (Request request : pending) {
            Socket socket;
            synchronized (request) {
                if (request.cancelled) { continue; }
                request.cancelled = true;
                socket = request.socket;
            }
            closed++;
            if (socket != null) {
                try { socket.close(); } catch (IOException ignored) { /* transitioning */ }
            }
        }
        return closed;
    }

    /**
     * Cap every write at this many bytes, so the reference transport reports
     * **partial** writes. Zero means write whatever it is given.
     *
     * <h2>Why a reference transport should be able to write less than it was
     * asked</h2>
     *
     * `OutputStream.write` either writes everything or throws, so this
     * primitive naturally always reports the full count -- and the shared
     * `writeAll` loop above it, which exists precisely to handle a short write,
     * therefore has its loop body executed **once, ever, on every platform**.
     * A partial-write path that no provider can produce is a path nothing has
     * run.
     *
     * <p>A real `send(2)` on a socket with a full send buffer returns short,
     * which is why the shared contract permits `1..data.length` and why the
     * loop is there. So the deterministic reference path is the right place to
     * produce it: not a production behaviour, a *reference* behaviour, which is
     * what "deterministic reference transport" means in the plan. The
     * production Android provider keeps writing in full.
     *
     * <p>Deterministic rather than random: the same input fragments the same
     * way on every run, so a corpus that exercises it stays an oracle rather
     * than becoming a flake.
     */
    private static volatile int fragment;

    /** Set the fragment size. Test and corpus use; zero turns it off. */
    public static void fragmentWritesAt(double bytes) {
        fragment = (int) Math.max(0.0, bytes);
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

    /**
     * `CONNECT host:port` and the response, on an already-open socket.
     *
     * <p>Reads a byte at a time to the blank line. That is not slow enough to
     * matter -- a response header is a few hundred bytes, once per connection
     * -- and it is the only way to stop **exactly** at the end of the headers:
     * a buffered read would consume the first bytes of the tunnelled stream
     * into a buffer the `SSLSocket` wrapping this socket will never look in,
     * and the handshake would then fail on a truncated ServerHello with no
     * indication of where the bytes went.
     *
     * <p>Anything but a 2xx is a failure carrying the proxy's own status line,
     * because `407 Proxy Authentication Required` and `502 Bad Gateway` are
     * different problems for whoever has to fix them.
     */
    private static void establish(Socket carrier, String host, int port) throws IOException {
        String authority = host + ":" + port;
        StringBuilder request = new StringBuilder();
        request.append("CONNECT ").append(authority).append(" HTTP/1.1\r\n");
        request.append("Host: ").append(authority).append("\r\n");
        request.append("Proxy-Connection: keep-alive\r\n\r\n");
        OutputStream out = carrier.getOutputStream();
        out.write(request.toString().getBytes("ISO-8859-1"));
        out.flush();

        InputStream in = carrier.getInputStream();
        StringBuilder head = new StringBuilder();
        int consecutive = 0;
        while (consecutive < 2) {
            int b = in.read();
            if (b < 0) {
                throw new IOException("the proxy closed the connection before answering CONNECT");
            }
            if (b == '\n') {
                consecutive++;
            } else if (b != '\r') {
                consecutive = 0;
            }
            head.append((char) b);
            if (head.length() > 16384) {
                throw new IOException("the proxy sent more than 16 KiB of CONNECT response headers");
            }
        }
        int firstLine = head.indexOf("\r\n");
        String status = head.substring(0, firstLine < 0 ? head.length() : firstLine);
        int space = status.indexOf(' ');
        int code = -1;
        if (space > 0 && status.length() >= space + 4) {
            try { code = Integer.parseInt(status.substring(space + 1, space + 4)); }
            catch (NumberFormatException malformed) { code = -1; }
        }
        if (code < 200 || code > 299) {
            throw new IOException("the proxy refused CONNECT: " + status);
        }
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
        NtsEnv env, NtsInbox.Slot slot,
        String host, double port, boolean secure,
        double timeoutMs, NtsNumberCallback ok, NtsTextPairCallback failed
    ) {
        return connectVia(env, slot, host, port, secure, timeoutMs, null, 0, DIRECT, ok, failed);
    }

    /** No proxy; the ordinary path. */
    public static final double DIRECT = 0;
    /** An HTTP proxy, reached with `CONNECT` and then tunnelled through. */
    public static final double HTTP_PROXY = 1;
    /** A SOCKS proxy, which the platform's `Socket` speaks natively. */
    public static final double SOCKS_PROXY = 2;

    /**
     * Connect, optionally through a proxy, and report the handle to the owner
     * lane.
     *
     * <h2>The security property, which is the whole reason this is not three
     * lines</h2>
     *
     * A TLS connection through an HTTP proxy is a `CONNECT` tunnel with a
     * handshake inside it, and **the certificate must name the target, not the
     * proxy**. The natural implementation gets this wrong in a way that works:
     * open a socket to the proxy, tunnel, wrap it in TLS, and the wrapping
     * carries whatever host the wrapping was told. Told the proxy's name -- and
     * the proxy's name is what the socket connected to -- every certificate the
     * proxy can present is accepted for every site, which is a proxy that can
     * read traffic it is only supposed to forward.
     *
     * <p>So the target's name is threaded through the tunnel to
     * `createSocket(socket, host, port, autoClose)` and to `setServerNames`,
     * and `TlsTest` proves it by presenting a certificate for the *proxy* on a
     * tunnel to another name and requiring the connection to fail.
     *
     * <p>SOCKS needs none of this: the platform's `Socket` speaks it below the
     * TLS layer, so the `SSLSocket` connects to the target's address and
     * verifies it the way an unproxied one does.
     */
    public static double connectVia(
        final NtsEnv env, final NtsInbox.Slot slot,
        final String host, final double port, final boolean secure,
        final double timeoutMs,
        final String proxyHost, final double proxyPort, final double proxyKind,
        final NtsNumberCallback ok, final NtsTextPairCallback failed
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
                    boolean tunnel = proxyKind == HTTP_PROXY && proxyHost != null;
                    // The plain socket first, whatever it connects to. A TLS
                    // connection through a tunnel has to have its carrier
                    // already open before the handshake can start, and doing it
                    // this way means the tunnel and the direct path share every
                    // line after the connect rather than being two functions
                    // that drift.
                    Socket carrier;
                    if (proxyKind == SOCKS_PROXY && proxyHost != null) {
                        // The platform speaks SOCKS below TLS, so the address
                        // the `SSLSocket` sees is the target's and verification
                        // is the unproxied one.
                        carrier = new Socket(new java.net.Proxy(
                            java.net.Proxy.Type.SOCKS,
                            new InetSocketAddress(proxyHost, (int) proxyPort)));
                    } else {
                        carrier = new Socket();
                    }
                    socket = carrier;
                    if (!publish(request, carrier)) {
                        retire(id);
                        finish(slot, ok, failed, 0, "Cancelled", "the connect was cancelled");
                        return;
                    }
                    carrier.connect(tunnel
                        ? new InetSocketAddress(proxyHost, (int) proxyPort)
                        : new InetSocketAddress(host, (int) port), millis);
                    if (tunnel) {
                        establish(carrier, host, (int) port);
                    }
                    if (secure) {
                        // The layering overload is `SSLSocketFactory`'s and
                        // not `SocketFactory`'s, so the cast is on the factory
                        // rather than on the socket.
                        SSLSocketFactory factory = (SSLSocketFactory) SSLSocketFactory.getDefault();
                        SSLSocket ssl = (SSLSocket) factory.createSocket(carrier, host, (int) port, true);
                        SSLParameters params = ssl.getSSLParameters();
                        // Without this the chain is validated and the *name* is
                        // not. See the class note; this is the whole reason the
                        // TLS sabotage test exists.
                        //
                        // Through a tunnel it is `host` and not the proxy's
                        // name, and `createSocket` above was given `host` for
                        // the same reason: the far end of a tunnel is the site,
                        // and a proxy that could satisfy the check with its own
                        // certificate is a proxy that can read what it forwards.
                        params.setEndpointIdentificationAlgorithm("HTTPS");
                        // **The SNI name is what the check runs against**, and
                        // that is not what this comment used to say. JSSE
                        // identifies the endpoint against the server name when
                        // one is set and against the socket's peer host only
                        // when one is not -- so an implementation that passed
                        // the proxy to `createSocket` and the target to
                        // `setServerNames` is accidentally *correct*, and one
                        // that gets them the other way round is wrong with the
                        // peer host right in front of it. Measured: giving
                        // `createSocket` a name in neither certificate changed
                        // nothing for a host, and changed the error message for
                        // an address.
                        //
                        // No SNI for an address. RFC 6066 says the name must be
                        // a DNS name and `SNIHostName` will accept `127.0.0.1`
                        // anyway, because it is syntactically one -- servers are
                        // entitled to reject the handshake for it, and the
                        // identification an address needs is the peer host's,
                        // which is the same string.
                        if (!host.contains(":") && !host.matches("[0-9.]+")) {
                            List<SNIServerName> names =
                                Collections.<SNIServerName>singletonList(new SNIHostName(host));
                            params.setServerNames(names);
                        }
                        ssl.setSSLParameters(params);
                        socket = ssl;
                        // Published again: the TLS socket is now the one that
                        // closing has to reach, and the carrier it wraps is
                        // closed with it because `autoClose` is true.
                        if (!publish(request, ssl)) {
                            retire(id);
                            finish(slot, ok, failed, 0, "Cancelled", "the connect was cancelled");
                            return;
                        }
                        // The handshake is deferred until the first I/O, so a
                        // name mismatch would surface inside a later read
                        // rather than here. Forcing it now puts the failure
                        // where the caller asked for a connection.
                        ssl.startHandshake();
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
                    // At most `fragment` bytes, and never zero: the contract is
                    // `1..data.length`, so a short write still makes progress
                    // and a caller looping on it terminates.
                    int cap = fragment;
                    int wrote = cap > 0 && cap < (int) length ? cap : (int) length;
                    c.out.write(from, (int) offset, wrote);
                    c.out.flush();
                    finish(slot, ok, failed, wrote, null, null);
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
