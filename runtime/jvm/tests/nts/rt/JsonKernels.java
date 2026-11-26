package nts.rt;

/**
 * {@link NtsJson} read directly, as {@code runtime/c/tests/json_scan.c} reads
 * {@code nts_json.c}: the tape it writes, what each read answers, both tape
 * forms, and a nesting far past any Java stack. The {@code SyntaxError} text is
 * held to node by the fixture {@code a-json-parse-as-a-plain-object-builds-its-layout},
 * whose {@code syntax} and {@code numbers} exports run on every backend.
 */
final class JsonKernels {
    private JsonKernels() {}

    private static long checks;

    private static void check(boolean yes, String message) {
        ++checks;
        if (!yes) { throw new AssertionError(message); }
    }

    private static void equal(Object actual, Object expected, String message) {
        check(java.util.Objects.equals(actual, expected), message + ": " + actual + " != " + expected);
    }

    private static void bits(double actual, double expected, String message) {
        check(Double.doubleToRawLongBits(actual) == Double.doubleToRawLongBits(expected),
            message + ": " + actual + " != " + expected);
    }

    /** The key table a reader passes: each key as one unit of its length, then its units. */
    private static String keys(String... names) {
        StringBuilder out = new StringBuilder();
        for (String name : names) { out.append((char) name.length()).append(name); }
        return out.toString();
    }

    private static void tapes() {
        String text = " {\"a\" : [1, \"x\\n\", {}], \"b\":null, \"a\":true} ";
        double[] tape = NtsJson.tape(text);
        bits(tape[0], 1, "valid text");
        // The object, its key "a", the array and its three elements, "b", null, the second "a", true: ten.
        equal(tape.length, 4 + 3 * 10, "three words per value");
        bits(tape[4], NtsJson.OBJECT, "the object");
        bits(tape[5], tape.length, "an object ends past its last descendant");
        bits(tape[6], 3, "members, the duplicate kept");
        bits(tape[7], NtsJson.STRING, "a key");
        bits(tape[10], NtsJson.ARRAY, "the array");
        bits(tape[11], 22, "the array ends where \"b\" begins");
        bits(tape[12], 3, "elements");
        bits(tape[13], NtsJson.NUMBER, "a number");
        bits(tape[14], 9, "its first unit");
        bits(tape[15], 10, "the unit after its last");
        bits(tape[16], NtsJson.STRING, "a string");
        bits(tape[17], -1.0 - 13, "an escaped string's first unit, marked");
        bits(tape[19], NtsJson.OBJECT, "the empty object");
        bits(tape[20], 22, "an empty container ends after itself");
        bits(tape[21], 0, "and counts nothing");
        bits(tape[25], NtsJson.NULL, "null");
        bits(tape[31], NtsJson.TRUE, "true");

        double[] invalid = NtsJson.tape("[1, ");
        bits(invalid[0], 0, "invalid text");
        equal(invalid.length, 4, "an invalid tape is its header");
        equal(NtsJson.syntaxMessage("[1, ", invalid), "Unexpected end of JSON input", "the end");
        double[] token = NtsJson.tape("[1,]");
        bits(token[1], NtsJson.TOKEN, "a token");
        bits(token[2], 3, "at its position");
        bits(token[3], ']', "and the unit there");
        equal(NtsJson.syntaxMessage("[1,]", token), "Unexpected token ']', \"[1,]\" is not valid JSON", "V8's words");
    }

