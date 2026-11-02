// Control for an-absent-record-key-compares-as-present: the same lookups with the value type declared `string | undefined`.
const registry: Record<string, string | undefined> = {};
function lookup(slot: string): string | undefined {
  if (registry[slot] === undefined) registry[slot] = "made:" + slot;
  return registry[slot];
}
observe("first lookup made", String(lookup("a") === "made:a"));
observe("second lookup made", String(lookup("a") === "made:a"));
done();
