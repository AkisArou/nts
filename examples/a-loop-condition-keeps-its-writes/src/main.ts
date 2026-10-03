// A separate body counter bounds the old compiler's lost-condition-update
// defect so the differential produces a wrong answer instead of hanging.
// Returning count also observes the write in the final, false condition.
export function whilePostfix(n: number): number {
  let count = n & 7;
  let steps = 0;
  while (count++ < 9 && steps < 20) steps++;
  return steps * 100 + count;
}

export function whilePrefix(n: number): number {
  let count = n & 7;
  let steps = 0;
  while (++count < 9 && steps < 20) steps++;
  return steps * 100 + count;
}

export function whileDecrement(n: number): number {
  let count = n & 7;
  let steps = 0;
  while (count-- > 0 && steps < 20) steps++;
  return steps * 100 + count;
}

export function whileAssignment(n: number): number {
  let count = n & 7;
  let steps = 0;
  while ((count = count + 1) < 9 && steps < 20) steps++;
  return steps * 100 + count;
}

export function whileCompound(n: number): number {
  let count = n & 7;
  let steps = 0;
  while ((count += 1) < 9 && steps < 20) steps++;
  return steps * 100 + count;
}

export function shortCircuit(n: number): number {
  let count = 0;
  let steps = 0;
  const bound = n & 3;
  while (steps < bound && count++ < 9) steps++;
  return steps * 100 + count;
}

export function forPostfix(n: number): number {
  let count = n & 7;
  let steps = 0;
  for (; count++ < 9 && steps < 20; steps++) {}
  return steps * 100 + count;
}

export function forContinue(n: number): number {
  let count = n & 7;
  let steps = 0;
  for (; count++ < 9 && steps < 20; steps++) {
    if ((count & 1) === 0) continue;
  }
  return steps * 100 + count;
}

export function doContinue(n: number): number {
  let count = n & 7;
  let steps = 0;
  do {
    steps++;
    if ((steps & 1) === 0) continue;
  } while (count++ < 9 && steps < 20);
  return steps * 100 + count;
}

export function zeroIterations(n: number): number {
  let count = n & 7;
  while (count++ < 0) {}
  return count;
}
