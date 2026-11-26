package nts.rt;

import java.util.Arrays;

/**
 * {@code JSON.parse(text) as T}: the scan a parser the compiler generates for
 * {@code T} reads (docs/foundations/json.md, "Reading"), the JVM's copy of
 * {@code runtime/c/nts_json.c}.
 *
 * <p>The compiler generates one reader per static type, ordinary HIR that walks
 * a <em>tape</em> and builds {@code T}'s layout directly
 * ({@code compiler/core/src/hir/lower/json_parse.rs}); every backend runs the
 * same readers. This class makes the tape and answers the questions about it
 * that are unit work: what a key or a string says, what a number is, and where
 * in the document an entry sits. Its grammar, tape and messages are
 * {@code nts_json.c}'s, unit for unit, and the fixture
 * {@code a-json-parse-as-a-plain-object-builds-its-layout} holds both to node.
 *
 * <p><b>The whole text is checked before any of it is read.</b> {@link #tape}
 * validates the complete grammar first, V8's step for step
 * ({@code deps/v8/src/json/json-parser.cc}), so invalid text is a
 * {@code SyntaxError} whatever {@code T} says, at the position node reports,
 * and {@link #syntaxMessage} prints it in V8's words.
 *
 * <p><b>No depth limit.</b> Nesting is an explicit stack on the heap, never
 * the Java stack, so the only limit is memory.
 *
 * <p><b>The tape</b> is a {@code number[]}: four doubles of header, then three
 * per value, in document order.
 *
 * <pre>
 *     [0]  1 when the text is JSON, 0 when it is not
 *     [1]  not JSON: the error (a problem below); JSON: unused
 *     [2]  not JSON: its position in code units
 *     [3]  not JSON: the unit there, or -1 past the end
 *
 *     object, array   kind, the index just past its last descendant, its
 *                     member or element count
 *     string          kind, its first unit (or -1 - that, when it holds an
 *                     escape), the index of its closing quote
 *     number          kind, its first unit, the unit after its last
 *     true/false/null kind, its first unit, the unit after its last
 * </pre>
 *
 * <p>A {@code number[]} is a bare {@code double[]} in a program where no array
 * grows and an {@link NtsArrayD} in one where any does, which the backend
 * decides for the whole program; so the tape comes in both forms
 * ({@link #tape}, {@link #tapeArray}) and every read takes either.
 */
public final class NtsJson {
    private NtsJson() {}

    /** The kinds, as the generated readers test them ({@code json_parse.rs}, {@code Kind}). */
    static final int OBJECT = 1;
    static final int ARRAY = 2;
    static final int STRING = 3;
    static final int NUMBER = 4;
    static final int TRUE = 5;
    static final int FALSE = 6;
    static final int NULL = 7;

    /** Where the first value starts, and how wide every entry is. */
    static final int HEAD = 4;
    static final int ENTRY = 3;

    /**
     * What went wrong, as V8 tells it: {@code nts_json.c}'s {@code Problem},
     * by number. {@code TOKEN} is V8's {@code ReportUnexpectedCharacter},
     * whose wording depends on the unit and the text; every other is one
     * {@code MessageTemplate} with a position.
     */
    static final int FINE = 0;
    static final int END = 1;
    static final int TOKEN = 2;
    static final int UNTERMINATED_STRING = 3;
    static final int PROPERTY_NAME_OR_BRACE = 4;
    static final int COMMA_OR_BRACKET = 5;
    static final int COMMA_OR_BRACE = 6;
    static final int DOUBLE_QUOTED_NAME = 7;
    static final int EXPONENT = 8;
    static final int COLON = 9;
    static final int FRACTION = 10;
    static final int AFTER_JSON = 11;
    static final int BAD_ESCAPE = 12;
    static final int CONTROL = 13;
    static final int UNICODE_ESCAPE = 14;
    static final int MINUS = 15;

    /** A unit past the end, as the number grammar reads it: no digit, no part of a number, past Latin-1. */
    private static final int NONE = Integer.MAX_VALUE;

