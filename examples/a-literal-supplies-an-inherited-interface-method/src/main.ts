interface Reader { read(x: number): unknown }
interface Base { read(x: number | string): unknown }
interface Derived extends Base { status: string }
function call(reader: Reader, n: number): string { return typeof reader.read(n); }
export function result(n: number): string {
  const literal: Derived = { status: "rejected", read(): void {} };
  return call(literal, n);
}
