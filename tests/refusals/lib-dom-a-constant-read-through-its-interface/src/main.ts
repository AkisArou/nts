// expect: `Node`, a name from an enclosing scope is not supported by this
//         lowering yet
//
// A lib.dom constant read through its interface object -- `node.nodeType ===
// Node.ELEMENT_NODE`, the usual way DOM code asks what a node is -- is
// refused: nothing binds `Node` as a value, and lowering then reads it as a
// captured name. lib.dom declares each IDL constant as a unit literal
// (`readonly ELEMENT_NODE: 1`), on the interface and on its `declare var`
// alike, so the read can be that literal, with no call; the Chromium lane's
// generator can hold every such literal to Blink's IDL constant at the pin
// (59 on the bound interfaces: bindgen/report-libdom.json, "absent:
// constant"). With lib-dom-a-constant-read-through-an-instance. Found
// 2026-10-13 by the Chromium lane.
//
// Control (emit-c --rc), one difference -- the literal `1` in place of
// `Node.ELEMENT_NODE`: nothing refused.
export function isElement(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE;
}
