// expect: emit-c --rc -> emits-c nts_dom_Path2D_roundRect_5_DOMPointInit(
//
// The control for `a-lib-dom-object-read-as-a-union-dictionary-arm`: the
// same call with the union's dictionary written as a literal, which the
// binding's DOMPointInit arm takes today. The one difference from its
// twin is where the dictionary's fields come from -- a literal here, an
// object's getters there -- so this holding while its twin refuses is
// the shape of the gap, not of the arm.
export function probe(path: Path2D): void {
  path.roundRect(0, 0, 100, 100, { x: 20, y: 20 });
}