    static boolean digit(int unit) {
        return unit >= '0' && unit <= '9';
    }

    static int hex(int unit) {
        if (unit >= '0' && unit <= '9') { return unit - '0'; }
        if (unit >= 'a' && unit <= 'f') { return unit - 'a' + 10; }
        if (unit >= 'A' && unit <= 'F') { return unit - 'A' + 10; }
        return -1;
    }

    /** V8's {@code NumberPart}: a unit that may continue a number. */
    static boolean numberPart(int unit) {
        return digit(unit) || unit == '.' || unit == 'e' || unit == 'E' || unit == '-' || unit == '+';
    }

    // # The scan

    /** One scan of one text: the tape being written, the stack of open containers, and the first problem. */
    private static final class Scan {
        private static final int VALUE = 0;
        private static final int KEY = 1;
        private static final int AFTER = 2;

        final String text;
        final int n;
        double[] items = new double[64];
        int length = HEAD;
        /** Each open container as two ints: its entry, then its count so far. */
        int[] open = new int[32];
        int depth;
        int problem;
        int at;
        /** The last string scanned: its closing quote, and whether it holds an escape. */
        int close;
        boolean escaped;

        Scan(String text) {
            this.text = text;
            this.n = text.length();
        }

        boolean fail(int problem, int at) {
            this.problem = problem;
            this.at = at;
            return false;
        }

        int unit(int i) {
            return i < n ? text.charAt(i) : NONE;
        }

        int entry(int kind, double a, double b) {
            if (length + ENTRY > items.length) { items = Arrays.copyOf(items, items.length * 2); }
            int entry = length;
            items[entry] = kind;
            items[entry + 1] = a;
            items[entry + 2] = b;
            length += ENTRY;
            return entry;
        }

        /** JSON's whitespace, and nothing else: not U+FEFF, not U+00A0. */
        int space(int c) {
            while (c < n) {
                char unit = text.charAt(c);
                if (unit != ' ' && unit != '\t' && unit != '\n' && unit != '\r') { break; }
                c++;
            }
            return c;
        }

        /** {@code ScanJsonString}, from the unit after the opening quote: past the closing quote, or -1. */
        int string(int c) {
            escaped = false;
            for (;;) {
                if (c >= n) { fail(UNTERMINATED_STRING, n); return -1; }
                char unit = text.charAt(c);
                if (unit == '"') {
                    close = c;
                    return c + 1;
                }
                if (unit == '\\') {
                    escaped = true;
                    c++;
                    if (c >= n) { fail(END, c); return -1; }
                    char escape = text.charAt(c);
                    switch (escape) {
                        case '"': case '\\': case '/': case 'b': case 'f': case 'n': case 'r': case 't':
                            break;
                        case 'u':
                            for (int digit = 0; digit < 4; digit++) {
                                c++;
                                if (c >= n || hex(text.charAt(c)) < 0) { fail(UNICODE_ESCAPE, c); return -1; }
                            }
                            break;
                        default:
                            // V8 reads a unit past Latin-1 as an unexpected character, and any other as a bad escape.
                            fail(escape > 0xFF ? TOKEN : BAD_ESCAPE, c);
                            return -1;
                    }
                    c++;
                    continue;
                }
                if (unit < 0x20) { fail(CONTROL, c); return -1; }
                c++;
            }
        }

