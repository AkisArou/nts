// React's $$typeof read through an `object` cast used to return null even
// though the object held a number. The control changes only the binding's
// static type: it names the record shape directly instead of asserting it.
export function throughCast(n: number): string {
  const value: object = { $$typeof: n };
  const read = (value as { $$typeof?: unknown }).$$typeof;
  return typeof read + ":" + String(read);
}

export function typedBinding(n: number): string {
  const value: { $$typeof?: unknown } = { $$typeof: n };
  const read = value.$$typeof;
  return typeof read + ":" + String(read);
}
