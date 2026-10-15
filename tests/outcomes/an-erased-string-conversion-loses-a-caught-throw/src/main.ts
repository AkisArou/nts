// run: check
//
// A class toString called through erased String() throws the same RangeError
// as the explicit-throw control. Node catches both in the caller. On the
// genuine main63e6cc0d7731 pin, the descriptor calls the ordinary toString
// entry and its RangeError escapes: 16 of 58 cases disagree, all converted.
// This is a guard for the catchability a property-key or numeric conversion
// must preserve when it invokes a program method.

class Key {
  constructor(private readonly fails: boolean) {}
  toString(): string {
    if (this.fails) throw new RangeError("key");
    return "x";
  }
}
function stringify(key: any): string { return String(key); }
function explicit(fails: boolean): string {
  if (fails) throw new RangeError("key");
  return "x";
}
export function converted(n: number): string {
  try { return stringify(new Key((n & 1) !== 0)); }
  catch (e) { return "caught " + (e as Error).message; }
}
export function control(n: number): string {
  try { return explicit((n & 1) !== 0); }
  catch (e) { return "caught " + (e as Error).message; }
}
