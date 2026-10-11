// run: check
// The class binding is unready again on every entry to this block.
export function repeated(n: number): string {
  let out = "";
  for (let i = 0; i < 2; i++) {
    const read = (): number => new Box(n + i).value;
    try { out += "no throw " + read(); } catch (error) {
      out += error instanceof ReferenceError ? "ReferenceError" : "other";
    }
    class Box {
      constructor(public value: number) {}
    }
    out += "/" + read() + ";";
  }
  return out;
}
