// expect: NTS1001 an argument `newBlob` has no parameter for
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
// **A guard since 2026-10-08** (MainClaude, `refuse_dropped_arguments`): an
// argument past the bound function's last parameter is refused, for a
// delegated `new`, method or global alike.
//
// Control, one difference -- `new Blob()`, which fits newBlob(): the same
// call, rightly (emit-c --rc, clean, nts_dom_new_Blob_0()).

export function go(): number {
  return new Blob(["héllo"]).size;
}
