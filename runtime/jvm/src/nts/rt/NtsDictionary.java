package nts.rt;

/**
 * An object used as a dictionary: `Record<string, T>`, an index signature,
 * `Object.create(null)`. A `Map`'s storage under a different type, and the
 * difference shows where `Object.prototype.toString` answers `"[object Object]"`
 * rather than `"[object Map]"`, and where `instanceof Map` answers false
 * (`hir::ManagedType::Table`). `runtime/c` tells them apart by descriptor,
 * `nts_desc_table`; here the class is the descriptor.
 */
public final class NtsDictionary extends NtsMap<Object, Object> {
}
