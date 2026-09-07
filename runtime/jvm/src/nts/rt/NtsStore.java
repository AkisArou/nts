package nts.rt;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * The durable byte store: bytes, atomicity, durability and enumeration.
 *
 * <p>The provider half of `runtime/web-platform/src/storage/durable.ts`.
 * Deliberately narrow -- RFC 9111 freshness, `Vary`, invalidation, eviction,
 * quota policy and CacheStorage matching are shared TypeScript above this, and
 * nothing here is a storage primitive for any of them.
 *
 * <h2>One implementation, both runtimes</h2>
 *
 * <p>This names no Android SDK member and lives in the runtime jar, so the
 * desktop JVM and ART run the same code. That was a measurement rather than a
 * hope: the one operation with any reason to need the platform is syncing a
 * directory, and `FileChannel.open(dir, READ).force(true)` was checked on an
 * API-26 device against `android.system.Os.fsync` on the same directory as a
 * control. Both worked, so the seam that would have existed for `Os.fsync` does
 * not exist. Had the portable route failed, this would be two classes.
 *
 * <h2>What a key holds after a crash</h2>
 *
 * <p>The old value or the new one, never a mix and never absent. That is the
 * ABI's guarantee rather than this provider's detail, and here it comes from
 * writing to a temporary and renaming: a rename is atomic within a directory,
 * so no reader ever observes a half-written value, and a crash leaves a
 * temporary that {@link #configure} sweeps.
 *
 * <p>Durable means two syncs and not one. {@link Write#commit} syncs the file's
 * own descriptor, which makes the bytes durable, and then syncs the containing
 * <em>directory</em>, which makes the rename durable. Doing only the first
 * leaves a committed value losable to a power cut while still never leaving a
 * partial one -- a failure that is invisible to every test that does not cut
 * power, which is why it is written down here rather than left to be noticed.
 *
 * <h2>What this refuses</h2>
 *
 * <p>A key whose encoded form would exceed the filesystem's name limit, and a
 * second concurrent write to a key that already has one. Both are refusals by
 * name. Truncating a long key would make two keys one key, and serialising a
 * concurrent write behind a lock would make the ABI's "sequential per key" a
 * property of how long a caller waits rather than of what it may do.
 */
public final class NtsStore {
    private NtsStore() {}

    /** Longest encoded file name, under the 255-byte limit every relevant filesystem shares. */
    private static final int NAME_LIMIT = 200;

    /** The suffix that marks a write in progress, and so also what recovery sweeps. */
    private static final String PARTIAL = ".nts-partial";

    private static volatile Path root;
    private static final AtomicLong NEXT = new AtomicLong(1);
    private static final ConcurrentHashMap<Long, Write> WRITES = new ConcurrentHashMap<>();
    /** Keys with a write in progress, as `namespace/key`, so a second one refuses. */
    private static final ConcurrentHashMap<String, Long> CLAIMED = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<Long, Source> SOURCES = new ConcurrentHashMap<>();

    /**
     * Points the store at a directory and recovers from whatever the last run left.
     *
     * <p>Recovery is one rule: a file with the partial suffix is a write that
     * never committed, so it is removed. There is nothing to replay, because a
     * commit is a rename and a rename either happened or did not.
     */
    public static synchronized void configure(String directory) {
        if (directory == null) {
            throw new NtsRefusal("the durable store needs a directory");
        }
        Path at = new File(directory).toPath();
        try {
            Files.createDirectories(at);
        } catch (IOException e) {
            throw new NtsRefusal("the durable store root could not be created: " + e);
        }
        root = at;
        sweep(at);
    }

    /** Removes every uncommitted temporary under the root, one namespace at a time. */
    private static void sweep(Path at) {
        File[] namespaces = at.toFile().listFiles();
        if (namespaces == null) {
            return;
        }
        for (File namespace : namespaces) {
            File[] files = namespace.listFiles();
            if (files == null) {
                continue;
            }
            for (File file : files) {
                if (file.getName().endsWith(PARTIAL)) {
                    // Best effort by design. A temporary that cannot be removed
                    // is not a correctness problem -- it is not a value and
                    // `keys` does not report it -- so failing the whole store
                    // over one would be the wrong trade.
                    file.delete();
                }
            }
        }
    }

    private static byte[] utf8(String text) {
        try {
            return text.getBytes("UTF-8");
        } catch (java.io.UnsupportedEncodingException e) {
            throw new NtsRefusal("UTF-8 is not available: " + e);
        }
    }

    private static Path rooted() {
        Path at = root;
        if (at == null) {
            throw new NtsRefusal("the durable store was used before `configure`");
        }
        return at;
    }

    /**
     * One path segment per namespace and per key, with everything outside a
     * conservative set percent-encoded.
     *
     * <p>Reversible, because {@link #keys} has to give back what was stored
     * rather than what it was called on disk. And escape-proof for the reason
     * that matters more: `..` and `/` do not survive encoding, so no key can
     * name a file outside its namespace however it was constructed.
     */
    private static String encode(String name) {
        StringBuilder out = new StringBuilder(name.length() + 8);
        for (byte b : utf8(name)) {
            int c = b & 0xff;
            boolean safe = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                || (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_';
            // A leading dot is encoded too, so a key cannot become a hidden
            // file and `.` and `..` cannot be spelled at all.
            if (safe && !(c == '.' && out.length() == 0)) {
                out.append((char) c);
            } else {
                out.append('%');
                out.append(Character.toUpperCase(Character.forDigit(c >> 4, 16)));
                out.append(Character.toUpperCase(Character.forDigit(c & 0xf, 16)));
            }
        }
        if (out.length() > NAME_LIMIT) {
            throw new NtsRefusal("a durable-store name encodes to " + out.length()
                + " bytes, past the " + NAME_LIMIT + "-byte limit -- truncating it would make"
                + " two names one name");
        }
        return out.toString();
    }

    private static String decode(String name) {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream(name.length());
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (c == '%' && i + 2 < name.length()) {
                out.write((Character.digit(name.charAt(i + 1), 16) << 4)
                    | Character.digit(name.charAt(i + 2), 16));
                i += 2;
            } else {
                out.write(c);
            }
        }
        try {
            return new String(out.toByteArray(), "UTF-8");
        } catch (java.io.UnsupportedEncodingException e) {
            throw new NtsRefusal("UTF-8 is not available: " + e);
        }
    }

    private static Path namespaceDir(String namespace, boolean create) {
        Path at = rooted().resolve(encode(namespace));
        if (create) {
            try {
                Files.createDirectories(at);
            } catch (IOException e) {
                throw new NtsRefusal("a durable-store namespace could not be created: " + e);
            }
        }
        return at;
    }

    private static Path valuePath(String namespace, String key, boolean create) {
        return namespaceDir(namespace, create).resolve(encode(key));
    }

    /** The whole value, or `null` when the key is absent. */
    public static byte[] read(String namespace, String key) {
        File file = valuePath(namespace, key, false).toFile();
        if (!file.isFile()) {
            return null;
        }
        long length = file.length();
        if (length > Integer.MAX_VALUE) {
            throw new NtsRefusal("a durable value of " + length
                + " bytes does not fit one array -- read it through `source` instead");
        }
        byte[] bytes = new byte[(int) length];
        int at = 0;
        try (InputStream in = new java.io.FileInputStream(file)) {
            while (at < bytes.length) {
                int read = in.read(bytes, at, bytes.length - at);
                if (read < 0) {
                    // The file shrank under us, which a concurrent `delete` and
                    // replace can do. Short is not a value, so this answers
                    // absent rather than a truncated one.
                    return null;
                }
                at += read;
            }
        } catch (IOException e) {
            throw new NtsRefusal("a durable value could not be read: " + e);
        }
        return bytes;
    }

    /**
     * The value's byte length, or `-1` when the key is absent.
     *
     * <p>`-1` rather than a separate existence call, so opening a ranged view
     * of a value that may not be there is one crossing rather than two.
     */
    public static long sourceSize(String namespace, String key) {
        File file = valuePath(namespace, key, false).toFile();
        return file.isFile() ? file.length() : -1L;
    }

    /**
     * Every committed record in a namespace, as `size NUL modified NUL key`.
     *
     * <p>One call and one snapshot. Three calls -- names, then a size and a
     * time for each -- is `1 + 2N` crossings, and worse than that it cannot be
     * atomic: a key created or removed between two of them makes the metadata
     * disagree with the names, and the caller has no way to tell which half is
     * stale.
     *
     * <p>Each record is `size NUL modified NUL keyByteLength NUL key`. The
     * explicit length is what lets the records be *concatenated* into one
     * buffer and still parsed when a key contains a separator; the key stays
     * last even though the length now makes that unnecessary, so the two
     * encodings this ABI has never differ in field order. A write in progress
     * is not a record.
     */
    public static String[] list(String namespace) {
        File[] files = namespaceDir(namespace, false).toFile().listFiles();
        if (files == null) {
            return new String[0];
        }
        List<String> found = new ArrayList<>(files.length);
        for (File file : files) {
            if (file.isFile() && !file.getName().endsWith(PARTIAL)) {
                String key = decode(file.getName());
                found.add(file.length() + "\0" + file.lastModified() + "\0"
                    + utf8(key).length + "\0" + key);
            }
        }
        String[] out = found.toArray(new String[0]);
        // Sorted, so two runs over one directory give one answer: `listFiles`
        // is in directory order, which is neither insertion nor alphabetical
        // and differs between filesystems. Sorted on the whole record, which
        // begins with a size -- the order is stable rather than meaningful, and
        // a caller that wants it by key sorts it by key.
        Arrays.sort(out);
        return out;
    }

    /** Total committed bytes in a namespace. */
    public static long size(String namespace) {
        File[] files = namespaceDir(namespace, false).toFile().listFiles();
        if (files == null) {
            return 0L;
        }
        long total = 0L;
        for (File file : files) {
            if (file.isFile() && !file.getName().endsWith(PARTIAL)) {
                total += file.length();
            }
        }
        return total;
    }

    /**
     * Opens an independent ranged view, or answers `-1` when the key is absent.
     *
     * <p>Independent is the load-bearing word: every consumer opens its own,
     * with its own position, so two readers of one value cannot move each
     * other. `length` past the end is clamped rather than refused, because the
     * size a caller was told may have been replaced since.
     */
    public static long sourceOpen(String namespace, String key, long start, long length) {
        File file = valuePath(namespace, key, false).toFile();
        if (!file.isFile()) {
            return -1L;
        }
        long handle = NEXT.getAndIncrement();
        try {
            SOURCES.put(handle, new Source(file, start, length));
        } catch (NtsRefusal e) {
            throw e;
        }
        return handle;
    }

    /**
     * The next chunk, or `null` at the end of the range.
     *
     * <p>Never an empty array. An empty chunk and the end of a stream are
     * different answers, and a reader that had to tell them apart by length
     * would get it wrong on the first zero-length value.
     */
    public static byte[] sourceRead(long handle, int maxBytes) {
        Source source = SOURCES.get(handle);
        if (source == null) {
            throw new NtsRefusal("durable source " + handle + " is not open");
        }
        return source.read(maxBytes);
    }

    /** Closes a ranged view. Safe on success, after a failed read, and twice. */
    public static void sourceClose(long handle) {
        Source source = SOURCES.remove(handle);
        if (source != null) {
            source.close();
        }
    }

    /** Removes a key. Absent is not an error; the answer says whether anything went. */
    public static boolean delete(String namespace, String key) {
        return valuePath(namespace, key, false).toFile().delete();
    }

    /**
     * Begins replacing a key, and answers the handle the other three take.
     *
     * <p>A second write to a key that already has one is refused rather than
     * queued. The ABI is sequential per key; making that true by waiting would
     * turn a caller's mistake into a pause, and the pause would be the only
     * evidence it made one.
     */
    public static long open(String namespace, String key) {
        Path target = valuePath(namespace, key, true);
        long handle = NEXT.getAndIncrement();
        String claim = namespace + " " + key;
        if (CLAIMED.putIfAbsent(claim, handle) != null) {
            throw new NtsRefusal("a durable write to `" + key + "` is already open in `"
                + namespace + "` -- this store is sequential per key");
        }
        Path partial = target.resolveSibling(target.getFileName() + "." + handle + PARTIAL);
        try {
            WRITES.put(handle, new Write(claim, target, partial));
        } catch (RuntimeException e) {
            CLAIMED.remove(claim, handle);
            throw e;
        }
        return handle;
    }

    private static Write live(long handle) {
        Write write = WRITES.get(handle);
        if (write == null) {
            throw new NtsRefusal("durable write " + handle + " is not open");
        }
        return write;
    }

    /** Appends bytes to a write in progress. Nothing is visible until {@link #commit}. */
    public static void append(long handle, byte[] bytes, int offset, int length) {
        live(handle).append(bytes, offset, length);
    }

    /** Makes everything appended visible under the key, atomically and durably. */
    public static void commit(long handle) {
        Write write = live(handle);
        try {
            write.commit();
        } finally {
            WRITES.remove(handle);
            CLAIMED.remove(write.claim, handle);
        }
    }

    /** Abandons a write. Idempotent, and a no-op once committed. */
    public static void discard(long handle) {
        Write write = WRITES.remove(handle);
        if (write == null) {
            return;
        }
        CLAIMED.remove(write.claim, handle);
        write.discard();
    }

    /**
     * Abandons every write in progress and forgets the root.
     *
     * <p>Committed values stay; they are on disk and that is the point of them.
     */
    public static synchronized void close() {
        // `entrySet` and not `keySet`. Java 8 gave `ConcurrentHashMap.keySet()`
        // a covariant return type -- `KeySetView` rather than `Set` -- so
        // `javac --release 8` writes that into the call site's descriptor, and
        // Android's `core-oj` declares the older signature. It resolves on
        // every desktop JVM and raises `NoSuchMethodError` on ART. `entrySet`
        // has no such override on either.
        for (java.util.Map.Entry<Long, Write> open : new ArrayList<>(WRITES.entrySet())) {
            discard(open.getKey());
        }
        for (java.util.Map.Entry<Long, Source> open : new ArrayList<>(SOURCES.entrySet())) {
            sourceClose(open.getKey());
        }
        WRITES.clear();
        CLAIMED.clear();
        SOURCES.clear();
        root = null;
    }

    /** Syncs a directory, which is what makes a rename survive a power cut. */
    private static void syncDirectory(Path directory) throws IOException {
        try (FileChannel channel = FileChannel.open(directory, StandardOpenOption.READ)) {
            channel.force(true);
        }
    }

    /** One open ranged view: a channel, a position and a bound. */
    private static final class Source {
        private final java.io.RandomAccessFile file;
        private long at;
        private long left;

        Source(File on, long start, long length) {
            try {
                this.file = new java.io.RandomAccessFile(on, "r");
            } catch (IOException e) {
                throw new NtsRefusal("a durable source could not be opened: " + e);
            }
            long size = on.length();
            // **Refused rather than clamped, and the difference is not
            // pedantry.** A caller asked for a range of *that* value. If the
            // key was replaced between being sized and being opened, a prefix
            // of the new value is not a shorter answer to that question -- it
            // is an answer to a different one, returned without saying so. The
            // Blob layer above composes and slices on the promise that a range
            // is immutable, and silently substituting bytes is exactly what
            // breaks it.
            //
            // The descriptor above pins what was opened, so a rename *after*
            // this point cannot change what this view sees. This check closes
            // the window before it.
            if (start < 0 || length < 0 || start + length > size) {
                close();
                throw new NtsRefusal("a durable source of [" + start + ", " + (start + length)
                    + ") does not fit a value of " + size + " bytes -- it was replaced between"
                    + " being sized and being opened");
            }
            this.at = start;
            this.left = length;
        }

        synchronized byte[] read(int maxBytes) {
            // **An empty window is refused, not answered.** `null` here means
            // the end of the range, and a caller that passed nowhere to put
            // bytes would be told the stream had ended when it had not -- the
            // one way this seam could produce a chunk of zero length, which the
            // shared side's contract says can never happen.
            if (maxBytes <= 0) {
                throw new NtsRefusal("a durable source read was given an empty window, and an "
                    + "empty window is not the end of the range");
            }
            if (left <= 0) {
                return null;
            }
            int want = (int) Math.min((long) maxBytes, left);
            byte[] chunk = new byte[want];
            int got = 0;
            try {
                file.seek(at);
                while (got < want) {
                    int read = file.read(chunk, got, want - got);
                    if (read < 0) {
                        break;
                    }
                    got += read;
                }
            } catch (IOException e) {
                throw new NtsRefusal("a durable source could not be read: " + e);
            }
            if (got == 0) {
                // The file shrank under an open view. End of stream, which is
                // the honest answer -- an empty chunk is not one.
                left = 0;
                return null;
            }
            at += got;
            left -= got;
            return got == want ? chunk : Arrays.copyOf(chunk, got);
        }

        synchronized void close() {
            try {
                file.close();
            } catch (IOException ignored) {
                // Closing a read-only view cannot lose anything, and there is
                // no caller who could act on the failure.
            }
        }
    }

    /** One write in progress: a temporary, and the name it takes on commit. */
    private static final class Write {
        private final String claim;
        private final Path target;
        private final Path partial;
        private FileOutputStream out;
        private boolean done;

        Write(String claim, Path target, Path partial) {
            this.claim = claim;
            this.target = target;
            this.partial = partial;
            try {
                this.out = new FileOutputStream(partial.toFile());
            } catch (IOException e) {
                throw new NtsRefusal("a durable write could not be opened: " + e);
            }
        }

        synchronized void append(byte[] bytes, int offset, int length) {
            if (done) {
                throw new NtsRefusal("a durable write was appended to after it finished");
            }
            try {
                out.write(bytes, offset, length);
            } catch (IOException e) {
                throw new NtsRefusal("a durable write could not be appended to: " + e);
            }
        }

        synchronized void commit() {
            if (done) {
                throw new NtsRefusal("a durable write was committed twice");
            }
            done = true;
            try {
                out.flush();
                // The bytes, before the rename that publishes them. A rename
                // ordered ahead of the data it names is exactly the reordering
                // that makes a committed value read back as zeros.
                out.getFD().sync();
                out.close();
                Files.move(partial, target, StandardCopyOption.ATOMIC_MOVE);
                // And the directory, so the rename itself survives. This is the
                // half that no test here can demonstrate: showing it matters
                // means cutting power between the two syncs.
                syncDirectory(target.getParent());
            } catch (IOException e) {
                partial.toFile().delete();
                throw new NtsRefusal("a durable write could not be committed: " + e);
            }
        }

        synchronized void discard() {
            if (done) {
                return;
            }
            done = true;
            try {
                out.close();
            } catch (IOException ignored) {
                // The file is going away; a close that failed changes nothing
                // about that, and there is no caller who could act on it.
            }
            partial.toFile().delete();
        }
    }
}
