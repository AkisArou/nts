// A guard now. Until d48bfb2d2, `emit-c` exited 0 and `cc` rejected the C: a
// `string` branch handed a `double` to `nts_concat`. `describe`'s one caller
// passes a number, so `unerase::narrow_parameters` specialised `value` to
// `double`, folded `typeof value === "number"` to true, and turned the unerase
// on the now-dead `string` arm into the identity. The guard added there is
// that an unerase must want the representation the callers agreed on, and
// `verify` knows `Concat` takes strings. The record holds the right answer, so
// a return to the miscompile reads as CHANGED. The control,
// a-typeof-narrowed-unknown-called-with-two-types, differs in one thing: a
// second caller passing a string.
//
// Found by the compiler lane probing `any` as erased (2026-09-29): an ordinary
// `unknown` narrowed by `typeof` and called from one place.
function describe(value: unknown): string {
  if (typeof value === "number") {
    return "n" + String(value);
  }
  if (typeof value === "string") {
    return "s" + value;
  }
  return "other";
}
observe("described", describe(7));
done();
