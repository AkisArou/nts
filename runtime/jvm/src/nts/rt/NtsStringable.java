package nts.rt;

/**
 * A generated class that declares its own {@code toString}.
 *
 * <p>Empty, and it exists for one question: `String(v)` on an erased object has
 * to call the object's `toString` where it has one and answer
 * `"[object Object]"` where it does not. `runtime/c` asks
 * `descriptor->methods[nts_to_string_slot]` and reads a null entry as "none
 * declared" -- the null and the answer are the same fact there.
 *
 * <p>**That question cannot be asked of a class here, because every class
 * already answers it.** `java.lang.Object` provides a `toString`, so
 * `ref.toString()` on a generated class that declares none gives
 * `nts.gen.Thing@1b6d3586` rather than `"[object Object]"`. An inherited default
 * and an absent entry are not the same fact, which is the one place this lane's
 * representation is *richer* than the descriptor and therefore worse at
 * answering.
 *
 * <p>So the nominal fact goes where `instanceof` can read it, which is what
 * {@link NtsTuple} does for `Array.isArray` and for the same reason. A layout
 * whose dispatch table names a `toString` returning a string implements this;
 * nothing else does.
 */
public interface NtsStringable {
}
