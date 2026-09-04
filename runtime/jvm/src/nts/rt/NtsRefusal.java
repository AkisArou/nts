package nts.rt;

/** A runtime refusal, deliberately an Error and deliberately retaining its diagnostic stack. */
public final class NtsRefusal extends Error {
    private static final long serialVersionUID = 1L;
    public NtsRefusal(String detail) { super("nts: refused: " + detail); }
}
