function widen(value: unknown): unknown { return value; }
let widened = 0;
function counted(value: unknown): unknown { widened++; return value; }

// The Wasm lane's kernel: a number erased through an identity, tested, read back.
export function eraseNumbers(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const value = widen(i & 1023);
    if (typeof value === "number") total += value;
  }
  return total;
}

// The test the erasure decides the other way: its arm is reached by nothing.
export function decidedAway(n: number): number {
  const value = widen(n);
  if (typeof value === "string") return value.length;
  return 1;
}

// The control: the same kernel through a function that also does something.
export function eraseCounted(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const value = counted(i & 1023);
    if (typeof value === "number") total += value;
  }
  return total;
}

// Two callers, one through the identity: both pass a number, so it narrows.
function kindOf(value: unknown): number { return typeof value === "number" ? 1 : 0; }
export function kindThroughIdentity(n: number): number { return kindOf(n) + kindOf(widen(n)); }

// The control: through `counted`, whose result carries a tag chosen inside it.
function kindOfCounted(value: unknown): number { return typeof value === "number" ? 1 : 0; }
export function kindThroughCounted(n: number): number {
  return kindOfCounted(n) + kindOfCounted(counted(n));
}
