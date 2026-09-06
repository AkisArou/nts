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
 * Android API 26+/Java 8 raw networking primitives. No HTTP/WebSocket semantics.
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
    private static int nextId(AtomicInteger sequence) {
        int id = sequence.getAndIncrement();
        if (id <= 0) throw new IllegalStateException("Handle space exhausted; create a new runtime");
        return id;
    }

    /** Returns the cancellable connection handle immediately. All callbacks are asynchronous. */
    public int connect(String hostname, int port, boolean secure, int timeoutMs, ConnectCallback callback) {
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
                    Socket raw = connection.socket;
                    // DNS is allowed to block only on this bounded connect pool. Closing a
                    // Socket cannot interrupt all resolver implementations; see README.
                    raw.connect(new InetSocketAddress(hostname, port), timeoutMs);
                    raw.setTcpNoDelay(true);
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
                        tls.setSSLParameters(parameters);
                        tls.setSoTimeout(timeoutMs);
                        tls.startHandshake();
                        tls.setSoTimeout(0);
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
                    connection.socket.getOutputStream().write(bytes, offset, length);
                    connection.writing.set(false); complete(() -> callback.success(length));
                } catch (IOException | RuntimeException error) {
                    connection.writing.set(false); complete(() -> callback.failure(error.getClass().getSimpleName(), message(error)));
                }
            });
        } catch (RejectedExecutionException error) {
            connection.writing.set(false); complete(() -> callback.failure("RejectedExecutionException", "Write worker capacity exhausted"));
        }
    }
    public void closeSocket(int handle) {
        Connection connection = sockets.remove(handle);
        if (connection == null || !connection.closed.compareAndSet(false, true)) return;
        try { connection.socket.close(); } catch (IOException ignored) { /* Idempotent best-effort OS close. */ }
        capacity.release();
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
