package nts.rt;

/**
 * The fixed networking intrinsics: the one class a compiled program reaches.
 *
 * <p>There is no general Java binding facility and this is deliberately not
 * one. The plan's boundary is "a small typed runtime-owned intrinsic table
 * whose TypeScript declarations state the real ABI", and this is the Java half
 * of that table -- a facade over {@link NtsSocket} and {@link NtsEnv} rather
 * than an implementation of anything. Every method here is named by a
 * `declare function nts_jvm_web_*` in
 * `runtime/web-platform/android/intrinsics.d.ts`, and
 * `the_declarations_the_table_and_the_jar_agree` asserts the two agree with the
 * compiler's own table.
 *
 * <h2>Why there is no environment parameter</h2>
 *
 * <p>The declarations used to take one, as an argument of a type that did not
 * exist -- which is why four of them were gated on "a common environment type".
 * They do not need one. The environment is **ambient in both runtimes**:
 * `nts_environment_current` in `runtime/c` ("the environment this lane is
 * running in; never null") and {@link NtsEnv#current} here, backed by a
 * `ThreadLocal` whose own comment says a hidden parameter on every call was the
 * alternative and was rejected.
 *
 * <p>So the parameter was not merely unrepresentable, it was redundant -- and
 * worse than redundant: a parameter is something a program can get *wrong*, and
 * an intrinsic handed the wrong environment would deliver its completion to a
 * lane that does not own it. Reading the current one cannot have that bug.
 *
 * <h2>Why the credit is taken here</h2>
 *
 * <p>Each operation reserves its own completion credit before submitting, so
 * backpressure is a refusal rather than an unbounded queue. `NtsEnv.launch`
 * answers `null` when none is available and the socket layer reports that
 * through the failure callback like any other outcome, which is what keeps
 * "no credit" in the same position in the task order as a connection refusal.
 *
 * <p>This is why the proposal's `nts_jvm_web_launch` and `cancel_launch` are
 * **withdrawn**. They were a shared-layer reservation to be taken before
 * submitting work and handed back if it was not submitted -- but a credit is
 * only useful attached to the operation that will consume it, and threading a
 * reservation through TypeScript would mean a handle whose only correct use is
 * to give it straight back to the next call. Nothing needs that, and an
 * intrinsic that exists because a design once implied it is a worse thing to
 * have than a gap.
 *
 * <h2>Bytes</h2>
 *
 * <p>The byte arguments are `Uint8Array`, so they carry their own window. A
 * view onto part of a larger `ArrayBuffer` reads and writes only its own bytes;
 * the ones outside belong to whatever else is looking at that buffer. A
 * detached buffer is a synchronous `TypeError`, as the language specifies --
 * not a completion, which is why it throws here rather than going through the
 * failure callback with everything that is genuinely asynchronous.
 */
public final class NtsWeb {
    private NtsWeb() {}

    /** No proxy. */
    public static final double DIRECT = NtsSocket.DIRECT;
    /** An HTTP proxy, reached with `CONNECT` and tunnelled through. */
    public static final double HTTP_PROXY = NtsSocket.HTTP_PROXY;
    /** A SOCKS proxy, which the platform speaks below TLS. */
    public static final double SOCKS_PROXY = NtsSocket.SOCKS_PROXY;

    /**
     * Connect, optionally through a proxy. Answers a cancellation handle
     * immediately; every callback happens later.
     *
     * <p>TLS through a `CONNECT` tunnel verifies the certificate against the
     * **target**, never the proxy. `proxyHost` is null for a direct connection.
     */
    public static double connect(String host, double port, boolean secure, double timeoutMs,
                                 String proxyHost, double proxyPort, double proxyKind,
                                 NtsNumberCallback onOpen, NtsTextPairCallback onError) {
        NtsEnv env = NtsEnv.current();
        return NtsSocket.connectVia(env, NtsEnv.launch(env), host, port, secure, timeoutMs,
            proxyHost, proxyPort, proxyKind, onOpen, onError);
    }

    /** Idempotent, safe from any lane, and a late success still closes its socket. */
    public static void cancelConnect(double request) {
        NtsSocket.cancelConnect(request);
    }

    /**
     * Read into a caller-owned view, reporting the count or -1 at end of
     * stream.
     */
    public static void read(double handle, NtsViewU8 into,
                            NtsNumberCallback onRead, NtsTextPairCallback onError) {
        // The view **before** the credit. Java evaluates arguments left to
        // right, so writing `NtsSocket.read(env, NtsEnv.launch(env), handle,
        // storage(into), ...)` reserves a completion and then throws past it,
        // and the reservation is only ever noticed when the environment is
        // closed -- "closing left 1 completion credit(s) held by work that
        // never settled", a long way from the line that held it.
        byte[] bytes = storage(into);
        NtsEnv env = NtsEnv.current();
        NtsSocket.read(env, NtsEnv.launch(env), handle,
            bytes, into.offset, NtsView.elements(into), onRead, onError);
    }

    /** Write from a caller-owned view, borrowed until the completion. */
    public static void write(double handle, NtsViewU8 from,
                             NtsNumberCallback onWrote, NtsTextPairCallback onError) {
        // The view before the credit, as in `read`.
        byte[] bytes = storage(from);
        NtsEnv env = NtsEnv.current();
        NtsSocket.write(env, NtsEnv.launch(env), handle,
            bytes, from.offset, NtsView.elements(from), onWrote, onError);
    }

    /** Idempotent, and what makes a blocked read or write return. */
    public static void close(double handle) {
        NtsSocket.close(handle);
    }

    /**
     * The default network changed; every connection on the old one is gone.
     * Answers how many were closed.
     */
    public static double networkChanged() {
        return NtsSocket.networkChanged();
    }

    /** Live connections, for tests and for backpressure reporting. */
    public static double openCount() {
        return NtsSocket.openCount();
    }

    /** Fill a byte view with secure random bytes, in place and in its window. */
    public static void randomFill(NtsViewU8 into) {
        NtsSocket.randomFill(into);
    }

    /**
     * The view's backing array, or a `TypeError` if the buffer is detached.
     *
     * <p>Synchronous, unlike every failure the callbacks carry, because a
     * detached buffer is not an outcome of the operation -- the operation never
     * starts. That is what the language specifies and what node does.
     *
     * <p>Callers must reach this **before** reserving a completion credit. A
     * throw past a reservation leaks it, and a leaked credit is invisible until
     * an environment is closed.
     */
    private static byte[] storage(NtsViewU8 view) {
        byte[] bytes = view.buffer.bytes;
        if (bytes == null) {
            throw new NtsRefusal("a TypeError: the ArrayBuffer is detached");
        }
        return bytes;
    }
}
