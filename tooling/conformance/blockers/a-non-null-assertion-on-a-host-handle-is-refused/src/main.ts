// expect: emit-c --rc -> a checked assertion from a value with no erased representation
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
