// backend: jvm
// run: check
// Native numeric arguments isolate the radix helper from erased ToNumber.
// ToIntegerOrInfinity makes radix 2.5 exactly 2; the control differs only in
// supplying that integer directly.
export function fractional(n: number): string {
  return (255 + (n & 3)).toString(2.5);
}
export function integerControl(n: number): string {
  return (255 + (n & 3)).toString(2);
}
