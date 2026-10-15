// An erased object key never runs a program conversion to make a TypeError.
// Node can describe an ordinary object's constructor as #<Object>. This
// runtime deliberately omits that unavailable description. The explicit-throw
// control changes only the access; the receiver and erased key are identical.
function read(values: Record<string, number> | null, key: any, control: boolean): number {
  if (control) throw new TypeError("Cannot read properties of null (reading '#<Object>')");
  return values![key];
}
function attempted(control: boolean): string {
  try { return String(read(null, {}, control)); }
  catch (error) { return error instanceof TypeError ? error.message : "other error"; }
}
observe("explicit throw control", attempted(true));
observe("erased object key", attempted(false));
function namedKey() { return "x"; }
function functionRead(values: Record<string, number> | null, key: any, control: boolean): number {
  if (control) throw new TypeError("Cannot read properties of null (reading 'function namedKey() { return \"x\"; }')");
  return values![key];
}
function attemptedFunction(control: boolean): string {
  try { return String(functionRead(null, namedKey, control)); }
  catch (error) {
    if (!(error instanceof TypeError)) return "other error";
    // The Node harness reformats the function across lines. Check the source
    // prefix so those lines cannot cut the rest of the observation record.
    return error.message.startsWith("Cannot read properties of null (reading 'function namedKey() {")
      ? "has function source" : error.message;
  }
}
observe("explicit function throw control", attemptedFunction(true));
observe("erased function key", attemptedFunction(false));
done();
