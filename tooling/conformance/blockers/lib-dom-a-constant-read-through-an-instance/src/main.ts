// expect: a property read through a native pointer is not supported by this
//         lowering yet
//
// A lib.dom constant read through an instance -- `node.ELEMENT_NODE`, which
// page script answers 1 as `Node.ELEMENT_NODE` does -- is refused: no member
// of the bound type answers it. lib.dom declares the constant as the unit
// literal `1` on the interface, so the read can be that literal, with no
// call. With lib-dom-a-constant-read-through-its-interface, which says how
// the literals can be held to Blink's. Found 2026-10-13 by the Chromium
// lane.
//
// Control (emit-c --rc), one difference -- the literal `1` in place of
// `node.ELEMENT_NODE`: nothing refused.
export function isElement(node: Node): boolean {
  return node.nodeType === node.ELEMENT_NODE;
}
