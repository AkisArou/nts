// ARES-6 Babylon return-record control: only the type declaration changes.
interface ValuePart { value: number; }
interface LabelPart { label: string; }
interface Result extends ValuePart, LabelPart {}
function make(n: number): Result { return { value: n, label: "r" }; }
export function work(n: number): number {
  const result = make(n);
  return result.value + result.label.length;
}
