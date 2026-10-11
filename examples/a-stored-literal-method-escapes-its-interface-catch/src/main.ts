// The adapter selects the closure's raising entry before decoding its result.
// A declared implementation in the same table is the control.
interface Reader { read(x: number): number }
interface Wide { read(x: number | string): number }
class Exact implements Reader {
  read(x: number): number { return x + 1; }
}
function call(reader: Reader, n: number): number {
  try { return reader.read(n); } catch { return 17; }
}
export function captured(n: number): number {
  const literal: Wide = {
    read: (x: number | string): number => {
      if (typeof x === "number" && x < 0) throw new Error("bad");
      return n + 5;
    },
  };
  return call(literal, n);
}
export function mixed(n: number): number {
  const literal: Wide = {
    read(x: number | string): number {
      if (typeof x === "number" && x < 0) throw new Error("bad");
      return n + 5;
    },
  };
  const rows: Reader[] = [literal, new Exact()];
  return call(rows[n > 0 ? 1 : 0]!, n);
}
