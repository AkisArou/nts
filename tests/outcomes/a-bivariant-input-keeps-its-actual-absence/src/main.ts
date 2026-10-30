// run: check
// A non-null declaration cannot erase an absent argument admitted by a wider
// method contract. Checking only the later property access misses these reads.
// The control changes only BodyInput to include the already-admitted undefined.
type BodyInput = number[];
interface Receiver {
  equals(value: number[] | undefined): number;
  kind(value: number[] | undefined): number;
  erased(value: number[] | undefined): number;
}
class Implementation implements Receiver {
  equals(value: BodyInput): number { return value === undefined ? -1 : 2; }
  kind(value: BodyInput): number { return typeof value === "undefined" ? -1 : 2; }
  erased(value: BodyInput): number { return (value as unknown) === undefined ? -1 : 2; }
}
export function work(n: number): number {
  const receiver: Receiver = new Implementation();
  const value = n === 1 ? undefined : [1, 2];
  return receiver.equals(value) + receiver.kind(value) + receiver.erased(value);
}
