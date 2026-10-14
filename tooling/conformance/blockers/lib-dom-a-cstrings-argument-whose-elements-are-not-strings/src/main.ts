// expect: emit-c --rc -> emits-c nts_strings_to_cstrings(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a call
// is typechecked against lib.dom's signature and lowered to the binding's,
// so the argument's type is lib.dom's, not the binding's. A WebIDL sequence
// of strings crosses as a lent `Counted<CStrings>` (src/blob.d.ts: Blob's
// `sequence<BlobPart>`, bound for its string parts), and lib.dom lets the
// call give a Blob[] there.
//
// The array is converted by `nts_strings_to_cstrings` whatever its elements
// are (lower.rs `lend_strings`), so the blobs' handles are read as strings: a
// type confusion, where `lend_handles` refuses an array whose elements are not
// handles. Page script makes a blob of the parts' bytes.
//
// Found by the Chromium lane (2026-10-14) binding sequence arguments.
//
// Control, one difference -- an array of strings -- emits the same call, and
// rightly:
//
//     return new Blob(["a", "b"]).size;

export function go(): number {
  const part = new Blob();
  return new Blob([part, part]).size;
}