        /** {@code ParseJsonNumberAsDoubleOrSmi}'s grammar, from its first unit: past its last, or -1. */
        int number(int c) {
            boolean negative = false;
            if (unit(c) == '-') {
                negative = true;
                c++;
            }
            if (unit(c) == '0') {
                c++;
                int next = unit(c);
                if (next <= 0xFF && numberPart(next)) {
                    if (digit(next)) { fail(TOKEN, c); return -1; }
                } else if (!negative) {
                    return c;
                }
            } else {
                int first = c;
                while (c < n && digit(text.charAt(c))) { c++; }
                if (c == first) { fail(MINUS, c); return -1; }
            }
            if (unit(c) == '.') {
                c++;
                if (!digit(unit(c))) { fail(FRACTION, c); return -1; }
                while (c < n && digit(text.charAt(c))) { c++; }
            }
            int e = unit(c);
            if (e == 'e' || e == 'E') {
                c++;
                int sign = unit(c);
                if (sign == '-' || sign == '+') { c++; }
                if (!digit(unit(c))) { fail(EXPONENT, c); return -1; }
                while (c < n && digit(text.charAt(c))) { c++; }
            }
            return c;
        }

        /** {@code ScanLiteral}, from its first unit, which matched already: past its last, or -1. */
        int literal(int c, String word) {
            for (int i = 1; i < word.length(); i++) {
                if (c + i >= n) { fail(END, n); return -1; }
                if (text.charAt(c + i) != word.charAt(i)) { fail(TOKEN, c + i); return -1; }
            }
            return c + word.length();
        }

        void push(int entry) {
            if (2 * depth + 2 > open.length) { open = Arrays.copyOf(open, open.length * 2); }
            open[2 * depth] = entry;
            open[2 * depth + 1] = 1;
            depth++;
        }

        /** The whole scan: V8's grammar, writing the tape as it goes. */
        boolean run() {
            int c = 0;
            int state = VALUE;
            int firstKey = PROPERTY_NAME_OR_BRACE;
            for (;;) {
                if (state == VALUE) {
                    c = space(c);
                    if (c >= n) { return fail(END, c); }
                    char unit = text.charAt(c);
                    switch (unit) {
                        case '"': {
                            int start = c + 1;
                            c = string(start);
                            if (c < 0) { return false; }
                            entry(STRING, escaped ? -1.0 - start : start, close);
                            state = AFTER;
                            break;
                        }
                        case '-': case '0': case '1': case '2': case '3': case '4':
                        case '5': case '6': case '7': case '8': case '9': {
                            int start = c;
                            c = number(c);
                            if (c < 0) { return false; }
                            entry(NUMBER, start, c);
                            state = AFTER;
                            break;
                        }
                        case 't': case 'f': case 'n': {
                            int start = c;
                            c = literal(c, unit == 't' ? "true" : unit == 'f' ? "false" : "null");
                            if (c < 0) { return false; }
                            entry(unit == 't' ? TRUE : unit == 'f' ? FALSE : NULL, start, c);
                            state = AFTER;
                            break;
                        }
                        case '{': case '[': {
                            boolean object = unit == '{';
                            int entry = entry(object ? OBJECT : ARRAY, 0.0, 0.0);
                            c = space(c + 1);
                            if (c < n && text.charAt(c) == (object ? '}' : ']')) {
                                c++;
                                items[entry + 1] = length;
                                state = AFTER;
                                break;
                            }
                            push(entry);
                            if (object) {
                                firstKey = PROPERTY_NAME_OR_BRACE;
                                state = KEY;
                            }
                            break;
                        }
                        default:
                            return fail(TOKEN, c);
                    }
                } else if (state == KEY) {
                    c = space(c);
                    if (c >= n || text.charAt(c) != '"') { return fail(firstKey, c); }
                    int start = c + 1;
                    c = string(start);
                    if (c < 0) { return false; }
                    entry(STRING, escaped ? -1.0 - start : start, close);
                    c = space(c);
                    if (c >= n || text.charAt(c) != ':') { return fail(COLON, c); }
                    c++;
                    state = VALUE;
                } else {
                    c = space(c);
                    if (depth == 0) { return c < n ? fail(AFTER_JSON, c) : true; }
                    int top = 2 * (depth - 1);
                    int entry = open[top];
                    boolean object = items[entry] == OBJECT;
                    int unit = c < n ? text.charAt(c) : 0;
                    if (unit == ',') {
                        c++;
                        open[top + 1]++;
                        if (object) {
                            firstKey = DOUBLE_QUOTED_NAME;
                            state = KEY;
                        } else {
                            state = VALUE;
                        }
                    } else if (c < n && unit == (object ? '}' : ']')) {
                        c++;
                        items[entry + 1] = length;
                        items[entry + 2] = open[top + 1];
                        depth--;
                    } else {
                        return fail(object ? COMMA_OR_BRACE : COMMA_OR_BRACKET, c);
                    }
                }
            }
        }
    }

