package nts.rt;

import java.io.BufferedReader;
import java.io.FileReader;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

/**
 * The differential harness, on this side of the fence.
 *
 * <p>The C lane generates a {@code check_main.c} per case set and compiles it.
 * Doing the same here would put {@code javac} in the differential's inner loop
 * -- roughly 300ms against some nine hundred cases -- to build a driver that is
 * thrown away. So this is one class, compiled once into the runtime jar, and
 * the cases arrive as data.
 *
 * <p>Reflection is slow. That does not matter: this is a correctness harness and
 * not a benchmark, and every microsecond it spends is spent identically on
 * every case.
 *
 * <h2>The output format is not ours to choose</h2>
 *
 * <p>Every line must match what the C driver's {@code printf} produces, because
 * the runner compares the two lane's outputs as text against node's:
 *
 * <pre>
 *   name at 3ff0000000000000     the result's sixty-four bits, lowercase hex
 *   name at nan                  every NaN is one NaN, since the language
 *                                cannot observe a sign or a payload
 * </pre>
 *
 * <p>A refusal goes to stderr with the {@code nts: refused:} prefix and a
 * non-zero exit, because the runner reads that prefix to tell a case the
 * compiler correctly declined from a program that went wrong. A Java stack
 * trace without it counts as a defect.
 */
public final class Check {
    private Check() {}

    private static final String PROGRAM = "nts.gen.Program";

    public static void main(String[] argv) {
        if (argv.length < 1) {
            System.err.println("nts: refused: Check needs a cases file");
            System.exit(2);
        }
        long from = argv.length > 1 ? Long.parseLong(argv[1]) : 0L;
        try {
            run(argv[0], from);
        } catch (NtsRefusal refusal) {
            System.out.flush();
            System.err.println(refusal.getMessage());
            System.exit(1);
        } catch (Throwable failure) {
            System.out.flush();
            // Deliberately not the `nts:` prefix: anything reaching here is a
            // defect in the compiled program or in this harness, and the runner
            // must count it as one rather than as a declined case.
            failure.printStackTrace();
            System.exit(1);
        }
    }

    private static void run(String file, long from) throws Exception {
        Class<?> program = Class.forName(PROGRAM);
        // Module evaluation is itself a job, and what it queues is drained
        // after it rather than interleaved with the first case -- which is
        // what node's `await import()` does on the other side, and is what
        // makes the two comparable.
        try {
            program.getMethod("module$init").invoke(null);
        } catch (NoSuchMethodException absent) {
            // A program with nothing at module scope has no initializer.
        }

        List<String> lines = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            for (String line = reader.readLine(); line != null; line = reader.readLine()) {
                if (!line.isEmpty()) {
                    lines.add(line);
                }
            }
        }
        for (int index = 0; index < lines.size(); index++) {
            if (index < from) {
                continue;
            }
            one(program, lines.get(index));
        }
    }

    /** {@code name at returnDescriptor parameterDescriptors bits...} */
    private static void one(Class<?> program, String line) throws Exception {
        String[] parts = line.split(" ");
        String name = parts[0];
        int at = Integer.parseInt(parts[1]);
        String returns = parts[2];
        String parameters = parts[3].equals("-") ? "" : parts[3];

        Class<?>[] types = new Class<?>[parameters.length()];
        Object[] arguments = new Object[parameters.length()];
        for (int i = 0; i < parameters.length(); i++) {
            char descriptor = parameters.charAt(i);
            double value = Double.longBitsToDouble(Long.parseUnsignedLong(parts[4 + i], 16));
            types[i] = typeOf(descriptor);
            arguments[i] = coerce(descriptor, value);
        }

        Method method = program.getMethod(name, types);
        Object result = method.invoke(null, arguments);
        show(name, at, widen(returns, result));
    }

    private static Class<?> typeOf(char descriptor) {
        switch (descriptor) {
            case 'D': return double.class;
            case 'F': return float.class;
            case 'J': return long.class;
            case 'Z': return boolean.class;
            default: return int.class;
        }
    }

    /**
     * The pool is doubles whatever the parameter is, so a narrower slot takes
     * the same cast the C driver's argument list takes.
     */
    private static Object coerce(char descriptor, double value) {
        switch (descriptor) {
            case 'D': return value;
            case 'F': return (float) value;
            case 'J': return (long) value;
            case 'Z': return value != 0.0;
            default: return (int) value;
        }
    }

    private static double widen(String returns, Object result) {
        if (result == null) {
            return 0.0;
        }
        if (returns.equals("Z")) {
            return ((Boolean) result) ? 1.0 : 0.0;
        }
        return ((Number) result).doubleValue();
    }

    private static void show(String name, int at, double value) {
        if (Double.isNaN(value)) {
            System.out.println(name + " " + at + " nan");
        } else {
            System.out.println(
                name + " " + at + " " + String.format("%016x", Double.doubleToRawLongBits(value)));
        }
        System.out.flush();
    }
}
