// expect: emit-c --rc -> emits-c ->inline_;
//
// A native record's member named for a C reserved word -- lib.dom's
// `ScrollIntoViewOptions.inline`, which a program writes
// `{ block: "center", inline: "nearest" }` -- is spelled with a trailing `_`
// in the C the compiler writes (`symbols::native_member`), the rule
// `c_identifier` applies to a linkage name (`main` is `main_`), and the one a
// header generator binding the record follows: `struct Options { int block;
// int inline_; }`. A name that is no identifier at all stays refused.
//
// **Kept as a guard from the day it was written (2026-10-07)**, by MainClaude,
// asked by the Chromium lane binding Blink's scroll family: it was "native
// field `inline` is not a C member identifier".
//
// Control, one difference -- the member named `inline2`: nothing refused, and
// the C writes `->inline2`.
import { scroll } from "c:scroll";
import type { c_int } from "@nts/scalars";

export function go(): number {
  return scroll({ block: 1 as c_int, inline: 2 as c_int });
}
