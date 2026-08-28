// A pattern is the reads it stands for: a field per name for an object, an
// element per position for an array. The initializer is lowered *once*, which
// is what the pattern means -- `const { a, b } = f()` calls `f` a single time.

interface Point {
  x: number;
  y: number;
}

let calls = 0;

function origin(n: number): Point {
  calls = calls + 1;
  return { x: n, y: n * 3 };
}

// Positions have to be distinguishable, or a lowering that read index 0 twice
// would agree with node by accident.
export function byPosition(n: number): number {
  const xs: number[] = [n, n * 7, n * 13];
  const [first, second] = xs;
  return first * 1000 + second;
}

export function byName(n: number): number {
  const p: Point = { x: n, y: n * 7 };
  const { x, y } = p;
  return x * 1000 + y;
}

// The property and the new name differ, and so do the values, so swapping them
// changes the answer.
export function renaming(n: number): number {
  const p: Point = { x: n, y: n * 7 };
  const { x: second, y: first } = p;
  return first * 1000 + second;
}

// `calls` counts, so an initializer lowered twice is visible rather than
// merely wasteful.
export function evaluatesItsInitializerOnce(n: number): number {
  calls = 0;
  const { x, y } = origin(n);
  return calls * 1000000 + x * 1000 + y;
}

// A pattern where a name would go. One parameter, one value, several names.
function distance({ x, y }: Point): number {
  return x * x + y * y;
}

export function throughAParameter(n: number): number {
  return distance({ x: n, y: n + 1 });
}

// A pattern in a loop body, rebound on every iteration.
export function inALoop(n: number): number {
  const xs: number[] = [n, n + 1, n + 2, n + 3];
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const [a, b] = xs;
    total = total + a + b + i;
  }
  return total;
}
