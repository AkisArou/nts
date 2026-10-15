// A record access uses ToPropertyKey, so the numeric key and its string
// spelling select the same entry. The control changes only the key.
// The string-specialized table hash must never receive a number payload.
function read(values: Record<string, number>, key: any): number {
  return values[key];
}
const values: Record<string, number> = { "1": 7 };
observe("string key control", String(read(values, "1")));
observe("number key", String(read(values, 1)));
done();
