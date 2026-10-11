// expect: no class in this program implements it, so its method has no body to declare
interface Reader { read(x: number): number }
interface Wide { read(x: number | string): number }
function call(reader: Reader, n: number): number { return reader.read(n); }
export function result(n: number): number {
  const literal: Wide = { read: (_x: number | string): number => n };
  const erased: any = literal;
  erased.read = (x: 3): number => x;
  return call(literal, n);
}
