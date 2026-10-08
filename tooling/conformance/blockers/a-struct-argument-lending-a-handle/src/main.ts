// expect: emit-c --rc -> emits-c event_new(*
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
// **A guard since 2026-10-08** (MainClaude): a by-value argument lends a
// host's handle members for the call (`Direction::Lent`), as a host's handle
// argument is lent -- not retained into the copy, not released from it -- and
// the host's conservative stack scan finds it in the copy. A GObject, ObjC or
// COM member is still refused (blockers/a-struct-argument-with-a-gobject-member):
// reference counting would release an owned one at the store, before the call.
//
// Control, one difference -- `relatedTarget` left out of the struct type
// (`Struct<{ bubbles: CBool<c_uint8> }, "EventInit">`): nothing refused.
import { makeTarget, newEvent } from "nts:events";
export function go(): number {
  newEvent({ relatedTarget: makeTarget(), bubbles: true });
  return 0;
}
