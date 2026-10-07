// expect: emit-c --rc -> emits-c nts_dom_new_Blob_0()
//
// `new Blob(["héllo"])` compiles to the zero-argument constructor and drops
// its argument: nts:dom binds only `newBlob()` (Blob's one-argument
// constructor takes a sequence of BlobParts, which the generator does not
// bind), and the delegation of `new` takes that overload although the call
// passes an argument it has no parameter for. The program then runs with an
// empty Blob: found 2026-10-08 by the Chromium lane, whose lib.dom vector
// `await new Blob(["héllo ", "wörld ✓"]).text()` answered "" in both backends
// where V8 answered the text. A `new` no bound constructor fits should be
// refused, as a delegated method call that fits no overload is.
//
// Fixed, this is refused and the expectation goes red: flip it to a guard
// that the refusal names Blob's constructor.
//
// Control, one difference -- `new Blob()`, which fits newBlob(): the same
// call, rightly (emit-c --rc, clean, nts_dom_new_Blob_0()).

export function go(): number {
  return new Blob(["héllo"]).size;
}
