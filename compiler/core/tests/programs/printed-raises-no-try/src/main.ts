// No try anywhere: the descriptor must still select the raising callback,
// and the ordinary conversion must turn its pending payload into an uncaught
// language throw rather than return the callback's null placeholder.
class Printer {
  n: number;
  constructor(n: number) { this.n = n; }
  toString(): string {
    if (this.n < 0) throw 22;
    return "ok";
  }
}
class Quiet {
  quiet = true;
  toString(): string { return "quiet"; }
}
export function converted(n: number): string { return String(new Printer(n)); }
export function errorMessage(n: number): string {
  return new Error(new Printer(n) as any, { cause: n }).message;
}
export function aggregateMessage(n: number, errors: any): string {
  return new AggregateError(errors, new Printer(n) as any, { cause: n }).message;
}
export function primitive(n: number): string { return String(n); }
export function primitiveErased(n: number): string {
  const value: any = n;
  return String(value);
}
export function quiet(_n: number): string { return String(new Quiet()); }
