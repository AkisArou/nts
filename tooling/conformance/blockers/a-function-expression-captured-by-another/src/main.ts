// expect: `visit`, a `an anonymous type` captured by a closure that reads it as a `__function`
//
// A `function` expression held in a local and captured by another `function`
// expression, then called from it. Written as arrows, the same program compiles
// and agrees with node; the difference is the `function` keyword on both, which
// gives the local the checker's own `__function` type where the capture reads
// it. The refusal's tail says it is about a copy re-typing a parameter, but no
// copy is involved: nothing here is generic or structurally copied.
//
// Found writing `examples/a-function-that-reads-its-own-this`, where React's
// `Children.forEach` shape was first reduced to this one. It is not about
// `this` at all: no function here reads one, and on main before the receiver
// work it refused identically. It matters more now that a `function`
// expression is a closure wherever an arrow would be.

export function captured(n: number): string {
  const visit = function (by: number): string {
    return "v" + String(by);
  };
  const outer = function (by: number): string {
    return visit(by);
  };
  return outer(n & 3);
}
