// A symbol-named field needs the actual property key in a null receiver's
// TypeError. The non-null control differs only in the receiver. Main's
// 10b84bb5f8fb throws the native assertion text; the first access-guard WIP
// instead printed the variable name "flag", rather than "Symbol(flag)".
const flag = Symbol("flag");
class Box {
  [flag]: number;
  constructor() { this[flag] = 8; }
}
function read(values: Box | null): number { return values![flag]; }
function attempted(values: Box | null): string {
  try { return String(read(values)); }
  catch (error) { return error instanceof TypeError ? "TypeError: " + error.message : "other error"; }
}
observe("non-null control", attempted(new Box()));
observe("null receiver", attempted(null));
done();
