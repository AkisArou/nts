// expect: a field address without a native struct layout is not supported
//         by this lowering yet
//
// An optional property read through a nullable lib.dom handle --
// `document.activeElement?.tagName`, `document.body?.id`, `el?.textContent`
// -- is refused, while the optional call (`document.querySelector(s)
// ?.setAttribute(...)`) and the same read after narrowing both compile: the
// chain reads the property as a struct field where the binding's getter is
// the read. Found 2026-10-13 by the Chromium lane, in a census of common
// lib.dom idioms.
//
// Control, one difference -- the handle narrowed first
// (`const a = document.activeElement; a === null ? "" : a.tagName`):
// nothing refused.
export function focusedTag(): string {
  return document.activeElement?.tagName ?? "";
}
