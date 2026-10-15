// A null receiver throws before ToPropertyKey can call program code.
// The control changes only the access to the same explicit TypeError: both
// receive the same null receiver and side-effecting key. Main10b84bb5f8fb
// prints its assertion text; the initial access guard instead called Key's
// toString while building the error. Node never calls it in either arm.
let trace = "";
class Key { toString(): string { trace += "coerced;"; return "x"; } }
function read(values: Record<string, number> | null, key: any, control: boolean): number {
  if (control) throw new TypeError("Cannot read properties of null");
  return values![key];
}
function attempted(control: boolean): string {
  trace = "";
  try { return String(read(null, new Key(), control)) + ";" + trace; }
  catch (error) { return (error instanceof TypeError ? error.message : "other error") + ";" + trace; }
}
observe("explicit throw control", attempted(true));
observe("null receiver", attempted(false));
done();