    /** {@code text} checked whole and indexed, as the class comment lays the tape out. */
    public static double[] tape(String text) {
        Scan scan = new Scan(text);
        if (scan.run()) {
            double[] out = Arrays.copyOf(scan.items, scan.length);
            out[0] = 1.0;
            return out;
        }
        double[] out = new double[HEAD];
        out[1] = scan.problem;
        out[2] = scan.at;
        out[3] = scan.at < text.length() ? text.charAt(scan.at) : -1.0;
        return out;
    }

    /** {@link #tape} in a program whose arrays can grow: the same doubles, adopted. */
    public static NtsArrayD tapeArray(String text) {
        return NtsArrayD.adopt(tape(text));
    }

    // # Messages

    /** V8's {@code CalculateFileLocation}: JSON's own line breaks, {@code \r\n} as one. */
    private static void location(StringBuilder out, String text, int pos) {
        int line = 1;
        int lineStart = 0;
        int at = 0;
        for (; at < pos; at++) {
            char unit = text.charAt(at);
            if (unit == '\r' && at + 1 < pos && text.charAt(at + 1) == '\n') {
                at++;
                unit = '\n';
            }
            if (unit == '\r' || unit == '\n') {
                line++;
                lineStart = at + 1;
            }
        }
        out.append(" at position ").append(pos).append(" (line ").append(line)
            .append(" column ").append(1 + (at - lineStart)).append(')');
    }

    /** V8's {@code IsSpecialString}: the four texts a stray {@code String(x)} makes. */
    private static boolean special(String text) {
        return text.equals("[object Object]") || text.equals("undefined") || text.equals("Infinity")
            || text.equals("NaN");
    }

    private static String template(int problem) {
        switch (problem) {
            case UNTERMINATED_STRING: return "Unterminated string in JSON";
            case PROPERTY_NAME_OR_BRACE: return "Expected property name or '}' in JSON";
            case COMMA_OR_BRACKET: return "Expected ',' or ']' after array element in JSON";
            case COMMA_OR_BRACE: return "Expected ',' or '}' after property value in JSON";
            case DOUBLE_QUOTED_NAME: return "Expected double-quoted property name in JSON";
            case EXPONENT: return "Exponent part is missing a number in JSON";
            case COLON: return "Expected ':' after property name in JSON";
            case FRACTION: return "Unterminated fractional number in JSON";
            case AFTER_JSON: return "Unexpected non-whitespace character after JSON";
            case BAD_ESCAPE: return "Bad escaped character in JSON";
            case CONTROL: return "Bad control character in string literal in JSON";
            case UNICODE_ESCAPE: return "Bad Unicode escape in JSON";
            case MINUS: return "No number after minus sign in JSON";
            default: return null;
        }
    }

