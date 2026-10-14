// expect: a property read through a native pointer is not supported by this
//         lowering yet
//
// An indexed read of a lib.dom collection -- `element.children[0]`,
// `document.querySelectorAll("li")[i]`, the usual way DOM code takes one
// item -- is refused. lib.dom declares the index signature
// (`[index: number]: Element`) beside `item(index)`, and nts:dom binds
// `item`: the read is `item(i)`, except that page script answers `undefined`
// past the end where `item` answers null. Found 2026-10-13 by the Chromium
// lane, in a census of common lib.dom idioms.
//
// Control, one difference -- `element.children.item(0)`: nothing refused.
export function firstTag(element: Element): string {
  const first = element.children[0];
  return first === undefined ? "" : first.tagName;
}
