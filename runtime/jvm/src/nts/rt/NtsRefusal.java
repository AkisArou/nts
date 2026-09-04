package nts.rt;

/**
 * A construct the compiled program declined at run time.
 *
 * <p>An {@code Error} rather than an {@code Exception} because nothing in a
 * compiled program may catch one: a refusal is the JVM lane's spelling of what
 * the native runtime does by printing to stderr and aborting, and a TypeScript
 * {@code try} block must not turn it into a caught value.
 *
 * <p>The message carries the {@code nts: refused:} prefix on purpose. The
 * differential harness reads that prefix to tell a program the compiler
 * correctly declined from a program that went wrong, and a Java stack trace
 * without it would be counted as a defect on every case the C lane also
 * declines.
 */
public final class NtsRefusal extends Error {
    private static final long serialVersionUID = 1L;

    public NtsRefusal(String detail) {
        super("nts: refused: " + detail);
    }
}
