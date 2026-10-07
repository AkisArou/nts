// expect: emit-c --rc -> emits-c nts_dom_request_animation_frame(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a call
// of a lib.dom.d.ts function the overlay binds (`declare function
// requestAnimationFrame`, `@ntsBoundBy "nts:dom" requestAnimationFrame`)
// lowers as the bound nts:dom function, at that function's parameters: the
// callback bridged at `Closure<(time: CNumber<"double">) => void>`, the id an
// `int32`.
//
// **Kept as a guard from the day it was written (2026-10-07)**: found by MainClaude
// while building the compiler half, as the one need the first six fixtures
// did not cover. Its `go` is the control's, byte for byte, but for the number
// of the anonymous `{ frames }` type.
//
// Control, one difference: the same program against the generated nts:dom
// module, which compiles today (emit-c --rc, clean):
//
//     import { cancelAnimationFrame, requestAnimationFrame } from "nts:dom";
//     export function go(): number {
//       const state = { frames: 0 };
//       const id = requestAnimationFrame((time: number) => { state.frames += time > 0 ? 1 : 0; });
//       cancelAnimationFrame(id);
//       return state.frames;
//     }

export function go(): number {
  const state = { frames: 0 };
  const id = requestAnimationFrame((time: number) => { state.frames += time > 0 ? 1 : 0; });
  cancelAnimationFrame(id);
  return state.frames;
}
