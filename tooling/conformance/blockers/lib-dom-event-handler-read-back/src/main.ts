// expect: emit-c --rc -> invalid HIR: CallResultType { func: "isUnset", callee: "nts_dom_HTMLElement_get_onclick"
//
// An event handler attribute read under lib.dom's types -- `el.onclick`,
// typed `((this: GlobalEventHandlers, ev: PointerEvent) => any) | null` --
// delegates to the bound getter (`_get_onclick`, a
// `Closure<(event: Event) => void> | null`, request 14) and emits a call
// whose result type is not the getter's: invalid HIR, nothing emitted. Read
// through nts:dom's own type the property emits the same invalid HIR
// (blockers/a-closure-typed-property-read; the method `_get_onclick()`
// compiles), so the two may be one cause. Next in the chain: a read that
// TypeScript narrows to `null` (after `el.onclick = null`) is refused, "a
// call result of unrepresentable type (null)". Found 2026-10-08 by the
// Chromium lane.
//
// Control (emit-c --rc), one difference -- the attribute written
// (`target.onclick = null; return true;`), not read: nothing refused.
export function isUnset(): boolean {
  const target = document.createElement("div");
  return target.onclick === null;
}
