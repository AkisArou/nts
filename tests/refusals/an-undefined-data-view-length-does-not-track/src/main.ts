// expect: an erased value where a concrete representation is wanted
// These are contract guards: the explicit form is currently refused, and
// the omitted form agrees with node; no pre-fix wrong answer is claimed.
// An explicit undefined length has the same tracking mode as an omitted one.
// The control changes only whether that undefined is written explicitly.
export function explicitLength(n: number): string {
  const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
  const length: any = undefined;
  const view = new DataView(buffer, 0, length);
  const before = view.byteLength;
  buffer.resize(6);
  return String(before) + ":" + String(view.byteLength) + ":" + String(n & 3);
}
export function omittedLength(n: number): string {
  const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
  const view = new DataView(buffer, 0);
  const before = view.byteLength;
  buffer.resize(6);
  return String(before) + ":" + String(view.byteLength) + ":" + String(n & 3);
}
