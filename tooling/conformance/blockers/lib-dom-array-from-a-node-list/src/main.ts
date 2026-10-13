// expect: an opaque C pointer converted to a different representation is not
//         supported by this lowering yet
//
// `Array.from(document.querySelectorAll("li"))` -- a lib.dom collection made
// an array, to map or filter it -- is refused. A collection is iterable in
// lib.dom (`for...of` over it is lowered: lib-dom-for-of-a-node-list), and
// Array.from is that iteration collected. Found 2026-10-13 by the Chromium
// lane, in a census of common lib.dom idioms.
//
// Control, one difference -- the same items collected by `for...of` into
// an array: nothing refused.
export function count(): number {
  return Array.from(document.querySelectorAll("li")).length;
}
