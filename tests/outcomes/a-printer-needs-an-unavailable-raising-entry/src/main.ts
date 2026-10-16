// The printer calls a generic method, whose throwing entry this compiler
// cannot yet name. Its descriptor keeps the existing named run-time stop;
// it must never fall back to the ordinary printer or refuse unrelated values.
// The control throws explicitly before calling a non-throwing printer.

class Picker {
  pick<T>(value: T, deep: boolean): T {
    if (deep) throw 22;
    return value;
  }
}
class NeedsRaising {
  n: number;
  constructor(n: number) { this.n = n; }
  toString(): string { return new Picker().pick("x", this.n < 0); }
}
class Quiet {
  quiet = true;
  toString(): string { return "x"; }
}

export function unavailable(n: number): string {
  try { return String(new NeedsRaising(n)); }
  catch { return "caught"; }
}
export function control(n: number): string {
  try {
    if (n < 0) throw 22;
    return String(new Quiet());
  } catch { return "caught"; }
}

observe("control", control(1));
observe("unavailable printer", unavailable(1));
done();
