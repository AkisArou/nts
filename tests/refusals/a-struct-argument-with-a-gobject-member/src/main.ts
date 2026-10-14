// expect: NTS1001 foreign function `gevent_new` passes `EventInit` by value, and its member `relatedTarget` is a counted handle
//
// The other side of blockers/a-struct-argument-lending-a-handle: a by-value
// argument lends a *host's* handle member for the call, and refuses any other
// counted family. A GObject is counted by reference, and an owned one would be
// released at its last use -- the store into the copy -- before the call read
// it; lending one needs the store to keep it alive to the call, which nothing
// here does yet.
//
// **A guard from the day it was written (2026-10-08)**, by MainClaude.
import { makeTarget, newEvent } from "nts:gevents";
export function go(): number {
  newEvent({ relatedTarget: makeTarget(), bubbles: true });
  return 0;
}
