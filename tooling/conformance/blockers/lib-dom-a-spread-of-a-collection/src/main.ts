// expect: a copy of something that is not an array is not supported by this
//         lowering yet
//
// `[...element.children]` -- a lib.dom collection spread into an array -- is
// refused: the spread copies arrays only, and a collection is iterable
// (lib-dom-for-of-a-node-list), so the spread is that iteration collected,
// as with Array.from (lib-dom-array-from-a-node-list). Found 2026-10-13 by the
// Chromium lane, in a census of common lib.dom idioms.
//
// Control, one difference -- the same children collected by `for...of` into
// an array: nothing refused.
export function count(element: Element): number {
  return [...element.children].length;
}
