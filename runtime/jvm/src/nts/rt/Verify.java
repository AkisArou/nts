package nts.rt;

/** Initialize every named emitted class to force JVM linking and verification. */
public final class Verify {
    private Verify() {}
    public static void main(String[] argv) {
        int failed = 0;
        for (String name : argv) {
            try {
                Class.forName(name, true, Verify.class.getClassLoader());
            } catch (Throwable failure) {
                failed++;
                System.out.println("UNVERIFIABLE " + name + ": "
                    + failure.getClass().getName() + ": " + failure.getMessage());
            }
        }
        if (failed > 0) { System.exit(1); }
    }
}
