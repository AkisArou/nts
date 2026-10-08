// expect: emit-c --rc -> NTS1001 a number where a string is wanted
//
// A binding's string argument whose expression holds a call --
// `createElement(tags[pick(1)])` -- refuses that inner call's number
// argument, as if it too were the string the binding's slot wants. Since
// 647b4ac0a (string arguments lowered as the slot wants); the Chromium
// lane's idl-vectors.ts `fuzz` compiled before it. Found 2026-10-08.
//
// Control (emit-c --rc), one difference -- the index computed first
// (`const k = pick(1); createElement(tags[k])`): nothing refused.
import { document } from "nts:dom";

export function make(): void {
  const tags = ["div", "p"];
  const pick = (n: number): number => n - 1;
  document().createElement(tags[pick(1)]);
}
