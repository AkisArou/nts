// Actual closed writers prove int32 payloads; the annotation alone does not.
export function closedAdd(n: number): number {
  const values = new Map<string, number>();
  values.set("key", n | 0);
  let total = n | 0;
  for (let i = 0; i < 8; i++) total = (total + (values.get("key") ?? 0)) | 0;
  return total;
}

export function closedSubtract(n: number): number {
  const values = new Map<string, number>();
  values.set("key", n | 0);
  let total = 2147483647;
  for (let i = 0; i < 8; i++) total = (total - (values.get("key") ?? 0)) | 0;
  return total;
}

// One difference: this writer has no whole/range proof.
export function fractionalWriter(n: number): number {
  const values = new Map<string, number>();
  values.set("key", n + 0.5);
  let total = n | 0;
  for (let i = 0; i < 8; i++) total = (total + (values.get("key") ?? 0)) | 0;
  return total;
}

export function unsignedWriter(n: number): number {
  const values = new Map<string, number>();
  values.set("key", n >>> 0);
  let total = n | 0;
  for (let i = 0; i < 8; i++) total = (total + (values.get("key") ?? 0)) | 0;
  return total;
}

export function nonfiniteWriter(n: number): number {
  const values = new Map<string, number>();
  values.set("key", (n | 0) & 1 ? NaN : Infinity);
  let total = n | 0;
  for (let i = 0; i < 8; i++) total = (total + (values.get("key") ?? 0)) | 0;
  return total;
}

export function absentRead(n: number): number {
  const values = new Map<string, number>();
  values.set("key", n | 0);
  let total = n | 0;
  for (let i = 0; i < 8; i++) total = (total + Number(values.get("missing"))) | 0;
  return total;
}

export function zeroSignOtherUse(n: number): string {
  const values = new Map<string, number>();
  values.set("key", -0);
  const held = values.get("key") ?? 0;
  const total = ((n | 0) + held) | 0;
  return String(total) + ":" + String(Object.is(held, -0)) + ":" + String(1 / held);
}

export function widerWriter(n: number): number {
  const values = new Map<string, number>();
  const wide: Map<string, unknown> = values;
  wide.set("key", n + 0.5);
  let total = n | 0;
  for (let i = 0; i < 8; i++) total = (total + (values.get("key") ?? 0)) | 0;
  return total;
}

export function twoUpdates(n: number): number {
  const values = new Map<string, number>();
  values.set("key", n | 0);
  let total = n | 0;
  for (let i = 0; i < 8; i++) {
    total = (total + (values.get("key") ?? 0)) | 0;
    if (i & 1) continue;
    total = (total - (values.get("key") ?? 0)) | 0;
  }
  return total;
}

export function extraFloatingUse(n: number): number {
  const values = new Map<string, number>();
  values.set("key", n | 0);
  const sum = (n | 0) + (values.get("key") ?? 0);
  return (sum | 0) + sum;
}

// Evaluating the right operand mutates the binding, but must still combine
// with the original left SSA operand that was read before the call.
export function capturedOrder(n: number): number {
  let total = n | 0;
  const change = (): number => { total = 17; return n | 0; };
  total = (total + change()) | 0;
  return total;
}

export function signedEdges(n: number): number {
  const values = new Map<string, number>();
  values.set("key", (n | 0) & 1 ? -2147483648 : 2147483647);
  let total = n | 0;
  for (let i = 0; i < 8; i++) total = (total - (values.get("key") ?? 0)) | 0;
  return total;
}
