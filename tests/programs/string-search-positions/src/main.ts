// Positions are UTF-16 code units. The default population includes fractions,
// signed zero, NaN and infinities, as well as numbers outside the string.
function text(n: number): string { return (n & 1) === 0 ? "ababa" : "\u0100a\ud83d\ude00aba"; }
function needle(n: number): string { return (n & 2) === 0 ? "a" : ""; }
export function starts(n: number): number { return text(n).startsWith(needle(n), n) ? 1 : 0; }
export function ends(n: number): number { return text(n).endsWith(needle(n), n) ? 1 : 0; }
export function includes(n: number): number { return text(n).includes(needle(n), n) ? 1 : 0; }
export function index(n: number): number { return text(n).indexOf(needle(n), n); }
export function last(n: number): number { return text(n).lastIndexOf(needle(n), n); }
export function relative(n: number): string { return text(n).at(n) ?? "absent"; }
export function defaults(n: number): number {
  const s = text(n), q = needle(n);
  // @ts-expect-error Explicit undefined follows this builtin's ToNumber contract.
  const atUndefined = s.at(undefined);
  return (s.startsWith(q) ? 1 : 0) + (s.startsWith(q, undefined) ? 2 : 0)
    + (s.endsWith(q) ? 4 : 0) + (s.endsWith(q, undefined) ? 8 : 0)
    + (s.includes(q) ? 16 : 0) + (s.includes(q, undefined) ? 32 : 0)
    + s.indexOf(q) * 64 + s.indexOf(q, undefined) * 128
    + s.lastIndexOf(q) * 256 + s.lastIndexOf(q, undefined) * 512
    + (s.at(0) === atUndefined ? 1024 : 0);
}
export function nanDefaults(n: number): number {
  const s = text(n), q = needle(n);
  return (s.startsWith(q, NaN) ? 1 : 0) + (s.endsWith(q, NaN) ? 2 : 0)
    + (s.includes(q, NaN) ? 4 : 0) + s.indexOf(q, NaN) * 8
    + s.lastIndexOf(q, NaN) * 16 + (s.at(NaN) === s.at(0) ? 128 : 0);
}
export function primitivePosition(n: number): number {
  let p: any = undefined;
  if ((n & 7) === 1) p = null;
  if ((n & 7) === 2) p = "2.9";
  if ((n & 7) === 3) p = "not numeric";
  if ((n & 7) === 4) p = true;
  if ((n & 7) === 5) p = false;
  if ((n & 7) === 6) p = "-1.9";
  if ((n & 7) === 7) p = "Infinity";
  const s = text(n), q = needle(n);
  return (s.startsWith(q, p) ? 1 : 0) + (s.endsWith(q, p) ? 2 : 0)
    + (s.includes(q, p) ? 4 : 0) + s.indexOf(q, p) * 8
    + s.lastIndexOf(q, p) * 16 + (s.at(p) === undefined ? 128 : 0);
}
export function utf16(n: number): number {
  const s = "a\ud83d\ude00a\u0100a";
  return (s.startsWith("\ude00", n) ? 1 : 0) + (s.endsWith("\ud83d", n) ? 2 : 0)
    + (s.includes("\u0100", n) ? 4 : 0) + s.indexOf("a", n) * 8
    + s.lastIndexOf("a", n) * 16;
}
export function longerNeedle(n: number): number {
  const s = text(n), q = s + "too long";
  return (s.startsWith(q, n) ? 1 : 0) + (s.endsWith(q, n) ? 2 : 0)
    + (s.includes(q, n) ? 4 : 0) + s.indexOf(q, n) * 8 + s.lastIndexOf(q, n) * 16;
}
export function noPosition(n: number): number {
  const s = text(n), q = needle(n);
  return (s.startsWith(q) ? 1 : 0) + (s.endsWith(q) ? 2 : 0)
    + (s.includes(q) ? 4 : 0) + s.indexOf(q) * 8 + s.lastIndexOf(q) * 16;
}
export function argumentOrder(n: number): number {
  let order = 0;
  function mark(value: number): number { order = order * 10 + value; return value; }
  const s = n < 0 ? "other" : "ababa";
  try {
    // @ts-expect-error Extra arguments are evaluated before ToNumber throws.
    s.startsWith((mark(1), "a"), (mark(2), 1n as any), mark(3));
  } catch (error) {
    return error instanceof TypeError ? order : -1;
  }
  return -2;
}

export function omittedAt(n: number): string {
  // @ts-expect-error At runtime an omitted index is ToIntegerOrInfinity(undefined).
  return text(n).at() ?? "absent";
}
export function emptyReceiver(n: number): number {
  const s = "", q = needle(n);
  return (s.startsWith(q, n) ? 1 : 0) + (s.endsWith(q, n) ? 2 : 0)
    + (s.includes(q, n) ? 4 : 0) + s.indexOf(q, n) * 8
    + s.lastIndexOf(q, n) * 16 + (s.at(n) === undefined ? 128 : 0);
}
export function positionTypeError(n: number): number {
  const p: any = (n & 1) === 0 ? 1n : Symbol("position");
  let caught = 0;
  try { text(n).startsWith("a", p); } catch (e) { if (e instanceof TypeError) caught += 1; }
  try { text(n).endsWith("a", p); } catch (e) { if (e instanceof TypeError) caught += 2; }
  try { text(n).includes("a", p); } catch (e) { if (e instanceof TypeError) caught += 4; }
  try { text(n).indexOf("a", p); } catch (e) { if (e instanceof TypeError) caught += 8; }
  try { text(n).lastIndexOf("a", p); } catch (e) { if (e instanceof TypeError) caught += 16; }
  try { text(n).at(p); } catch (e) { if (e instanceof TypeError) caught += 32; }
  return caught;
}

export function surplusNotCoerced(n: number): number {
  let order = 0;
  function mark(value: number): number { order = order * 10 + value; return value; }
  const ignored = Symbol("ignored");
  // @ts-expect-error A surplus Symbol argument is evaluated, never converted.
  const found = text(n).startsWith((mark(1), "a"), (mark(2), n), (mark(3), ignored));
  return order * 2 + (found ? 1 : 0);
}
export function surplusAt(n: number): number {
  let order = 0;
  function mark(value: number): number { order = order * 10 + value; return value; }
  // @ts-expect-error Only the first argument of at is converted.
  const found = text(n).at((mark(1), n), (mark(2), Symbol("ignored")));
  return order * 2 + (found === undefined ? 1 : 0);
}

export function checkedErasedNeedle(n: number): number {
  const nullable: string | undefined = n < 0 ? undefined : "a";
  if (n < 0) return -1;
  return text(n).indexOf((nullable as unknown as string), n);
}

export function nullAt(n: number): string {
  // @ts-expect-error Literal null has the numeric index zero at runtime.
  return text(n).at(null) ?? "absent";
}

export function shadowedUndefined(undefined: number): string {
  return "abc".at(undefined) ?? "absent";
}
export function surplusAbsent(n: number): number {
  let count = 0;
  function mark(): void { count++; }
  // @ts-expect-error A surplus undefined value still evaluates its operand.
  const found = text(n).startsWith("a", n, void mark());
  return count * 2 + (found ? 1 : 0);
}
