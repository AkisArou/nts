import { accept_name, enumerate_names, ATOM } from "c:resource-overload-probe";
import { pointerBits } from "c:memory";
import type { ConstPtr } from "c:types";
import type { BigInt64, Uint16, c_int } from "@nts/scalars";
export function atomCall(): number { return accept_name(ATOM); }
export function textCall(): number { return accept_name("A"); }
export function wideCall(): number { return accept_name("\u0394"); }
export function surrogateCall(): number { return accept_name(String.fromCharCode(0xD83D)); }
export function typeUtilityCall(): number {
  const text: Parameters<typeof accept_name>[0] = "B";
  return accept_name(text);
}
// A callback asks the bits before it reads (winuser.h's IS_INTRESOURCE), and
// copies any text while the pointer is still lent to it.
function describe(p: ConstPtr<Uint16>): string {
  if ((pointerBits(p) >> 16n) === 0n) return `#${Number(pointerBits(p) & 0xffffn)}`;
  let text = "";
  for (let i = 0; p[i] !== 0; i++) text += String.fromCharCode(p[i]);
  return text;
}
let seen = "";
function onName(type: ConstPtr<Uint16>, name: ConstPtr<Uint16>, language: Uint16, parameter: BigInt64): c_int {
  seen += `${describe(type)}/${describe(name)}@${language}:${parameter} `;
  return 1;
}
export function enumerated(): number {
  seen = "";
  const calls = enumerate_names(onName, 7n);
  // The lone surrogate is built, not written: a literal one is corrupted
  // before the compiler sees it (tests/refusals/a-lone-surrogate-in-a-string-literal).
  const wide = "\u0394" + String.fromCharCode(0xd83d);
  return seen === `#23/NTS_NAMED@1033:7 #0/#1@0:7 ${wide}/#65535@7:7 NTS_NAMED/#32512@1033:7 ` ? calls : -1;
}
