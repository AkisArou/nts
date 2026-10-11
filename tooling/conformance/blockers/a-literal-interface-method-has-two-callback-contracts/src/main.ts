// expect: emit-jvm -> `Wide` needs distinct dispatch bodies
interface NumberReader { read(cb: () => number): number }
interface StringReader { read(cb: () => string): number }
interface Wide { read(cb: () => unknown): number }
function numberValue(reader: NumberReader, n: number): number { return reader.read(() => n); }
function stringValue(reader: StringReader): number { return reader.read(() => "hello"); }
export function result(n: number): number {
  const literal: Wide = { read: (cb: () => unknown): number => typeof cb() === "number" ? n + 1 : n + 2 };
  return numberValue(literal, n) * 10 + stringValue(literal);
}
