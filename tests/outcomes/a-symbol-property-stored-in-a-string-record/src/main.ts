// A symbol store is a different property from its description's string.
// The control changes only the key. String tables cannot retain symbol
// properties yet; the guard requires a named stop rather than an alias.
function store(key: any): string {
  const values: Record<string, unknown> = { x: 2 };
  values[key] = 7;
  return String(values.x) + ";" + String(values[key]);
}
observe("string key control", store("x"));
observe("symbol key", store(Symbol("x")));
done();
