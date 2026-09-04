package nts.rt;

/** A suspended frame, resumed on the runtime thread rather than an Executor. */
public interface NtsResumable {
    void resume();
}
