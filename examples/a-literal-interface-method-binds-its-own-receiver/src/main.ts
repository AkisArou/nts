// A shorthand method receives the literal as this through another face.
interface Reader { read(x: number): number }
interface Wide { base: number; read(x: number | string): number }
function call(reader: Reader, n: number): number { return reader.read(n); }
export function result(n: number): number {
  const literal: Wide = {
    base: n + 5,
    read(x: number | string): number {
      return this.base + (typeof x === "number" ? x : 0);
    },
  };
  return call(literal, n);
}
