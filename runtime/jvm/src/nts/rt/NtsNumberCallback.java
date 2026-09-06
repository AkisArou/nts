package nts.rt;

/**
 * A generated closure of shape `(n: number) => void`, reached by the interface
 * rather than by its class.
 *
 * <p>The class is `nts/gen/Closure7` or `nts/gen/Fn$3__1` and its name is a
 * function of how many closures the program happened to contain, so a runtime
 * that named it would break when an unrelated line moved. The interface is the
 * ABI; the hash class is an implementation detail of the emitter.
 *
 * <p>Attached by <em>descriptor</em> -- a layout whose dispatched `call` is
 * `(D)V` implements this, whatever the lowering called the function -- so the
 * relationship holds by construction rather than by a list that has to be
 * maintained alongside the lowering.
 */
public interface NtsNumberCallback {
    void call(double value);
}
