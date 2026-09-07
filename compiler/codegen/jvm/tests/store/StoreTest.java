import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;

import nts.rt.NtsStore;

/**
 * The durable byte store, against a real filesystem.
 *
 * <p>Every case here is about something the ABI promises rather than about the
 * implementation: that nothing appended is visible before commit, that a key
 * holds the old value or the new one and never a mix, that a name cannot escape
 * its namespace, and that a crashed write leaves nothing a later run reports.
 */
public final class StoreTest {
    static int checks;
    static int failures;

    static void check(boolean ok, String what) {
        checks++;
        if (!ok) {
            failures++;
            System.out.println("FAIL " + what);
        }
    }

    static void refuses(String what, Runnable body) {
        checks++;
        try {
            body.run();
            failures++;
            System.out.println("FAIL " + what + " -- it was allowed");
        } catch (Error expected) {
            if (!expected.getMessage().startsWith("nts: refused:")) {
                failures++;
                System.out.println("FAIL " + what + " -- wrong error: " + expected);
            }
        }
    }

    static byte[] bytes(String text) {
        try {
            return text.getBytes("UTF-8");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    static void write(String namespace, String key, String value) {
        long handle = NtsStore.open(namespace, key);
        byte[] payload = bytes(value);
        NtsStore.append(handle, payload, 0, payload.length);
        NtsStore.commit(handle);
    }

    static String read(String namespace, String key) {
        byte[] found = NtsStore.read(namespace, key);
        if (found == null) {
            return null;
        }
        try {
            return new String(found, "UTF-8");
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    /** The keys out of a `list` snapshot, which is `size NUL modified NUL key`. */
    static String[] keysOf(String namespace) {
        String[] records = NtsStore.list(namespace);
        String[] keys = new String[records.length];
        for (int i = 0; i < records.length; i++) {
            int first = records[i].indexOf('\0');
            int second = records[i].indexOf('\0', first + 1);
            keys[i] = records[i].substring(second + 1);
        }
        Arrays.sort(keys);
        return keys;
    }

    static long fieldOf(String namespace, String key, int which) {
        for (String record : NtsStore.list(namespace)) {
            int first = record.indexOf('\0');
            int second = record.indexOf('\0', first + 1);
            if (record.substring(second + 1).equals(key)) {
                return Long.parseLong(which == 0
                    ? record.substring(0, first)
                    : record.substring(first + 1, second));
            }
        }
        return -1L;
    }

    /** Recursively, because a device run uses a fixed path and runs more than once. */
    static void clear(File at) {
        File[] inside = at.listFiles();
        if (inside != null) {
            for (File one : inside) {
                clear(one);
            }
        }
        at.delete();
    }

    public static void main(String[] args) throws Exception {
        File root = new File(args[0]);
        // **Cleared first, so this can run twice in a row.** The desktop harness
        // gives a fresh temporary each time and would never have noticed; the
        // device runs it at a fixed path, where the first case -- that an
        // unwritten key reads as absent -- would fail on the second run against
        // the first run's leftovers. A case that cannot be run twice is not
        // evidence a suite can carry.
        clear(root);
        NtsStore.configure(root.getPath());

        // ----- the round trip, and the absence that precedes it -------------
        check(read("cache", "a") == null, "an unwritten key read as something");
        check(NtsStore.sourceSize("cache", "a") == -1, "an unwritten key had a size");
        write("cache", "a", "hello");
        check("hello".equals(read("cache", "a")), "the value did not come back");
        check(NtsStore.sourceSize("cache", "a") == 5, "the size was not the byte length");
        check(fieldOf("cache", "a", 0) == 5, "the listed size was not the byte length");
        check(fieldOf("cache", "a", 1) > 0, "there was no modified time");

        // ----- many appends are one value -----------------------------------
        long many = NtsStore.open("cache", "many");
        for (int i = 0; i < 4; i++) {
            byte[] chunk = bytes("chunk" + i + " ");
            NtsStore.append(many, chunk, 0, chunk.length);
        }
        check(read("cache", "many") == null, "a value was visible before its commit");
        NtsStore.commit(many);
        check("chunk0 chunk1 chunk2 chunk3 ".equals(read("cache", "many")),
            "the appended chunks did not make one value");

        // ----- the old value until the new one is committed ------------------
        //
        // The property the whole temp-file mechanism exists for. Writing
        // straight to the target instead would make this the first thing to
        // fail, which is what makes it worth asserting rather than assuming.
        long replacing = NtsStore.open("cache", "a");
        byte[] replacement = bytes("REPLACED");
        NtsStore.append(replacing, replacement, 0, replacement.length);
        check("hello".equals(read("cache", "a")),
            "the old value was gone while the new one was still being written");
        NtsStore.commit(replacing);
        check("REPLACED".equals(read("cache", "a")), "the replacement did not land");

        // ----- discard leaves what was there --------------------------------
        long abandoned = NtsStore.open("cache", "a");
        byte[] never = bytes("NEVER");
        NtsStore.append(abandoned, never, 0, never.length);
        NtsStore.discard(abandoned);
        check("REPLACED".equals(read("cache", "a")), "a discarded write changed the value");
        NtsStore.discard(abandoned);
        check(true, "discard was not idempotent");

        // ----- enumeration counts values and not writes in progress ----------
        long open = NtsStore.open("cache", "in-progress");
        byte[] some = bytes("x");
        NtsStore.append(open, some, 0, some.length);
        String[] keys = keysOf("cache");
        check(Arrays.asList(keys).contains("a"), "a committed key was not listed");
        check(!Arrays.asList(keys).contains("in-progress"),
            "a write in progress was listed as a record");
        check(NtsStore.size("cache") == 8 + 28, "the namespace size was not the committed bytes");
        NtsStore.discard(open);

        // Sorted, so two runs over one directory give one answer.
        String[] sorted = keys.clone();
        Arrays.sort(sorted);
        check(Arrays.equals(keys, sorted), "the keys were not in a stable order");

        // ----- delete --------------------------------------------------------
        check(NtsStore.delete("cache", "many"), "delete did not report removing a key");
        check(read("cache", "many") == null, "a deleted key still read");
        check(!NtsStore.delete("cache", "many"), "deleting an absent key reported a removal");

        // ----- names that would escape, and names that need encoding ---------
        //
        // `..` and `/` do not survive encoding, so these are stored, listed and
        // read back under their own names while living inside the namespace.
        String[] awkward = {"../escape", "..", "/etc/passwd", "a b", "%41", "é中", ".hidden"};
        for (String key : awkward) {
            write("names", key, "value:" + key);
            check(("value:" + key).equals(read("names", key)),
                "an awkward key did not round trip: " + key);
        }
        File namespace = new File(root, "names");
        File[] stored = namespace.listFiles();
        check(stored != null && stored.length == awkward.length,
            "a key escaped its namespace or collided with another");
        for (File file : stored == null ? new File[0] : stored) {
            check(file.getName().indexOf('/') < 0 && !file.getName().equals("..")
                    && !file.getName().startsWith("."),
                "a stored name was not a plain segment: " + file.getName());
        }
        check(new File(root.getParentFile(), "etc").exists() == false,
            "a key wrote outside the store root");
        check(keysOf("names").length == awkward.length, "the awkward keys did not all list");
        // The key is last and the split takes the first two separators only, so
        // a key that itself contains one still comes back whole.
        write("names", "with\0nul", "n");
        check("n".equals(read("names", "with\0nul")), "a key containing NUL did not round trip");
        check(Arrays.asList(keysOf("names")).contains("with\0nul"),
            "a key containing NUL did not survive the record encoding");
        NtsStore.delete("names", "with\0nul");

        // ----- what this refuses ---------------------------------------------
        StringBuilder long_ = new StringBuilder();
        for (int i = 0; i < 300; i++) {
            long_.append('k');
        }
        final String tooLong = long_.toString();
        refuses("a key past the name limit", () -> NtsStore.open("cache", tooLong));

        long held = NtsStore.open("cache", "sequential");
        refuses("a second concurrent write to one key", () -> NtsStore.open("cache", "sequential"));
        NtsStore.discard(held);
        // And the claim is released, so the same key is writable afterwards.
        write("cache", "sequential", "after");
        check("after".equals(read("cache", "sequential")),
            "the key stayed claimed after its write was discarded");

        refuses("appending to a handle that is not open", () -> NtsStore.append(999999, new byte[1], 0, 1));

        // ----- recovery: a crashed write leaves nothing behind ----------------
        //
        // Simulated the only way a test can without cutting power: a temporary
        // is created by hand exactly as a killed process would have left one.
        // It must be invisible before recovery and gone after it.
        File partial = new File(namespace, "recovered.7.nts-partial");
        try (FileOutputStream out = new FileOutputStream(partial)) {
            out.write(bytes("half a value"));
        }
        check(partial.exists(), "the simulated crash left nothing to recover from");
        check(!Arrays.asList(keysOf("names")).contains("recovered"),
            "an uncommitted temporary was reported as a record");
        NtsStore.configure(root.getPath());
        check(!partial.exists(), "recovery did not sweep an uncommitted temporary");
        check(read("names", "..") != null, "recovery removed a committed value");

        // ----- the ranged view ------------------------------------------------
        write("cache", "big", "0123456789");
        check(NtsStore.sourceSize("cache", "big") == 10, "the source size was wrong");
        check(NtsStore.sourceSize("cache", "absent") == -1, "an absent key had a source size");
        check(NtsStore.sourceOpen("cache", "absent", 0, 10) == -1,
            "an absent key opened a source");

        long source = NtsStore.sourceOpen("cache", "big", 2, 5);
        byte[] first = NtsStore.sourceRead(source, 3);
        check(first != null && new String(first, "UTF-8").equals("234"), "the first chunk was wrong");
        // Two bytes, not three: the range is five long and three are gone.
        byte[] second = NtsStore.sourceRead(source, 3);
        check(second != null && new String(second, "UTF-8").equals("56"),
            "the range did not stop at its own length");
        check(NtsStore.sourceRead(source, 3) == null, "the end of a range was not null");
        // Never an empty array: an empty chunk and the end of a stream are
        // different answers, and a reader told them apart by length would get
        // the first zero-length value wrong.
        check(NtsStore.sourceRead(source, 3) == null, "reading past the end was not null");
        NtsStore.sourceClose(source);
        NtsStore.sourceClose(source);
        check(true, "closing a source twice threw");
        refuses("reading a closed source", () -> NtsStore.sourceRead(source, 1));

        // Two views of one value do not move each other.
        long left = NtsStore.sourceOpen("cache", "big", 0, 10);
        long right = NtsStore.sourceOpen("cache", "big", 0, 10);
        byte[] fromLeft = NtsStore.sourceRead(left, 4);
        byte[] fromRight = NtsStore.sourceRead(right, 4);
        check(fromLeft != null && fromRight != null
                && new String(fromLeft, "UTF-8").equals("0123")
                && new String(fromRight, "UTF-8").equals("0123"),
            "two ranged views shared a position");
        NtsStore.sourceClose(left);
        NtsStore.sourceClose(right);

        // A range past the end is clamped, because the size a caller was told
        // may have been replaced since.
        long clamped = NtsStore.sourceOpen("cache", "big", 8, 100);
        byte[] tail = NtsStore.sourceRead(clamped, 100);
        check(tail != null && new String(tail, "UTF-8").equals("89"), "a long range was not clamped");
        check(NtsStore.sourceRead(clamped, 100) == null, "the clamped range did not end");
        NtsStore.sourceClose(clamped);
        NtsStore.delete("cache", "big");

        // ----- a committed value outlives the handle that wrote it ----------
        //
        // `close` abandons writes in progress and forgets the root; what is on
        // disk is on disk, which is the whole point of the store. Reopening is
        // the nearest thing to a restart that one process can show.
        NtsStore.close();
        refuses("using the store after close", () -> NtsStore.read("cache", "a"));
        NtsStore.configure(root.getPath());
        check("REPLACED".equals(read("cache", "a")), "a committed value did not survive a reopen");
        check(read("names", "../escape").equals("value:../escape"),
            "an awkward key did not survive a reopen");
        check(NtsStore.size("cache") > 0, "the namespace was empty after a reopen");
        NtsStore.close();

        System.out.printf("store: %d checks, %d failures%n", checks, failures);
        System.exit(failures == 0 ? 0 : 1);
    }
}
