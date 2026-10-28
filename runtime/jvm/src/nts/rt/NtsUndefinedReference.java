package nts.rt;

/** The internal reference niche for undefined; Java null remains defined null. */
public final class NtsUndefinedReference {
    private NtsUndefinedReference() {}
    public static final Object INSTANCE = new NtsUndefinedReference();
}
