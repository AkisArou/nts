// expect: NTS1001 foreign function `handler_get`'s return (which wants a c_int or c_double brand, a boolean, or a string, or void), a type with no native ABI
//
// A foreign function returning a Closure is refused: a closure goes to C
// (as a parameter, which the host retains) but never comes back. The DOM's
// event handler attributes need it -- `button.onclick` reads back the
// handler the program set with `button.onclick = ...`, as Blink keeps it --
// so every `on*` getter (406 members, 169 names) is unbound while the
// setters bind.
// The closure handed back is one the program made and lent, the same object;
// the host returns it retained. Request 14 in
// runtime/chromium/contracts/compiler-requests.md. Found 2026-10-08 by the
// Chromium lane (ledger row 11 waited on it without a fixture).
//
// Control, one difference -- `handler_get` declared returning
// CNumber<"int32"> (types/host.d.ts): nothing refused.
import type { CNumber } from "c:types";
import { handler_get, handler_set } from "host";

export function setThenRead(target: CNumber<"int32">): void {
  handler_set(target, (event: CNumber<"int32">): void => {});
  handler_get(target);
}
