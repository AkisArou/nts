// A record access uses ToPropertyKey, so true and "true" select the same
// entry. The control changes only the key; no boolean payload is a string.
function read(values: Record<string, number>, key: any): number {
  return values[key];
}
const values: Record<string, number> = { "true": 7 };
observe("string key control", String(read(values, "true")));
observe("boolean key", String(read(values, true)));
done();
