// `push` and `unshift` with several arguments evaluate every argument before
// the first insert, and `unshift` keeps its run's order at the front:
// `[9].unshift(1, 2)` is `1,2,9`, and `a.push(a.length, a.length)` appends the
// length twice. Lowered one argument at a time, the second read saw the first
// insert and the run went in reversed -- 86 of 116 cases wrong on C, LLVM, the
// JVM and RC before the fix. Found by the review of the Wasm lane's slice 1e.
export function unshiftTwo(n: number): string {
  const a = [9];
  a.unshift(n, n + 1);
  return a.join(",");
}
export function unshiftLength(n: number): string {
  const a = [n];
  a.unshift(a.length, a.length);
  return a.join(",");
}
export function pushLength(n: number): string {
  const a = [n];
  a.push(a.length, a.length);
  return a.join(",");
}
export function pushItself(n: number): string {
  const a = [n, n + 1];
  a.push(a.length, ...a);
  return a.join(",");
}
// The control: one argument, which never depended on the order.
export function unshiftOne(n: number): string {
  const a = [9];
  a.unshift(n);
  return a.join(",");
}
