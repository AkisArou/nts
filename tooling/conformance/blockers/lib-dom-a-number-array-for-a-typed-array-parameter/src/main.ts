// expect: emit-c --rc -> emits-c nts_view_bytes(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a call
// is typechecked against lib.dom's signature and lowered to the binding's,
// so the argument's type is lib.dom's, not the binding's. A WebIDL sequence
// of numbers can cross as a lent `Counted<CElements<Float64Array>>`, C's
// `const double *` beside its count (src/dash.d.ts: the canvas's
// `setLineDash(sequence<unrestricted double>)`), and lib.dom lets the call
// give a `number[]` there as well as a Float64Array (dom.iterable's
// `Iterable<number>`).
//
// The `number[]` is lent through `nts_view_bytes` as though it were a typed
// array: its NtsArray is read as an NtsView, whose buffer pointer is not
// there -- a type confusion. A `number[]` keeps its elements as doubles in
// its own block (`NTS_ITEMS(array, double)`), which is what C wants.
//
// Found by the Chromium lane (2026-10-14) binding sequence arguments.
//
// Control, one difference -- a Float64Array -- emits the same call, and
// rightly:
//
//     ctx.setLineDash(new Float64Array([5, 3]));

export function go(ctx: CanvasRenderingContext2D): number {
  ctx.setLineDash([5, 3]);
  return 0;
}
