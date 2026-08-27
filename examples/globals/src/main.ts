// State that outlives a call. A `const` with a constant initializer is not
// storage at all -- it resolves to its value at each use, which is what makes it
// free -- and a `let` is one location every function shares.

const SCALE = 10;
const OFFSET = -2.5;

let counter = 0;
let armed = false;

export function bump(by: number): number {
  counter = counter + by;
  return counter * SCALE + OFFSET;
}

export function readCounter(): number {
  return counter;
}

export function reset(): number {
  counter = 0;
  return counter;
}

export function toggle(): boolean {
  armed = !armed;
  return armed;
}

// A constant used in arithmetic reads as an immediate, so nothing is loaded.
export function scaled(x: number): number {
  return x * SCALE;
}
