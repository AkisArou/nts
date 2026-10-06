// expect: emit-c --rc -> emits-c nts_dom_Element_get_childElementCount(
//
// The guard reads the property access after the assertion: `go` reaches it
// only when it lowers. Under `emit-c --rc`, because a DOM handle is refused
// for another reason under the default provider ("a handle its host keeps
// alive", NTS2006), and `nothing refused` -- a `hir` phrase -- is not what
// `emit-c` prints.
//
// **FIXED the same day (2026-10-06), and kept as a guard.** The refusal is
// now asked only of a check that reads the value's tag (a primitive or class
// assertion); a non-null assertion compares the handle with NULL and raises
// the TypeError, as the record below says it should.
//
// The record of the defect follows unchanged.
//
//
// `asElement(node)!` -- a non-null assertion on a nullable host handle -- is
// refused since landing-1 (20eaa7d74): the assertion plans a null check and
// `assertions.rs` refuses any checked assertion whose value has no erased
// representation. A host handle has none, but a null check needs none: it is
// a pointer compared with NULL. The compiler before landing-1 compiled this.
// Found 2026-10-06 rebuilding the Chromium lane: four refusals, one per
// function, across the DOM vectors, rows and TodoMVC -- every
// `asHTMLInputElement(d.createElement("input"))!`. Every native lane writes
// `!` on a nullable handle.
//
// Control, one difference -- the null check written out:
//
//     const e = asElement(document());
//     if (e === null) return -1;
//
// compiles on both compilers.

import { asElement, document } from "nts:dom";
export function go(): number {
  const e = asElement(document())!;
  return e.childElementCount;
}
