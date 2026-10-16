// A descriptor's printer is selected per physical layout. These two classes
// share a layout but have different printers, so an erased String conversion
// stops by name. Direct calls to the same methods are the control.
class Left {
  n: number;
  constructor(n: number) { this.n = n; }
  toString(): string { return "left" + this.n; }
}
class Right {
  n: number;
  constructor(n: number) { this.n = n; }
  toString(): string { return "right" + this.n; }
}
export function erased(n: number): string {
  const value: any = (n & 1) === 0 ? new Left(n) : new Right(n);
  return String(value);
}
export function direct(n: number): string {
  return (n & 1) === 0 ? new Left(n).toString() : new Right(n).toString();
}
observe("control", direct(1));
observe("erased", erased(1));
done();
