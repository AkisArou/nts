// expect: nothing refused
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
// Int32 (types/host.d.ts): nothing refused.
//
// **A guard since 2026-10-08** (MainClaude): a retained
// `Closure<F>` comes back as the program's own closure, owned -- the host
// returns the context it was lent, retained, and NULL is `null`. Run under
// both providers by compiler/codegen/c/tests/native.rs
// `a_closure_lent_to_c_comes_back_as_the_same_callable_closure`.
import type { Int32 } from "@nts/scalars";
import { handler_get, handler_set } from "host";

export function setThenRead(target: Int32): void {
  handler_set(target, (event: Int32): void => {});
  handler_get(target);
}
