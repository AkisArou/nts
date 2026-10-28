// A function field is projected through two callback-result contracts.
// Both projections must preserve the callback result tag on the JVM too.
interface NumberReader { read(cb: () => number): number }
interface StringReader { read(cb: () => string): number }
interface Wide { read(cb: () => unknown): number }
function numberValue(reader: NumberReader, n: number): number { return reader.read(() => n); }
function stringValue(reader: StringReader): number { return reader.read(() => "hello"); }
export function result(n: number): number {
  const literal: Wide = { read: (cb: () => unknown): number => typeof cb() === "number" ? n + 1 : n + 2 };
  return numberValue(literal, n) * 10 + stringValue(literal);
}

// Control: both callbacks use one common unknown-result contract instead of
// the two narrower contracts above. The literal supplier stays identical.
function oneContract(reader: Wide, n: number): number {
  return reader.read(() => n) * 10 + reader.read(() => "hello");
}
export function resultControl(n: number): number {
  const literal: Wide = { read: (cb: () => unknown): number => typeof cb() === "number" ? n + 1 : n + 2 };
  return oneContract(literal, n);
}
