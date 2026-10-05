// Recovering one store representation also requires each read to observe a
// store. Holes and out-of-range reads remain JavaScript undefined.
function plus(n: number): number { return n + 1; }

export function missing(n: number): number {
  const values: unknown[] = [plus];
  const value = values[n > 0 ? 0 : 1];
  return value === undefined ? 17 : typeof value === "function" ? 19 : 23;
}

export function hole(n: number): number {
  const values: unknown[] = new Array(2);
  values[0] = plus;
  return values[1] === undefined ? 29 : 31;
}

export function numberedHole(n: number): number {
  const values: unknown[] = new Array(2);
  values[0] = n;
  return values[1] === undefined ? 37 : 41;
}

export function conditionalStore(n: number): number {
  const values: unknown[] = new Array(2);
  if (n > 0) values[0] = n;
  return values[0] === undefined ? 43 : 47;
}

export function partialFill(n: number): number {
  const values: unknown[] = new Array(3);
  for (let i = 0; i < 2; i++) values[i] = n;
  return values[2] === undefined ? 53 : 59;
}

export function skippedFill(n: number): number {
  const values: unknown[] = new Array(4);
  for (let i = 0; i < 4; i += 2) values[i] = n;
  return values[1] === undefined ? 61 : 67;
}

export function interruptedFill(n: number): number {
  const values: unknown[] = new Array(4);
  for (let i = 0; i < 4; i++) {
    if (i === n) break;
    values[i] = n;
  }
  return values[3] === undefined ? 71 : 73;
}

export function readBeforeFill(n: number): number {
  const values: unknown[] = new Array(3);
  let total = 0;
  for (let i = 0; i < 3; i++) {
    total += values[i] === undefined ? 79 : 83;
    values[i] = n;
  }
  return total;
}

export function freshOnEachIteration(n: number): number {
  let total = 0;
  for (let i = 0; i < 3; i++) {
    const values: unknown[] = new Array(2);
    if (i === 0) values[1] = n;
    total += values[1] === undefined ? 89 : 97;
  }
  return total;
}

export function sameSlotControl(n: number): number {
  const values: unknown[] = new Array(4);
  const at = n > 0 ? 1 : 2;
  values[at] = n;
  const held = values[at];
  return typeof held === "number" ? held : 101;
}

export function completeFillControl(n: number): number {
  const values: unknown[] = new Array(4);
  for (let i = 0; i < 4; i++) values[i] = n + i;
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const held = values[i];
    if (typeof held === "number") total += held;
  }
  return total;
}

export function mixedLiteralControl(n: number): number {
  const values: unknown[] = [plus, n];
  const held = values[n > 0 ? 0 : 1];
  return typeof held === "function" ? 103 : typeof held === "number" ? 107 : 109;
}

// A module's `unknown[]`, whose length no bounds proof reaches: the read stays
// checked and answers `undefined` past the end (`bounds::answer_erased_reads`).
const held: unknown[] = [1, "two", 3];
export function globalPastTheEnd(n: number): number {
  const v = held[n > 0 ? 2 : 5];
  return v === undefined ? 89 : typeof v === "number" ? v : 97;
}
