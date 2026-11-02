// run: check
// backend: llvm

// #209: a callback signature with three fixed arguments reaches a rest implementation.
// The control differs only in Callback's exposed signature.
type Callback = (n: number, left: number, right: number) => number;
function target(n: number, ...tail: number[]): number {
  const count = tail.length;
  return count * 1000 + n + tail[0] * 10 + tail[1] * 100;
}
class Holder { handler: Callback = target; }
const holder = new Holder();
export function through(n: number): number {
  return holder.handler(n, n + 1, n + 2);
}
