// expect: a string method with this many arguments is not supported by this lowering yet
// B-d's typed JSON prototype tests literal keys at Scanner.at. The second
// startsWith argument is the only difference from the agreeing control.
export function work(n: number): number {
  const text = n < 0 ? "other" : "value";
  return text.startsWith("v", n & 1) ? 1 : 0;
}
