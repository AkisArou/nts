// run: check
// A deleted own field must reveal its inherited getter (#229).
// The one-change control keeps the own field. Both use typed reads, so this
// isolates deletion from the separate erased dynamic-read defect (#284).
class Base { get same(): string { return "base"; } }
class Child extends Base {
  // @ts-expect-error TS2610: JavaScript own fields can shadow an inherited accessor.
  same?: string;
  constructor(n: number) { super(); this.same = String(n); }
}
export function deletedOwnField(n: number): string {
  const value = new Child(n);
  delete value.same;
  return String(value.same);
}
export function ownFieldKept(n: number): string {
  const value = new Child(n);
  return String(value.same);
}