    /** V8's message for the first error of a text that is not JSON, word for word. */
    public static String syntaxMessage(String text, double[] tape) {
        int problem = (int) tape[1];
        int pos = (int) tape[2];
        double unit = tape[3];
        if (problem == FINE || problem == END) { return "Unexpected end of JSON input"; }
        StringBuilder out = new StringBuilder();
        String template = template(problem);
        if (template != null) {
            out.append(template);
            location(out, text, pos);
            return out.toString();
        }
        // `LookUpErrorMessageForJsonToken`: a number or a string by its token, and anything else quoted with the
        // text around it.
        if (unit < 0.0) { return "Unexpected end of JSON input"; }
        char at = (char) unit;
        if (at == '-' || digit(at) || at == '"') {
            out.append(at == '"' ? "Unexpected string in JSON" : "Unexpected number in JSON");
            location(out, text, pos);
            return out.toString();
        }
        if (special(text)) { return out.append('"').append(text).append("\" is not valid JSON").toString(); }
        // `GetErrorMessageWithEllipses`: ten units either side, from 21 on.
        final int context = 10;
        int length = text.length();
        out.append("Unexpected token '").append(at).append("', ");
        if (length >= 2 * context + 1) {
            if (pos < context) {
                out.append('"').append(text, 0, pos + context).append("\"... is not valid JSON");
            } else if (pos < length - context) {
                out.append("...\"").append(text, pos - context, pos + context).append("\"... is not valid JSON");
            } else {
                out.append("...\"").append(text, pos - context, length).append("\" is not valid JSON");
            }
        } else {
            out.append('"').append(text).append("\" is not valid JSON");
        }
        return out.toString();
    }

    public static String syntaxMessage(String text, NtsArrayD tape) {
        return syntaxMessage(text, tape.items);
    }

    // # Reading entries

    /** A string entry's first unit, its escape mark undone. */
    private static int start(double[] tape, int entry) {
        double first = tape[entry + 1];
        return (int) (first < 0.0 ? -1.0 - first : first);
    }

    /** The units a validated string means, into {@code out} (room for {@code end - start}): how many. */
    private static int decode(String text, int start, int end, char[] out) {
        int length = 0;
        for (int at = start; at < end; at++) {
            char unit = text.charAt(at);
            if (unit != '\\') {
                out[length++] = unit;
                continue;
            }
            at++;
            char escape = text.charAt(at);
            switch (escape) {
                case 'b': out[length++] = '\b'; break;
                case 'f': out[length++] = '\f'; break;
                case 'n': out[length++] = '\n'; break;
                case 'r': out[length++] = '\r'; break;
                case 't': out[length++] = '\t'; break;
                case 'u': {
                    int value = 0;
                    for (int digit = 0; digit < 4; digit++) { value = value * 16 + hex(text.charAt(at + 1 + digit)); }
                    at += 4;
                    out[length++] = (char) value;
                    break;
                }
                default: out[length++] = escape; break;
            }
        }
        return length;
    }

    /** The string at entry {@code at}: one copy, unescaped where it has an escape. */
    public static String string(String text, double[] tape, double at) {
        int entry = (int) at;
        double first = tape[entry + 1];
        int end = (int) tape[entry + 2];
        if (first >= 0.0) { return text.substring((int) first, end); }
        int start = (int) (-1.0 - first);
        char[] units = new char[end - start];
        return new String(units, 0, decode(text, start, end, units));
    }

    public static String string(String text, NtsArrayD tape, double at) {
        return string(text, tape.items, at);
    }

    /**
     * Which of {@code keys} the key entry {@code at} is, or -1. {@code keys} is each key as one unit of its length
     * and then its units; {@code hint}, the one to try first, is the member a reader expects next in declaration
     * order -- the one a document {@code JSON.stringify} wrote from the same type has there.
     */
    public static double keyIndex(String text, double[] tape, double at, String keys, double hint) {
        int entry = (int) at;
        int start = start(tape, entry);
        int end = (int) tape[entry + 2];
        char[] decoded = null;
        int decodedLength = 0;
        if (tape[entry + 1] < 0.0) {
            decoded = new char[end - start];
            decodedLength = decode(text, start, end, decoded);
        }
        int count = keys.length();
        int wanted = hint >= 0.0 ? (int) hint : -1;
        if (wanted >= 0) {
            int i = 0;
            for (int ordinal = 0; i < count && ordinal < wanted; ordinal++) { i += 1 + keys.charAt(i); }
            if (i < count && keyIs(text, start, end, decoded, decodedLength, keys, i + 1, keys.charAt(i))) {
                return wanted;
            }
        }
        int i = 0;
        for (int ordinal = 0; i < count; ordinal++) {
            int length = keys.charAt(i);
            if (ordinal != wanted && keyIs(text, start, end, decoded, decodedLength, keys, i + 1, length)) {
                return ordinal;
            }
            i += 1 + length;
        }
        return -1.0;
    }

