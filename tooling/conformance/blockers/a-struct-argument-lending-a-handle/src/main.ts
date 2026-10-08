// expect: NTS1001 foreign function `event_new` passes `EventInit` by value, and its member `relatedTarget` is a counted handle
//
// A dictionary argument whose member is a handle -- MouseEventInit's
// `relatedTarget: EventTarget?`, UIEventInit's `view: Window?`, 21 such
// members across Blink's event dictionaries -- is refused at the declaration:
// "passes ... by value, and its member ... is a counted handle: a copy would
// be a second owner". The struct is lent for the call's duration, as a handle
// argument is, so the member could cross borrowed: neither retained into the
// copy nor released from it. Because the refusal is on the declaration, a
// generator binding the member would break every call of the constructor,
// with or without it; the Chromium lane leaves those members unbound
// (tooling/chromium/bindgen/generate.py, dictionary). Found 2026-10-08.
//
// Control, one difference -- `relatedTarget` left out of the struct type
// (`Struct<{ bubbles: CBool<c_uint8> }, "EventInit">`): nothing refused.
import { makeTarget, newEvent } from "nts:events";
export function go(): number {
  newEvent({ relatedTarget: makeTarget(), bubbles: true });
  return 0;
}
