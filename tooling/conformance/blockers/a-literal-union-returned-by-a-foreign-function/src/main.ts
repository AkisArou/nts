// expect: NTS1001 foreign function `canvas_fill_rule`'s return (which wants a c_int or c_double brand, a boolean, or a string, or void), a type with no native ABI is not supported by this lowering yet
//
// A union of string literals -- how lib.dom.d.ts spells every IDL enum
// (CanvasFillRule, DocumentReadyState, ScrollRestoration) -- crosses into a
// foreign function as a parameter (a C string) but not back out as its
// result, which is refused. So a binding can take `ctx.fill("evenodd")`
// typed, but must answer `ctx.textAlign` or `document.readyState` as a plain
// string, and a program cannot write `const rule: CanvasFillRule =
// fillRule()`. Found 2026-10-07 in the Chromium lane, binding Blink's IDL
// enums (runtime/chromium/contracts/workarounds.md, 21).
//
// Control, one difference -- the same union as the parameter:
//
//     setFillRule(rule === "nonzero" ? "evenodd" : "nonzero");
//
// with `rule` from a function answering `string`, compiles.

import { fillRule, setFillRule } from "nts:canvas";
import type { CanvasFillRule } from "nts:canvas";
export function go(): number {
  const rule: CanvasFillRule = fillRule();
  setFillRule(rule === "nonzero" ? "evenodd" : "nonzero");
  return rule === "evenodd" ? 1 : 0;
}
