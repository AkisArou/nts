// A literal union is a declaration contract, not proof of an unchecked
// arrival. These exported parameters keep the number representation and must
// also compute correctly for values supplied outside that declaration.
export function weigh(mode: 0 | 1 | 2 | 3): number {
  return mode * 10;
}

// A singleton annotation likewise does not supply a value proof.
export function fixed(scale: 8): number {
  return scale * scale;
}

// Mixing literals with plain `number` does not narrow the representation.
export function loose(mode: 0 | 1 | number): number {
  return mode * 10;
}

// An ordinary `number` says nothing, and must stay a double.
export function plain(n: number): number {
  return n * 10;
}

// An actual immutable initializer or a proved caller may supply a value fact;
// an exported parameter's annotation alone may not.
