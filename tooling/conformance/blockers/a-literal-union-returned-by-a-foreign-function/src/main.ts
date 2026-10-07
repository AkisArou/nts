// expect: emit-c --rc -> emits-c canvas_fill_rule();
//
// **FIXED 2026-10-07, and kept as a guard**: a union of string literals is
// answered as a non-nullable `const char *`, as the parameter side already
// took it. The guard is the call in `go`, which exists only when it lowers.
// The record follows unchanged.
//
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
