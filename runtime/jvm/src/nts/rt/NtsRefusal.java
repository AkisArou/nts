package nts.rt;

/**
 * A runtime refusal, deliberately an Error and deliberately retaining its diagnostic stack.
 *
 * <p>**Its message is the exact line `runtime/c` prints, and it carries C's exit status**, because the
 * differential reads the line to tell the two kinds apart: `nts: refused: ` is the program correctly
 * declining its input (an index outside an array, an assertion an input fails), and anything else that
 * aborts -- `nts: refused at run time: `, the missing-feature abort a declined function's stub calls -- is a
 * defect. The JVM printed the second as `nts: refused: at run time: `, which matched the first prefix, so a
 * reached declined function counted as a legitimate decline here and as a defect on C (2026-10-04).
 */
public final class NtsRefusal extends Error {
    private static final long serialVersionUID = 1L;
    /** The process status `nts.rt.NtsMain` exits with: C's `abort()` (134) unless the helper says otherwise. */
    public final int status;
    /** A legitimate decline: `nts: refused: <detail>`, as C's `NTS_REFUSED`, ending as C's `abort()`. */
    public NtsRefusal(String detail) { this("nts: refused: " + detail, 134); }
    private NtsRefusal(String line, int status) {
        super(line);
        this.status = status;
    }
    /** The missing-feature abort: C's `nts_refused`, `nts: refused at run time: <what>`, read as a defect. */
    public static NtsRefusal missing(String what) { return new NtsRefusal("nts: refused at run time: " + what, 134); }
    /** An input decline with an explicit exit status, for a helper whose C counterpart exits rather than aborts. */
    public static NtsRefusal decline(String detail, int status) { return new NtsRefusal("nts: refused: " + detail, status); }
}
