package nts.rt;

/**
 * Load every emitted class, so the JVM's verifier passes judgement on it.
 *
 * <p>The characteristic failure of a bytecode emitter is a class that is
 * well-formed enough to write and rejected at load. It cannot be found by
 * running a program, because a program only loads the classes it reaches, and it
 * cannot be found by inspecting the bytes, because the thing being asked is
 * exactly what the verifier's abstract interpretation concludes. The only
 * instrument is the verifier.
 *
 * <p>{@code initialize = true} rather than {@code false}: linking is lazy, and a
 * class named but never initialized may never be verified at all. Initializing
 * forces linking, which forces verification. It also runs {@code <clinit>},
 * which for a generated program sets its module-scope variables and nothing
 * else -- these classes have no other static state, by construction.
 *
 * <p>Every class is attempted even after one fails, and each failure is printed
 * with its class name. A harness that stopped at the first would turn a
 * count into a boolean, and the count is what gets ratcheted.
 */
public final class Verify {
    private Verify() {}

    public static void main(String[] argv) {
        int failed = 0;
        for (String name : argv) {
            try {
                Class.forName(name, true, Verify.class.getClassLoader());
            } catch (Throwable failure) {
                failed++;
                // `getClass().getName()` as well as the message: a `VerifyError`
                // and a `NoSuchMethodError` are different bugs, and the message
                // alone does not always say which.
                System.out.println(
                    "UNVERIFIABLE " + name + ": "
                        + failure.getClass().getName() + ": " + failure.getMessage());
            }
        }
        if (failed > 0) {
            System.exit(1);
        }
    }
}
