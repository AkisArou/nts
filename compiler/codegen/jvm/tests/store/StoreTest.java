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

    /** `size NUL modified NUL keyByteLength NUL key`, split into its four fields. */
    static String[] fields(String record) {
        int first = record.indexOf('\0');
        int second = record.indexOf('\0', first + 1);
        int third = record.indexOf('\0', second + 1);
        return new String[] {
            record.substring(0, first),
            record.substring(first + 1, second),
            record.substring(second + 1, third),
            // The key is last and taken as the whole remainder, so a key that
            // contains a separator survives.
            record.substring(third + 1),
        };
    }

    static String[] keysOf(String namespace) {
        String[] records = NtsStore.list(namespace);
        String[] keys = new String[records.length];
        for (int i = 0; i < records.length; i++) {
            keys[i] = fields(records[i])[3];
        }
        Arrays.sort(keys);
        return keys;
    }

    static long fieldOf(String namespace, String key, int which) {
        for (String record : NtsStore.list(namespace)) {
            String[] parts = fields(record);
            if (parts[3].equals(key)) {
                return Long.parseLong(parts[which]);
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
        check(fieldOf("names", "with\0nul", 2) == 8,
            "the declared key length did not match the key");
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

        // A range past the end is **refused, not clamped**. The caller asked for
        // a range of *that* value; if the key was replaced between being sized
        // and being opened, a prefix of the new one is not a shorter answer to
        // that question but an answer to a different one, returned without
        // saying so -- and the Blob layer above composes on the promise that a
        // range is immutable.
        refuses("a range past the end of the value",
            () -> NtsStore.sourceOpen("cache", "big", 8, 100));
        refuses("a negative start", () -> NtsStore.sourceOpen("cache", "big", -1, 2));
        // The exact tail is fine, because it fits.
        long tailView = NtsStore.sourceOpen("cache", "big", 8, 2);
        byte[] tail = NtsStore.sourceRead(tailView, 100);
        check(tail != null && new String(tail, "UTF-8").equals("89"), "the tail range was wrong");
        check(NtsStore.sourceRead(tailView, 100) == null, "the tail range did not end");
        NtsStore.sourceClose(tailView);

        // An empty window is refused rather than answered. `null` means the end
        // of the range, so answering it here would tell a caller the stream had
        // ended when it had not -- the one way this could produce a zero-length
        // chunk, which the shared contract says cannot happen.
        long empty = NtsStore.sourceOpen("cache", "big", 0, 10);
        refuses("a source read with an empty window", () -> NtsStore.sourceRead(empty, 0));
        check(NtsStore.sourceRead(empty, 4) != null, "the refusal consumed the range");
        NtsStore.sourceClose(empty);

        // And a view already open keeps reading what it was opened over, both
        // when the key is **replaced** and when it is **deleted**.
        //
        // Replacement is a correctness property: a Blob composes and slices
        // immutable ranges, so a reader that saw a replacement mid-read breaks
        // the guarantee it is built on. Deletion is a *lifetime* one -- without
        // it nothing above this seam can release stored bytes while anything
        // might still be reading them, so every caller either leaks or guesses.
        //
        // Both hold here for one reason: the handle is an open descriptor, and
        // a rename or an unlink changes the directory rather than the file it
        // named. That is a property of the platform, not of this code, which is
        // exactly why it is asserted rather than assumed -- and asserted on ART
        // as well, where the filesystem underneath is not the desktop's.
        long pinned = NtsStore.sourceOpen("cache", "big", 0, 10);
        write("cache", "big", "REPLACEDXX");
        byte[] original = NtsStore.sourceRead(pinned, 100);
        check(original != null && new String(original, "UTF-8").equals("0123456789"),
            "an open ranged view saw a value committed after it opened");
        NtsStore.sourceClose(pinned);

        long survives = NtsStore.sourceOpen("cache", "big", 0, 10);
        check(NtsStore.delete("cache", "big"), "the key to be deleted was not there");
        check(NtsStore.sourceSize("cache", "big") == -1, "the key was not deleted");
        byte[] afterDelete = NtsStore.sourceRead(survives, 100);
        check(afterDelete != null && new String(afterDelete, "UTF-8").equals("REPLACEDXX"),
            "an open ranged view stopped reading when its key was deleted");
        check(NtsStore.sourceRead(survives, 100) == null, "the surviving range did not end");
        NtsStore.sourceClose(survives);
        write("cache", "big", "0123456789");
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
