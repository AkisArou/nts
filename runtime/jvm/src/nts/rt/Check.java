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

    /**
     * {@code name at returnDescriptor d1,d2,... arg...}
     *
     * <p>The descriptors are comma-separated because a descriptor is not one
     * character: {@code Ljava/lang/String;} is eighteen. An argument is sixteen
     * hex digits of the double's bits, or {@code s:} followed by comma-separated
     * hex UTF-16 code units for a string -- units rather than text so there are
     * no escaping rules and a surrogate pair arrives as the two units
     * {@code length} counts.
     */
    private static void one(Class<?> program, String line) throws Exception {
        String[] parts = line.split(" ");
        String name = parts[0];
        int at = Integer.parseInt(parts[1]);
        String returns = parts[2];
        String[] parameters = parts[3].equals("-") ? new String[0] : parts[3].split(",");

        Class<?>[] types = new Class<?>[parameters.length];
        Object[] arguments = new Object[parameters.length];
        for (int i = 0; i < parameters.length; i++) {
            types[i] = typeOf(parameters[i]);
            arguments[i] = coerce(parameters[i], parts[4 + i]);
        }

        Method method = program.getMethod(name, types);
        Object result = method.invoke(null, arguments);
        if (returns.equals("Ljava/lang/String;")) {
            showString(name, at, (String) result);
        } else {
            show(name, at, widen(returns, result));
        }
    }

    private static Class<?> typeOf(String descriptor) {
        switch (descriptor) {
            case "D": return double.class;
            case "F": return float.class;
            case "J": return long.class;
            case "Z": return boolean.class;
            case "Ljava/lang/String;": return String.class;
            default: return int.class;
        }
    }

    /**
     * The pool is doubles whatever the parameter is, so a narrower slot takes
     * the same cast the C driver's argument list takes -- except a string,
     * which the driver *builds* because the pool carries an index rather than
     * the text.
     */
    private static Object coerce(String descriptor, String token) {
        if (descriptor.equals("Ljava/lang/String;")) {
            String units = token.substring(2);
            if (units.isEmpty()) {
                return "";
            }
            String[] each = units.split(",");
            char[] made = new char[each.length];
            for (int i = 0; i < each.length; i++) {
                made[i] = (char) Integer.parseInt(each[i], 16);
            }
            return new String(made);
        }
        double value = Double.longBitsToDouble(Long.parseUnsignedLong(token, 16));
        switch (descriptor) {
            case "D": return value;
            case "F": return (float) value;
            case "J": return (long) value;
            case "Z": return value != 0.0;
            default: return (int) value;
        }
    }

    /**
     * A string, as its code units.
     *
     * <p>Byte-identical to what the C driver prints, because the runner
     * compares the two lanes' output as text: {@code name at str LEN,U0,U1}.
     * Printing the units beats printing the text -- it needs no escaping rules,
     * and a surrogate pair shows as the two units {@code length} counts rather
     * than as one character.
     */
    private static void showString(String name, int at, String value) {
        StringBuilder out = new StringBuilder();
        out.append(name).append(' ').append(at).append(" str ").append(value.length());
        for (int i = 0; i < value.length(); i++) {
            out.append(',').append((int) value.charAt(i));
        }
        System.out.println(out);
        System.out.flush();
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
