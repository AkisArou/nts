// run: check
// backend: llvm

// #209: a callback signature with three fixed arguments reaches a rest implementation.
// The control differs only in Callback's exposed signature.
type Callback = (n: number, left: number, right: number) => number;
function target(n: number, ...tail: number[]): number {
  const count = tail.length;
  return count * 1000 + n + tail[0] * 10 + tail[1] * 100;
}
const handlers = new Map<string, Callback>();
handlers.set("run", target);
export function through(n: number): number {
  const invoke = handlers.get("run");
  if (invoke === undefined) throw new Error("missing callback");
  return invoke(n, n + 1, n + 2);
}