    public static double keyIndex(String text, NtsArrayD tape, double at, String keys, double hint) {
        return keyIndex(text, tape.items, at, keys, hint);
    }

    /** Whether the key spanning {@code [start, end)} (or {@code decoded}, where it had an escape) is the {@code length} units at {@code key}. */
    private static boolean keyIs(String text, int start, int end, char[] decoded, int decodedLength, String keys,
            int key, int length) {
        if (decoded != null) {
            if (decodedLength != length) { return false; }
            for (int i = 0; i < length; i++) {
                if (decoded[i] != keys.charAt(key + i)) { return false; }
            }
            return true;
        }
        return end - start == length && text.regionMatches(start, keys, key, length);
    }

    /** The powers of ten a double holds exactly. */
    private static final double[] EXACT_POWERS = {
        1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11,
        1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
    };

    /**
     * The number at entry {@code at}, correctly rounded. Clinger's fast path where it is exact: at most 15
     * significant digits, so the digits are an exact double, times or divided by a power of ten up to 1e22, which
     * is one too, makes one correctly rounded operation. Anything else goes to {@link Double#parseDouble}, which is
     * correctly rounded and admits every text JSON's grammar does, and the scan has checked that grammar.
     */
    public static double number(String text, double[] tape, double at) {
        int entry = (int) at;
        int start = (int) tape[entry + 1];
        int end = (int) tape[entry + 2];
        int c = start;
        boolean negative = text.charAt(c) == '-';
        if (negative) { c++; }
        long digits = 0;
        int significant = 0;
        int scale = 0;
        boolean fraction = false;
        for (; c < end; c++) {
            char unit = text.charAt(c);
            if (unit == '.') {
                fraction = true;
                continue;
            }
            if (!digit(unit)) { break; }
            if (fraction) { scale--; }
            if (digits == 0 && unit == '0') { continue; }
            if (++significant > 15) { return slow(text, start, end); }
            digits = digits * 10 + (unit - '0');
        }
        if (c < end) {
            // The exponent: `e` or `E`, an optional sign, and at least one digit.
            c++;
            boolean down = text.charAt(c) == '-';
            if (down || text.charAt(c) == '+') { c++; }
            if (end - c > 3) { return slow(text, start, end); }
            int exponent = 0;
            for (; c < end; c++) { exponent = exponent * 10 + (text.charAt(c) - '0'); }
            scale += down ? -exponent : exponent;
        }
        double value;
        if (digits == 0) {
            value = 0.0;
        } else if (scale >= 0 && scale <= 22) {
            value = digits * EXACT_POWERS[scale];
        } else if (scale < 0 && scale >= -22) {
            value = digits / EXACT_POWERS[-scale];
        } else {
            return slow(text, start, end);
        }
        return negative ? -value : value;
    }

    public static double number(String text, NtsArrayD tape, double at) {
        return number(text, tape.items, at);
    }

    private static double slow(String text, int start, int end) {
        return Double.parseDouble(text.substring(start, end));
    }

    // # Mismatches
    //
    // Only on the failing path, so none of this costs a document that matches: the path is found again from the
    // root.

    private static int next(double[] tape, int entry) {
        double kind = tape[entry];
        return kind == OBJECT || kind == ARRAY ? (int) tape[entry + 1] : entry + ENTRY;
    }

    private static boolean identifier(String name) {
        if (name.isEmpty()) { return false; }
        for (int i = 0; i < name.length(); i++) {
            char unit = name.charAt(i);
            boolean letter = (unit >= 'a' && unit <= 'z') || (unit >= 'A' && unit <= 'Z') || unit == '_'
                || unit == '$';
            if (!letter && !(i > 0 && digit(unit))) { return false; }
        }
        return true;
    }