    private static void reads() {
        String text = "{\"plain\":\"abc\",\"esc\":\"\\u00e9\\uD83D\\uDE00\\ud800\\b\\f\\n\\r\\t\\/\\\\\\\"\","
            + "\"wide\":\"中文\",\"pi\\u0065\":3.25,\"n\":-0,\"big\":1e400,\"tiny\":5e-324}";
        double[] tape = NtsJson.tape(text);
        bits(tape[0], 1, "valid");
        // Members start at 7; each is a key entry, then its value's.
        equal(NtsJson.string(text, tape, 10), "abc", "an unescaped string is its span");
        equal(NtsJson.string(text, tape, 16), "é😀\ud800\b\f\n\r\t/\\\"", "every escape, a pair and a lone half");
        equal(NtsJson.string(text, tape, 22), "中文", "two-byte text");
        bits(NtsJson.number(text, tape, 28), 3.25, "a fraction");
        bits(NtsJson.number(text, tape, 34), -0.0, "negative zero");
        bits(NtsJson.number(text, tape, 40), Double.POSITIVE_INFINITY, "past the largest double");
        bits(NtsJson.number(text, tape, 46), Double.MIN_VALUE, "the least subnormal");

        String table = keys("plain", "esc", "wide", "pie", "n", "big", "tiny");
        bits(NtsJson.keyIndex(text, tape, 7, table, 0), 0, "the hinted key");
        bits(NtsJson.keyIndex(text, tape, 7, table, 3), 0, "a key the hint missed");
        bits(NtsJson.keyIndex(text, tape, 7, table, -1), 0, "no hint");
        bits(NtsJson.keyIndex(text, tape, 25, table, 3), 3, "an escaped key, decoded");
        bits(NtsJson.keyIndex(text, tape, 25, table, -1), 3, "an escaped key, unhinted");
        bits(NtsJson.keyIndex(text, tape, 7, keys("plainer", "plai", ""), -1), -1, "a key of no other length");
        bits(NtsJson.keyIndex("{\"\":1}", NtsJson.tape("{\"\":1}"), 7, keys("a", ""), 0), 1, "the empty key");

        String nested = "{\"rows\":[{\"id\":1},{\"id\":\"x\",\"odd key\":{\"q\":[true]}}]}";
        double[] at = NtsJson.tape(nested);
        // The second row's "id" value, and its "odd key" object's array's element.
        int id = -1;
        int element = -1;
        for (int entry = 4; entry < at.length; entry += 3) {
            if (at[entry] == NtsJson.STRING && "x".equals(NtsJson.string(nested, at, entry))) { id = entry; }
            if (at[entry] == NtsJson.TRUE) { element = entry; }
        }
        equal(NtsJson.mismatch(nested, at, id, "a number"),
            "$.rows[1].id: expected a number, found a string", "a path through an array");
        equal(NtsJson.mismatch(nested, at, element, "a string"),
            "$.rows[1][\"odd key\"].q[0]: expected a string, found a boolean", "an odd key, quoted");
        equal(NtsJson.missing(nested, at, 4, "a\"\n\u0001\ud800"),
            "$: missing the property \"a\\\"\\n\\u0001\\ud800\"", "a missing key as JSON.stringify writes it");
        equal(NtsJson.mismatch("[]", NtsJson.tape("[]"), 4, "an object"), "$: expected an object, found an array",
            "the root");
    }

    /** The two tape forms answer alike: a program whose arrays grow holds the tape in an NtsArrayD. */
    private static void forms() {
        String text = "{\"k\\u0031\":[\"s\",2.5,false],\"x\":1}";
        double[] bare = NtsJson.tape(text);
        NtsArrayD grown = NtsJson.tapeArray(text);
        equal(NtsArrayD.count(grown), bare.length, "the same length");
        for (int i = 0; i < bare.length; i++) { bits(NtsArrayD.get(grown, i), bare[i], "word " + i); }
        String table = keys("x", "k1");
        bits(NtsJson.keyIndex(text, grown, 7, table, 0), NtsJson.keyIndex(text, bare, 7, table, 0), "keyIndex");
        equal(NtsJson.string(text, grown, 13), NtsJson.string(text, bare, 13), "string");
        bits(NtsJson.number(text, grown, 16), 2.5, "number");
        equal(NtsJson.mismatch(text, grown, 19, "a number"), "$.k1[2]: expected a number, found a boolean",
            "mismatch");
        equal(NtsJson.missing(text, grown, 4, "y"), NtsJson.missing(text, bare, 4, "y"), "missing");
        String bad = "{\"k\":[1 2]}";
        equal(NtsJson.syntaxMessage(bad, NtsJson.tapeArray(bad)), NtsJson.syntaxMessage(bad, NtsJson.tape(bad)),
            "syntaxMessage");
    }

    /** A million levels: the scan's stack is the heap's, and the path is found without recursion either. */
    private static void depth() {
        final int depth = 1_000_000;
        StringBuilder arrays = new StringBuilder(2 * depth);
        for (int i = 0; i < depth; i++) { arrays.append('['); }
        for (int i = 0; i < depth; i++) { arrays.append(']'); }
        double[] tape = NtsJson.tape(arrays.toString());
        bits(tape[0], 1, "a million arrays deep");
        bits(tape[5], tape.length, "the outermost ends past everything");
        double[] open = NtsJson.tape(arrays.substring(0, depth));
        equal(NtsJson.syntaxMessage(arrays.substring(0, depth), open), "Unexpected end of JSON input",
            "a million arrays never closed");

        final int objects = 100_000;
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < objects; i++) { text.append("{\"a\":"); }
        text.append('1');
        for (int i = 0; i < objects; i++) { text.append('}'); }
        String nested = text.toString();
        double[] at = NtsJson.tape(nested);
        int innermost = at.length - 3;
        bits(at[innermost], NtsJson.NUMBER, "the innermost value");
        String message = NtsJson.mismatch(nested, at, innermost, "a string");
        equal(message.length(), 1 + 2 * objects + ": expected a string, found a number".length(), "its path");
        check(message.startsWith("$.a.a.a"), "a path a hundred thousand members long");
    }

    static long run() {
        tapes();
        reads();
        forms();
        depth();
        return checks;
    }
}
