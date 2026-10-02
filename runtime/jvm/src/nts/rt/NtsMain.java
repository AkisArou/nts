package nts.rt;

/**
 * Run a compiled program whole: its module initializer, then the event loop to
 * quiescence. {@code java -cp <out>:nts-runtime.jar nts.rt.NtsMain nts.gen.Program}.
 *
 * <p>Until this existed nothing on this lane could run a program as a program:
 * the emitted {@code Program} has {@code module$init()} and no {@code main},
 * and the differential drives exported functions. So every divergence that
 * only a whole program shows -- module-scope statements, an unhandled
 * rejection, what is printed between two callbacks -- was invisible here to
 * every instrument, not merely untested (2026-10-02).
 *
 * <p>The exits match the C lane's: an uncaught throw already ends the process
 * from compiled code ({@link NtsRuntime#uncaught}, status 1); a run-time
 * refusal prints C's {@code nts: refused at run time: } line and exits 134,
 * which is what C's {@code abort()} leaves; a clean run exits 0.
 */
public final class NtsMain {
    private NtsMain() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            System.err.println("usage: nts.rt.NtsMain <program class>, e.g. nts.gen.Program");
            System.exit(2);
        }
        java.lang.reflect.Method init = Class.forName(args[0]).getMethod("module$init");
        try {
            init.invoke(null);
            NtsEnv.drain(NtsEnv.current());
        } catch (java.lang.reflect.InvocationTargetException e) {
            report(e.getCause());
        } catch (NtsRefusal e) {
            report(e);
        }
        System.out.flush();
        System.exit(0);
    }

    private static void report(Throwable cause) throws Exception {
        if (!(cause instanceof NtsRefusal)) {
            if (cause instanceof Exception) { throw (Exception) cause; }
            throw (Error) cause;
        }
        String message = cause.getMessage();
        String detail = message.startsWith("nts: refused: at run time: ")
            ? message.substring("nts: refused: at run time: ".length())
            : message.substring("nts: refused: ".length());
        System.out.flush();
        System.err.println("nts: refused at run time: " + detail);
        System.err.flush();
        System.exit(134);
    }
}
