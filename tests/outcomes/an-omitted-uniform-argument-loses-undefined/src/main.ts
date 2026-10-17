// run: check
// Main's unchecked entry compares 58/2 on each backend with 29 wrong answers:
// an omitted required number is observed as a number instead of undefined.
// Checked entries stop by name on the subject; the supplied control remains
// 29/29 on all four backends. This is the Step 1 representation floor, pending
// the separately reviewed erased-body semantics.
// The control supplies the argument to the same uniform callback. The open
// entry keeps the call indirect instead of specializing it to Closure0#call.
export function invoke(callback: (x?: any) => any, omit: boolean, n: number): string {
  return typeof (omit ? callback() : callback(n));
}
function through(omit: boolean, n: number): string {
  const callback = (x: number): number => x;
  return invoke(callback, omit, n);
}
export function subject(n: number): string { return through(true, n); }
export function control(n: number): string { return through(false, n); }
