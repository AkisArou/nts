package nts.rt;

import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;

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
    /**
     * The proxy result string for a URL, in the classic auto-configuration
     * grammar the shared lane parses.
     *
     * <p>`PROXY host:port`, `SOCKS5 host:port`, `SOCKS host:port` or `DIRECT`,
     * joined with `"; "`. Formatting only: the parsing lives above this seam
     * where it has its own tests and sabotages, and a second parser here would
     * be a second answer.
     *
     * <h2>The SOCKS version is established, not assumed</h2>
     *
     * <p>`Proxy.Type.SOCKS` covers **both** versions and the selector will not
     * say which -- measured on API 26, where setting `socksProxyVersion` to `4`
     * leaves the answer `SOCKS socks.test:1080`, identical to version 5. So the
     * version comes from the property, which reads `null` when unset and means
     * 5 by Java's own default.
     *
     * <p>Answering `SOCKS5` for a SOCKS4 proxy would type-check, look like
     * support, and fail inside a handshake the peer never agreed to speak. `4`
     * is reported as bare `SOCKS`, which the shared side names as unusable
     * rather than upgrading -- a visible refusal beating a wrong protocol.
     *
     * <h2>Brackets are ours to add</h2>
     *
     * <p>`InetSocketAddress.getHostString()` answers `::1` for an IPv6 literal,
     * unbracketed, and unbracketed is genuinely ambiguous against `host:port`.
     * Measured, not assumed.
     */
    public static String systemProxyFor(String url) {
        ProxySelector selector = ProxySelector.getDefault();
        if (selector == null) {
            return "DIRECT";
        }
        List<Proxy> found;
        try {
            found = selector.select(new URI(url));
        } catch (URISyntaxException | RuntimeException e) {
            // **`DIRECT` rather than a throw.** A proxy lookup is advisory, and
            // failing the request a direct connection would have served is the
            // worse of the two outcomes -- the same reasoning the shared side
            // gives for treating an unparseable result as `DIRECT`. The URL
            // arrives from a parsed record, so this is a shared-side bug rather
            // than user input, and it is not one this seam can act on.
            return "DIRECT";
        }
        if (found == null || found.isEmpty()) {
            return "DIRECT";
        }
        StringBuilder out = new StringBuilder();
        for (Proxy one : found) {
            String directive = directiveFor(one);
            if (directive == null) {
                continue;
            }
            if (out.length() != 0) {
                out.append("; ");
            }
            out.append(directive);
        }
        return out.length() == 0 ? "DIRECT" : out.toString();
    }

    /** One `Proxy` as one directive, or `null` for one with no address to name. */
    private static String directiveFor(Proxy one) {
        if (one.type() == Proxy.Type.DIRECT) {
            return "DIRECT";
        }
        if (!(one.address() instanceof InetSocketAddress)) {
            return null;
        }
        InetSocketAddress at = (InetSocketAddress) one.address();
        String host = at.getHostString();
        if (host == null) {
            return null;
        }
        if (host.indexOf(':') >= 0 && host.charAt(0) != '[') {
            host = "[" + host + "]";
        }
        String keyword;
        if (one.type() == Proxy.Type.SOCKS) {
            String version = System.getProperty("socksProxyVersion");
            keyword = version == null || "5".equals(version) ? "SOCKS5" : "SOCKS";
        } else {
            keyword = "PROXY";
        }
        return keyword + " " + host + ":" + at.getPort();
    }

    // ----- the durable store ------------------------------------------------
    //
    // **Views both ways, because the table already decided that.** Three
    // entries here take a caller's window -- `randomFill` fills one, `read` and
    // `write` borrow one -- and a byte store that allocated at this seam
    // instead would be the only one that does, copying every value twice: once
    // out of the file and once into the view the caller wanted anyway.
    //
    // The two fill-buffer reads answer **the full size** and write as much of
    // it as fits, so a caller that guessed too small learns the right number
    // from the same call rather than from a second one. Both behave that way;
    // two fill-buffer calls with different short-buffer rules would be a trap
    // discovered once, painfully.

    /** Points the store at a directory and sweeps whatever the last run left. */
    public static void storeConfigure(String root) {
        NtsStore.configure(root);
    }

    /** Abandons every write and ranged view, and forgets the root. */
    public static void storeClose() {
        NtsStore.close();
    }

    /** Begins replacing a key. Refuses when that key already has a live write. */
    public static double storeOpen(String namespace, String key) {
        return (double) NtsStore.open(namespace, key);
    }

    /**
     * Appends a caller's window to a write in progress.
     *
     * <p>No offset or length beside the view: it carries both, and passing
     * them again is a second answer that can disagree with the first.
     */
    public static void storeAppend(double handle, NtsViewU8 from) {
        byte[] bytes = storage(from);
        NtsStore.append((long) handle, bytes, from.offset, NtsView.elements(from));
    }

    /** Makes everything appended visible under the key, atomically and durably. */
    public static void storeCommit(double handle) {
        NtsStore.commit((long) handle);
    }

    /** Abandons a write. Idempotent, and a no-op once committed. */
    public static void storeDiscard(double handle) {
        NtsStore.discard((long) handle);
    }

    /** The value's full size, or `-1` when absent; writes as much as fits. */
    public static double storeRead(String namespace, String key, NtsViewU8 into) {
        byte[] value = NtsStore.read(namespace, key);
        if (value == null) {
            return -1.0;
        }
        return (double) fill(into, value);
    }

    /** Removes a key. Absent is not an error; the answer says whether anything went. */
    public static boolean storeDelete(String namespace, String key) {
        return NtsStore.delete(namespace, key);
    }

    /**
     * One snapshot of a namespace's records, concatenated into a caller's
     * window; answers the total byte length needed.
     *
     * <p>`size NUL modified NUL keyByteLength NUL key` per record. The explicit
     * length is what lets records be concatenated and still parsed when a key
     * contains a separator -- which a key may, because a key is an arbitrary
     * string.
     */
    public static double storeList(String namespace, NtsViewU8 into) {
        String[] records = NtsStore.list(namespace);
        java.io.ByteArrayOutputStream all = new java.io.ByteArrayOutputStream();
        for (String record : records) {
            byte[] bytes;
            try {
                bytes = record.getBytes("UTF-8");
            } catch (java.io.UnsupportedEncodingException e) {
                throw new NtsRefusal("UTF-8 is not available: " + e);
            }
            all.write(bytes, 0, bytes.length);
        }
        return (double) fill(into, all.toByteArray());
    }

    /** Total committed bytes in a namespace. */
    public static double storeSize(String namespace) {
        return (double) NtsStore.size(namespace);
    }

    /** An independent ranged view, or `-1` when the key is absent. */
    public static double storeSourceOpen(String namespace, String key, double start, double length) {
        return (double) NtsStore.sourceOpen(namespace, key, (long) start, (long) length);
    }

    /**
     * The next chunk into a caller's window; answers how many bytes, or `-1` at
     * the end of the range.
     *
     * <p>`-1` and not `0`: an empty chunk and the end of a stream are different
     * answers, and making zero unreachable is what keeps a consumer from having
     * to know that.
     */
    public static double storeSourceRead(double handle, NtsViewU8 into) {
        byte[] bytes = storage(into);
        byte[] chunk = NtsStore.sourceRead((long) handle, NtsView.elements(into));
        if (chunk == null) {
            return -1.0;
        }
        System.arraycopy(chunk, 0, bytes, into.offset, chunk.length);
        return (double) chunk.length;
    }

    /** Closes a ranged view. Safe on success, after a failed read, and twice. */
    public static void storeSourceClose(double handle) {
        NtsStore.sourceClose((long) handle);
    }

    /** The value's byte length, or `-1` when the key is absent. */
    public static double storeSourceSize(String namespace, String key) {
        return (double) NtsStore.sourceSize(namespace, key);
    }

    /** Writes what fits and answers what there was, which are different numbers. */
    private static int fill(NtsViewU8 into, byte[] value) {
        byte[] bytes = storage(into);
        int room = NtsView.elements(into);
        System.arraycopy(value, 0, bytes, into.offset, Math.min(room, value.length));
        return value.length;
    }

    private static byte[] storage(NtsViewU8 view) {
        byte[] bytes = view.buffer.bytes;
        if (bytes == null) {
            throw new NtsRefusal("a TypeError: the ArrayBuffer is detached");
        }
        return bytes;
    }
}
