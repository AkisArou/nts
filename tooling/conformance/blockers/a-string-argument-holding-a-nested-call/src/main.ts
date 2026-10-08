// expect: emit-c --rc -> emits-c nts_dom_Document_createElement
//
// A binding's string argument whose expression holds a call --
// `createElement(tags[pick(1)])` -- refuses that inner call's number
// argument, as if it too were the string the binding's slot wants. Since
// 647b4ac0a (string arguments lowered as the slot wants); the Chromium
// lane's idl-vectors.ts `fuzz` compiled before it. Found 2026-10-08.
//
// Control (emit-c --rc), one difference -- the index computed first
// (`const k = pick(1); createElement(tags[k])`): nothing refused.
//
// **A guard since 2026-10-08** (MainClaude): a nested call to a program function no longer borrows the binding's string slot: `native_string_slot` answers only for the call `omitting_for` is set around.
import { document } from "nts:dom";

export function make(): void {
  const tags = ["div", "p"];
  const pick = (n: number): number => n - 1;
  document().createElement(tags[pick(1)]);
}
