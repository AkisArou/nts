/*
 * External. A closure the runtime can invoke without knowing its class.
 */
package nts.rt;

/**
 * A zero-argument callback, which is what a timer takes.
 *
 * <p>The C runtime reaches a callback through its descriptor and a dispatch
 * slot: {@code nts_callback_task} stores the object and the slot, and the task
 * calls through the table. This backend has no table -- it dispatches by name
 * and lets the JIT devirtualise through class-hierarchy analysis -- so the
 * equivalent is an interface, and the generated class declares it.
 *
 * <p>Which class declares it is decided structurally, in `object_class`: a
 * layout whose method in the closure slot is {@code ()V} implements this.
 * That is the same fact the slot carries, read from the descriptor rather than
 * from a list of names that would have to be kept in step with the lowering.
 *
 * <p>An interface rather than an abstract class because a closure already
 * extends the abstract class its function type became, and Android's API 24
 * floor rules out a default method -- so this declares one method and nothing
 * else, which needs no such feature.
 */
public interface NtsCallback {
    void call();
}
