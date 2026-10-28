// run: check
// TypeScript accepts method-parameter bivariance. The wider caller passes a
// string to the numerically declared method; preparation leaves an erased
// argument at a Float64 parameter and fails its CallArgumentType validator.
// Control: a-method-accepting-the-erased-argument changes only value's type.
let observed = 0;
const sink = {
  put(value: number): void { observed = typeof value === "string" ? 1 : 17; },
};
function inject(target: { put(value: unknown): void }): void { target.put("7"); }
export function work(n: number): number {
  observed = 0;
  inject(sink);
  return n + observed;
}