    /** {@code $}, then {@code .name}, {@code ["odd name"]} or {@code [3]} down to {@code target}. */
    private static void path(StringBuilder out, String text, double[] tape, int target) {
        out.append('$');
        int entry = HEAD;
        while (entry != target) {
            boolean object = tape[entry] == OBJECT;
            int end = (int) tape[entry + 1];
            int child = entry + ENTRY;
            int from = entry;
            if (object) {
                while (child < end) {
                    int value = child + ENTRY;
                    int after = next(tape, value);
                    if (target >= value && target < after) {
                        String name = string(text, tape, child);
                        if (identifier(name)) {
                            out.append('.').append(name);
                        } else {
                            out.append('[');
                            quote(out, name);
                            out.append(']');
                        }
                        entry = value;
                        break;
                    }
                    child = after;
                }
            } else {
                int index = 0;
                while (child < end) {
                    int after = next(tape, child);
                    if (target >= child && target < after) {
                        out.append('[').append(index).append(']');
                        entry = child;
                        break;
                    }
                    child = after;
                    index++;
                }
            }
            // A target inside no child of a container is not an entry of this tape: the reader's own defect,
            // never a document's.
            if (entry == from) { throw new NtsRefusal("a JSON tape entry outside its document"); }
        }
    }

    private static final char[] HEX = "0123456789abcdef".toCharArray();

    /** {@code s} as {@code JSON.stringify} writes it: quoted, with a lone surrogate escaped and a pair kept. */
    private static void quote(StringBuilder out, String s) {
        out.append('"');
        int length = s.length();
        for (int at = 0; at < length; at++) {
            char unit = s.charAt(at);
            switch (unit) {
                case '"': out.append("\\\""); continue;
                case '\\': out.append("\\\\"); continue;
                case '\b': out.append("\\b"); continue;
                case '\t': out.append("\\t"); continue;
                case '\n': out.append("\\n"); continue;
                case '\f': out.append("\\f"); continue;
                case '\r': out.append("\\r"); continue;
                default: break;
            }
            boolean lone = false;
            if (Character.isHighSurrogate(unit)) {
                if (at + 1 < length && Character.isLowSurrogate(s.charAt(at + 1))) {
                    out.append(unit).append(s.charAt(++at));
                    continue;
                }
                lone = true;
            } else if (Character.isLowSurrogate(unit)) {
                lone = true;
            }
            if (unit < 0x20 || lone) {
                out.append("\\u").append(HEX[unit >> 12]).append(HEX[(unit >> 8) & 0xF])
                    .append(HEX[(unit >> 4) & 0xF]).append(HEX[unit & 0xF]);
            } else {
                out.append(unit);
            }
        }
        out.append('"');
    }

    private static String kindName(double kind) {
        switch ((int) kind) {
            case OBJECT: return "an object";
            case ARRAY: return "an array";
            case STRING: return "a string";
            case NUMBER: return "a number";
            case TRUE: case FALSE: return "a boolean";
            default: return "null";
        }
    }

    /** A {@code TypeError}'s message: the entry's JSON path, what was expected there, and what was found. */
    public static String mismatch(String text, double[] tape, double at, String expected) {
        StringBuilder out = new StringBuilder();
        path(out, text, tape, (int) at);
        return out.append(": expected ").append(expected).append(", found ").append(kindName(tape[(int) at]))
            .toString();
    }

    public static String mismatch(String text, NtsArrayD tape, double at, String expected) {
        return mismatch(text, tape.items, at, expected);
    }

    /** A {@code TypeError}'s message: the object entry's JSON path, and the property it lacks. */
    public static String missing(String text, double[] tape, double at, String key) {
        StringBuilder out = new StringBuilder();
        path(out, text, tape, (int) at);
        out.append(": missing the property ");
        quote(out, key);
        return out.toString();
    }

    public static String missing(String text, NtsArrayD tape, double at, String key) {
        return missing(text, tape.items, at, key);
    }
}
