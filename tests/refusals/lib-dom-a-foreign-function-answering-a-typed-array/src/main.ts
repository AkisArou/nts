// expect: a type with no native ABI is not supported by this lowering yet
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a
// member answering a typed array -- `matrix.toFloat64Array()`,
// `matrix.toFloat32Array()`, an ImageData's `data` -- would bind as a
// foreign function whose return is that typed array (src/matrix.d.ts),
// the adapter filling a fresh one from Blink's values as V8's binding
// fills one. A foreign return wants a scalar kind, a boolean, a string
// or void, so the answer is refused by name; there is no ABI for the
// adapter to hand the program a typed array it made. Found 2026-10-16 by
// the Chromium lane binding typed-array members.
//
// Control, one difference -- the same typed array as an argument,
// lent through `Counted<CElements<Float64Array>>` -- emits the call:
//
//     const m = DOMMatrix.fromFloat64Array(new Float64Array([2, 0, 0, 2, 10, 20]));
//     return m.e + m.a;

export function go(): number {
  const m = DOMMatrix.fromFloat64Array(new Float64Array([2, 0, 0, 2, 10, 20]));
  const out = m.toFloat64Array();
  return out[4] + out.length;
}
