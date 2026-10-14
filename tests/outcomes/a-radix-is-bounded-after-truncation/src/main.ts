// **`n.toString(radix)` bounded the radix as a number, where the
// specification bounds its truncation.** `ToIntegerOrInfinity(radix)` must be
// 2 to 36: `36.5` truncates to 36 and formats in base 36, `NaN` truncates to
// 0 and throws a `RangeError`, and `10.5` is base 10, which is `ToString(n)`.
// The lowering compared the number itself, so `36.5` threw, `NaN` passed the
// check and reached the runtime's `(int)` -- undefined behaviour in C -- and
// the runtime's base-10 shortcut tested `radix == 10.0`, so `10.5` took the
// digit loop instead. Found by the Wasm lane.
//
// **Control**: radix 16 and 2, which always agreed.
function radix(n: number, r: number): string {
  try {
    return n.toString(r);
  } catch (e) {
    return e instanceof RangeError ? "RangeError" : "other";
  }
}

observe("the control, base 16", radix(255, 16));
observe("the control, base 2", radix(5, 2));
observe("36.5 is base 36", radix(1295, 36.5));
observe("37 is past it", radix(1295, 37));
observe("1.9 truncates below 2", radix(5, 1.9));
observe("NaN is 0", radix(5, NaN));
observe("Infinity is past it", radix(5, Infinity));
observe("10.5 is base 10", radix(0.1, 10.5));
observe("2.9 is base 2", radix(5, 2.9));
done();
