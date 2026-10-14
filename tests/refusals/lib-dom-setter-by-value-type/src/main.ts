// expect: emit-c --rc -> emits-c nts_dom_CanvasRenderingContext2D_set_fillStyle_gradient(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a
// property lib.dom types wider than its bound setter takes --
// `fillStyle: string | CanvasGradient | CanvasPattern`, whose `@ntsSet` is
// `_set_fillStyle_string(StringView)` -- is written through the setter whose
// parameter the value fits: a gradient through `_set_fillStyle_gradient`, a
// string through the property's own.
//
// **Kept as a guard from the day it was found (2026-10-07)**, by MainClaude
// probing the syntax table's rows: the property's own setter was taken
// whatever the value, and the gradient's handle was lent as the string --
// `(const struct NtsBorrowedString *)gradient`, which compiled. The string role
// refuses a value that is not a string since (`lend_string_argument`).
//
// Control, one difference: the same function against the generated nts:dom
// module, calling the setters by name (emit-c --rc, clean). The context is a
// parameter in both, so the control reaches it with nothing between: narrowed
// by `instanceof HTMLCanvasElement` in a program with the DOM lib, a canvas is
// lib.dom's, whose `getContext` answers lib.dom's context, not nts:dom's.
//
//     import type { CanvasRenderingContext2D } from "nts:dom";
//     export function paint(ctx: CanvasRenderingContext2D): number {
//       ctx._set_fillStyle_gradient(ctx.createLinearGradient(0, 0, 1, 1));
//       ctx._set_fillStyle_string("red");
//       return 0;
//     }

export function paint(ctx: CanvasRenderingContext2D): number {
  ctx.fillStyle = ctx.createLinearGradient(0, 0, 1, 1);
  ctx.fillStyle = "red";
  return 0;
}
