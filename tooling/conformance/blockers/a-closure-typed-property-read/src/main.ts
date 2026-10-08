// expect: emit-c --rc -> invalid HIR: CallResultType { func: "isUnset", callee: "nts_dom_HTMLElement_get_onclick"
//
// A property whose `@ntsGet` getter returns a Closure (request 14) -- an
// event handler attribute, `el.onclick` -- emits a call whose result type is
// not the getter's: invalid HIR, nothing emitted. The getter called as the
// method it is (`el._get_onclick()`) compiles, and is `===` the closure
// set. lib.dom's read (blockers/lib-dom-event-handler-read-back) goes
// through the same property. Found 2026-10-08 by the Chromium lane.
//
// Control (emit-c --rc), one difference -- `e._get_onclick()` for
// `e.onclick`: nothing refused.
import { asHTMLElement, document } from "nts:dom";

export function isUnset(): boolean {
  const e = asHTMLElement(document().createElement("div"))!;
  return e.onclick === null;
}
