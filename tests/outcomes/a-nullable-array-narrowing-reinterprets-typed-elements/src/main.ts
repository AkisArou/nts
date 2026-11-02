// Node 26 validateObject (489881a3) exposed this handoff: narrowing unknown
// to an array-or-null must not reinterpret a number[] as erased-element storage.
// The control removes only `value === null ||`; both read 42 on Node.
// The prepared subject currently inserts unerase<[erased]> then erase.or.null
// before passing the original value to read(). No element is read by that cast.
function read(value: unknown): string {
  return Array.isArray(value) ? String(value[0]) : "not an array";
}
function inspect(value: unknown): string {
  if (value === null || Array.isArray(value)) return read(value);
  return "other";
}
const values: number[] = [42];
observe("first", inspect(values));
done();
