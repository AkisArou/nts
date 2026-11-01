// run: check
//
// The control for a-call-through-a-shorthand-property-of-a-refused-function-
// crashes: the same program without the `ArrayLike<number>` overload, so
// `size` compiles, and a call through the shorthand `{ size }` agrees.
function size(value: number): number;
function size(value: string): number;
function size(value: number | string): number {
  if (typeof value === "number") return value;
  return value.length;
}
const api = { size };
export function direct(n: number): number {
  return size(n);
}
export function throughShorthand(n: number): number {
  return api.size(n);
}
