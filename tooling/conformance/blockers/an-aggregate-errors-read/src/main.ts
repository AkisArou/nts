// expect: `errors` on an `AggregateError`, which is stored erased
//
// `AggregateError` became a provided class on 2026-09-13. Its errors array is
// **stored and not readable**, and the asymmetry is deliberate.
//
// # Why the field is erased
//
// `new AggregateError([new Error("x")], "m")` passes an `Array(Object(Error))`.
// The field cannot have that type — one layout serves every `AggregateError` —
// and `Array(Erased)` is not a cast from it: an array of pointers is not an
// array of tagged values, so it is a per-element conversion, which nothing at a
// `field.set` is entitled to insert. The verifier said so directly:
//
//     StoreType { expected: Managed(Array(Erased)),
//                 found: Managed(Array(Managed(Object(TypeId(7))))) }
//
// Erasing the whole array is one `Erase`, which this compiler already has.
//
// # Why the read is refused rather than left alone
//
// Because of what the two backends did with it, which is the finding:
//
//     C       compiled, and agreed with node on every case
//     LLVM    clang rejected the module
//
//     %v87 = load { i32, i64 }, ptr %v87.at        <- the erased field
//     %v88.at = getelementptr i8, ptr %v87, i64 20 <- indexed as an array
//     error: '%v87' defined with type '{ i32, i64 }' but expected 'ptr'
//
// One backend refusing to compile is loud. The other answering **correctly, by
// coincidence** is the shape that survives to production — and it did not merely
// compile, it agreed with node on 203 cases, so every instrument except the one
// that could not build it reported the feature working.
//
// Before this class was provided the read was unreachable, so leaving it
// unrefused would have been a path introduced and left to clang.
//
// # What the write half buys, which is why the field exists
//
// Nothing in `runtime/node` reads `.errors` — zero sites, checked. Three sites
// **construct** one with it, `new NodeAggregateError([outer, inner], message,
// code)` among them. A constructor argument accepted and discarded is a wrong
// answer that runs, and it is exactly what `builtin::OMITTED` cannot express:
// that list names a member so that *reading* it says why it is absent, and says
// nothing about writing.
//
// # Two controls
//
//     constructing with an errors array   compiles, all three backends
//     `message` on the same object        compiles, and is the example's answer
//
// `examples/the-provided-error-classes` holds both, over three array lengths, so
// the store must not disturb the two fields beside it.
//
// # What closing it needs
//
// An element-wise conversion at one end or the other: erase each element on the
// way in so the field can be `Array(Erased)`, or a checked un-erase on the way
// out. Both are the same piece of work — the representation change this stores
// around — and neither has a site asking for it.

/** Under test. */
export function read(n: number): number {
  const a = new AggregateError([new Error("x"), new Error("yy")], "m");
  return a.errors.length + (n & 7);
}

/** The control: the same object, the field beside it. */
export function message(n: number): number {
  const a = new AggregateError([new Error("x"), new Error("yy")], "m");
  return a.message.length + (n & 7);
}
