// expect: a `CHandles` argument whose elements are not handles
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a
// lib.dom member a binding spells as several C functions is the one whose
// parameters fit the call. A WebIDL sequence argument crosses as a lent
// array (c:types `Counted<CStrings>`, `Counted<CHandles<H>>`), and where its
// element is a union -- Blob's `sequence<BlobPart>`, a string or a Blob among
// others -- the binding offers one overload per element kind (src/blob.d.ts):
// `nts_dom_new_Blob_b` for blobs, `nts_dom_new_Blob_s` for strings.
//
// The choice does not look at the array's elements: the first array overload
// is taken for any array, so `new Blob(["a,b\n", "c"])`, an array of strings,
// is given to the blobs' and refused there. Page script makes a two-part blob
// of four bytes.
//
// Found by the Chromium lane (2026-10-14) binding sequence arguments.
//
// Control, one difference -- an array of blobs -- emits
// `nts_dom_new_Blob_b(`:
//
//     const part = new Blob();
//     return new Blob([part, part]).size;

export function go(): number {
  return new Blob(["a,b\n", "c"]).size;
}
