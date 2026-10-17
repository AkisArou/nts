// run: check
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
