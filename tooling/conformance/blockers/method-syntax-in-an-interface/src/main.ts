// expect: with a type that has no representation
//
// A member of an interface written in **method syntax**. 24 distinct named
// things across 7 modules, and the fourth-largest unfiled root.
//
// The sites are stream's shape interfaces -- `destroy` on
// `ClassicWritableLike`, `writev` and `writevSync` on `AsyncWriter`, `_read` on
// `Readable`, `_construct` on `DestroyableStream`.
//
// # The same declaration written the other way compiles
//
// This is the whole finding, and it took the matrix to see it:
//
//     interface Sink { read: (n: number) => void }    compiles
//     interface Sink { destroy?: (r: number) => void } compiles
//     interface Sink { read(n: number): void }        refuses
//     interface Sink { destroy?(r: number): void }    refuses
//     class Sink { read(n: number): void { … } }      compiles
//     interface Sink { size?: number }                compiles
//
// **A property whose type is a function type compiles. The same member in
// method syntax does not.** In TypeScript the two differ only in variance under
// `strictFunctionTypes`; they describe the same value and the same layout. And
// a class declaring the identical method compiles, so it is not method syntax
// as such -- it is method syntax *in an interface*.
//
// That matters for what a fix looks like. The message reads as a
// representation gap for function types, and the first row says there is no
// such gap: the representation exists and one spelling reaches it.
//
// It also matters for what a fix is *not*. Rewriting stream's interfaces from
// `destroy?(reason: number): void` to
// `destroy?: (reason: number) => void` would make 24 things compile and would
// be rewriting correct source to route around a refusal. The declarations are
// node's shape written the way node's own types write it. Hence a fixture.
//
// # A call cascades, so the refusal is on the declaration
//
//     interface Sink { read(n: number): void }
//     sink.read(1)      NTS1003 `f` cannot be compiled because it calls
//                       `Sink#read`, which was refused above
//
// The member is refused where it is declared, and every use of it is a cascade
// off that. So the count of 24 things is the count of declarations, and the
// cone off them is larger.

interface Sink {
  // Refuses. Written as `read: (n: number) => void` it compiles.
  read(n: number): void;
  // Refuses. Written as `destroy?: (reason: number) => void` it compiles.
  destroy?(reason: number): void;
}

export function describes(sink: Sink): boolean {
  return typeof sink.read === "function";
}
