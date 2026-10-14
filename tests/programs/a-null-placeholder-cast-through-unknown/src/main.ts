// A placeholder `null as unknown as T`, assigned before it is read, is `null`
// and nothing else. React keeps the fiber it renders in
// `let currentlyRenderingFiber: Fiber = null as unknown as Fiber;`
// (ReactFiberHooks.ts:306), Flow's `(null: any)` written in TypeScript.
//
// An `as` checks only what the representation needs (docs/scalar-numbers.md,
// D4), and a reference holds its absence as the null pointer. From e6d7961f2,
// which made a lone `null` erase as `null`, the cast instead checked presence
// and threw at module init, so every native React program ended before its
// first line. Reported by the React lane as an outcome, bisected, and fixed.

class Placeholder {
  readonly name: string = "root";
}

// At module scope, as React writes it: module initialisation runs the cast.
let current: Placeholder = null as unknown as Placeholder;
let label: string = null as unknown as string;

export function render(n: number): number {
  current = new Placeholder();
  label = "fiber";
  return current.name.length * 10 + label.length + n;
}

// In a function, as a local: the cast is evaluated on every call.
export function local(n: number): number {
  let placeholder: Placeholder = null as unknown as Placeholder;
  placeholder = new Placeholder();
  return placeholder.name.length + n;
}
