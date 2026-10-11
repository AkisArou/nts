// Every literal at Wide owns its closure. Forwarders load it on each call;
// two captures and a replacement must remain distinct. Reading the field at
// its own type preserves closure identity, and typeof needs no wrapper.
interface Reader { read(x: number): number }
interface Wide { read(x: number | string): number }
function call(reader: Reader, n: number): number { return reader.read(n); }
function kind(reader: Reader): string { return typeof reader.read; }
export function twoCaptures(n: number): number {
  const left = n + 2, right = n + 7;
  const a: Wide = { read: (x: number | string): number => left + (typeof x === "number" ? x : 0) };
  const b: Wide = { read: (x: number | string): number => right + (typeof x === "number" ? x : 0) };
  return call(a, n) * 100 + call(b, n);
}
export function replacement(n: number): number {
  const left = n + 2, right = n + 7;
  const literal: Wide = { read: (_x: number | string): number => left };
  const face: Reader = literal;
  const before = call(face, n);
  literal.read = (_x: number | string): number => right;
  return before * 100 + call(face, n);
}
export function ownIdentity(n: number): boolean {
  const literal: Wide = { read: (_x: number | string): number => n };
  call(literal, n);
  return literal.read === literal.read;
}
export function callableKind(n: number): string {
  const literal: Wide = { read: (_x: number | string): number => n };
  return kind(literal);
}
export function specializedBody(n: number): number {
  const literal: Wide = {
    read(x: number | string): number {
      let sum = 0;
      if (typeof x === "number") {
        for (let i = 0; i < Math.abs(x % 8); i++) sum += i;
      }
      return sum;
    },
  };
  return call(literal, n);
}

export function unrelatedWrites(n: number): number {
  const literal: Wide = { read: (_x: number | string): number => n };
  const numbers: number[] = [0];
  numbers[0] = n + 1;
  const table: Record<string, number> = {};
  table["read"] = n + 2;
  const fresh: { marker?: number } = {};
  fresh.marker = n + 3;
  return call(literal, n) + numbers[0]! + table["read"]!;
}
