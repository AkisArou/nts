interface OptionalLabel { readonly label?: string; readonly absent?: string; }
interface Parent { readonly value: number; }
interface Child extends Parent { readonly extra: number; }
function label(value: OptionalLabel): string { return String(value.label) + String(value.absent); }
export function defaultLabel(value: unknown): string { return label(value as OptionalLabel); }
class Base {
  toJSON(): Parent { return {value: 7}; }
}
class Derived extends Base {
  label = "derived";
  toJSON(): Child { return {value: 8, extra: 9}; }
}
export function recordValue(n: number): number {
  const values: Base[] = [new Base(), new Derived()];
  return values[n > 0 ? 0 : 1]!.toJSON().value;
}
// The record layouts must actually reach the optional face. Merely having an
// unrelated structurally compatible face does not give them native rows.
export function recordLabel(n: number): string {
  const record = n > 0 ? new Derived().toJSON() : new Base().toJSON();
  return label(record as OptionalLabel);
}
