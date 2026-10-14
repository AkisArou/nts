// A union of numeric literals is the strongest thing TypeScript can say about a
// parameter. A parameter is otherwise unconstrained -- its callers are outside
// the function, and for an exported one, outside the program -- so this is the
// only way a parameter becomes provable without seeing a single call site.
export function weigh(mode: 0 | 1 | 2 | 3): number {
  return mode * 10;
}

// Narrower still: one literal is one value.
export function fixed(scale: 8): number {
  return scale * scale;
}

// Mixed with a plain `number`, nothing is provable -- the union is as wide as
// its widest member.
export function loose(mode: 0 | 1 | number): number {
  return mode * 10;
}

// An ordinary `number` says nothing, and must stay a double.
export function plain(n: number): number {
  return n * 10;
}

// Not yet: a module-level `const` has a literal type, but module state is not
// lowered, so `SCALE` cannot be read from a function body. When globals land,
// this becomes provable for free.
//
//   const SCALE = 8;
//   export function scaled(level: 1 | 2 | 4): number { return level * SCALE; }
