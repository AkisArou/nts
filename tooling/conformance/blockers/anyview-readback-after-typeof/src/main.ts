// expect: NTS1001 an `unknown` narrowed to Managed(AnyView), which it cannot be read back as
//
// A value narrowed to `AnyView` by **excluding the other arm of a union with
// `typeof`** cannot be read back. Every other way of arriving at the same value
// can be, and the three functions above the subject are those ways.
//
//     buf instanceof Uint8Array   -> lowers   (closed in ac27dac4)
//     buf === undefined           -> lowers
//     buf: ArrayBufferView        -> lowers   (the representation itself)
//     typeof buf === "string"     -> REFUSED
//
// **The three controls are the content of this fixture.** Without them the
// diagnostic reads as "AnyView cannot be read back", which is false and would
// have sent the compiler lane at the representation rather than at one
// narrowing. `AnyView` works; `plainParameter` lowers to
// `(buf: managed<anyview>) -> f64` and reads `.byteLength` off it. What fails is
// arriving at it by elimination.
//
// The `instanceof` control is worth keeping specifically because it *was* the
// same defect from the other side and was fixed in the commit this is measured
// against. If it ever refuses again, this fixture has stopped being about
// `typeof` and the readback is broken generally.
//
// **Where it came from.** `arraybufferview-parameter` filed three cases: a
// plain parameter, an optional one, and a union. `AnyView` fixed the first two
// and that fixture went `CHANGED` -- still reproducing, on a different defect
// than the one it is named for. A fixture holding on a diagnostic it was not
// written for is the failure this directory spent a day on, so the union case
// moved here and the other two stayed as a guard.
//
// It cost `string_decoder` nothing: its `write` narrows with `typeof` and does
// not read a property off the view in that branch, so this is not on the
// critical path to a green module. It is on `arraybufferview-parameter`'s path
// to being retired.
export function narrowsByInstanceof(buf: ArrayBufferView | string): number {
  if (buf instanceof Uint8Array) {
    return buf.byteLength;
  }
  return 0;
}

export function narrowsByUndefined(buf?: ArrayBufferView): number {
  if (buf === undefined) {
    return 0;
  }
  return buf.byteLength;
}

export function plainParameter(buf: ArrayBufferView): number {
  return buf.byteLength;
}

export function narrowsByTypeof(buf: ArrayBufferView | string): number {
  if (typeof buf === "string") {
    return buf.length;
  }
  return buf.byteLength;
}
