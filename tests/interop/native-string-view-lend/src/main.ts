// A string lent to C as a `StringView` must outlive the call that reads it.
// `holder.s` is lent straight out of its field, and C calls back into the
// program before it reads: the callback overwrites a field, then C allocates
// and reads the view. Run under reference counting and AddressSanitizer on
// both backends (build.sh).
//
// **A guard since 2026-10-19; it was a recorded use-after-free.** The load of
// `holder.s` was a borrow (`own::borrows_safely`) whose window ended at the
// view, the last operation that names it, so the call that reads through the
// view -- and runs the callback -- was outside it. `overwriteS` replaced the
// field, which released the only count, and C read the string after it was
// freed (heap-use-after-free in `nts_string_view`, on both backends). The
// borrow now counts a reader of a view of a value as a use of it, so the
// call is inside the window and the load takes a count of its own.
//
// Control, one difference -- the callback overwrites `holder.t`, not the
// field that was lent: it passes.
//
// **The other way a view could outlive its string has no fixture, because it
// cannot happen.** If an argument converted after a lend opened a block, the
// string's release could land at the end of the lend's block, before the
// call. But every lend is made in the native-argument conversion loop, after
// every argument is evaluated and immediately before the call, in the call's
// own block: a conditional argument, or a by-value record whose field is one,
// puts its blocks first, and the view, the call and the release follow in
// the block that joins them (measured 2026-10-19, prepared HIR under --rc).
import { visit } from "x:visit";
class Holder { s: string = ""; t: string = ""; }
const holder = new Holder();
function overwriteS(): void { holder.s = "o".repeat(40); }
function overwriteT(): void { holder.t = "o".repeat(40); }
export function subject(n: number): number {
  holder.s = "k".repeat(n) + "px";
  return visit(holder.s, overwriteS);
}
export function control(n: number): number {
  holder.s = "k".repeat(n) + "px";
  return visit(holder.s, overwriteT);
}
