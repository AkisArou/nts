// The module the closures in `main.ts` call into.

export function thrower(x: number): number {
  if (x > 1) throw new TypeError("big");
  return x;
}

// A function held in a value, imported: the alias names a `const`, not a body.
export const held = (x: number): number => {
  if (x > 1) throw new RangeError("held");
  return x;
};
