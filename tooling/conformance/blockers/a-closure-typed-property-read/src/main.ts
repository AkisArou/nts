// expect: emit-c --rc -> emits-c nts_dom_HTMLElement_get_onclick(
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
//
// **A guard since 2026-10-08** (MainClaude): the getter's result and the
// property spell one signature twice, and `canonicalize_objects` now gives a
// native call's own result the representative its value gets; the read is
// typed as the getter declares it, so both ids are seen.
import { asHTMLElement, document } from "nts:dom";

export function isUnset(): boolean {
  const e = asHTMLElement(document().createElement("div"))!;
  return e.onclick === null;
}
