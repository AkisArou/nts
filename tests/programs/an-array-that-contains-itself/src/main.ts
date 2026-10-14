// An `unknown[]` that holds itself: a reference cycle through an array of
// erased values.
//
// Under reference counting a cycle is freed by the cycle collector, which
// considers an object only where its descriptor says it could be in one
// (`NtsDescriptor.cyclic`). An array of erased values said it could not, so
// every such array leaked two objects -- under `NTS_RC=1` the differential
// counts them -- though the collector already walked its elements. An erased
// element can be any object, the array itself included.
//
// Printed too: an array met again inside itself prints as empty, as node's
// join does, rather than recursing until the stack runs out.

export function holdsItself(n: number): number {
  const xs: unknown[] = [n & 3];
  xs.push(xs);
  return xs.length;
}

export function printsItselfAsEmpty(n: number): string {
  const xs: unknown[] = [n & 3];
  xs.push(xs);
  xs.push("end");
  return String(xs);
}

export function twoArraysHoldingEachOther(n: number): number {
  const a: unknown[] = [n & 3];
  const b: unknown[] = [a];
  a.push(b);
  return a.length + b.length;
}
