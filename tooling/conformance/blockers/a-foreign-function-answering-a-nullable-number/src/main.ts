// expect: a type with no native ABI is not supported by this lowering yet
//
// A foreign function answering a nullable number is refused: a scalar
// result has a C type, and `null` has no value of it to spare. The DOM has
// such results -- `input.selectionStart` and `selectionEnd` (`unsigned
// long?`: null for an input type with no selection), `animation.
// overallProgress` (`double?`) -- so a text editor cannot read its caret.
// A string or a handle answers null as NULL; a number needs its presence
// carried beside it, e.g. a by-value `{ bool present; double value; }`,
// which the SysV ABI returns in two registers. Request 16 in
// runtime/chromium/contracts/compiler-requests.md. Found 2026-10-13 by the
// Chromium lane.
//
// Control, one difference -- `selection_start` declared returning `Float64`
// (types/host.d.ts): nothing refused.
import type { Int32 } from "@nts/scalars";
import { selection_start } from "host";

export function caret(input: Int32): number {
  const start = selection_start(input);
  return start === null ? -1 : start;
}
