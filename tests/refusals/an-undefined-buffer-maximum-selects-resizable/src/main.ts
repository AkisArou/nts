// expect: an erased value where a concrete representation is wanted
// These are contract guards: the explicit form is currently refused, and
// the omitted form agrees with node; no pre-fix wrong answer is claimed.
// An undefined maxByteLength selects a fixed buffer, as an absent option does.
// The control omits only that undefined option.
export function explicitMaximum(n: number): string {
  const maximum: any = undefined;
  try {
    const buffer = new ArrayBuffer(4, { maxByteLength: maximum });
    return String(buffer.byteLength) + ":" + String(buffer.resizable) + ":" + String(n & 3);
  } catch (error) { return (error as Error).name + ": " + (error as Error).message; }
}
export function omittedMaximum(n: number): string {
  try {
    const buffer = new ArrayBuffer(4);
    return String(buffer.byteLength) + ":" + String(buffer.resizable) + ":" + String(n & 3);
  } catch (error) { return (error as Error).name + ": " + (error as Error).message; }
}
