// One-change control for a-prebound-optional-undefined-is-stored-as-an-array:
// the pre-bound argument is "abc" instead of undefined. Both pins agree with
// node on all 29 cases on C, LLVM, JVM and Wasm.
function text(x?: string): number { return x === undefined ? 7 : x.length; }
export function control(n: number): number {
  const f = text.bind(undefined, "abc");
  return f();
}
