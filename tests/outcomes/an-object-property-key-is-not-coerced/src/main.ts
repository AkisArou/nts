// The control changes only the key from an object with toString to its
// primitive result. Node calls toString exactly once for the object key;
// main10b84bb5f8fb instead finds no entry, returns 0 and calls no code.
let trace = "";
class Key { toString(): string { trace += "coerced;"; return "x"; } }
function read(values: Record<string, number>, key: any): number { return values[key]; }
function attempted(key: any): string {
  trace = "";
  return String(read({ x: 7 }, key)) + ";" + trace;
}
observe("primitive key control", attempted("x"));
observe("object key", attempted(new Key()));
done();
