package nts.rt;

/** Cooked strings of one source site; the program caches its single instance. */
public final class NtsTemplate {
    private final String[] cooked;

    private NtsTemplate(String[] cooked) { this.cooked = cooked.clone(); }

    /** Copy at construction so the caller cannot mutate the template through an alias. */
    public static NtsTemplate of(String[] cooked) { return new NtsTemplate(cooked); }
    public static int count(NtsTemplate template) { return template.cooked.length; }
    public static String get(NtsTemplate template, int index) {
        if (index >= 0 && index < template.cooked.length) return template.cooked[index];
        NtsRuntime.outOfRange(index, template.cooked.length);
        return null;
    }
    public static String get(NtsTemplate template, double index) {
        int at = (int) index;
        if ((double) at == index) return get(template, at);
        NtsRuntime.outOfRange(index, template.cooked.length);
        return null;
    }
}
