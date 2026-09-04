package nts.rt;

import java.io.BufferedReader;
import java.io.FileReader;
import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.Map;

/** Differential driver. Streams cases and caches invocation metadata, not results. */
public final class Check {
    private Check() {}
    private static final String PROGRAM = "nts.gen.Program";
    private static final char[] HEX = "0123456789abcdef".toCharArray();
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
        try { run(argv[0], from); }
        catch (NtsRefusal refusal) {
            System.out.flush(); System.err.println(refusal.getMessage()); System.exit(1);
        } catch (Throwable failure) {
            System.out.flush(); failure.printStackTrace(); System.exit(1);
        }
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
                if (index++ >= from) { one(program, plans, line); }
            }
        }
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
            if (!NtsLoop.step()) { break; }
            --budget;
        }
        if (budget == 0) { System.out.println(name + " " + at + " starved"); return; }
        NtsValue value = NtsPromise.value(promise);
        if (!NtsPromise.isSettled(promise)) { System.out.println(name + " " + at + " pending"); }
        else if (NtsPromise.isRejected(promise)) { System.out.println(name + " " + at + " rejected"); }
        else if (value.tag == NtsValue.NUMBER) { show(name, at, value.num); }
        else if (value.tag == NtsValue.STRING) { showString(name, at, (String) value.ref); }
        else { System.out.println(name + " " + at + " undefined"); }
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
        StringBuilder out = new StringBuilder();
        out.append(name).append(' ').append(at).append(" str ").append(value.length());
        for (int i = 0; i < value.length(); ++i) { out.append(',').append((int) value.charAt(i)); }
        System.out.println(out); System.out.flush();
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
        System.out.println(out); System.out.flush();
    }
}
