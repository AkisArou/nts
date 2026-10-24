// The second const aliases the first; every consumer still sees its tag.
// The numeric arm differs from the typeof control only in the consumer.
function source(n: number): unknown {
  return (n & 1) === 0 ? { value: n } : { label: "missing" };
}

export function kind(n: number): string {
  const first = (source(n) as { value: number }).value;
  const second = first;
  return typeof second;
}

export function numeric(n: number): number {
  const first = (source(n) as { value: number }).value;
  const second = first;
  return second * 2;
}

export function text(n: number): string {
  const value: unknown = { text: String(n) };
  const first = (value as { text: string }).text;
  const second = first;
  return second;
}
