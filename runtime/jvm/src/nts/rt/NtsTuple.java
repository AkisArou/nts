package nts.rt;

/**
 * A generated class that a heterogeneous tuple was laid out as.
 *
 * <p>Empty, and it exists for one question: `Array.isArray` must answer `true`
 * for a tuple. A tuple is laid out as a struct here -- `[number, string]` has
 * fields of different types and cannot be a JVM array -- and the language calls
 * it an Array anyway.
 *
 * <p>`runtime/c` answers this from the descriptor's kind, `NTS_KIND_TUPLE`.
 * There is no descriptor on this lane: RFC §13 puts these objects in the
 * platform collector's heap, so nothing carries a kind at run time and the
 * question has to be asked of the *class*. A marker interface is the JVM's way
 * of putting a nominal fact where `instanceof` can read it.
 *
 * <p>That difference matters more here than there, and in a way worth writing
 * down. If a tuple layout merged with a non-tuple of the same shape, the C lane
 * would give one descriptor the wrong kind -- a wrong field in a struct that
 * still exists. On this lane the two layouts become **one class**, and there is
 * no field left to be wrong: the answer is baked into class identity, where no
 * test of a descriptor could see it. `hir::lower` keeps them apart with a
 * one-directional check on the layout name, and two tuples of the same shape
 * still merge, which they must.
 */
public interface NtsTuple {
}
