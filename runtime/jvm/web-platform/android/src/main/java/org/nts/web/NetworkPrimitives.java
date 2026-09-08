package org.nts.web;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLException;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Android API 29+/Java 8 raw networking primitives. No HTTP/WebSocket semantics.
 * I/O occurs on bounded worker pools. Completions are posted to the caller's NTS
 * runtime executor. Never use Runnable::run or a blocking I/O pool as that executor.
 * Close this object before shutting down the completion executor.
 */
public final class NetworkPrimitives implements AutoCloseable {
    public interface Task { void run(); }
    public interface ConnectCallback { void success(int handle); void failure(String name, String message); }
    public interface ReadCallback { void success(byte[] bytes, boolean eof); void failure(String name, String message); }
    public interface WriteCallback { void success(int written); void failure(String name, String message); }
    public interface CleartextPolicy { boolean permits(String hostname); }
    /** No proxy. */
    public static final int DIRECT = 0;
    /** An HTTP proxy, reached with `CONNECT` and tunnelled through. */
    public static final int HTTP_PROXY = 1;
    /** A SOCKS proxy, which the platform's `Socket` speaks natively. */
    public static final int SOCKS_PROXY = 2;
    public interface ErrorReporter { void report(String name, String message); }

    private static final int MAX_CHUNK = 65536;
    private final Executor runtime;
    private final CleartextPolicy cleartext;
    private final ErrorReporter errors;
    private final SSLSocketFactory tlsFactory;
    private final SecureRandom random = new SecureRandom();
    private final Semaphore capacity;
    private final ThreadPoolExecutor connects;
    private final ThreadPoolExecutor reads;
    private final ThreadPoolExecutor writes;
    private final ScheduledThreadPoolExecutor clock;
    private final AtomicInteger ids = new AtomicInteger(1);
    private final AtomicInteger timerIds = new AtomicInteger(1);
    private final AtomicBoolean closed = new AtomicBoolean();
    private final ConcurrentMap<Integer, Connection> sockets = new ConcurrentHashMap<>();
    private final ConcurrentMap<Integer, TimerEntry> timers = new ConcurrentHashMap<>();

    private static final class Connection {
        final int id;
        final AtomicBoolean closed = new AtomicBoolean();
        final AtomicBoolean reading = new AtomicBoolean();
        final AtomicBoolean writing = new AtomicBoolean();
        volatile Socket socket = new Socket();
        volatile boolean connected;
        volatile boolean timedOut;
        /**
         * What ALPN selected, or `""` when nothing was negotiated.
         *
         * <p>Conscrypt answers `null` for the absent case where JSSE answers
         * `""`; normalised once, on the handshake thread, so the two runtimes
         * this seam has cannot be told apart by a program.
         */
        volatile String protocol = "";
        Connection(int id) { this.id = id; }
    }
    private static final class TimerEntry {
        final AtomicBoolean canceled = new AtomicBoolean();
        volatile ScheduledFuture<?> future;
    }

