package nts.rt;

import java.io.BufferedReader;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.PrintStream;
import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.Map;

/** Differential driver. Streams cases and caches invocation metadata, not results. */
public final class Check {
    private Check() {}
    private static final String PROGRAM = "nts.gen.Program";
    private static final char[] HEX = "0123456789abcdef".toCharArray();
    /**
     * Where result lines go, when the collector named a file.
     *
     * <p><b>A subject and its instrument must not share a channel.</b> Results
     * used to go to stdout beside whatever the program itself printed, and they
     * were told apart by <i>shape</i> -- a name, a case number, a value. As of
     * 2026-09-26 a compiled program can write stdout on purpose, so
     * {@code console.log("twice at 7")} is indistinguishable from a result: a
     * subject can duplicate, hide or invent its own cases, by accident, by
     * logging a label with a number in it. With a file only this class writes,
     * "every line is compared" holds by construction instead of by a pattern
     * continuing to hold.
     *
     * <p>A file rather than fd 3 because Java has no portable third descriptor
     * and neither does mingw, while a path works on every lane. Absent the
     * variable, results go to stdout exactly as before, so the old collector
     * still reads this harness.
     */
    private static PrintStream results;
    /** Cases answered in this run, for the {@code done} line. */
    private static long answered;
    private static final class Plan {
        final Method method;
        final String[] parameters;
        final Object[] arguments;
        Plan(Class<?> program, String name, String descriptors) throws NoSuchMethodException {
            parameters = descriptors.equals("-") ? new String[0] : descriptors.split(",");
            Class<?>[] types = new Class<?>[parameters.length];
            for (int i = 0; i < types.length; ++i) { types[i] = typeOf(parameters[i]); }
            method = program.getMethod(name, types);
            arguments = new Object[types.length];
        }
    }
    public static void main(String[] argv) {
        if (argv.length < 1) {
            System.err.println("nts: refused: Check needs a cases file"); System.exit(2);
        }
        long from = argv.length > 1 ? Long.parseLong(argv[1]) : 0L;
        String into = System.getenv("NTS_DIFF_RESULTS");
        if (into != null) {
            // Append, because the collector deletes the file before each spawn
            // and a run that restarts from a later case continues the same one.
            // **Refused rather than fallen back on**: writing results to stdout
            // when a file was asked for is the ambiguity this exists to remove,
            // and it would look like a pass.
            try { results = new PrintStream(new FileOutputStream(into, true), true, "UTF-8"); }
            catch (java.io.IOException unopened) {
                System.err.println("nts: refused: cannot write results to " + into);
                System.exit(2);
            }
        }
        try { run(argv[0], from); }
        catch (Throwable failure) {
            System.out.flush();
            Throwable cause = unwrap(failure);
            // A refusal is the program correctly declining its input and goes
            // out as its `nts:` line. Anything else is a defect and goes out as
            // a stack trace, which is what the differential looks for.
            if (cause instanceof NtsRefusal) { System.err.println(cause.getMessage()); }
            else { cause.printStackTrace(); }
            System.exit(1);
        }
    }
    /**
     * The throwable the program actually raised.
     *
     * <p>Every entry point here is called reflectively, so anything it throws
     * arrives wrapped in an {@code InvocationTargetException} whose own type
     * says nothing. A {@code catch (NtsRefusal)} arm beside the catch-all was
     * therefore unreachable, and every legitimate bounds refusal on this lane
     * went out as a stack trace rather than as its {@code nts:} line -- which
     * read as a crash to anything classifying the output.
     */
    private static Throwable unwrap(Throwable failure) {
        Throwable cause = failure;
        while (cause instanceof java.lang.reflect.InvocationTargetException
                && cause.getCause() != null) {
            cause = cause.getCause();
        }
        return cause;
    }
    private static void run(String file, long from) throws Exception {
        Class<?> program = Class.forName(PROGRAM);
        try { program.getMethod("module$init").invoke(null); }
        catch (NoSuchMethodException absent) { /* No module-scope initializer. */ }
        Map<String, Map<String, Plan>> plans = new HashMap<String, Map<String, Plan>>();
        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            long index = 0;
            for (String line = reader.readLine(); line != null; line = reader.readLine()) {
                if (line.isEmpty()) { continue; }
                if (index++ >= from) { one(program, plans, line); ++answered; }
            }
        }
        // **The marker, and it is what makes truncation visible.** A run that
        // aborts after three cases leaves a file with three good lines and
        // nothing saying it ended early -- which is exactly what a passing
        // three-case run looks like. So the collector requires this line and
        // treats a file without one as a crash. Written only on the path where
        // the loop completed: a throw goes to `main`'s catch and exits non-zero
        // without it, which is the whole point.
        if (results != null) { results.println("done " + answered); }
    }
    private static void one(Class<?> program, Map<String, Map<String, Plan>> plans, String line) throws Exception {
        String[] parts = line.split(" ");
        String name = parts[0], returns = parts[2], descriptors = parts[3];
        int at = Integer.parseInt(parts[1]);
        Map<String, Plan> overloads = plans.get(name);
        if (overloads == null) {
            overloads = new HashMap<String, Plan>(); plans.put(name, overloads);
        }
        Plan plan = overloads.get(descriptors);
        if (plan == null) { plan = new Plan(program, name, descriptors); overloads.put(descriptors, plan); }
        Object result;
        try {
            for (int i = 0; i < plan.parameters.length; ++i) { plan.arguments[i] = coerce(plan.parameters[i], parts[4 + i]); }
            result = plan.method.invoke(null, plan.arguments);
        } finally {
            // A cached plan must not retain the last case's reference arguments.
            java.util.Arrays.fill(plan.arguments, null);
        }
        if (result instanceof NtsPromise) { showSettled(name, at, (NtsPromise) result); }
        else if (returns.equals("Ljava/lang/String;")) { showString(name, at, (String) result); }
        else { show(name, at, widen(returns, result)); }
    }
    private static void showSettled(String name, int at, NtsPromise promise) {
        int budget = 1000000;
        while (!NtsPromise.isSettled(promise) && budget > 0) {
            if (!NtsEnv.step(NtsEnv.current())) { break; }
            --budget;
        }
        if (budget == 0) { say(name + " " + at + " starved"); return; }
        NtsValue value = NtsPromise.value(promise);
        if (!NtsPromise.isSettled(promise)) { say(name + " " + at + " pending"); }
        else if (NtsPromise.isRejected(promise)) { say(name + " " + at + " rejected"); }
        else if (value.tag == NtsValue.NUMBER) { show(name, at, value.num); }
        else if (value.tag == NtsValue.STRING) { showString(name, at, (String) value.ref); }
        else { say(name + " " + at + " undefined"); }
    }
    /** One result line, to the results file when there is one and stdout otherwise. */
    private static void say(String line) {
        if (results == null) { System.out.println(line); System.out.flush(); return; }
        results.println(line);
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
    private static Object coerce(String descriptor, String token) {
        if (descriptor.equals("Ljava/lang/String;")) {
            String units = token.substring(2);
            if (units.isEmpty()) { return ""; }
            String[] each = units.split(",");
            char[] made = new char[each.length];
            for (int i = 0; i < each.length; ++i) { made[i] = (char) Integer.parseInt(each[i], 16); }
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
    private static void showString(String name, int at, String value) {
        // An absent string is `null` here, which is what a `string | undefined`
        // return produces -- `String.prototype.at` past the end, for one.
        // Reading `.length()` threw, and the differential scores a throw as
        // *the program aborted* rather than as an answer, so every export that
        // could answer `undefined` was not merely unchecked but reported as a
        // failure of the compiled side.
        //
        // The same hole the C harness had, and the same spelling out of it:
        // `undefined` printed as itself. `docs/records` has the C half at
        // `7b742b3f`; this is the JVM twin, found the moment
        // `nts_str_relative_at` gave the backend something that legitimately
        // answers nothing.
        if (value == null) {
            say(name + " " + at + " undefined");
            return;
        }
        StringBuilder out = new StringBuilder();
        out.append(name).append(' ').append(at).append(" str ").append(value.length());
        for (int i = 0; i < value.length(); ++i) { out.append(',').append((int) value.charAt(i)); }
        say(out.toString());
    }
    private static double widen(String returns, Object result) {
        if (result == null) { return 0.0; }
        return returns.equals("Z") ? ((Boolean) result ? 1.0 : 0.0) : ((Number) result).doubleValue();
    }
    private static void show(String name, int at, double value) {
        StringBuilder out = new StringBuilder(name.length() + 30).append(name).append(' ').append(at).append(' ');
        if (Double.isNaN(value)) { out.append("nan"); }
        else {
            long bits = Double.doubleToRawLongBits(value);
            for (int shift = 60; shift >= 0; shift -= 4) { out.append(HEX[(int) (bits >>> shift) & 15]); }
        }
        say(out.toString());
    }
}
