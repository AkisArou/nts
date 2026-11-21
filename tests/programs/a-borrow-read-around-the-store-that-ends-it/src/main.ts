// A borrowed read is good until the slot it came from lets go of it. Each
// `after` function reads what a slot holds and only then overwrites the slot,
// so its reads need no reference of their own; each `before` function is its
// control, the same function with the overwrite moved in front of the last
// read, where the overwrite frees what is still to be read unless the read
// holds a reference. The nodes are acyclic, so an overwrite frees at once.

class Node {
  value: number;
  next: Node | null = null;
  constructor(value: number) { this.value = value; }
}

function chain(value: number): Node {
  const head = new Node(value);
  const middle = new Node(value + 1);
  head.next = middle;
  middle.next = new Node(value + 2);
  return head;
}

function ring(n: number): Node[] {
  const nodes: Node[] = [];
  for (let i = 0; i < 4; i++) nodes.push(chain(((n | 0) & 7) * 10 + i * 100));
  return nodes;
}

function replace(nodes: Node[], slot: number, fresh: Node): void {
  nodes[slot] = fresh;
}

// Across the null checks a `!` makes, and the throws they guard.
export function afterBranches(n: number): number {
  const nodes = ring(n);
  const old = nodes[1];
  const sum = old.next!.value + old.next!.next!.value;
  nodes[1] = chain(7);
  return sum + nodes[1].value;
}

export function beforeBranches(n: number): number {
  const nodes = ring(n);
  const old = nodes[1];
  nodes[1] = chain(7);
  return old.next!.value + old.next!.next!.value + nodes[1].value;
}

// The overwrite is a call, which can store anywhere.
export function afterCall(n: number): number {
  const nodes = ring(n);
  const old = nodes[2];
  const sum = old.value + old.next!.value;
  replace(nodes, 2, chain(9));
  return sum;
}

export function beforeCall(n: number): number {
  const nodes = ring(n);
  const old = nodes[2];
  replace(nodes, 2, chain(9));
  return old.value + old.next!.value;
}

// An early return on one arm.
export function afterEarlyExit(n: number): number {
  const nodes = ring(n);
  const old = nodes[0];
  const next = old.next;
  if (next === null || (n | 0) < 0) return -1;
  const value = next.value + next.next!.value;
  old.next = null;
  return value;
}

export function beforeEarlyExit(n: number): number {
  const nodes = ring(n);
  const old = nodes[0];
  const next = old.next;
  if (next === null || (n | 0) < 0) return -1;
  old.next = null;
  return next.value + next.next!.value;
}

// Round a loop: each iteration's reads end before its slot is overwritten.
export function afterLoop(n: number): number {
  const nodes = ring(n);
  let total = 0;
  for (let i = 0; i < nodes.length; i++) {
    const old = nodes[i];
    total = total + old.next!.next!.value;
    nodes[i] = chain(i);
  }
  return total;
}

export function beforeLoop(n: number): number {
  const nodes = ring(n);
  let total = 0;
  for (let i = 0; i < nodes.length; i++) {
    const old = nodes[i];
    nodes[i] = chain(i);
    total = total + old.next!.next!.value;
  }
  return total;
}

// Carried round a loop by its parameter: read before the overwrite, or after.
export function afterCarried(n: number): number {
  const nodes = ring(n);
  let total = 0;
  let at = nodes[0];
  for (let i = 1; i < nodes.length; i++) {
    total = total + at.next!.value;
    nodes[i - 1] = chain(i);
    at = nodes[i];
  }
  return total + at.value;
}

export function beforeCarried(n: number): number {
  const nodes = ring(n);
  let total = 0;
  let at = nodes[0];
  for (let i = 1; i < nodes.length; i++) {
    nodes[i - 1] = chain(i);
    total = total + at.next!.value;
    at = nodes[i];
  }
  return total + at.value;
}

// The overwrite on the path that throws, and the read in its handler.
export function afterThrow(n: number): number {
  const nodes = ring(n);
  const old = nodes[3];
  const value = old.next!.value;
  try {
    nodes[3] = chain(5);
    if ((n | 0) >= 0) throw new Error("replaced");
    return 0;
  } catch {
    return value + nodes[3].value;
  }
}

export function beforeThrow(n: number): number {
  const nodes = ring(n);
  const old = nodes[3];
  try {
    nodes[3] = chain(5);
    if ((n | 0) >= 0) throw new Error("replaced");
    return 0;
  } catch {
    return old.next!.value + nodes[3].value;
  }
}