    public NetworkPrimitives(Executor runtime, CleartextPolicy cleartext, ErrorReporter errors, int maxConnections) {
        this(runtime, cleartext, errors, maxConnections, defaultTlsFactory());
    }
    /** A custom factory may supply a private CA; endpoint verification is still mandatory. */
    public NetworkPrimitives(Executor runtime, CleartextPolicy cleartext, ErrorReporter errors,
                             int maxConnections, SSLSocketFactory tlsFactory) {
        if (maxConnections < 1 || maxConnections > 1024) throw new IllegalArgumentException("maxConnections must be 1..1024");
        this.runtime = Objects.requireNonNull(runtime);
        this.cleartext = Objects.requireNonNull(cleartext);
        this.errors = Objects.requireNonNull(errors);
        this.tlsFactory = Objects.requireNonNull(tlsFactory);
        capacity = new Semaphore(maxConnections);
        // Separate pools prevent blocked reads from starving writes or TLS setup.
        connects = workers("nts-web-connect", maxConnections);
        reads = workers("nts-web-read", maxConnections);
        writes = workers("nts-web-write", maxConnections);
        clock = new ScheduledThreadPoolExecutor(1, threads("nts-web-clock"));
        clock.setRemoveOnCancelPolicy(true);
    }
    private static SSLSocketFactory defaultTlsFactory() {
        javax.net.SocketFactory factory = SSLSocketFactory.getDefault();
        if (!(factory instanceof SSLSocketFactory)) throw new IllegalStateException("No default TLS provider");
        return (SSLSocketFactory) factory;
    }
    private static ThreadFactory threads(String prefix) {
        AtomicInteger number = new AtomicInteger();
        return work -> {
            Thread thread = new Thread(work, prefix + "-" + number.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }
    private static ThreadPoolExecutor workers(String name, int maximum) {
        ThreadPoolExecutor pool = new ThreadPoolExecutor(maximum, maximum, 60, TimeUnit.SECONDS,
                new ArrayBlockingQueue<Runnable>(maximum), threads(name), new ThreadPoolExecutor.AbortPolicy());
        pool.allowCoreThreadTimeOut(true);
        return pool;
    }
    private void complete(Runnable callback) {
        try { runtime.execute(callback); }
        catch (RejectedExecutionException error) { errors.report("RejectedExecutionException", "NTS runtime rejected a completion during shutdown"); }
    }
    private static String message(Exception error) {
        return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
    }
    /**
     * The offer, split.
     *
     * <p>A name containing the separator is refused rather than split into two
     * protocols nobody asked for. ALPN names are opaque byte strings and a
     * comma is legal in one; none of the registered names has one, which makes
     * this the kind of thing found years later by one server saying no.
     */
    private static String[] offered(String protocols) {
        if (protocols == null || protocols.isEmpty()) return new String[0];
        String[] names = protocols.split(",", -1);
        for (String name : names) {
            if (name.isEmpty()) {
                throw new IllegalArgumentException("An empty application protocol name in \"" + protocols + "\"");
            }
        }
        return names;
    }

    /**
     * What ALPN selected for an open handle, or `""`.
     *
     * <p>One answer for a plain socket, for a TLS socket where neither side
     * offered, and for a handle that is not open.
     */
    public String protocolOf(int handle) {
        Connection connection = sockets.get(handle);
        return connection == null ? "" : connection.protocol;
    }

    private static int nextId(AtomicInteger sequence) {
        int id = sequence.getAndIncrement();
        if (id <= 0) throw new IllegalStateException("Handle space exhausted; create a new runtime");
        return id;
    }

    /** Returns the cancellable connection handle immediately. All callbacks are asynchronous. */
    public int connect(String hostname, int port, boolean secure, int timeoutMs, ConnectCallback callback) {
        return connect(hostname, port, secure, timeoutMs, null, 0, DIRECT, callback);
    }

    /**
     * As {@link #connect}, through a proxy.
     *
     * <p>A TLS connection through a `CONNECT` tunnel must verify the
     * certificate against the **target**, not the proxy. The wrong version
     * works perfectly against an honest proxy: hand the TLS layering the host
     * the socket connected to -- which is the proxy -- and every certificate
     * the proxy can present becomes good for every site it forwards.
     *
     * <p>The name that decides it is the **SNI** one, not the socket's peer
     * host: JSSE identifies against `setServerNames` when it is set and falls
     * back to the peer host only when it is not. So the two have to agree, and
     * a sabotage that changed only one of them was a no-op in the direction
     * that matters. Both come from `hostname` here.
     *
     * <p>SOCKS needs none of this. The platform speaks it below TLS, so the
     * `SSLSocket` sees the target's address and verifies it the way an
     * unproxied one does.
     *
     * <p>This tunnel is a second implementation of `nts.rt.NtsSocket`'s, and
     * deliberately so: this library depends on no NTS runtime, which is what
     * lets it be built into an Android library on its own. Two copies of
     * something subtle is how drift starts, so they are held together by a
     * test that runs both against one proxy and requires the same answer
     * rather than by care.
     */
    public int connect(String hostname, int port, boolean secure, int timeoutMs,
                       String proxyHost, int proxyPort, int proxyKind, ConnectCallback callback) {
        return connect(hostname, port, secure, timeoutMs, proxyHost, proxyPort, proxyKind, "", callback);
    }

    /**
     * As above, offering a comma-separated set of application protocols to TLS.
     *
     * <p>Client-side, which is all this class does. Measured on API 29 rather
     * than assumed, because each of these would otherwise surface as a
     * handshake failing against one server: the **server's** order decides, not
     * this one; an offer the far end cannot match is a fatal
     * `no_application_protocol` alert and so a failed connect; and the absent
     * case reads back `null` here against `""` on the desktop JSSE, which is
     * why {@link Connection#protocol} normalises.
     *
     * <p>Setting the same parameters on a *server* socket is silently dropped
     * by Conscrypt at this floor -- `getApplicationProtocols()` reads back
     * empty immediately after being set -- so nothing here should grow a
     * server side expecting it to work.
     */
    public int connect(String hostname, int port, boolean secure, int timeoutMs,
                       String proxyHost, int proxyPort, int proxyKind, String protocols,
                       ConnectCallback callback) {
        Objects.requireNonNull(hostname); Objects.requireNonNull(callback);
        if (hostname.isEmpty() || port < 1 || port > 65535 || timeoutMs < 1) throw new IllegalArgumentException("Invalid connect arguments");
        int id = nextId(ids);
        if (closed.get() || !capacity.tryAcquire()) {
            complete(() -> callback.failure("RejectedExecutionException", "Networking is closed or connection capacity is exhausted"));
            return id;
        }
        Connection connection = new Connection(id);
        sockets.put(id, connection);
        if (closed.get()) {
            closeSocket(id); complete(() -> callback.failure("IOException", "Networking closed")); return id;
        }
        try {
            if (!secure && !cleartext.permits(hostname)) {
                closeSocket(id); complete(() -> callback.failure("SecurityException", "Cleartext traffic is not permitted for this host")); return id;
            }
        } catch (RuntimeException error) {
            closeSocket(id); complete(() -> callback.failure("SecurityException", message(error))); return id;
        }
        final ScheduledFuture<?> deadline;
        try {
            deadline = clock.schedule(() -> { connection.timedOut = true; closeSocket(id); }, timeoutMs, TimeUnit.MILLISECONDS);
        } catch (RejectedExecutionException error) {
            closeSocket(id); complete(() -> callback.failure("IOException", "Networking closed")); return id;
        }
        try {
            connects.execute(() -> {
                try {
                    if (connection.closed.get()) throw new IOException("Connect canceled");
                    boolean tunnel = proxyKind == HTTP_PROXY && proxyHost != null;
                    Socket raw = connection.socket;
                    if (proxyKind == SOCKS_PROXY && proxyHost != null) {
                        raw = new java.net.Socket(new java.net.Proxy(
                                java.net.Proxy.Type.SOCKS, new InetSocketAddress(proxyHost, proxyPort)));
                        connection.socket = raw;
                        if (connection.closed.get()) { raw.close(); throw new IOException("Connect canceled"); }
                    }
                    // DNS is allowed to block only on this bounded connect pool. Closing a
                    // Socket cannot interrupt all resolver implementations; see README.
                    raw.connect(tunnel ? new InetSocketAddress(proxyHost, proxyPort)
                            : new InetSocketAddress(hostname, port), timeoutMs);
                    raw.setTcpNoDelay(true);
                    if (tunnel) { establish(raw, hostname, port, timeoutMs); }
                    if (secure) {
                        Socket layered = tlsFactory.createSocket(raw, hostname, port, true);
                        if (!(layered instanceof SSLSocket)) { layered.close(); throw new SSLException("TLS factory returned a non-TLS socket"); }
                        SSLSocket tls = (SSLSocket) layered;
                        connection.socket = tls;
                        if (connection.closed.get()) { tls.close(); throw new IOException("Connect canceled"); }
                        tls.setUseClientMode(true);
                        SSLParameters parameters = tls.getSSLParameters();
                        parameters.setEndpointIdentificationAlgorithm("HTTPS");
                        if (!hostname.contains(":") && !hostname.matches("[0-9.]+")) {
                            parameters.setServerNames(Collections.singletonList(new SNIHostName(hostname)));
                        }
                        List<String> versions = new ArrayList<>();
                        List<String> supported = Arrays.asList(tls.getSupportedProtocols());
                        if (supported.contains("TLSv1.3")) versions.add("TLSv1.3");
                        if (supported.contains("TLSv1.2")) versions.add("TLSv1.2");
                        if (versions.isEmpty()) throw new SSLException("TLS 1.2 or newer is required");
                        parameters.setProtocols(versions.toArray(new String[0]));
                        // Offered only when there is something to offer: an
                        // empty array is not the same as not setting one.
                        String[] offer = offered(protocols);
                        if (offer.length > 0) parameters.setApplicationProtocols(offer);
                        tls.setSSLParameters(parameters);
                        tls.setSoTimeout(timeoutMs);
                        tls.startHandshake();
                        tls.setSoTimeout(0);
                        String chosen = tls.getApplicationProtocol();
                        connection.protocol = chosen == null ? "" : chosen;
                    }
                    if (connection.closed.get()) throw new IOException("Connect canceled");
                    connection.connected = true;
                    deadline.cancel(false);
                    complete(() -> {
                        if (connection.closed.get()) callback.failure("IOException", "Connect canceled");
                        else callback.success(id);
                    });
                } catch (IOException | RuntimeException error) {
                    deadline.cancel(false); closeSocket(id);
                    complete(() -> callback.failure(connection.timedOut ? "SocketTimeoutException" : error.getClass().getSimpleName(), message(error)));
                }
            });
        } catch (RejectedExecutionException error) {
            deadline.cancel(false); closeSocket(id);
            complete(() -> callback.failure("RejectedExecutionException", "Connect worker capacity exhausted"));
        }
        return id;
    }

    public void read(int handle, int maxBytes, ReadCallback callback) {
        Objects.requireNonNull(callback);
        if (maxBytes < 1 || maxBytes > MAX_CHUNK) throw new IllegalArgumentException("Read size must be 1..65536");
        Connection connection = sockets.get(handle);
        if (connection == null || !connection.connected || connection.closed.get()) {
            complete(() -> callback.failure("IOException", "Socket is not connected")); return;
        }
        if (!connection.reading.compareAndSet(false, true)) {
            complete(() -> callback.failure("IllegalStateException", "Overlapping reads")); return;
        }
        try {
            reads.execute(() -> {
                try {
                    byte[] buffer = new byte[maxBytes];
                    int count = connection.socket.getInputStream().read(buffer);
                    if (count == 0) throw new IOException("A nonempty socket read made no progress");
                    byte[] value = count < 0 ? new byte[0] : count == buffer.length ? buffer : Arrays.copyOf(buffer, count);
                    connection.reading.set(false);
                    complete(() -> callback.success(value, count < 0));
                } catch (IOException | RuntimeException error) {
                    connection.reading.set(false);
                    complete(() -> callback.failure(error.getClass().getSimpleName(), message(error)));
                }
            });
        } catch (RejectedExecutionException error) {
            connection.reading.set(false); complete(() -> callback.failure("RejectedExecutionException", "Read worker capacity exhausted"));
        }
    }
    /** bytes are borrowed until the callback. The bridge must keep their storage pinned/alive. */
    public void write(int handle, byte[] bytes, int offset, int length, WriteCallback callback) {
        Objects.requireNonNull(bytes); Objects.requireNonNull(callback);
        if (length < 1 || length > MAX_CHUNK || offset < 0 || offset > bytes.length - length) throw new IllegalArgumentException("Invalid write slice");
        Connection connection = sockets.get(handle);
        if (connection == null || !connection.connected || connection.closed.get()) {
            complete(() -> callback.failure("IOException", "Socket is not connected")); return;
        }
        if (!connection.writing.compareAndSet(false, true)) {
            complete(() -> callback.failure("IllegalStateException", "Overlapping writes")); return;
        }
        try {
            writes.execute(() -> {
                try {
                    // At most `fragment` bytes, and never zero: the contract is
                    // `1..data.length`, so a short write still makes progress
                    // and a caller looping on it terminates.
                    int cap = fragment;
                    int wrote = cap > 0 && cap < length ? cap : length;
                    connection.socket.getOutputStream().write(bytes, offset, wrote);
                    connection.writing.set(false); complete(() -> callback.success(wrote));
                } catch (IOException | RuntimeException error) {
                    connection.writing.set(false); complete(() -> callback.failure(error.getClass().getSimpleName(), message(error)));
                }
            });
        } catch (RejectedExecutionException error) {
            connection.writing.set(false); complete(() -> callback.failure("RejectedExecutionException", "Write worker capacity exhausted"));
        }
    }
    /**
     * Cap every write at this many bytes, so this provider reports **partial**
     * writes. Zero means write whatever it is given.
     *
     * <p>`OutputStream.write` writes everything or throws, so this primitive
     * naturally always reports the full count -- and the shared `writeAll` loop
     * above it, which exists precisely to handle a short write, would have its
     * body executed once, ever, on every platform. The shared contract permits
     * `1..data.length` because a real `send(2)` on a full send buffer returns
     * short, and no provider here could produce one.
     *
     * <p>Test and corpus use, matching `nts.rt.NtsSocket.fragmentWritesAt`, so
     * the same partial-write case can be driven through both providers rather
     * than through whichever one happens to have the knob. Deterministic rather
     * than random: a corpus that exercises it stays an oracle.
     */
    public void fragmentWritesAt(int bytes) { fragment = Math.max(0, bytes); }

    private volatile int fragment;

    public void closeSocket(int handle) {
        Connection connection = sockets.remove(handle);
        if (connection == null || !connection.closed.compareAndSet(false, true)) return;
        try { connection.socket.close(); } catch (IOException ignored) { /* Idempotent best-effort OS close. */ }
        capacity.release();
    }
    /**
     * `CONNECT host:port`, and the response, on an already-open socket.
     *
     * <p>Read a byte at a time to the blank line, which is the only way to stop
     * **exactly** at the end of the headers. A buffered read would take the
     * first bytes of the tunnelled stream into a buffer the `SSLSocket`
     * wrapping this socket will never look in, and the handshake would fail on
     * a truncated ServerHello with no indication of where the bytes went. A
     * response header is a few hundred bytes once per connection, so the cost
     * of doing it a byte at a time is not a cost.
     *
     * <p>The proxy's own status line is carried into the failure: `407 Proxy
     * Authentication Required` and `502 Bad Gateway` are different problems for
     * whoever has to fix them.
     */
    private static void establish(Socket carrier, String hostname, int port, int timeoutMs) throws IOException {
        String authority = hostname + ":" + port;
        String request = "CONNECT " + authority + " HTTP/1.1\r\nHost: " + authority
                + "\r\nProxy-Connection: keep-alive\r\n\r\n";
        int previous = carrier.getSoTimeout();
        carrier.setSoTimeout(timeoutMs);
        try {
            carrier.getOutputStream().write(request.getBytes("ISO-8859-1"));
            carrier.getOutputStream().flush();
            java.io.InputStream in = carrier.getInputStream();
            StringBuilder head = new StringBuilder();
            int consecutive = 0;
            while (consecutive < 2) {
                int b = in.read();
                if (b < 0) throw new IOException("The proxy closed the connection before answering CONNECT");
                if (b == '\n') consecutive++; else if (b != '\r') consecutive = 0;
                head.append((char) b);
                if (head.length() > 16384) throw new IOException("The proxy sent more than 16 KiB of CONNECT response headers");
            }
            int firstLine = head.indexOf("\r\n");
            String status = head.substring(0, firstLine < 0 ? head.length() : firstLine);
            int space = status.indexOf(' ');
            int code = -1;
            if (space > 0 && status.length() >= space + 4) {
                try { code = Integer.parseInt(status.substring(space + 1, space + 4)); }
                catch (NumberFormatException malformed) { code = -1; }
            }
            if (code < 200 || code > 299) throw new IOException("The proxy refused CONNECT: " + status);
        } finally {
            carrier.setSoTimeout(previous);
        }
    }

    /**
     * The default network changed; every connection on the old one is gone.
     * Returns how many were closed.
     *
     * <p>Not a no-op that waits for the reads to fail. A socket on a replaced
     * network reports nothing: a read blocks for as long as the kernel is
     * willing to give it -- tens of seconds on a handover -- and a write
     * succeeds into a buffer that will never drain, so the failure the program
     * eventually sees is a timeout arriving long after the cause and describing
     * the wrong thing.
     *
     * <p>Every completion still arrives, because closing under a blocked worker
     * is what unblocks it and the worker reports through the callback it was
     * given. A transition that closed the sockets and dropped the completions
     * would strand the caller instead.
     */
    public int networkChanged() {
        int closed = 0;
        for (Integer id : new ArrayList<Integer>(sockets.keySet())) {
            if (sockets.containsKey(id)) { closeSocket(id); closed++; }
        }
        return closed;
    }

    public void randomFill(byte[] destination) { random.nextBytes(Objects.requireNonNull(destination)); }
    public void post(Task task) { Objects.requireNonNull(task); complete(task::run); }
    public int timer(long milliseconds, Task task) {
        if (milliseconds < 0 || closed.get()) throw new IllegalArgumentException("Invalid timer or closed runtime");
        Objects.requireNonNull(task);
        int id = nextId(timerIds); TimerEntry entry = new TimerEntry(); timers.put(id, entry);
        try {
            entry.future = clock.schedule(() -> {
                complete(() -> {
                    if (timers.remove(id, entry) && !entry.canceled.get()) task.run();
                });
            }, milliseconds, TimeUnit.MILLISECONDS);
            if (entry.canceled.get()) entry.future.cancel(false);
        } catch (RejectedExecutionException error) { timers.remove(id, entry); throw error; }
        return id;
    }
    public void clearTimer(int id) {
        TimerEntry entry = timers.remove(id);
        if (entry == null) return;
        entry.canceled.set(true);
        ScheduledFuture<?> future = entry.future; if (future != null) future.cancel(false);
    }
    public void reportError(String name, String message) { errors.report(name, message); }
    public int openSocketCount() { return sockets.size(); }
    @Override public void close() {
        if (!closed.compareAndSet(false, true)) return;
        for (Integer id : sockets.keySet()) closeSocket(id);
        for (Integer id : timers.keySet()) clearTimer(id);
        connects.shutdownNow(); reads.shutdownNow(); writes.shutdownNow(); clock.shutdownNow();
    }
}
